import { existingCtx } from "./context";
import { stage02Assets } from "./stages";

async function main() {
  const ctx = await existingCtx();
  await stage02Assets(ctx);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
