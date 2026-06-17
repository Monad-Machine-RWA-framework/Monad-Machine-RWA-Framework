import { freshCtx } from "./context";
import { stage01Onboard } from "./stages";

// Stage 1 deploys a fresh stack (persisted to deployments.local.json) and
// onboards the participants. Subsequent stages reuse that deployment/state.
async function main() {
  const ctx = await freshCtx();
  console.log("Deployed addresses:");
  console.table(ctx.addresses);
  await stage01Onboard(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
