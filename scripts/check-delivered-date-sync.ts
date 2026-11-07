import "./load-env";

import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, pgClient } from "../src/lib/db/connection";
import { domesticOrderDueDates, domesticOrders, repairCases } from "../src/lib/db/schema";
import {
  deliveredDateSurveyMismatch,
  summarizeDeliveredDateSync,
  type SurveyDueDateRow,
  type SurveyOrderLine,
  type SurveySample,
} from "./lib/delivered-date-sync-survey";

/**
 * ============================================================================
 * 내자 `납품일` ↔ 수리 건 `실제 출하일` — **옮기기 전에 무엇이 어떻게 적혀 있나**
 * ============================================================================
 *
 *   npm run check:delivered-date-sync
 *
 * ── 🔴 왜 이것부터인가 ──────────────────────────────────────────────────
 * 2026-11-07 사용자 요구는 **내자정리의 납품일을 납기요청일 줄에 달고, 수리 건의 실제
 * 출하일과 양방향으로 잇는** 것이다. 그것은 **자료를 옮기는 일**인데, 운영에 지금 무엇이
 * 어떻게 적혀 있는지 아무도 모른다 — 개발 DB 에는 과거 건이 거의 없어서(연락서 469장이
 * 개발에서는 3장이다) 여기서 센 수로 규모를 말할 수 없다.
 *
 * 🔴 이 저장소의 규율이다: **운영 대량 변경은 표본부터.** 계획이 ✗ 0 으로 통과해도 값은
 * 안 재고 있다. 2026-10-30 에 납기요청일을 묶을 때도 세는 도구
 * (`check-requested-due-date-sync.ts`)를 먼저 만들고 그 수를 보고 설계를 정했다 —
 * 이 도구는 그 자리의 같은 일을 하고, 바깥 껍데기도 그 파일을 그대로 따랐다.
 *
 * ── 🔴 읽기만 한다. **쓰는 모드가 없다** ────────────────────────────────
 * `INSERT`·`UPDATE`·`DELETE` 가 한 줄도 없고, `--apply` 같은 깃발도 **일부러** 두지
 * 않았다 — 재는 도구에 쓰는 길을 내 두면 언젠가 누가 그 길을 넓힌다
 * (`check-part-name-overlap.ts` · `check-target-shipment-missing.ts` ·
 * `check-requested-due-date-sync.ts` 와 같은 규율). 그 규율이 지켜지고 있는지는
 * `scripts/check-tools-read-only-source.test.ts` 가 **원본 글자로** 본다.
 *
 * ── 🔴 범위: **살아 있는 내자 줄 전부**(수리 건이 붙은 줄 + 기타건) ─────
 * 이웃 도구는 수리 건에 붙은 줄만 봤다. 여기서는 **기타건도 함께 센다** — 「납품일을
 * 납기요청일 줄에 단다」는 쪽은 수리 건과 상관없이 모든 줄에 걸리는 일이고, 분할 납품은
 * 기타건에 몰려 있다고 들었기 때문이다(그 말이 운영에서 참인지가 ⑨ 다).
 *
 * 🔴 갈래를 가르는 것은 `repair_case_id` **하나**다 — 「기타건 현황」이 쓰는 그 조건
 * (`listMiscDomesticOrders`: `is_deleted = false` + `repair_case_id IS NULL`)과 같아야
 * 두 자리가 같은 수를 말한다. 그래서 **수리 건이 휴지통인 줄도 「수리 건이 붙은 줄」에
 * 그대로 둔다**(그 줄은 기타건 현황에 뜨지 않는다). 그 수는 따로 찍어 숨기지 않는다.
 *
 * ── 🔴 이름도 글자도 꺼내지 않는다 ──────────────────────────────────────
 * 납품자(`delivered_by`)는 사람 이름이고(users FK 가 아니라 시트 그대로의 글자다),
 * 납기요청일 행의 비고(`note`)에도 담당자 이름이 섞일 수 있다 — 둘 다 그 표의 PII
 * 항목이다. 그래서 **「적혀 있나」만** DB 안에서 불리언으로 바꿔 받는다. 고객사·형식·
 * L/N·S/N 은 애초에 조회에 없다.
 *
 * 🔵 찍는 글자는 **접수번호와 날짜까지**다(이웃 도구와 같은 선). 기타건 줄은 본보기를
 * 만들지 않는다 — 그 줄을 가리킬 글자가 발주서번호·고객사·인수번호 글자뿐이고 셋 다
 * 꺼내지 않기로 한 것들이다. 기타건 쪽은 수로만 말한다.
 *
 * ── 🔴 개발 DB 로는 규모를 못 잰다 ──────────────────────────────────────
 * **운영에서** 돌려야 뜻이 있는 수가 나온다. NAS 에서는 도구 컨테이너가 그 자리를 맡는다:
 *
 *   cd /volume1/dss/deploy
 *   sudo docker compose -f docker-compose.nas.yml --env-file .env.nas --profile tools \
 *     run --rm tools-as npm run check:delivered-date-sync
 *
 * 🔴 지금 운영에 올라가 있는 도구 이미지(`dss-as-tools:13`)에는 **이 명령이 없다.**
 * 다음 배포에 실려야 돌아간다 — 그 전에 치면 `Missing script` 가 난다.
 * ============================================================================
 */

/** 본보기를 몇 개까지 찍나. 🔵 늘리려면 이 수를 고친다 — 깃발을 두지 않았다(머리말). */
const SAMPLE_LIMIT = 20;

type JoinedRow = {
  orderId: string;
  linkedToRepairCase: boolean;
  caseKey: string | null;
  intakeNumber: string | null;
  actualShipmentDate: string | null;
  caseDeleted: boolean | null;
  deliveredDate: string | null;
  hasDeliveredBy: boolean | null;
  hasLegacyRequestedDueDate: boolean | null;
  dueDate: string | null;
  hasNote: boolean | null;
};

/**
 * **살아 있는** 내자 줄 전부와, 거기 붙은 수리 건 · 납기요청일 행.
 *
 * 🔴 두 조인이 **모두 `leftJoin`** 인 까닭:
 *  · 수리 건 쪽 — `innerJoin` 으로 바꾸면 기타건이 통째로 사라진다. 기타건을 세는 것이
 *    이 도구가 이웃과 다른 점이다.
 *  · 납기요청일 쪽 — **행이 하나도 없는 줄도 세야 한다.** 그 줄들이 ⑨ 의 `0행` 이고
 *    ⑬(달 행이 없는데 납품일이 적힌 줄)의 자리다.
 *
 * 🔴 거르는 조건은 `is_deleted = false` **하나뿐**이다. 수리 건의 휴지통 여부로 거르지
 * 않는 것은 일부러다(머리말의 '범위') — 대신 그 값을 실어 와 따로 센다.
 */
async function readJoinedRows(): Promise<JoinedRow[]> {
  return db
    .select({
      orderId: domesticOrders.id,
      // 🔴 갈래를 가르는 하나뿐인 값. 아래 수리 건 조인의 결과로 가르지 않는다 —
      //    조인이 새면 수리 건이 붙은 줄이 조용히 기타건으로 세어진다.
      linkedToRepairCase: sql<boolean>`${domesticOrders.repairCaseId} is not null`,
      caseKey: repairCases.id,
      intakeNumber: repairCases.intakeNumber,
      actualShipmentDate: repairCases.actualShipmentDate,
      caseDeleted: repairCases.isDeleted,
      deliveredDate: domesticOrders.deliveredDate,
      // 🔴 글자를 꺼내지 않는다(머리말의 PII 항목). 공백만 적힌 값은 「없음」으로 본다.
      hasDeliveredBy: sql<boolean>`${domesticOrders.deliveredBy} is not null and btrim(${domesticOrders.deliveredBy}) <> ''`,
      // ⑫ 아무도 안 읽는 옛 칸. 날짜 자체는 받지 않는다 — 셀 것은 「남아 있나」뿐이다.
      hasLegacyRequestedDueDate: sql<boolean>`${domesticOrders.requestedDueDate} is not null`,
      dueDate: domesticOrderDueDates.dueDate,
      hasNote: sql<boolean>`${domesticOrderDueDates.note} is not null and btrim(${domesticOrderDueDates.note}) <> ''`,
    })
    .from(domesticOrders)
    .leftJoin(repairCases, eq(repairCases.id, domesticOrders.repairCaseId))
    .leftJoin(domesticOrderDueDates, eq(domesticOrderDueDates.domesticOrderId, domesticOrders.id))
    .where(eq(domesticOrders.isDeleted, false))
    .orderBy(
      // 접수번호순이라 본보기가 돌릴 때마다 같은 차례로 찍힌다. 기타건은 접수번호가
      // 없어 뒤로 밀리고(`nulls last`), 그 안에서는 줄 id 로 차례가 고정된다.
      sql`${repairCases.intakeNumber} asc nulls last`,
      asc(domesticOrders.id),
      asc(domesticOrderDueDates.displayOrder),
      asc(domesticOrderDueDates.dueDate)
    );
}

/**
 * 범위 밖이 몇인가 — 빠진 것을 모르고 비율을 읽지 않도록 함께 찍는다(이웃 도구의 규율).
 *
 * 🔵 셋째 수는 **반대 방향의 하한**이다: 실제 출하일이 적혀 있는데 살아 있는 내자 줄이
 * 하나도 없는 수리 건은, 「수리 건 → 내자」로 끌어올 자리가 **아예 없는** 건이다.
 */
async function readOutOfScopeCounts(): Promise<{
  trashedLines: number;
  trashedLinesWithCase: number;
  shipmentWithoutLine: number;
}> {
  const [trashedLines] = await db
    .select({ value: count() })
    .from(domesticOrders)
    .where(eq(domesticOrders.isDeleted, true));
  const [trashedLinesWithCase] = await db
    .select({ value: count() })
    .from(domesticOrders)
    .where(and(eq(domesticOrders.isDeleted, true), isNotNull(domesticOrders.repairCaseId)));
  // 살아 있는 내자 줄이 하나도 안 붙은 수리 건 — leftJoin 뒤 `is null` 인 줄만 남긴다.
  const [shipmentWithoutLine] = await db
    .select({ value: count() })
    .from(repairCases)
    .leftJoin(
      domesticOrders,
      and(eq(domesticOrders.repairCaseId, repairCases.id), eq(domesticOrders.isDeleted, false))
    )
    .where(
      and(
        eq(repairCases.isDeleted, false),
        isNotNull(repairCases.actualShipmentDate),
        isNull(domesticOrders.id)
      )
    );
  return {
    trashedLines: trashedLines?.value ?? 0,
    trashedLinesWithCase: trashedLinesWithCase?.value ?? 0,
    shipmentWithoutLine: shipmentWithoutLine?.value ?? 0,
  };
}

/**
 * 읽어 온 행들을 **내자 줄 하나 + 그 줄에 달린 납기요청일들**로 묶는다.
 *
 * `Map` 의 차례는 넣은 차례이고 조회가 접수번호순이므로, 돌릴 때마다 같은 줄이 같은
 * 차례로 찍힌다. 세는 일은 여기서 하지 않는다 — 전부 `scripts/lib/` 의 순수 함수가 한다.
 */
function groupByLine(rows: readonly JoinedRow[]): SurveyOrderLine[] {
  const byLine = new Map<string, SurveyOrderLine & { dueDateRows: SurveyDueDateRow[] }>();

  for (const row of rows) {
    let line = byLine.get(row.orderId);
    if (!line) {
      line = {
        linkedToRepairCase: row.linkedToRepairCase === true,
        // 🔴 갈래가 「붙었다」일 때만 수리 건을 싣는다. 못 읽은 줄은 null 로 남아
        //    `case-unreadable` 로 세어진다 — 「출하일 없음」으로 접지 않는다.
        repairCase:
          row.linkedToRepairCase === true && row.caseKey !== null
            ? {
                key: row.caseKey,
                intakeNumber: row.intakeNumber ?? "(접수번호 없음)",
                actualShipmentDate: row.actualShipmentDate,
                isDeleted: row.caseDeleted === true,
              }
            : null,
        deliveredDate: row.deliveredDate,
        hasDeliveredBy: row.hasDeliveredBy === true,
        hasLegacyRequestedDueDate: row.hasLegacyRequestedDueDate === true,
        dueDateRows: [],
      };
      byLine.set(row.orderId, line);
    }
    // leftJoin 이라 날짜 행이 없는 줄은 여기서 null 로 온다 — 줄은 서고 행만 없다.
    if (row.dueDate !== null) {
      line.dueDateRows.push({ dueDate: row.dueDate, hasNote: row.hasNote === true });
    }
  }

  return [...byLine.values()];
}

/** 본보기 한 줄. 🔴 접수번호와 날짜까지다. */
function formatSample(sample: SurveySample): string {
  const delivered = sample.deliveredDate ?? "-";
  const shipment = sample.actualShipmentDate ?? "-";
  const gap = sample.gapDays === null ? "" : `  (${sample.gapDays > 0 ? "+" : ""}${sample.gapDays}일)`;
  return `  ${sample.intakeNumber}  납품일 ${delivered}  ↔  실제 출하일 ${shipment}${gap}   납기요청일 ${sample.dueDateRowCount}행`;
}

function printSamples(title: string, samples: readonly SurveySample[], total: number): void {
  if (samples.length === 0) return;
  console.log(`\n─ ${title} — 앞의 ${samples.length}줄`);
  for (const sample of samples) console.log(formatSample(sample));
  if (total > samples.length) console.log(`  … 그 밖 ${total - samples.length}줄`);
}

/**
 * 한글·한자·동그라미 숫자는 **두 칸**을 먹는다. `padEnd` 는 글자 수로 세기 때문에
 * 그대로 쓰면 한글이 섞인 이름표마다 줄이 어긋난다 — 이웃 도구가 손으로 띄어 맞춰 둔
 * 그 폭(42칸)을 여기서는 셈으로 맞춘다.
 */
const WIDE_CHARACTER = /[ᄀ-ᅟ①-⓿⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) width += WIDE_CHARACTER.test(character) ? 2 : 1;
  return width;
}

function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(1, width - displayWidth(text)));
}

/** 값이 서는 칸. 이 수 하나를 고치면 보고 전체가 함께 움직인다. */
const VALUE_COLUMN = 41;

/** 이름표 + 값 한 줄. 🔵 이름표가 칸을 넘으면 한 칸은 남긴다 — 붙어 버리면 못 읽는다. */
function row(label: string, value: string): string {
  return `  ${padDisplay(label, VALUE_COLUMN)}${value}`;
}

/** 갈래별 수 한 줄. 합을 함께 적는다 — 둘을 눈으로 더하게 만들지 않는다. */
function kinds(label: string, counts: { linked: number; misc: number }): string {
  const total = counts.linked + counts.misc;
  return row(label, `수리 건 ${counts.linked}줄 · 기타건 ${counts.misc}줄  (합 ${total}줄)`);
}

/** 날수 한 칸. 🔴 잴 줄이 없으면 **0 이 아니라 「-」** 다 — 「차이가 0일」로 읽히면 안 된다. */
function days(value: number | null): string {
  return value === null ? "-" : `${value > 0 ? "+" : ""}${value}일`;
}

async function main(): Promise<void> {
  console.log("\n" + "─".repeat(84));
  console.log("  납품일 ↔ 실제 출하일 — 옮기기 전에 무엇이 어떻게 적혀 있나 (읽기만 한다)");
  console.log("─".repeat(84));

  const rows = await readJoinedRows();
  const lines = groupByLine(rows);
  const survey = summarizeDeliveredDateSync(lines, SAMPLE_LIMIT);
  const outOfScope = await readOutOfScopeCounts();

  // 🔴 눈으로 검산할 수 없는 수다. 합이 어긋나면 셈이 샌 것이고, 그 수로 설계를 정하면
  //    안 된다 — 찍지 않고 멈춘다(이웃 도구와 같은 규율).
  const mismatch = deliveredDateSurveyMismatch(survey);
  if (mismatch !== null) {
    console.log(`\n  ✗ ${mismatch} 이 수를 믿지 마십시오.`);
    process.exitCode = 1;
    return;
  }

  console.log("\n─ 범위 (휴지통에 든 내자 줄은 빠져 있다)");
  console.log(row("살아 있는 내자 줄", `${survey.lines}줄`));
  console.log(row("① 수리 건이 붙은 줄", `${survey.linkedLines}줄`));
  console.log(row("① 기타건(수리 건이 안 붙은 줄)", `${survey.miscLines}줄`));
  console.log(row("   그중 붙은 수리 건이 휴지통인 줄", `${survey.caseInTrashLines}줄  ← 빼지 않았다`));
  console.log("     🔵 갈래를 가르는 자가 「기타건 현황」과 같아야 해서다 — repair_case_id 하나.");
  console.log("\n  범위 밖");
  console.log(
    row("휴지통에 든 내자 줄", `${outOfScope.trashedLines}줄 (그중 수리 건이 붙은 줄 ${outOfScope.trashedLinesWithCase}줄)`)
  );
  console.log(row("내자 줄 없이 출하일만 있는 수리 건", `${outOfScope.shipmentWithoutLine}건`));
  console.log("     🔵 「수리 건 → 내자」로 끌어올 자리가 **아예 없는** 건이다(반대 방향의 하한).");

  console.log("\n─ 적혀 있는 것 (갈래별)");
  console.log(kinds("② 납품일이 적힌 줄", survey.deliveredDateLines));
  console.log(kinds("③ 납품자가 적힌 줄", survey.deliveredByLines));
  console.log(kinds("   그중 납품일은 비어 있는 줄", survey.deliveredByWithoutDateLines));
  console.log("     🔴 납품자는 **이름을 읽지 않았다** — 적혀 있나만 셌다.");
  console.log(
    row("④ 실제 출하일이 적힌 줄", `${survey.shipmentDateLines}줄  (수리 건이 붙은 줄만 가질 수 있다)`)
  );

  // 🔴 조건을 하나씩 걸어 가며 좁힌다 — 마지막 수만 찍으면 어디서 걸러졌는지를 못 본다.
  const bothWritten = survey.buckets.differ + survey.buckets.same;
  console.log("\n─ 좁혀 가며 (수리 건이 붙은 줄만)");
  console.log(row("ⓐ 수리 건이 붙은 줄", `${survey.linkedLines}줄`));
  console.log(row("ⓑ ⓐ 그리고 납품일이 적힌 줄", `${survey.deliveredDateLines.linked}줄`));
  console.log(row("ⓒ ⓑ 그리고 실제 출하일도 적힌 줄", `${bothWritten}줄`));
  console.log(row("ⓓ ⓒ 그리고 두 날짜가 **다른** 줄", `${survey.buckets.differ}줄  ← ⑤`));

  console.log("\n─ 수리 건이 붙은 줄을 여섯 칸으로");
  // 🔵 화살표는 **값 쪽**에 둔다 — 이름표에 넣으면 그 글자의 터미널 폭(한 칸인지 두 칸인지)에
  //    따라 이 줄만 어긋난다.
  console.log(row("⑤ 둘 다 적혔는데 다르다", `${survey.buckets.differ}줄  ← 덮이는 수`));
  console.log(
    row("    납품일이 더 늦다", `${survey.differ.deliveredLater}줄  (보낸 뒤에 받았다 — 운송이 끼면 이 모습이다)`)
  );
  console.log(
    row("    납품일이 더 이르다", `${survey.differ.deliveredEarlier}줄  (출하 전에 납품 — 설명이 필요한 쪽이다)`)
  );
  console.log(row("    가장 크게 벌어진 날수", days(survey.differ.gapDaysMaxAbs)));
  console.log(row("    가운데쯤(아래쪽 가운데값)", days(survey.differ.gapDaysMedianAbs)));
  console.log(
    row("    부호를 살린 양 끝", `${days(survey.differ.gapDaysMin)} ~ ${days(survey.differ.gapDaysMax)}`)
  );
  console.log("     🔵 「-」 는 0일이 아니라 **잴 줄이 없다**는 뜻이다.");
  if (survey.differ.unmeasured > 0) {
    console.log(
      row("    🔴 날수를 못 잰 줄", `${survey.differ.unmeasured}줄 — 날짜 꼴이 아니다. 위 날수는 그만큼 못 본 수다`)
    );
  }
  console.log(row("⑥ 둘 다 적혔고 같다", `${survey.buckets.same}줄`));
  console.log(row("⑦ 납품일만 적혔다", `${survey.buckets["delivered-only"]}줄  (수리 건 쪽으로 밀 값이 있다)`));
  console.log(
    row("⑦ 실제 출하일만 적혔다", `${survey.buckets["shipment-only"]}줄  (내자 쪽으로 끌어올 값이 있다)`)
  );
  console.log(row("   둘 다 비었다", `${survey.buckets.neither}줄`));
  if (survey.buckets["case-unreadable"] > 0) {
    console.log(
      row("   🔴 수리 건을 **못 읽었다**", `${survey.buckets["case-unreadable"]}줄 — 조인이 샜다. 위 ④ 는 적게 세어진 수다`)
    );
  }
  console.log(`  ─ ⑧ ⑤+⑥+⑦+⑦+둘 다 빔 = ${survey.linkedLines}줄 (검산 통과)`);

  console.log("\n─ 납기요청일 쪽 (행에 달겠다는 설계의 밑자락)");
  for (const kind of ["linked", "misc"] as const) {
    const buckets = survey.dueDateRowBuckets[kind];
    const label = kind === "linked" ? "수리 건이 붙은 줄" : "기타건";
    console.log(
      row(`⑨ ${label}`, `0행 ${buckets.none}줄 · 1행 ${buckets.one}줄 · 2행 이상 ${buckets.many}줄`)
    );
  }
  console.log(row("   🔴 수리 건이 붙었는데 2행 이상", `${survey.dueDateRowBuckets.linked.many}줄`));
  console.log("      (「분할 납품은 기타건뿐」이 운영에서 참인가 — 0 이 아니면 그 전제가 틀렸다)");
  console.log(kinds("   납기요청일 행 수", survey.dueDateRows));
  console.log(kinds("⑩ 비고가 적힌 행", survey.notedDueDateRows));
  console.log("     🔴 비고는 **글자를 읽지 않았다** — 적혀 있나만 셌다(담당자 이름이 섞일 수 있다).");
  console.log(kinds("⑪ 2행 이상인데 납품일이 적힌 줄", survey.ambiguousTargetLines));
  console.log(kinds("   그중 납품일이 그 행과 같은 줄", survey.ambiguousTargetLinesMatchingADueDate));
  console.log("     🔵 같은 줄은 「어느 행에 달 것인가」가 자료로 정해진다. 나머지는 사람이 고를 수밖에 없다.");
  console.log(kinds("⑫ 옛 칸에 값이 남은 줄", survey.legacyRequestedDueDateLines));
  console.log("     🔵 requested_due_date — 아무도 안 읽는 칸이다. 이 조각은 손대지 않는다.");

  console.log("\n─ 옮길 때 걸리는 것");
  console.log(kinds("⑬ 납품일이 적혔는데 납기요청일 0행", survey.deliveredWithoutDueDateRowLines));
  console.log("     🔴 행에 달려고 하면 **달 행이 아예 없다.** 행을 만들 것인가, 줄에 그대로 둘 것인가.");
  console.log(
    row("⑭ 내자 줄이 여럿인 수리 건", `${survey.multiLineCases}건 (줄 ${survey.multiLineCaseLines}개)`)
  );
  console.log(
    row("   그중 줄들의 납품일이 서로 다른 건", `${survey.multiLineCasesWithDifferentDeliveredDates}건`)
  );
  console.log("     🔴 수리 건에는 실제 출하일 칸이 **하나뿐**이다 — 그런 건은 어느 납품일을 올릴지");
  console.log("        자료만으로 답할 수 없다.");

  printSamples("⑤ 두 날짜가 다른 줄", survey.samples.differ, survey.buckets.differ);
  printSamples(
    "⑬ 납품일이 적혔는데 납기요청일이 0행인 줄",
    survey.samples.noDueDateRow,
    survey.deliveredWithoutDueDateRowLines.linked
  );
  printSamples(
    "⑪ 납기요청일이 2행 이상인데 납품일이 적힌 줄",
    survey.samples.ambiguous,
    survey.ambiguousTargetLines.linked
  );
  printSamples("⑭ 내자 줄이 여럿인 수리 건의 줄들", survey.samples.multiLine, survey.multiLineCaseLines);
  console.log(`\n  🔵 본보기는 **수리 건이 붙은 줄만** 찍는다 — 기타건 줄을 가리킬 글자가`);
  console.log(`     발주서번호·고객사·인수번호 글자뿐이고, 셋 다 안 꺼내기로 한 것들이다.`);

  console.log("\n─ 이 수를 보고 정할 것");
  console.log("  🔴 「옮길 때 어느 쪽 값을 살리나」 — 그 판단에 걸리는 수는 이것들이다:");
  console.log(`   · 고를 일이 생기는 줄은 ⑤ ${survey.buckets.differ}줄뿐이다. ⑦ 의 ${survey.buckets["delivered-only"] + survey.buckets["shipment-only"]}줄은 덮을 값이 없다(한쪽만 적혔다).`);
  console.log("   · ⑤ 의 **방향과 날수**가 「오타인가 다른 사실인가」를 가른다. 한 방향으로");
  console.log("     며칠씩 쏠려 있으면 그것은 운송 시차이고, 묶는 순간 사실 하나가 사라진다.");
  console.log("   · ⑬ 은 값을 고르는 문제가 아니라 **달 자리가 없는** 문제다(행을 만들 것인가).");
  console.log("   · ⑭ 과 ⑪ 은 한쪽 값이 여럿일 때 **누구에게 쓸 것인가**를 묻는다.");
  console.log("  🔵 이 도구는 그 답을 정하지 않는다 — 재는 도구에 답을 적어 두면 다음 조각이");
  console.log("     그것을 설계 결정으로 물려받는다.");
}

main()
  .then(async () => {
    console.log("\n" + "─".repeat(84));
    console.log("  🔵 이 수는 **돌린 그 DB 의 사실**입니다 — 개발 DB 로는 규모를 못 잽니다.");
    console.log("  🔴 이 도구는 한 글자도 바꾸지 않았습니다(SELECT 뿐).");
    console.log("─".repeat(84) + "\n");
    await pgClient.end({ timeout: 5 });
  })
  .catch(async (error) => {
    console.error("재지 못했습니다:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    await pgClient.end({ timeout: 5 });
  });
