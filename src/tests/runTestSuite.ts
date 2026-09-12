import "../lib/env";

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

type SuiteName = "all" | "api" | "coin-ledger" | "cron";

const suiteCommands: Record<SuiteName, string[]> = {
  all: [
    "_test:coin-accounting",
    "_test:api",
    "_test:coin-ledger",
    "_test:cron",
  ],
  api: ["_test:api"],
  "coin-ledger": ["_test:coin-ledger"],
  cron: ["_test:cron"],
};

let activeChild: ChildProcess | undefined;
let interruptedSignal: NodeJS.Signals | undefined;

function quoteIdentifier(identifier: string) {
  if (!/^[a-z][a-z0-9_]*_test$/.test(identifier)) {
    throw new Error(`Unsafe temporary database name: ${identifier}`);
  }
  return `"${identifier}"`;
}

function databaseName(databaseUrl: string) {
  return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
}

function databaseUrlWithName(databaseUrl: string, name: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

function runNpmScript(script: string, databaseUrl: string) {
  return new Promise<void>((resolve, reject) => {
    console.log(`\n[test] Running ${script}`);
    const child = spawn("npm", ["run", script], {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        NO_CRON: "true",
        COIN_LEDGER_ENABLED: "true",
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_MANAGED: "true",
      },
    });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${script} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
        ),
      );
    });
  });
}

async function main() {
  const requestedSuite = process.argv[2] ?? "all";
  if (!(requestedSuite in suiteCommands)) {
    throw new Error(
      `Unknown suite "${requestedSuite}". Use all, api, coin-ledger, or cron.`,
    );
  }
  const suite = requestedSuite as SuiteName;

  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("DATABASE_URL is required in .env.test.");
  }
  const configuredName = databaseName(configuredUrl);
  if (!configuredName.endsWith("_test")) {
    throw new Error(
      `Refusing to use non-test PostgreSQL database: ${configuredName}`,
    );
  }

  const temporaryName = `waterdrop_api_${Date.now()}_${randomBytes(4).toString("hex")}_test`;
  const quotedTemporaryName = quoteIdentifier(temporaryName);
  const temporaryUrl = databaseUrlWithName(configuredUrl, temporaryName);
  const adminUrl = databaseUrlWithName(configuredUrl, "postgres");
  const adminClient = postgres(adminUrl, { max: 1 });

  const stopChild = (signal: NodeJS.Signals) => {
    interruptedSignal = signal;
    activeChild?.kill(signal);
  };
  process.once("SIGINT", () => stopChild("SIGINT"));
  process.once("SIGTERM", () => stopChild("SIGTERM"));

  let created = false;
  try {
    console.log(`[test] Creating disposable database ${temporaryName}`);
    await adminClient.unsafe(`CREATE DATABASE ${quotedTemporaryName}`);
    created = true;

    const migrationClient = postgres(temporaryUrl, {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      await migrate(drizzle(migrationClient), {
        migrationsFolder: path.resolve(process.cwd(), "drizzle_test"),
      });
    } finally {
      await migrationClient.end();
    }

    for (const script of suiteCommands[suite]) {
      if (interruptedSignal) break;
      await runNpmScript(script, temporaryUrl);
    }

    if (interruptedSignal) {
      throw new Error(`Test run interrupted by ${interruptedSignal}.`);
    }
    console.log(`\n[test] ${suite} suite passed`);
  } finally {
    if (created) {
      console.log(`[test] Dropping disposable database ${temporaryName}`);
      await adminClient`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${temporaryName}
          and pid <> pg_backend_pid()
      `;
      await adminClient.unsafe(`DROP DATABASE ${quotedTemporaryName}`);
    }
    await adminClient.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
