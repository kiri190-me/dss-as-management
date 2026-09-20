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
  // 🔴 `drizzle.config.ts` 와 **언제나 같은 자리**를 가리켜야 한다. 한쪽만 고치면
  // 안 된다 — 지금 이 설정으로 도는 `db:test:migrate` 는 drizzle/ 의 SQL 만 읽어
  // 아무 일도 안 일어나지만, 누가 이 설정으로 `generate` 나 `push` 를 돌리는 날
  // 옛 자리(src/lib/db/schema/index.ts)는 별칭 `@dss/core/schema` 로 되넘길 뿐이고
  // drizzle-kit 은 Next/tsx 바깥이라 tsconfig 의 paths 를 못 볼 수 있다. 그러면
  // 표를 하나도 못 찾은 채 **「전부 DROP」짜리 마이그레이션**이 나온다.
  // 그래서 별칭이 아니라 상대경로로, 두 설정이 똑같이 적는다(설계서 E-2).
  schema: "./vendor/dss-core/src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: testDatabaseUrl },
  strict: true,
  verbose: true,
});
