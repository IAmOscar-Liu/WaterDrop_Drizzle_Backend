import { Worker } from "worker_threads";
import path from "path";
import { existsSync } from "fs";

// Triggers an immediate fetch of the ECPay store list JSON on startup
// if the output file does not already exist. Runs in a worker to avoid
// blocking the main thread.
export function ensureEcpayStoreListOnStartup() {
  try {
    // const outDir = path.resolve(process.cwd(), "src/assets/json");
    // const outPath = path.join(outDir, "ecpay-storeList.json");

    // if (existsSync(outPath)) return; // Already exists; nothing to do

    // console.log(
    //   `ecpay-storeList.json not found. Triggering immediate fetch in worker...`,
    // );

    const tsFile = path.resolve(process.cwd(), "src/ecpay-storeList.ts");
    const jsFile = path.resolve(process.cwd(), "dist/ecpay-storeList.js");
    const useTsRunner = !existsSync(jsFile);

    const worker = new Worker(useTsRunner ? tsFile : jsFile, {
      ...(useTsRunner
        ? { execArgv: ["-r", "ts-node/register/transpile-only"] }
        : {}),
      workerData: { outDir: "src/assets/json" },
    });

    worker.on("message", (msg) => {
      if (msg?.ok) {
        console.log(`Startup fetch worker finished. Output: ${msg.outPath}`);
      } else {
        console.error("Startup fetch worker reported error:", msg?.error);
      }
    });
    worker.on("error", (err) => {
      console.error("Startup fetch worker error:", err);
    });
    worker.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Startup fetch worker exited with code ${code}`);
      } else {
        console.log("Startup fetch worker exited successfully.");
      }
    });
  } catch (e) {
    console.error("Failed to trigger immediate ECPay store list fetch:", e);
  }
}
