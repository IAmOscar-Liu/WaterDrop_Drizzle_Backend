import "dotenv/config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  // out: "./drizzle_local", // local
  out: "./drizzle_dev", // development
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
