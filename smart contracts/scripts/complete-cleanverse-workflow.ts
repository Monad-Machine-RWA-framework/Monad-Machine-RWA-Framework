/**
 * Cleanverse compliance audit + MRWA transfer on existing Monad deployment.
 *
 * Uses the initial MRWA SecurityToken from deployments.monad.json as the sole
 * machine representation token. Cleanverse provides A-Pass identity (generate/
 * query_apass); MRWA transfers are gated on-chain via the A-Pass-synced registry.
 *
 * Note: verify_apass and download_travel_rule against MRWA may fail until MRWA
 * is registered with Cleanverse as an A-Token — planned for a future release.
 *
 * Usage: npm run flow:monad:audit
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
dotenv.config();

import { ethers } from "ethers";
import { CleanverseClient } from "../src/cleanverse/client";
import { getChain } from "../src/cleanverse/mode";
import { getMonadParticipants } from "./context";

const MONAD_STATE = path.join(__dirname, "..", "deployments.monad.json");
const OUT = path.join(__dirname, "..", "deployments.cleanverse-audit.json");

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(MONAD_STATE)) {
    throw new Error("Run npm run flow:monad first to deploy the machine RWA stack.");
  }

  const monad = JSON.parse(fs.readFileSync(MONAD_STATE, "utf8"));
  const mrwaAddress = monad.addresses.securityToken as string;

  const client = new CleanverseClient({
    baseUrl:
      process.env.CLEANVERSE_BASE_URL ||
      "https://uatapi.cleanverse.com/api/cooperate",
    apiId: process.env.CLEANVERSE_API_ID!,
    apiKey: process.env.CLEANVERSE_API_KEY!,
  });
  const chain = getChain();
  const { alice, bob } = await getMonadParticipants();
  const aliceAddr = await alice.getAddress();
  const bobAddr = await bob.getAddress();
  const transferAmount = ethers.parseUnits("10", 6);

  const audit: Record<string, unknown> = {
    token: "MRWA",
    mrwaAddress,
    chain,
    timestamp: new Date().toISOString(),
  };

  console.log(`=== MRWA machine token: ${mrwaAddress} ===\n`);
  console.log("=== Cleanverse A-Pass (identity) ===\n");

  for (const [name, addr] of [
    ["alice", aliceAddr],
    ["bob", bobAddr],
  ] as const) {
    const apass = await client.queryApass({ chain, address: addr });
    const verify = await client.verifyApass(chain, mrwaAddress, addr);
    console.log(
      `${name} query_apass: tier=${(apass.data as any)?.tier} cvRecordId=${(apass.data as any)?.cvRecordId}`
    );
    console.log(
      `${name} verify_apass (MRWA): code=${verify.data?.code} (${verify.data?.message})`
    );
    audit[`${name}_apass`] = apass;
    audit[`${name}_verify_apass_mrwa`] = verify;
  }

  console.log("\n=== MRWA transfer (on-chain A-Pass compliance) ===\n");
  const mrwa = new ethers.Contract(mrwaAddress, ERC20_ABI, alice);
  const aliceMrwa = (await mrwa.balanceOf(aliceAddr)) as bigint;
  console.log(`Alice MRWA balance: ${ethers.formatUnits(aliceMrwa, 6)}`);
  if (aliceMrwa < transferAmount) {
    throw new Error("Alice has insufficient MRWA. Re-run npm run flow:monad.");
  }

  const transferTx = await mrwa.transfer(bobAddr, transferAmount);
  const transferRc = await transferTx.wait();
  const transferHash = transferRc!.hash;
  console.log(`Alice -> Bob ${ethers.formatUnits(transferAmount, 6)} MRWA`);
  console.log(`Tx: https://testnet.monadscan.com/tx/${transferHash}`);
  audit.mrwa_transfer_tx = transferHash;
  monad.lastTransferTxHash = transferHash;
  fs.writeFileSync(MONAD_STATE, JSON.stringify(monad, null, 2));

  console.log("\n=== download_travel_rule ===\n");
  await sleep(15_000);
  const travel = await client.downloadTravelRule({
    txHash: transferHash,
    wallet: { chain, address: aliceAddr },
    customerId: monad.customers?.alice,
  });
  audit.travel_rule = travel;
  console.log(`code=${travel.code} ${travel.message}`);
  if (travel.code === "0000" && travel.data?.downloadUrl) {
    console.log(travel.data.downloadUrl);
  }

  fs.writeFileSync(OUT, JSON.stringify(audit, null, 2));
  console.log(`\nSaved ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
