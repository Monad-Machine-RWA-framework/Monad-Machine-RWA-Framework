import { expect } from "chai";
import { ethers } from "hardhat";
import { freshCtx } from "../scripts/context";
import {
  stage01Onboard,
  stage02Assets,
  stage03VaultToken,
  stage04CollateralizeMint,
  stage05TransfersYield,
} from "../scripts/stages";

const USDC = (n: number) => ethers.parseUnits(n.toString(), 6);

describe("Full Machine RWA workflow (mock mode)", () => {
  before(() => {
    process.env.CLEANVERSE_MODE = "mock";
  });

  it("runs onboard -> assets -> vault -> mint -> transfers -> yield", async () => {
    const ctx = await freshCtx();

    await stage01Onboard(ctx);
    // All three participants are verified on-chain.
    for (const s of [ctx.participants.alice, ctx.participants.bob, ctx.participants.charlie]) {
      expect(await ctx.identityRegistry.isVerified(await s.getAddress())).to.equal(true);
    }

    await stage02Assets(ctx);
    expect(ctx.state.machineIds.length).to.equal(2);
    expect(ctx.state.contractTokenId).to.not.equal(undefined);
    // Contract NFT owned by Alice before deposit.
    expect(await ctx.contractNFT.ownerOf(ctx.state.contractTokenId!)).to.equal(
      await ctx.participants.alice.getAddress()
    );

    await stage03VaultToken(ctx);
    expect(await ctx.securityToken.paused()).to.equal(false);

    await stage04CollateralizeMint(ctx);
    const aliceAddr = await ctx.participants.alice.getAddress();
    expect(await ctx.securityToken.balanceOf(aliceAddr)).to.equal(USDC(1000));
    // Collateral now held by the vault.
    expect(await ctx.contractNFT.ownerOf(ctx.state.contractTokenId!)).to.equal(
      ctx.addresses.vault
    );

    await stage05TransfersYield(ctx);
    const bobAddr = await ctx.participants.bob.getAddress();
    const charlieAddr = await ctx.participants.charlie.getAddress();
    expect(await ctx.securityToken.balanceOf(bobAddr)).to.equal(USDC(100));
    expect(await ctx.securityToken.balanceOf(charlieAddr)).to.equal(USDC(100));
    // Yield: 30 USDC over 1000 supply; Bob and Charlie hold 100 each -> 3 each.
    expect(await ctx.mockUSDC.balanceOf(bobAddr)).to.equal(USDC(3));
    expect(await ctx.mockUSDC.balanceOf(charlieAddr)).to.equal(USDC(3));
  });

  it("blocks transfers to wallets without an A-Pass", async () => {
    const ctx = await freshCtx();
    await stage01Onboard(ctx);
    await stage02Assets(ctx);
    await stage03VaultToken(ctx);
    await stage04CollateralizeMint(ctx);

    const dave = ctx.participants.dave;
    await expect(
      ctx.securityToken
        .connect(ctx.participants.alice)
        .transfer(await dave.getAddress(), USDC(1))
    ).to.be.revertedWithCustomError(ctx.securityToken, "NotCompliant");
  });
});
