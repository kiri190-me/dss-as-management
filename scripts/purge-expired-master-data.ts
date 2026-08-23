import "./load-env";

import { pgClient } from "../src/lib/db/connection";
import {
  runMasterDataPurgeSweep,
  type MasterDataPurgeEntitySummary,
} from "../src/lib/db/mutations/master-data-purge";

/**
 * 마스터 데이터(고객사·제품 모델·부품·기술 절차) 휴지통의 15일 자동 완전삭제
 * 진입점.
 * `npm run purge:master-data`로 직접 부를 수 있고, 야간 작업은
 * scripts/run-nightly-purge.ps1이 다른 정리 작업들과 함께 순서대로 부른다.
 * 페이지 요청이나 프로세스 안 타이머는 절대 건드리지 않는다 — CLI 전용이고,
 * purge-expired-repair-cases.ts / purge-expired-flowcharts.ts와 같은 설계다.
 */
function report(label: string, summary: MasterDataPurgeEntitySummary) {
  console.log(`[${label}]`);
  console.log(`  eligible: ${summary.eligible}`);
  console.log(`  purged: ${summary.purged}`);
  console.log(`  skipped (restored): ${summary.skippedRestored}`);
  console.log(`  skipped (not yet eligible): ${summary.skippedNotEligible}`);
  console.log(`  skipped (already gone): ${summary.skippedAlreadyGone}`);
  // 정상 운영에서는 0이어야 한다. 0이 아닌 채로 매일 밤 반복된다면 휴지통에
  // 들어간 뒤 접수 건이 걸린 행이 있다는 뜻이고, 사람이 손대기 전까지 그
  // 행은 영원히 지워지지 않는다.
  console.log(`  skipped (referenced by repair cases): ${summary.skippedReferenced}`);
  console.log(`  errored: ${summary.errored}`);

  if (summary.errored > 0) {
    console.error(`Per-record errors (${label}):`);
    for (const { id, message } of summary.errors) {
      console.error(`  - ${id}: ${message}`);
    }
  }
}

async function main() {
  console.log("Running master-data purge sweep...");
  const summary = await runMasterDataPurgeSweep();

  report("customers", summary.customers);
  report("product_models", summary.productModels);
  report("parts", summary.parts);
  report("procedure_templates", summary.procedureTemplates);

  console.log("Purge sweep complete.");
  return summary;
}

main()
  .then(async (summary) => {
    await pgClient.end({ timeout: 5 });
    // 회차 자체는 끝났어도 개별 건이 실패했으면 0이 아닌 종료 코드를 준다 —
    // 스케줄러가 stdout을 파싱하지 않고도 degraded 회차를 표시할 수 있다.
    const errored =
      summary.customers.errored +
      summary.productModels.errored +
      summary.parts.errored +
      summary.procedureTemplates.errored;
    process.exit(errored > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Purge sweep failed:", err instanceof Error ? err.message : String(err));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
