import fs from "node:fs";
import dotenv from "dotenv";

// 견적서·보고서 xlsx 양식 시험은 실제 양식 파일의 경로를 환경변수로 받는다.
// 그 값은 .env.local 에 적혀 있지만 npm test 는 어떤 설정 파일도 읽지 않아서
// 양식 시험 71건이 통째로 잠들어 있었다. 이 로더가 그 여섯 개만 골라 넣어
// 깨운다.
//
// 🔴 dotenv.config() 를 쓰면 안 된다. 그 함수는 파일의 모든 키를 process.env
// 에 붓는데, .env.local 에는 개발 데이터베이스를 가리키는 DATABASE_URL 이
// 들어 있다. 지금 단위 시험은 환경변수가 없어 DB 에 닿을 길이 아예 없고,
// 그 차단이 이 저장소가 src/lib/db/test-database-safety.ts 까지 만들어 막아 둔
// 사고(단위 시험이 개발 자료를 건드리는 일)를 막는 마지막 벽이다. 통째로
// 부으면 그 문이 열린다. 그래서 parse() 로 읽기만 하고 아래 목록에 적힌
// 이름만 옮긴다.
//
// 시험 DB 로 바꿔치기하는 scripts/load-test-env.ts 와는 사정이 다르다.
// 그쪽은 안전장치를 함께 들고 통째로 붓지만, 이 파일에는 그런 장치가 없다.

// 허용 목록. 이름을 하나씩 적는다 — `_TEMPLATE_PATH` 로 끝나는 것을 정규식으로
// 훑어 통과시키면, 나중에 같은 꼬리를 가진 다른 값이 생겼을 때 조용히 함께
// 새어 든다.
const TEMPLATE_PATH_KEYS = [
  "QUOTE_TEMPLATE_PATH",
  "OH_QUOTE_TEMPLATE_PATH",
  "MATCHER_QUOTE_TEMPLATE_PATH",
  "MATCHER_OH_QUOTE_TEMPLATE_PATH",
  "INSPECTION_REPORT_TEMPLATE_PATH",
  "REPAIR_REPORT_TEMPLATE_PATH",
] as const;

try {
  const parsed = dotenv.parse(fs.readFileSync(".env.local"));

  for (const key of TEMPLATE_PATH_KEYS) {
    const value = parsed[key];
    // 사람이 명령줄에서 준 값이 이긴다. 이미 들어 있으면 덮어쓰지 않는다.
    if (value !== undefined && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.local 이 없거나, 키가 없거나, 읽다 실패해도 조용히 넘어간다.
  // NAS·CI 처럼 양식 파일이 없는 환경에서는 지금까지처럼 양식 시험이 건너뛰면
  // 되고, 로더 때문에 시험 전체가 죽는 일이 있어서는 안 된다.
}

// 성공이든 실패든 아무것도 출력하지 않는다. 경로 값은 물론이고 몇 개를 넣었는지도
// 찍지 않는다 — .env 내용을 출력하지 않는 것이 이 저장소의 규칙이다.
