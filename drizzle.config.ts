import "dotenv/config";
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  // out: "./drizzle_dev", // development
  out: "./drizzle_prod", // production
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
