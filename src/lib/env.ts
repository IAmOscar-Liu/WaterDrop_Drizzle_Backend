import dotenv from "dotenv";
import path from "path";

const env = process.env.NODE_ENV ?? "local";
dotenv.config({
  path: path.resolve(process.cwd(), `.env.${env}`),
  quiet: true,
});

if (env === "test") {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the test environment.");
  }

  const databaseName = decodeURIComponent(
    new URL(databaseUrl).pathname.replace(/^\//, ""),
  );
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to start test environment with non-test database: ${databaseName}`,
    );
  }
}
