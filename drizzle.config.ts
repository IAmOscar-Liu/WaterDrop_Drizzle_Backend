import dotenv from "dotenv";
import path from "path";
import { defineConfig } from "drizzle-kit";

type EnvType = "local" | "development" | "stg" | "production";

// Remember to update it when you add a new environment, and also create a corresponding .env file and output directory for it.
const env = "stg" as EnvType;
const envPath = path.resolve(process.cwd(), `.env.${env}`);

dotenv.config({
  path: envPath,
  override: true,
});

console.log(`Loaded env from ${envPath}`);
console.log("DATABASE_URL:", process.env.DATABASE_URL);

const getOutPath = () => {
  switch (env) {
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

export default defineConfig({
  out: getOutPath(),
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
