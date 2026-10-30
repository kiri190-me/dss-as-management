import "./load-env";

import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import { domesticOrderDueDates, domesticOrders, repairCases } from "../src/lib/db/schema";
import {
  bucketTotalMismatch,
  summarizeRequestedDueDateSync,
  type SurveyCase,
  type SurveyDueDateRow,
  type SurveySample,
} from "./lib/requested-due-date-sync-survey";

/**
 * ============================================================================
 * 내자 `납기요청일` ↔ 수리 건 `고객 요청 납기일` — **묶기 전에 몇 건이 어긋나 있나**
 * ============================================================================
 *
 *   npm run check:requested-due-date-sync
 *
 * ── 🔴 왜 이것부터인가 ──────────────────────────────────────────────────
 * 2026-10-30 사용자 요구는 **어느 쪽에서 고치든 같은 날짜를 보게** 하는 것이다. 그런데
 * 이 저장소는 그 둘을 **일부러 따로** 두었다 — `src/lib/domain/requested-due-date-link.ts`
 * 머리말이 그 까닭을 길게 적어 두었다(발주서에 적힌 날짜와 고객이 말한 날짜라, 같아야 할
 * 이유가 없다). 지금은 한쪽이 비었을 때만 상대 값을 **빌려 그릴 뿐**이고 어느 칸에도
 * 옮겨 적지 않는다.
 *
 * 🔴 **묶는 순간, 지금 다르게 적혀 있는 건들은 한쪽 값으로 덮인다. 덮인 값은 돌아오지
 *    않는다.** 그 수가 몇인지 아는 길이 코드 어디에도 없었다 — 단위 시험으로는 영영
 *    안 나오고, 운영 자료를 봐야만 나온다. 그래서 **묶기 전에** 이 도구로 센다.
 *
 * ── 🔴 ⑦ 는 「덮인다」가 아니라 「**막힌다**」다 ────────────────────────
 * 수리 건의 고객 요청 납기일에는 **인수일보다 이를 수 없다**는 잣대가 걸려 있고
 * (`mutations/repair-cases.ts` 847-857), 내자 납기요청일에는 그런 잣대가 없다. 그래서
 * 내자 쪽 날짜를 수리 건으로 미는 방향은 **지금 적힌 값만으로도 저장이 거절될 수 있다.**
 * 그 수가 ⑦ 이고, 잣대는 베껴 적지 않고 저쪽이 부르는 함수를 그대로 부른다(세는 쪽
 * 머리말). ⑦ 이 0 이 아니면 다음 조각은 **그 건들을 어떻게 할지 먼저 정해야 한다.**
 *
 * ── 🔴 읽기만 한다. **쓰는 모드가 없다** ────────────────────────────────
 * `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고, `--apply` 같은 깃발도 **일부러** 두지
 * 않았다 — 재는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을 넓힌다
 * (`check-part-name-overlap.ts` · `check-target-shipment-missing.ts` 와 같은 규율).
 * 묶는 일은 이 조각이 하지 않는다.
 *
 * ── 🔴 범위: **수리 건에 붙은 내자 줄만** ───────────────────────────────
 * 수리 건과 무관한 줄(별도 건)은 분할 납품 때문에 날짜를 **여럿 계속 받아야 하고**,
 * 동기화와 아무 상관이 없다(2026-10-30 사용자 결정). 그 거르기를 보장하는 것은 아래
 * `innerJoin(repairCases, ...)` **하나**다 — `repair_case_id` 가 비어 있으면 조인이
 * 성립하지 않아 애초에 한 줄도 들어오지 않는다. `isNotNull` 로 한 번 더 적지 않는 것도
 * 일부러다(같은 뜻을 두 군데 적으면 한쪽만 고쳐지는 날이 온다). 그 대신 **범위 밖이
 * 몇 줄인지**를 따로 세어 함께 찍는다 — 빠진 것을 모르고 비율을 읽지 않도록.
 *
 * ── 🔴 비고는 **글자를 읽지 않는다** ────────────────────────────────────
 * `domestic_order_due_dates.note` 는 사람이 자유롭게 적는 칸이라 담당자 이름이 섞일 수
 * 있다(그 표의 PII 항목). 그래서 글자를 꺼내 오지 않고 **「적혀 있나」만** DB 안에서
 * 불리언으로 바꿔 받는다. 고객사·형식·L/N·S/N 은 애초에 조회에 없다.
 *
 * ── 🔴 찍는 것은 접수번호와 날짜까지다 ──────────────────────────────────
 * ①·②·③ 의 본보기로 접수번호를 몇 개 찍는다 — 「정말 그 건들인가」를 사람이 눈으로
 * 확인할 수 있어야 해서다. 파일로 남기는 깃발은 두지 않았다.
 *
 * ── 🔴 개발 DB 로는 규모를 못 잰다 ──────────────────────────────────────
 * 개발 DB 에는 과거 건이 거의 없다. **운영에서** 돌려야 뜻이 있는 수가 나온다. NAS 에서는
 * 도구 컨테이너가 그 자리를 맡는다:
 *
 *   cd /volume1/dss/deploy
 *   sudo docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm tools-as npm run check:requested-due-date-sync
 * ============================================================================
 */

/** 본보기를 몇 개까지 찍나. 🔵 늘리려면 이 수를 고친다 — 깃발을 두지 않았다(머리말). */
const SAMPLE_LIMIT = 20;

type JoinedRow = {
  caseId: string;
  intakeNumber: string;
  customerRequestedDueDate: string | null;
  receivedAt: string;
  orderId: string;
  dueDate: string | null;
  hasNote: boolean | null;
};

/**
 * 수리 건에 붙은 **살아 있는** 내자 줄과 그 줄에 달린 납기요청일 전부.
 *
 * 🔴 `leftJoin` 인 까닭: **날짜가 한 줄도 없는 내자 줄도 세야 한다.** 그 줄들이 지금
 * 수리 건의 날짜를 빌려 그리고 있는 줄이고(④), `innerJoin` 으로 바꾸면 그 줄이 통째로
 * 사라져 「줄이 여럿인 건」(①)까지 적게 세어진다.
 *
 * 🔴 휴지통은 양쪽 다 뺀다 — 지워진 내자 줄(`domestic_orders.is_deleted`)과 지워진
 * 수리 건(`repair_cases.is_deleted`). 조회·화면이 이미 그렇게 보고 있어서다
 * (`loadDomesticOrderDueDatesByCaseId` 의 같은 조건). 뺀 수는 아래에서 따로 찍는다.
 */
async function readJoinedRows(): Promise<JoinedRow[]> {
  return db
    .select({
      caseId: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      customerRequestedDueDate: repairCases.customerRequestedDueDate,
      // ⑦ 의 잣대. 🔵 수리 건 저장이 거절하는지 가르는 값이라 **저장된 인수일**을 읽는다
      //    (그 mutation 의 effectiveReceivedAt 은 이번 저장에 인수일이 안 실리면 이 값이다).
      receivedAt: repairCases.receivedAt,
      orderId: domesticOrders.id,
      dueDate: domesticOrderDueDates.dueDate,
      // 🔴 글자를 꺼내지 않는다(머리말의 PII 항목). 공백만 적힌 비고는 「없음」으로 본다.
      hasNote: sql<boolean>`${domesticOrderDueDates.note} is not null and btrim(${domesticOrderDueDates.note}) <> ''`,
    })
    .from(domesticOrders)
    .innerJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(domesticOrderDueDates, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
    .where(and(eq(domesticOrders.isDeleted, false), eq(repairCases.isDeleted, false)))
    .orderBy(
      asc(repairCases.intakeNumber),
      asc(domesticOrders.id),
      asc(domesticOrderDueDates.dueDate)
    );
}

/** 범위 밖이 몇 줄인가 — 숨기지 않으려고 센다(머리말의 '범위'). 수만 센다. */
async function readOutOfScopeCounts(): Promise<{
  standalone: number;
  trashedLine: number;
  trashedCase: number;
}> {
  const [standalone] = await db
    .select({ value: count() })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.isDeleted, false), isNull(domesticOrders.repairCaseId)));
  const [trashedLine] = await db
    .select({ value: count() })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.isDeleted, true), isNotNull(domesticOrders.repairCaseId)));
  const [trashedCase] = await db
    .select({ value: count() })
    .from(domesticOrders)
    .innerJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .where(and(eq(domesticOrders.isDeleted, false), eq(repairCases.isDeleted, true)));
  return {
    standalone: standalone?.value ?? 0,
    trashedLine: trashedLine?.value ?? 0,
    trashedCase: trashedCase?.value ?? 0,
  };
}

/**
 * 읽어 온 줄들을 **수리 건 하나 + 그 건의 내자 줄들**로 묶는다.
 *
 * `Map` 의 차례는 넣은 차례이고 조회가 접수번호순이므로, 돌릴 때마다 같은 건이 같은
 * 차례로 찍힌다. 세는 일은 여기서 하지 않는다 — 전부 `scripts/lib/` 의 순수 함수가 한다.
 */
function groupByCase(rows: readonly JoinedRow[]): SurveyCase[] {
  const byCase = new Map<
    string,
    {
      intakeNumber: string;
      customerRequestedDueDate: string | null;
      receivedAt: string;
      lines: Map<string, SurveyDueDateRow[]>;
    }
  >();

  for (const row of rows) {
    let entry = byCase.get(row.caseId);
    if (!entry) {
      entry = {
        intakeNumber: row.intakeNumber,
        customerRequestedDueDate: row.customerRequestedDueDate,
        receivedAt: row.receivedAt,
        lines: new Map(),
      };
      byCase.set(row.caseId, entry);
    }
    let line = entry.lines.get(row.orderId);
    if (!line) {
      line = [];
      entry.lines.set(row.orderId, line);
    }
    // leftJoin 이라 날짜가 없는 줄은 여기서 null 로 온다 — 줄은 서고 날짜 행만 없다.
    if (row.dueDate !== null) line.push({ dueDate: row.dueDate, hasNote: row.hasNote === true });
  }

  return [...byCase.values()].map((entry) => ({
    intakeNumber: entry.intakeNumber,
    customerRequestedDueDate: entry.customerRequestedDueDate,
    receivedAt: entry.receivedAt,
    lines: [...entry.lines.values()].map((dueDates) => ({ dueDates })),
  }));
}

/** 본보기 한 줄. 🔴 접수번호와 날짜까지다. */
function formatSample(sample: SurveySample, withReceivedAt = false): string {
  const own = sample.caseDueDate ?? "-";
  const domestic = sample.domesticDueDates.length > 0 ? sample.domesticDueDates.join(", ") : "-";
  const line = `  ${sample.intakeNumber}  수리 건 ${own}  ↔  내자 ${domestic}`;
  // ⑦ 는 인수일이 있어야 「정말 이른가」를 눈으로 볼 수 있다. 다른 묶음에는 군더더기다.
  return withReceivedAt ? `${line}   (인수일 ${sample.receivedAt ?? "?"})` : line;
}

function printSamples(
  title: string,
  samples: readonly SurveySample[],
  total: number,
  withReceivedAt = false
): void {
  if (samples.length === 0) return;
  console.log(`\n─ ${title} — 앞의 ${samples.length}건`);
  for (const sample of samples) console.log(formatSample(sample, withReceivedAt));
  if (total > samples.length) console.log(`  … 그 밖 ${total - samples.length}건`);
}

async function main(): Promise<void> {
  console.log("\n" + "─".repeat(76));
  console.log("  납기요청일 ↔ 고객 요청 납기일 — 묶으면 몇 건이 덮이나 (읽기만 한다)");
  console.log("─".repeat(76));

  const rows = await readJoinedRows();
  const cases = groupByCase(rows);
  const survey = summarizeRequestedDueDateSync(cases, SAMPLE_LIMIT);
  const outOfScope = await readOutOfScopeCounts();

  // 🔴 눈으로 검산할 수 없는 수다. 칸의 합이 전체와 다르면 셈이 샌 것이고, 그 수로
  //    설계를 정하면 안 된다 — 찍지 않고 멈춘다.
  const mismatch = bucketTotalMismatch(survey);
  if (mismatch !== null) {
    console.log(`\n  ✗ ${mismatch} 이 수를 믿지 마십시오.`);
    process.exitCode = 1;
    return;
  }

  console.log("\n─ 범위 (휴지통은 양쪽 다 빠져 있다)");
  console.log(`  수리 건에 붙은 살아 있는 내자 줄        ${survey.lines}줄`);
  console.log(`  그 줄들이 가리키는 수리 건              ${survey.cases}건`);
  console.log(`  그 줄들에 달린 납기요청일 행            ${survey.dueDateRows}행`);
  console.log("\n  범위 밖 (동기화와 무관하거나 휴지통)");
  console.log(`  수리 건과 무관한 살아 있는 줄(별도 건)  ${outOfScope.standalone}줄  ← 지금 그대로 둔다`);
  console.log(`  휴지통에 든 내자 줄(수리 건에 붙은 것)  ${outOfScope.trashedLine}줄`);
  console.log(`  수리 건이 휴지통인 살아 있는 줄         ${outOfScope.trashedCase}줄`);

  console.log("\n─ 세어 본 것 (수리 건 단위)");
  console.log(`  ① 내자 줄이 여럿인 건                   ${survey.multiLineCases}건 (줄 ${survey.multiLineLines}개)`);
  console.log(`  ② 한 줄에 납기요청일이 여럿             ${survey.multiDueDateLines}줄 (그런 줄을 가진 건 ${survey.multiDueDateCases}건)`);
  console.log(`      그중 서로 다른 날짜가 여럿           ${survey.multiDistinctDueDateLines}줄`);
  console.log(`      (차이는 「날짜는 같고 행만 여럿」이다 — 묶으면 행과 비고가 사라진다)`);
  console.log(`  ③ 양쪽 다 적혔는데 다름  ← 덮이는 수    ${survey.buckets.differ}건`);
  console.log(`      내자가 더 늦다                       ${survey.directions["domestic-later"]}건  (발주를 미룬 쪽)`);
  console.log(`      수리 건이 더 늦다                    ${survey.directions["case-later"]}건  (고객이 당긴 쪽일 수 있다)`);
  console.log(`      가장 이른 하루는 같고 날짜가 더 있다 ${survey.directions["same-earliest-plus-more"]}건`);
  console.log(`      🔴 그중 내자 날짜가 여럿인 건        ${survey.differWithMultipleDomesticDates}건`);
  console.log(`         (이 건들은 위 방향 꼬리표가 묶음 전체를 말하지 못한다 — 가장 이른 하루로만 갈랐다)`);
  console.log(`  ④ 한쪽만 적힘 (지금 빌려 그리는 중)     ${survey.buckets["case-only"] + survey.buckets["domestic-only"]}건`);
  console.log(`      수리 건에만 적힘                     ${survey.buckets["case-only"]}건  (내자 줄이 빌려 그린다)`);
  console.log(`      내자에만 적힘                        ${survey.buckets["domestic-only"]}건  (수리 건이 빌려 그린다)`);
  console.log(`  ⑤ 양쪽 다 적혔고 같다                   ${survey.buckets.same}건`);
  console.log(`  ⑥ 양쪽 다 비었다                        ${survey.buckets.neither}건`);
  console.log(`  ─ ③+④+⑤+⑥ = ${survey.cases}건 (검산 통과)`);

  console.log(`  ⑦ 내자 날짜가 인수일보다 이른 건         ${survey.blockedByReceivedAt}건`);
  console.log(`      🔴 「내자 → 수리 건」이 **거절당하는 건**이다 — 수리 건의 고객 요청 납기일은`);
  console.log(`         인수일보다 이를 수 없다(mutations/repair-cases.ts 847-857). 같은 날은 괜찮다.`);
  console.log(`      어느 날짜를 골라 밀어도 막힌다(전부 이르다) ${survey.blockedAllDates}건`);
  console.log(`      그중 ③ 다른 건  ← 가장 까다롭다          ${survey.blockedByBucket.differ}건  (덮을 값도 있고 거절도 당한다)`);
  console.log(`      그중 ④ 내자에만 적힘                     ${survey.blockedByBucket["domestic-only"]}건  (지금 잘 보이던 건이 묶는 순간 오류가 된다)`);
  console.log(`      그중 ⑤ 양쪽이 같음                       ${survey.blockedByBucket.same}건  (0 이 아니면 저장된 고객 요청 납기일 자체가 잣대를 어기고 있다)`);
  if (survey.receivedAtUnknown > 0) {
    console.log(`      🔴 인수일을 못 읽어 못 잰 건              ${survey.receivedAtUnknown}건 — 위 ⑦ 은 적게 세어진 수다`);
  }

  console.log("\n─ 줄 단위로 보면");
  console.log(`  지금 수리 건 날짜를 빌려 그리는 줄      ${survey.linesBorrowingFromCase}줄`);
  console.log(`  묶으면 덮일 줄(수리 건 날짜와 다른 줄)  ${survey.linesDifferingFromCase}줄`);
  console.log(`  비고가 적힌 납기요청일 행               ${survey.notedDueDateRows}행  ← 행을 지우면 함께 사라진다`);

  printSamples("① 내자 줄이 여럿인 건", survey.samples.multiLine, survey.multiLineCases);
  printSamples("② 한 줄에 납기요청일이 여럿인 건", survey.samples.multiDueDate, survey.multiDueDateCases);
  printSamples("③ 양쪽이 다른 건", survey.samples.differ, survey.buckets.differ);
  printSamples(
    "⑦ 내자 날짜가 인수일보다 이른 건(수리 건으로 밀면 거절당한다)",
    survey.samples.blocked,
    survey.blockedByReceivedAt,
    true
  );
}

main()
  .then(async () => {
    console.log("\n" + "─".repeat(76));
    console.log("  🔵 이 수는 **돌린 그 DB 의 사실**입니다 — 개발 DB 로는 규모를 못 잽니다.");
    console.log("  🔴 이 도구는 한 글자도 바꾸지 않았습니다(SELECT 뿐).");
    console.log("─".repeat(76) + "\n");
    await pgClient.end({ timeout: 5 });
  })
  .catch(async (error) => {
    console.error("재지 못했습니다:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await pgClient.end({ timeout: 5 });
  });
