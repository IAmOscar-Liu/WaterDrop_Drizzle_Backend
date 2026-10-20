import "../lib/env";

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";

type SuiteName = "email-verification" | "account-sessions" | "account-onboarding" | "be1001" | "all" | "api" | "coin-ledger" | "cron" | "order-date-filter" | "chatroom-auth" | "refund-auth" | "account-wallet" | "chatroom-sse" | "notification-sse" | "admin-chatroom-sse";

const suiteCommands: Record<SuiteName, string[]> = {
  "email-verification": ["_test:email-verification"],
  "account-sessions": ["_test:account-sessions"],
  "account-onboarding": ["_test:account-onboarding"],
  "admin-chatroom-sse": ["_test:admin-chatroom-sse", "_test:chatroom-auth", "_test:chatroom-legacy", "_test:chatroom-sse"],
  "notification-sse": ["_test:notification-sse", "_test:chatroom-legacy", "_test:chatroom-sse"],
  "chatroom-sse": ["_test:chatroom-auth", "_test:chatroom-legacy", "_test:chatroom-sse"],
  be1001: ["_test:be1001"],
  all: [
    "_test:email-verification",
    "_test:account-sessions",
    "_test:account-onboarding",
    "_test:be1001",
    "_test:coin-accounting",
    "_test:api",
    "_test:order-date-filter",
    "_test:chatroom-auth",
    "_test:refund-auth",
    "_test:account-wallet",
    "_test:coin-ledger",
    "_test:cron",
  ],
  api: ["_test:api"],
  "refund-auth": ["_test:refund-auth"],
  "chatroom-auth": ["_test:chatroom-auth"],
  "order-date-filter": ["_test:order-date-filter"],
  "account-wallet": ["_test:account-wallet"],
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
        ACCOUNT_EMAIL_VERIFICATION_URL: "https://seller.example.test/verify-email",
        COIN_LEDGER_ENABLED: "true",
        ACCOUNT_WALLET_AD_FUNDING_ENABLED: "true",
        COIN_LEDGER_MAINTENANCE_CONCURRENCY: "2",
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
      `Unknown suite "${requestedSuite}". Use ${Object.keys(suiteCommands).join(", ")}.`,
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

  // Keep suites independent: platform-wide assertions must not observe another suite's fixtures.
  for (const script of suiteCommands[suite]) {
    if (interruptedSignal) break;
    const temporaryName = `waterdrop_api_${Date.now()}_${randomBytes(4).toString("hex")}_test`;
    const quotedTemporaryName = quoteIdentifier(temporaryName);
    const temporaryUrl = databaseUrlWithName(configuredUrl, temporaryName);
    const adminUrl = databaseUrlWithName(configuredUrl, "postgres");
    const adminClient = postgres(adminUrl, { max: 1 });

    const stopChild = (signal: NodeJS.Signals) => {
      interruptedSignal = signal;
      activeChild?.kill(signal);
    };
    const onSigint = () => stopChild("SIGINT");
    const onSigterm = () => stopChild("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

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
        // Each test script gets the current schema in a newly created disposable DB.
        // Shared notification/chat writers now require SSE tables even in older suites.
        // No configured database or generated migration file is changed here.
        const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
        const schema = await import("../db/schema");
        const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
        for (const statement of statements) await migrationClient.unsafe(statement);
      } finally {
        await migrationClient.end();
      }

      await runNpmScript(script, temporaryUrl);

      if (interruptedSignal) {
        throw new Error(`Test run interrupted by ${interruptedSignal}.`);
      }
      console.log(`\n[test] ${script} passed`);
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
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
