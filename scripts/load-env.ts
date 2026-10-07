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

  // 🔴 「업체별 수리품현황」 공유폴더는 앞의 둘보다 더 위험하다. 두 가지 까닭이다.
  //   ① **루트를 넣어 줄 인자가 없다.** 견적서 · 연락서는 임시 폴더를 `root` 로 넣어
  //      피해 갈 수 있지만, services/customer-portal-export.ts 는
  //      resolveCustomerPortalArchiveRoot() 를 **스스로** 불러 그 자리에서
  //      CUSTOMER_PORTAL_ARCHIVE_DIR 을 읽는다 — 임시 폴더로 돌릴 통로가 아예 없다.
  //      그래서 설정이 남아 있으면 부르는 순간 **무조건** 사내 서류함에 쓴다.
  //   ② 🔴 **덮어쓴다.** 견적서는 이름이 겹치면 ` (2)` 로 비켜 가지만, 이쪽은 같은 이름이
  //      있으면 그 위에 쓴다(storage/customer-portal-archive.ts 머리말, 사용자 결정
  //      2026-09-30) — 사람이 손으로 고쳐 둔 현황표가 시험 자료로 지워질 수 있다.
  //      저장 뒤에는 날짜가 다른 옛 파일을 `OLD` 로 옮기기까지 한다.
  // 지금은 이 길을 지나는 DB 시험이 하나도 없다. 하나만 생겨도 늦으므로 미리 막아 둔다.
  delete process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;

  // 🔴 「수리 관련」 서류 공유폴더(2026-10-07). 앞의 셋과 같은 까닭이고, **앞질러** 막는다 —
  // 지금은 이 설정을 읽는 길이 resolveRepairDocsArchiveRoot 하나뿐이고 그것을 부르는 곳이
  // 아직 없지만, 다음 조각이 그 자리에서 폴더를 읽는다. 제품 종류마다 **같은 서류를 돌려
  // 쓰는** 사내 서류함이라 시험이 한 번 잘못 닿으면 사람이 수년째 쌓아 온 것을 건드린다.
  // 앱은 이 폴더를 읽기만 하지만, 「읽기만」은 설정이 사라지는 쪽으로 틀려도 손해가 없다.
  delete process.env.REPAIR_DOCS_ARCHIVE_DIR;
}
