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

// 🔴 시험은 **실제 공유폴더에 닿지 않는다** — load-env.ts 의 같은 줄과 한 쌍이다.
// 시험 파일이 load-env 를 부르지 않는 경우까지 여기서 막는다(까닭은 그쪽 주석 참조).
delete process.env.CONTACT_FOLDER_ARCHIVE_DIR;

// 🔴 견적서 공유폴더도 같다 — 2026-10-06 부터 [견적서 받기]를 누르지 않아도 **저장만
// 해도** 폴더가 서고 엑셀이 들어간다. load-env.ts 의 같은 줄과 한 쌍이다(까닭은 그쪽 주석).
delete process.env.QUOTE_ARCHIVE_DIR;
