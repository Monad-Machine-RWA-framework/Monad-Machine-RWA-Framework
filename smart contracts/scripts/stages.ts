import { ethers } from "hardhat";
import { CleanverseClient } from "../src/cleanverse/client";
import { Ctx, fmt, saveState } from "./context";

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);

/**
 * Stage 1 - Onboard participants.
 * Create A-Pass identities (via Cleanverse gateway or mock) for Alice, Bob and
 * Charlie, attach KYC claims, and sync the A-Pass projection into the on-chain
 * IdentityRegistry. Dave is deliberately left un-onboarded.
 */
export async function stage01Onboard(ctx: Ctx): Promise<void> {
  console.log(`\n=== Stage 1: Onboard (Cleanverse mode: ${ctx.service.mode}) ===`);
  const { alice, bob, charlie } = ctx.participants;

  const people = [
    { role: "alice", signer: alice, tier: 30, group: "AA", name: "Alice" },
    { role: "bob", signer: bob, tier: 26, group: "AA", name: "Bob" },
    { role: "charlie", signer: charlie, tier: 26, group: "AA", name: "Charlie" },
  ];

  for (const p of people) {
    const address = await p.signer.getAddress();
    // customerId: >=12 chars, [A-Za-z0-9] only.
    const customerId = `CV${p.name}${address.slice(2, 14)}`.replace(/[^A-Za-z0-9]/g, "");
    const proj = await ctx.oracle.onboard({
      customerId,
      chain: ctx.chain,
      address,
      tier: p.tier,
      group: p.group,
      fullName: p.name,
    });
    ctx.state.customers[p.role] = customerId;
    console.log(
      `  ${p.name}: A-Pass tier ${proj.tier} group "${proj.group}" cvRecordId ${proj.cvRecordId} -> registry`
    );
  }
  saveState(ctx.state);
}

/**
 * Stage 2 - Asset side.
 * The Machine Issuer mints Machine NFTs to Alice; then Alice proposes a
 * multi-party Contract NFT with Bob and Charlie, who both accept (minting it).
 */
export async function stage02Assets(ctx: Ctx): Promise<void> {
  console.log("\n=== Stage 2: Assets (Machine NFTs + multi-party Contract NFT) ===");
  const { deployer, alice, bob, charlie } = ctx.participants;
  const aliceAddr = await alice.getAddress();

  const machineNFT = ctx.machineNFT.connect(deployer);
  const machines = [
    { serial: "MX-1001", model: "CNC-Mill", value: USDC(1000) },
    { serial: "MX-1002", model: "Laser-Cutter", value: USDC(1000) },
  ];
  ctx.state.machineIds = [];
  for (const m of machines) {
    const tx = await machineNFT.mintMachine(aliceAddr, m.serial, m.model, m.value);
    const rc = await tx.wait();
    // tokenId is sequential starting at 1.
    const tokenId = await getMintedTokenId(machineNFT, rc);
    ctx.state.machineIds.push(tokenId.toString());
    console.log(`  Minted Machine #${tokenId} (${m.serial}) to Alice, value ${fmt(m.value)} USDC`);
  }

  // Multi-party contract: Alice proposes, Bob + Charlie accept.
  const parties = [aliceAddr, await bob.getAddress(), await charlie.getAddress()];
  const proposeTx = await ctx.contractNFT
    .connect(alice)
    .propose(parties, "Joint machine operating agreement (Alice/Bob/Charlie)");
  const proposeRc = await proposeTx.wait();
  const proposalId = await getProposalId(ctx.contractNFT, proposeRc);
  ctx.state.contractProposalId = proposalId.toString();
  console.log(`  Alice proposed Contract agreement #${proposalId} (auto-accepted)`);

  await (await ctx.contractNFT.connect(bob).accept(proposalId)).wait();
  console.log("  Bob accepted");
  await (await ctx.contractNFT.connect(charlie).accept(proposalId)).wait();
  console.log("  Charlie accepted -> Contract NFT finalized");

  const tokenId = await ctx.contractNFT.tokenIdOfProposal(proposalId);
  ctx.state.contractTokenId = tokenId.toString();
  console.log(`  Contract NFT #${tokenId} minted to Alice`);
  saveState(ctx.state);
}

/**
 * Stage 3 - Vault and token.
 * Admin assigns Alice as vault controller, configures the ComplianceModule rule
 * (Validator pool mirror), unpauses the SecurityToken, and confirms Alice/Bob/
 * Charlie are registered + verified in the Identity Registry.
 */
export async function stage03VaultToken(ctx: Ctx): Promise<void> {
  console.log("\n=== Stage 3: Vault + token (controller, rule, unpause, verify) ===");
  const { deployer, alice, bob, charlie } = ctx.participants;
  const aliceAddr = await alice.getAddress();

  await (await ctx.vault.connect(deployer).setController(aliceAddr)).wait();
  console.log("  Vault controller set to Alice");

  // Compliance rule mirrors a Cleanverse Validator rule: min_tier 5, no group filter.
  await (
    await ctx.compliance.connect(deployer).setRule({
      allowedGroup: "0x0000",
      allowedSubGroup: "0x0000",
      minTier: 5,
      minSubTier: 0,
    })
  ).wait();
  console.log("  ComplianceModule rule set (minTier 5)");

  await (await ctx.securityToken.connect(deployer).setPaused(false)).wait();
  console.log("  SecurityToken unpaused");

  for (const [name, signer] of [
    ["Alice", alice],
    ["Bob", bob],
    ["Charlie", charlie],
  ] as const) {
    const addr = await signer.getAddress();
    const verified = await ctx.compliance.verify(addr);
    console.log(`  Identity Registry verify ${name}: ${verified}`);
    if (!verified) throw new Error(`${name} failed compliance verification`);
  }
  saveState(ctx.state);
}

/**
 * Stage 4 - Collateralize and mint.
 * Alice approves the vault to move her Machine + Contract NFTs, deposits them as
 * collateral, then mints SecurityTokens against the declared valuations.
 */
export async function stage04CollateralizeMint(ctx: Ctx): Promise<void> {
  console.log("\n=== Stage 4: Collateralize + mint ===");
  const { alice } = ctx.participants;
  const aliceAddr = await alice.getAddress();
  const vaultAddr = ctx.addresses.vault;

  await (await ctx.machineNFT.connect(alice).setApprovalForAll(vaultAddr, true)).wait();
  const contractTokenId = ctx.state.contractTokenId!;
  await (await ctx.contractNFT.connect(alice).approve(vaultAddr, contractTokenId)).wait();
  console.log("  Alice approved vault for Machine NFTs + Contract NFT");

  const machineIds = ctx.state.machineIds.map((s) => BigInt(s));
  await (
    await ctx.vault.connect(alice).depositCollateral(machineIds, contractTokenId)
  ).wait();
  const collateral = await ctx.vault.totalCollateralValue();
  console.log(`  Deposited collateral; total value ${fmt(collateral)} USDC`);

  const mintAmount = USDC(1000);
  await (await ctx.vault.connect(alice).mint(aliceAddr, mintAmount)).wait();
  const bal = await ctx.securityToken.balanceOf(aliceAddr);
  console.log(`  Minted ${fmt(mintAmount)} MRWA to Alice (balance ${fmt(bal)})`);
  saveState(ctx.state);
}

/**
 * Stage 5 - Transfers and yield.
 * Alice transfers tokens to Bob and Charlie (compliance-gated; a transfer to the
 * un-onboarded Dave is expected to revert). Alice deposits yield; Bob claims his
 * yield and also claims on Charlie's behalf.
 */
export async function stage05TransfersYield(ctx: Ctx): Promise<void> {
  console.log("\n=== Stage 5: Transfers + yield ===");
  const { alice, bob, charlie, dave } = ctx.participants;
  const [bobAddr, charlieAddr, daveAddr] = await Promise.all([
    bob.getAddress(),
    charlie.getAddress(),
    dave.getAddress(),
  ]);

  const tx1 = await ctx.securityToken.connect(alice).transfer(bobAddr, USDC(100));
  const rc1 = await tx1.wait();
  ctx.state.lastTransferTxHash = rc1?.hash;
  console.log(`  Alice -> Bob 100 MRWA (tx ${rc1?.hash})`);
  await (await ctx.securityToken.connect(alice).transfer(charlieAddr, USDC(100))).wait();
  console.log("  Alice -> Charlie 100 MRWA");

  // Negative case: Dave has no A-Pass, so compliance must block the transfer.
  try {
    await ctx.securityToken.connect(alice).transfer(daveAddr, USDC(1));
    console.log("  WARNING: transfer to un-onboarded Dave unexpectedly succeeded");
  } catch {
    console.log("  Transfer to un-onboarded Dave correctly BLOCKED by compliance");
  }

  // Yield: fund Alice with MockUSDC, then deposit yield into the vault.
  const yieldAmount = USDC(30);
  await (await ctx.mockUSDC.faucet(await alice.getAddress(), yieldAmount)).wait();
  await (await ctx.mockUSDC.connect(alice).approve(ctx.addresses.vault, yieldAmount)).wait();
  await (await ctx.vault.connect(alice).depositYield(yieldAmount)).wait();
  console.log(`  Alice deposited ${fmt(yieldAmount)} USDC yield into the vault`);

  const bobPending = await ctx.vault.pendingYield(bobAddr);
  const charliePending = await ctx.vault.pendingYield(charlieAddr);
  console.log(`  Pending yield -> Bob ${fmt(bobPending)}, Charlie ${fmt(charliePending)} USDC`);

  await (await ctx.vault.connect(bob).claimYield()).wait();
  console.log("  Bob claimed his own yield");
  await (await ctx.vault.connect(bob).claimYieldFor(charlieAddr)).wait();
  console.log("  Bob claimed yield on Charlie's behalf");

  const bobUsdc = await ctx.mockUSDC.balanceOf(bobAddr);
  const charlieUsdc = await ctx.mockUSDC.balanceOf(charlieAddr);
  console.log(`  Final USDC -> Bob ${fmt(bobUsdc)}, Charlie ${fmt(charlieUsdc)}`);

  // Live mode: attempt Travel Rule export for the MRWA transfer.
  if (ctx.service.mode === "live" && ctx.state.lastTransferTxHash) {
    try {
      const client = new CleanverseClient({
        baseUrl: process.env.CLEANVERSE_BASE_URL || "https://uatapi.cleanverse.com/api/cooperate",
        apiId: process.env.CLEANVERSE_API_ID!,
        apiKey: process.env.CLEANVERSE_API_KEY!,
      });
      const aliceAddr = await alice.getAddress();
      const res = await client.downloadTravelRule({
        txHash: ctx.state.lastTransferTxHash,
        wallet: { chain: ctx.chain, address: aliceAddr },
        customerId: ctx.state.customers?.alice,
      });
      console.log(`  download_travel_rule (MRWA): code=${res.code} ${res.message}`);
      if (res.data?.downloadUrl) console.log(`  ${res.data.downloadUrl}`);
    } catch (e: any) {
      console.log(`  download_travel_rule skipped: ${e.message ?? e}`);
    }
  }
  saveState(ctx.state);
}

// --- helpers to extract ids from receipts ---

async function getMintedTokenId(contract: any, receipt: any): Promise<bigint> {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "MachineMinted") return parsed.args.tokenId as bigint;
    } catch {
      /* not our event */
    }
  }
  throw new Error("MachineMinted event not found");
}

async function getProposalId(contract: any, receipt: any): Promise<bigint> {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "AgreementProposed") return parsed.args.proposalId as bigint;
    } catch {
      /* not our event */
    }
  }
  throw new Error("AgreementProposed event not found");
}
