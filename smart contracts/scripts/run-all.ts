import { freshCtx } from "./context";
import {
  stage01Onboard,
  stage02Assets,
  stage03VaultToken,
  stage04CollateralizeMint,
  stage05TransfersYield,
} from "./stages";

/**
 * End-to-end demo: deploys a fresh stack and runs all five workflow stages in
 * order against the connected network (use the local Hardhat network for the
 * full multi-signer flow in mock mode).
 */
async function main() {
  const ctx = await freshCtx();
  console.log("Deployed addresses:");
  console.table(ctx.addresses);

  await stage01Onboard(ctx);
  await stage02Assets(ctx);
  await stage03VaultToken(ctx);
  await stage04CollateralizeMint(ctx);
  await stage05TransfersYield(ctx);

  console.log("\nAll stages complete.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
