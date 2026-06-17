import { existingCtx } from "./context";
import { stage05TransfersYield } from "./stages";

async function main() {
  const ctx = await existingCtx();
  await stage05TransfersYield(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
