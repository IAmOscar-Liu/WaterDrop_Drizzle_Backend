import dotenv from "dotenv";
import path from "path";
import { defineConfig } from "drizzle-kit";

type EnvType = "test" | "local" | "development" | "stg" | "production";

const supportedEnvironments: EnvType[] = [
  "test",
  "local",
  "development",
  "stg",
  "production",
];

const requestedEnv = process.env.DRIZZLE_ENV ?? process.env.NODE_ENV ?? "local";
if (!supportedEnvironments.includes(requestedEnv as EnvType)) {
  throw new Error(`Unsupported Drizzle environment: ${requestedEnv}`);
}

const env = requestedEnv as EnvType;
const envPath = path.resolve(process.cwd(), `.env.${env}`);

dotenv.config({
  path: envPath,
  override: true,
  quiet: true,
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(`DATABASE_URL is missing from ${envPath}`);
}

const getOutPath = () => {
  switch (env) {
    case "test":
      return "./drizzle_test";
    case "local":
      return "./drizzle_local";
    case "development":
      return "./drizzle_dev";
    case "stg":
      return "./drizzle_stg";
    case "production":
      return "./drizzle_prod";
    default:
      throw new Error(`Unknown environment: ${env}`);
  }
};

if (env === "test") {
  const databaseName = decodeURIComponent(
    new URL(databaseUrl).pathname.replace(/^\//, ""),
  );
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing test Drizzle command for non-test database: ${databaseName}`,
    );
  }
}

console.log(`Drizzle environment: ${env}; migrations: ${getOutPath()}`);

export default defineConfig({
  out: getOutPath(),
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
