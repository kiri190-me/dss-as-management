import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
import { requireSafeTestDatabaseUrl } from "./src/lib/db/test-database-safety";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.test.local" });

const testDatabaseUrl = requireSafeTestDatabaseUrl({
  developmentDatabaseUrl:
    process.env.DSS_DEVELOPMENT_DATABASE_URL ?? process.env.DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
});

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: testDatabaseUrl },
  strict: true,
  verbose: true,
});
