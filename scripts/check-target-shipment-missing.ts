import "./load-env";

import { pgClient } from "../src/lib/db/connection";
import {
  countTargetShipmentMissingStages,
  listRepairCasesMissingTargetShipmentDate,
} from "../src/lib/db/queries/repair-case-target-shipment-notifications";

/**
 * ============================================================================
 * 「사내 목표 출하일을 등록해 주세요」 알림이 **몇 건이나 뜨는가** (2026-10-30)
 * ============================================================================
 *
 *   npm run check:target-shipment-missing
 *
 * ── 🔴 왜 이것부터인가 ──────────────────────────────────────────────────
 * 이 알림은 **A/S 엔지니어 전원**에게 가고, 지난 건도 함께 뜬다(판정이 매 요청마다
 * 다시 계산되기 때문이다 — domain/notifications.ts 머리말). ③ 이 수백이면 켜는 날
 * 종이 그 한 종류로 가득 찬다. 그러니 **켜기 전에 그 수를 보고** 판단해야 하는데,
 * 운영 DB 에 직접 붙는 것은 금지라 코드 안에 세는 길이 있어야 한다.
 *
 * ── 🔴 앱이 쓰는 그 길로 센다 ───────────────────────────────────────────
 * 세는 SQL 을 여기 따로 적지 않는다. 종에 줄을 내놓는 그 조회 파일의 함수
 * (countTargetShipmentMissingStages)를 그대로 부른다 — 여기 한 벌 더 적으면 재어
 * 놓은 수와 실제로 뜨는 수가 조용히 달라지고, 그때는 **틀린 수를 보고** 켤지 말지를
 * 정하게 된다. 그래서 끝에서 ③ 과 **실제 줄 수**를 맞대어 보고 다르면 ✗ 로 멈춘다.
 *
 * ── 🔴 읽기만 한다. **쓰는 모드가 없다** ────────────────────────────────
 * `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고, `--apply` 같은 깃발도 **일부러** 두지
 * 않았다 — 재는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을 넓힌다
 * (scripts/check-part-name-overlap.ts 와 같은 규율).
 *
 * ── 🔴 인수번호를 몇 개만 찍는다 ────────────────────────────────────────
 * 고객사·L/N·S/N 은 한 글자도 읽지 않는다(조회가 애초에 안 읽는다). 인수번호는
 * 「정말 그 건들인가」를 사람이 눈으로 확인할 수 있어야 해서 **앞의 몇 개만** 찍고,
 * 파일로 남기는 깃발도 두지 않는다.
 *
 * ── 🔴 개발 DB 로는 규모를 못 잰다 ──────────────────────────────────────
 * 개발 DB 에는 과거 건이 거의 없다. **운영에서** 돌려야 뜻이 있는 수가 나온다.
 * NAS 에서는 도구 컨테이너가 그 자리를 맡는다:
 *
 *   docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm tools-as npm run check:target-shipment-missing
 * ============================================================================
 */

/** 인수번호를 몇 개까지 찍나. 🔵 늘리려면 이 수를 고친다 — 깃발을 두지 않았다(머리말). */
const SAMPLE_LIMIT = 10;

async function main(): Promise<void> {
  console.log("\n" + "─".repeat(72));
  console.log("  사내 목표 출하일 미등록 — 종에 몇 줄이 뜨나 (읽기만 한다)");
  console.log("─".repeat(72));

  const stages = await countTargetShipmentMissingStages();
  const rows = await listRepairCasesMissingTargetShipmentDate();

  console.log("\n─ 조건을 하나씩 걸면 (휴지통에 든 건은 처음부터 빠져 있다)");
  console.log(`  ① PO발행일 있음                          ${stages.withOrderIssued}건`);
  console.log(`  ② ① 그리고 사내 목표 출하일 없음          ${stages.andTargetMissing}건`);
  console.log(`  ③ ② 그리고 출하 완료 아님  ← 실제로 뜰 수  ${stages.andNotShipped}건`);

  // 🔴 「세는 길」과 「뜨는 길」이 갈라지면 이 도구의 답은 쓸모가 없다. 둘은 같은 후보
  //    묶음에 같은 판정을 걸므로 언제나 같아야 하고, 다르면 여기서 멈춘다.
  if (rows.length !== stages.andNotShipped) {
    console.log(
      `\n  ✗ ③(${stages.andNotShipped}건)과 실제 알림 줄 수(${rows.length}건)가 다릅니다 — ` +
        "두 함수가 갈라졌습니다. 이 수를 믿지 마십시오."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\n─ 누구에게 가나");
  console.log("  A/S 엔지니어 한 사람의 종에 위 ③ 만큼의 줄이 섭니다(최고관리자도 같습니다).");
  console.log("  관리자·영업·재고 담당자는 기본값이 꺼짐이라 한 줄도 뜨지 않습니다.");

  if (rows.length === 0) {
    console.log("\n  🔵 지금은 한 건도 뜨지 않습니다.");
    return;
  }

  const shown = rows.slice(0, SAMPLE_LIMIT);
  console.log(`\n─ 앞의 ${shown.length}건 (인수번호 · 가장 이른 PO발행일)`);
  for (const row of shown) {
    console.log(`  ${row.intakeNumber}  ${row.orderIssuedDate}`);
  }
  if (rows.length > shown.length) {
    console.log(`  … 그 밖 ${rows.length - shown.length}건`);
  }
}

main()
  .then(async () => {
    console.log("\n" + "─".repeat(72));
    console.log("  🔵 이 수는 **돌린 그 DB 의 사실**입니다 — 개발 DB 로는 규모를 못 잽니다.");
    console.log("─".repeat(72) + "\n");
    await pgClient.end({ timeout: 5 });
  })
  .catch(async (error) => {
    console.error("재지 못했습니다:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await pgClient.end({ timeout: 5 });
  });
