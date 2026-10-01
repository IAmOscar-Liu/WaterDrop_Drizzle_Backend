import "../lib/env";

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { accountWalletTransactionTable, accountWalletTransactionTypeEnum, transactionTypeEnum } from "../db/schema";

type SuiteName = "be1001" | "all" | "api" | "coin-ledger" | "cron" | "order-date-filter" | "chatroom-auth" | "refund-auth" | "account-wallet";

const suiteCommands: Record<SuiteName, string[]> = {
  be1001: ["_test:be1001"],
  all: [
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
      `Unknown suite "${requestedSuite}". Use all, be1001, api, coin-ledger, cron, order-date-filter, chatroom-auth, refund-auth, or account-wallet.`,
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
        await migrate(drizzle(migrationClient), {
          migrationsFolder: path.resolve(process.cwd(), "drizzle_test"),
        });
        // The owner generates deployment migrations separately. Apply only these pending
        // schema definitions to this newly CREATED disposable database, never .env.test's DB.
        // Each enum addition commits before constraints reference its new value.
        for (const enumType of [transactionTypeEnum, accountWalletTransactionTypeEnum]) {
          for (const value of enumType.enumValues) {
            await migrationClient.unsafe(`ALTER TYPE "${enumType.enumName}" ADD VALUE IF NOT EXISTS '${value}'`);
          }
        }
        const dialect = new PgDialect();
        for (const constraint of getTableConfig(accountWalletTransactionTable).checks.filter((c) =>
          ["account_wallet_transactions_type_sign", "account_wallet_transactions_funding_ad_required", "account_wallet_transactions_admin_actor_required"].includes(c.name),
        )) {
          await migrationClient.unsafe(`ALTER TABLE account_wallet_transactions DROP CONSTRAINT "${constraint.name}"`);
          await migrationClient.unsafe(`ALTER TABLE account_wallet_transactions ADD CONSTRAINT "${constraint.name}" CHECK (${dialect.sqlToQuery(constraint.value).sql})`);
        }
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
