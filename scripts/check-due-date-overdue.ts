import "./load-env";

import { pgClient } from "../src/lib/db/connection";
import {
  countRepairCaseOverdueStages,
  listRepairCasesOverdue,
} from "../src/lib/db/queries/repair-case-overdue-notifications";

/**
 * ============================================================================
 * 「납기 지연」이 **몇 건이나 뜨는가** — 배지와 종 알림 둘 다 (2026-11-07)
 * ============================================================================
 *
 *   npm run check:due-date-overdue
 *
 * ── 🔴 왜 이것부터인가 ──────────────────────────────────────────────────
 * 2026-11-07 변경은 **지금까지 조용하던 건들에 경보를 한꺼번에 켜는** 일이다. 그
 * 전까지 「납기 지연」은 수리 건의 `고객 요청 납기일` 칸 **하나만** 봤고, 그 칸이 비면
 * 거기서 끝났다 — 화면에는 내자 정리에서 빌려 온 날짜가 **보이는데도** 배지가 안
 * 떴다(사용자 신고). 이제 빌려 온 날짜도 같은 취급을 받으므로, **⑤ 만큼의 건에
 * 배지가 새로 붙고 종에도 그만큼 줄이 는다.** 거기에 종 알림 자체가 처음 생기는
 * 것이라 **⑥ 전부가 종에는 새 줄**이다.
 *
 * 그러니 올리기 전에 그 수를 보고 판단해야 하는데, 운영 DB 에 직접 붙는 것은 금지라
 * 코드 안에 세는 길이 있어야 한다. 🔵 앞선 둘(`check:target-shipment-missing` ·
 * `check:due-date-inverted`)과 같은 모양·같은 까닭이다.
 *
 * ── 🔴 왜 **새 도구**인가 — 기존 도구에 한 줄 더하지 않았다 ─────────────
 * `check:due-date-inverted` 는 **역전 전용**이다. 거기에 지연 단계를 끼워 넣으면 한
 * 도구가 두 경보를 말하게 되고, 그다음 사람은 어느 수가 어느 경보의 것인지 출력에서
 * 갈라야 한다. 이 저장소는 **경보 하나에 도구 하나**로 서 있다(앞선 둘이 그렇다).
 * 🔵 「새 알림 자체가 그 수를 보여 주지 않나」도 생각해 봤지만 — 종은 **지금** 뜨는
 * 줄만 보여 주고, 여기서 알아야 하는 것은 **④(고치기 전) → ⑥(고친 뒤)** 의 차이다.
 * 종으로는 그 차이를 영영 볼 수 없다(옛 규칙이 코드에서 사라졌기 때문이다).
 *
 * ── 🔴 앱이 쓰는 그 길로 센다 ───────────────────────────────────────────
 * 세는 SQL 을 여기 따로 적지 않는다. 종에 줄을 내놓는 그 조회 파일의 함수
 * (countRepairCaseOverdueStages)를 그대로 부르고, 그 함수는 다시 **표·카드·상세의
 * 배지를 세우는 도메인 판정**을 그대로 부른다(domain/repair-case-overdue.ts). 여기
 * 한 벌 더 적으면 재어 놓은 수와 실제로 뜨는 수가 조용히 달라지고, 그때는 **틀린 수를
 * 보고** 올릴지 말지를 정하게 된다. 그래서 끝에서 ⑥ 과 **실제 줄 수**를 맞대어 보고
 * 다르면 ✗ 로 멈춘다.
 *
 * ── 🔴 읽기만 한다. **쓰는 모드가 없다** ────────────────────────────────
 * `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고, 쓰는 깃발도 **일부러** 두지 않았다 —
 * 재는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을 넓힌다(이웃 도구들과 같은 규율).
 * 그 규율이 지켜지는지는 `scripts/check-tools-read-only-source.test.ts` 가 **원본
 * 글자로** 본다.
 *
 * ── 🔴 인수번호와 날짜 둘만 찍는다 ──────────────────────────────────────
 * 고객사·L/N·S/N 은 한 글자도 읽지 않는다(조회가 애초에 안 읽는다). 인수번호와 날짜는
 * 「정말 지났나」를 사람이 눈으로 확인할 수 있어야 해서 **앞의 몇 건만** 찍고, 파일로
 * 남기는 깃발도 두지 않는다.
 *
 * ── 🔴 개발 DB 로는 규모를 못 잰다 ──────────────────────────────────────
 * 개발 DB 에는 과거 건이 거의 없다. **운영에서** 돌려야 뜻이 있는 수가 나온다.
 * NAS 에서는 도구 컨테이너가 그 자리를 맡는다:
 *
 *   cd /volume1/dss/deploy
 *   sudo docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm tools-as npm run check:due-date-overdue
 *
 * 🔴 지금 운영에 올라가 있는 도구 이미지에는 **이 명령이 없다.** 다음 배포에 실려야
 * 돌아간다 — 그 전에 치면 `Missing script` 가 난다.
 * ============================================================================
 */

/** 몇 건까지 찍나. 🔵 늘리려면 이 수를 고친다 — 깃발을 두지 않았다(머리말). */
const SAMPLE_LIMIT = 10;

async function main(): Promise<void> {
  console.log("\n" + "─".repeat(72));
  console.log("  납기 지연 — 배지와 종에 몇 건이 뜨나 (읽기만 한다)");
  console.log("─".repeat(72));

  const stages = await countRepairCaseOverdueStages();
  const rows = await listRepairCasesOverdue();

  console.log("\n─ 조건을 하나씩 걸면 (휴지통에 든 건과 이미 나간 건은 처음부터 빠져 있다)");
  console.log(`  ① 아직 안 나간 건                                  ${stages.live}건`);
  console.log(`  ② ① 가운데 고객 요청 납기일이 **제 칸에** 적힌 건   ${stages.withOwnDueDate}건`);
  console.log(`  ③ ① 가운데 **내자에서 빌려 온** 날짜가 있는 건       ${stages.withBorrowedDueDate}건`);
  console.log(`  ④ ② 가운데 그 날짜가 지난 건  ← 고치기 전에도 뜨던 수 ${stages.overdueByOwnDueDate}건`);
  console.log(`  ⑤ ③ 가운데 그 날짜가 지난 건  ← 🔴 새로 뜨는 수       ${stages.overdueByBorrowedDueDate}건`);
  console.log(`  ⑥ ④ + ⑤                     ← 고친 뒤 뜨는 수       ${stages.overdueTotal}건`);

  // 🔴 「세는 길」과 「뜨는 길」이 갈라지면 이 도구의 답은 쓸모가 없다. 둘은 같은 후보
  //    묶음에 같은 판정을 걸므로 언제나 같아야 하고, 다르면 여기서 멈춘다.
  if (rows.length !== stages.overdueTotal) {
    console.log(
      `\n  ✗ ⑥(${stages.overdueTotal}건)와 실제 알림 줄 수(${rows.length}건)가 다릅니다 — ` +
        "두 함수가 갈라졌습니다. 이 수를 믿지 마십시오."
    );
    process.exitCode = 1;
    return;
  }

  console.log("\n─ 어디에 뜨나");
  console.log("  · 배지: 전체 A/S 현황의 표·카드와 수리 건 상세 머리 카드에 [납기 지연] 이 ⑥ 만큼 붙습니다.");
  console.log("          그중 ⑤ 건은 **이번 변경으로 새로 붙는 것**입니다.");
  console.log("  · 종  : 한 사람의 종에 ⑥ 만큼의 줄이 섭니다 — 이 종류는 다섯 역할 전원이 받습니다.");
  console.log("          종 알림 자체가 이번에 생긴 것이라 **⑥ 전부가 새 줄**입니다.");

  if (rows.length === 0) {
    console.log("\n  🔵 지금은 한 건도 뜨지 않습니다.");
    return;
  }

  const borrowed = rows.filter((row) => row.borrowed);
  console.log(
    `\n─ 그중 ${borrowed.length}건은 고객 요청 납기일을 **내자 정리에서 빌려 온** 건입니다` +
      " — 상세 화면의 그 칸에는 [내자 정리에서 작성됨] 꼬리표가 붙어 있습니다."
  );

  const shown = rows.slice(0, SAMPLE_LIMIT);
  console.log(`\n─ 앞의 ${shown.length}건 (인수번호 · 고객 요청 납기일)`);
  for (const row of shown) {
    const mark = row.borrowed ? "  (내자에서 빌려 온 날짜 — 새로 뜨는 건)" : "";
    console.log(`  ${row.intakeNumber}  ${row.dueDate}${mark}`);
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
