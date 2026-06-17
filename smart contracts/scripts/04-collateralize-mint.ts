import { existingCtx } from "./context";
import { stage04CollateralizeMint } from "./stages";

async function main() {
  const ctx = await existingCtx();
  await stage04CollateralizeMint(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
