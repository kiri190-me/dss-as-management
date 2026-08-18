import dotenv from "dotenv";
import { requireSafeTestDatabaseUrl } from "../src/lib/db/test-database-safety";

// Load the normal development URL only for the equality guard. Test secrets
// live in the ignored .env.test.local file and are never logged.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.test.local" });

const safeTestDatabaseUrl = requireSafeTestDatabaseUrl({
  developmentDatabaseUrl: process.env.DATABASE_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
});

process.env.DSS_DEVELOPMENT_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = safeTestDatabaseUrl;
process.env.DSS_DB_TEST_MODE = "1";
