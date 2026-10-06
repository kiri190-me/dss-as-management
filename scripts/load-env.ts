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

  // 🔴 견적서 공유폴더도 같다. 어제까지는 사람이 [견적서 받기]를 눌러야 닿았지만,
  // 2026-10-06(견적서 공유폴더 조각)부터는 **견적서를 저장하는 것만으로** 그 폴더에
  // 연도 폴더 · 견적서 폴더가 서고 엑셀 한 장이 들어간다 — actions/quotes.ts 가
  // createQuoteArchiveFolder 와 archiveQuoteDocumentOnSave 를 부르고, 둘 다 루트를
  // 안 받으면 그 자리에서 QUOTE_ARCHIVE_DIR 을 읽는다. 견적서를 만들거나 고치는 시험이
  // 하나만 있어도 사내 서류함에 폴더가 생긴다.
  // 폴더가 필요한 시험은 mkdtemp 임시 폴더를 `root`(`archiveRoot`)로 **직접** 넣어 쓴다.
  delete process.env.QUOTE_ARCHIVE_DIR;
}
