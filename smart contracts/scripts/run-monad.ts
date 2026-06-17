import { freshMonadCtx, saveMonadState } from "./context";
import {
  stage01Onboard,
  stage02Assets,
  stage03VaultToken,
  stage04CollateralizeMint,
  stage05TransfersYield,
} from "./stages";

/**
 * Deploy the full stack to Monad testnet and run all five workflow stages
 * with live Cleanverse API onboarding.
 *
 * Requires: PRIVATE_KEY funded on Monad testnet, CLEANVERSE_MODE=live + credentials.
 *
 * Usage: npx hardhat run scripts/run-monad.ts --network monadTestnet
 */
async function main() {
  const ctx = await freshMonadCtx();

  const addrs = ctx.addresses;
  const p = ctx.participants;
  console.log("\nMonad testnet deployment:");
  console.table(addrs);
  console.log("Participants:");
  console.log(`  deployer: ${await p.deployer.getAddress()}`);
  console.log(`  alice:    ${await p.alice.getAddress()}`);
  console.log(`  bob:      ${await p.bob.getAddress()}`);
  console.log(`  charlie:  ${await p.charlie.getAddress()}`);
  console.log(`  dave:     ${await p.dave.getAddress()}`);
  console.log(`  Cleanverse mode: ${ctx.service.mode}\n`);

  await stage01Onboard(ctx);
  await stage02Assets(ctx);
  await stage03VaultToken(ctx);
  await stage04CollateralizeMint(ctx);
  await stage05TransfersYield(ctx);

  saveMonadState(ctx.state);
  console.log("\nMonad testnet workflow complete. State saved to deployments.monad.json");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
