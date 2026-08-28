/**
 * 고객 안내 상태 목록의 기본값을 넣는다.
 *
 * 마이그레이션 SQL에 INSERT를 손으로 끼워 넣지 않고 스크립트로 두는 이유:
 * 마이그레이션은 drizzle-kit이 스키마에서 생성하는 것이라, 사람이 고치면
 * 다음 generate 때 그 자리가 어떻게 될지 예측하기 어려워진다. 이 저장소가
 * `exception_statuses`의 기본 9종을 seed 스크립트로 넣는 것과 같은 판단이다.
 *
 * 여러 번 돌려도 안전하다 — 이미 있는 이름은 건너뛴다. 그래서 나중에 기본값이
 * 하나 늘었을 때 다시 돌리면 새것만 들어간다.
 *
 * 사용법:
 *   npm run seed:customer-status
 */
import "./load-env";
import { sql } from "drizzle-orm";
import { db, pgClient } from "../src/lib/db/connection";
import {
  customerStatusOptions,
  DEFAULT_CUSTOMER_STATUS_LABELS,
} from "../src/lib/db/schema";

async function main() {
  let inserted = 0;

  for (const [index, label] of DEFAULT_CUSTOMER_STATUS_LABELS.entries()) {
    const rows = await db
      .insert(customerStatusOptions)
      .values({ label, displayOrder: (index + 1) * 10 })
      // 살아 있는 같은 이름이 있으면 넘어간다. 부분 unique 인덱스가
      // is_active=true에만 걸려 있어 target을 그대로 쓸 수 없으므로
      // where로 같은 조건을 적어 준다.
      .onConflictDoNothing({
        target: customerStatusOptions.label,
        where: sql`is_active = true`,
      })
      .returning({ id: customerStatusOptions.id });

    if (rows.length > 0) {
      inserted += 1;
      console.log(`  + ${label}`);
    } else {
      console.log(`    ${label} (이미 있음)`);
    }
  }

  console.log(
    `\n기본 상태 ${DEFAULT_CUSTOMER_STATUS_LABELS.length}종 중 ${inserted}종을 새로 넣었습니다.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // 열린 연결 풀이 있으면 postgres.js가 프로세스를 계속 살려둔다.
  .finally(() => pgClient.end());
