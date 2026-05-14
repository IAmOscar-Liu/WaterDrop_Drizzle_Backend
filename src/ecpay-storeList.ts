import "./lib/env";
import path from "path";
import { promises as fs } from "fs";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import ecPayService from "./services/ecpay";

async function getStore(outDirFromWorker?: string) {
  let tmpPath: string | undefined;
  try {
    const storeList = await ecPayService.getStoreList({ CvsType: "All" });
    // console.log("Store List:", storeList);

    const data: Record<
      string,
      Array<{
        StoreId: string;
        StoreName: string;
        StoreAddr: string;
        StorePhone?: string;
      }>
    > = {};

    for (let { CvsType, StoreInfo } of storeList) {
      data[CvsType] = StoreInfo;
    }

    const outDir = path.resolve(
      process.cwd(),
      outDirFromWorker || "src/assets/json",
    );
    const outPath = path.join(outDir, "ecpay-storeList.json");

    // Ensure directory exists (idempotent if already present)
    await fs.mkdir(outDir, { recursive: true });
    // Write atomically: write to temp, then rename over target
    tmpPath = `${outPath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, outPath);
    console.log(`Saved store list to: ${outPath}`);
    parentPort?.postMessage({ ok: true, outPath });
  } catch (error) {
    console.error("Error fetching store list:", error);
    parentPort?.postMessage({ ok: false, error: String(error) });
    try {
      if (tmpPath) await fs.rm(tmpPath, { force: true });
    } catch {}
    throw error;
  }
}

if (isMainThread) {
  // Launch this same file in a worker so the heavy work is isolated
  const worker = new Worker(__filename, {
    execArgv: ["-r", "ts-node/register/transpile-only"],
    workerData: {
      outDir: "src/assets/json",
    },
  });

  worker.on("message", (msg) => {
    if (msg?.ok) {
      console.log(`Worker finished. Output: ${msg.outPath}`);
    } else {
      console.error("Worker reported error:", msg?.error);
    }
  });
  worker.on("error", (err) => {
    console.error("Worker error:", err);
    process.exitCode = 1;
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      console.error(`Worker stopped with exit code ${code}`);
      process.exitCode = code;
    }
  });
} else {
  // Worker thread: run the task
  getStore(workerData?.outDir).catch(() => process.exit(1));
}
