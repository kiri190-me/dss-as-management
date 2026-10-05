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

  // 🔴 시험은 **실제 공유폴더에 닿지 않는다.** .env.local 의 연락서 공유폴더는 사내
  // 서류함(UNC)을 가리키는데, 접수 경로가 2026-10-05(연락서 조각 7)부터 접수 직후
  // 폴더를 만든다 — 시험이 접수를 한 건 만들 때마다 거기에 폴더가 하나 생긴다.
  // 폴더가 필요한 시험은 mkdtemp 임시 폴더를 **직접** 넣어 쓴다.
  delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;
}
