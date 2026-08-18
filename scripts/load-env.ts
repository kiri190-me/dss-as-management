import dotenv from "dotenv";
import { requireSafeTestDatabaseUrl } from "../src/lib/db/test-database-safety";

// Must be the first import in any script entry point. tsx compiles to
// CommonJS, and TypeScript hoists all `import` declarations (as `require()`
// calls, in listed order) ahead of any other top-level statement — so a
// bare `dotenv.config()` call written between two imports would actually
// run AFTER both, not between them. Putting the side effect inside its own
// imported module and listing it first guarantees it runs before any
// later-listed import (e.g. src/lib/db/connection.ts, which reads
// process.env.DATABASE_URL at its own module top level).
dotenv.config({ path: ".env.local" });

// Individual integration-test files are sometimes run directly instead of
// through npm test:db. Detect that case here so their first import still
// switches to the isolated test database before connection.ts is evaluated.
const isIntegrationTestProcess = process.argv.some((argument) =>
  argument.endsWith(".integration.test.ts")
);

if (process.env.DSS_DB_TEST_MODE === "1" || isIntegrationTestProcess) {
  dotenv.config({ path: ".env.test.local" });
  process.env.DATABASE_URL = requireSafeTestDatabaseUrl({
    developmentDatabaseUrl:
      process.env.DSS_DEVELOPMENT_DATABASE_URL ?? process.env.DATABASE_URL,
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
  });
  process.env.DSS_DB_TEST_MODE = "1";
}
