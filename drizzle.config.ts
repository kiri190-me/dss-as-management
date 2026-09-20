import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

// The Drizzle CLI runs outside Next.js, so .env.local is not loaded
// automatically — it must be loaded explicitly here.
dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Define it in .env.local (see .env.example) before running any drizzle-kit command."
  );
}

export default defineConfig({
  dialect: "postgresql",
  // 표 정의는 서브모듈 vendor/dss-core 에 있다(설계서 E-2). 별칭(@dss/core/schema)이
  // 아니라 **상대경로**로 적는다 — drizzle-kit 은 Next/tsx 바깥에서 돌아 tsconfig 의
  // paths 를 보지 못할 수 있다. 마이그레이션(drizzle/)은 A/S 가 계속 소유한다.
  // 🔴 짝이 있다 — `drizzle.test.config.ts` 도 같은 자리를 가리킨다. 이 경로를
  // 고치면 그쪽도 함께 고친다(한쪽만 고치면 무슨 일이 나는지는 그쪽 주석에).
  schema: "./vendor/dss-core/src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
