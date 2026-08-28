/**
 * 고객 안내 창구 동기화 — 새 의뢰를 가져오고, 현황을 내보낸다.
 *
 * 모양은 이 저장소의 scripts/purge-expired-repair-cases.ts 를 본떴다.
 *
 * ⚠️ **작업 스케줄러 등록은 사람이 한다.** 이 저장소의 CLAUDE.md 가 운영
 * 배포·스케줄 등록을 사람의 몫으로 정해 두었고, 야간 정리 스크립트도 같은
 * 이유로 등록되지 않은 채 남아 있다. 등록 방법은 README 에 적는다.
 *
 * 몇 번을 돌려도 안전하다 — 당겨오기는 넣거나-넘어가기, 스냅샷은 통째 교체다.
 * 예정된 실행과 사람이 누른 「지금 내보내기」가 겹쳐도 잠금이 필요 없다.
 *
 * 사용법:
 *   npm run portal:sync
 */
import "./load-env";
import { pgClient } from "../src/lib/db/connection";
import {
  pullNewRequests,
  pushSnapshots,
} from "../src/lib/server/services/customer-portal-sync";

async function main() {
  let failed = false;

  console.log("― 새 수리 의뢰 가져오기 ―");
  try {
    const { pulled, inserted } = await pullNewRequests();
    if (pulled === 0) {
      console.log("  새 의뢰 없음");
    } else {
      console.log(`  받은 것 ${pulled}건, 새로 들어간 것 ${inserted}건`);
      if (pulled !== inserted) {
        // 겹침은 정상이다 — 알리기 전에 죽었던 회차의 것을 다시 받은 경우다.
        console.log(`  (${pulled - inserted}건은 이미 있던 것)`);
      }
    }
  } catch (error) {
    failed = true;
    console.error("  ✗ 가져오기 실패:", (error as Error).message);
  }

  console.log("\n― 고객사별 현황 내보내기 ―");
  try {
    const results = await pushSnapshots();
    if (results.length === 0) {
      console.log("  발급된 링크 없음");
    }
    for (const result of results) {
      const mark = result.ok ? "✓" : "✗";
      console.log(`  ${mark} ${result.customerName} — ${result.itemCount}건`);
      if (!result.ok) failed = true;
    }
  } catch (error) {
    failed = true;
    console.error("  ✗ 내보내기 실패:", (error as Error).message);
  }

  // 실패했으면 0이 아닌 코드로 끝낸다. 스케줄러가 알아채야 한다 —
  // 조용히 성공한 척하면 며칠째 의뢰가 안 들어오는 것을 아무도 모른다.
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // 열린 연결 풀이 있으면 postgres.js 가 프로세스를 계속 살려둔다.
  .finally(() => pgClient.end());
