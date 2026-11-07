import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDueDateOverdue, isRepairCaseOverdue } from "./repair-case-overdue";
import { resolveRepairCaseRequestedDueDate } from "./requested-due-date-link";
import type { RepairCase } from "./types";

/**
 * ============================================================================
 * 「납기 지연」 — **고객 요청 납기일**이 지난 건 (2026-11-03 부터)
 * ============================================================================
 * 사용자 결정: 「사내 목표 완료일을 지났다고 해서 납기 지연 배지가 뜨지 않도록
 * 해줘. (고객 요청 납기일을 지났을 때만 [납기 지연]이 뜨도록 해줘.)」
 *
 * 🔴 **그 전까지 이 판정이 보던 날짜는 사내 목표 완료일**(칸 이름은
 * internalTargetShipmentDate 그대로)이었다. 그래서 아래 표본은 **두 날짜를 모두**
 * 들고 다니며, 사내 날짜 쪽은 일부러 **한참 지난 값**으로 둔다 — 옛 규칙이
 * 되살아나면 그 자리에서 터지도록. 사내 날짜를 null 로 비워 두면 「고객 날짜를
 * 본다」와 「아무 날짜도 안 본다」가 구별되지 않아, 판정을 통째로 꺼 놔도 초록이다.
 *
 * ── 🔴 2026-11-07 — **빌려 온 날짜도 본다** ─────────────────────────────────
 * 사용자 요구: 「고객 요청 납기일이 **내자정리에서 읽어온 경우 [납기지연]이 안뜨는**
 * 것 같아. 내자정리에서 쓰인 요청 납기일에 대해서도 **수리건 상세에서 적은 것과 같은
 * 취급**을 해주도록 해줘」. 아래 「빌려 온 날짜」 묶음이 그 요구를 값으로 잰다 —
 * 사용자가 본 그 모양(제 칸이 비었고 · 내자 줄에 지난 날짜가 있고 · 출하일이 없다)이
 * 첫 시험이다.
 *
 * 🔴 **표본의 못이 하나 더 늘었다**(아래 「표본 점검」 둘째). 「빌려 온다」를 재려면
 * 표본의 내자 날짜가 **실제로 쓰여야** 하는데, 그 목록이 비어 있으면 모든 단언이
 * 옛 구현에서도 그대로 통과한다 — 아무것도 안 재는 초록이 된다.
 *
 * "납기 지연"은 납기일이 *지난* 것이지 납기일 *당일*이 아니다.
 * customerRequestedDueDate는 PostgreSQL `date` 컬럼에서 온 "YYYY-MM-DD"
 * 문자열이라 new Date()로 파싱하면 UTC 자정이 되므로, 실제 시각과 그대로
 * 비교하면 한국시간 오전 9시(=UTC 0시)부터 "납기일이 바로 오늘"인 건이
 * 지연으로 뒤집힌다. 아래 KST 경계 두 케이스가 그 회귀를 막는 자물쇠다.
 * ============================================================================
 */

type OverdueInput = Pick<
  RepairCase,
  "status" | "customerRequestedDueDate" | "actualShipmentDate" | "internalTargetShipmentDate"
> & { domesticOrderDueDates: readonly string[] };

function subject(overrides: Partial<OverdueInput> = {}): OverdueInput {
  return {
    status: "IN_REPAIR",
    customerRequestedDueDate: "2026-08-25",
    // 🔵 기본 표본은 **안 빌린다** — 아래 옛 시험들이 재는 것은 제 칸 하나다.
    //    빌려 오기는 「빌려 온 날짜」 묶음이 따로 잰다.
    domesticOrderDueDates: [],
    actualShipmentDate: null,
    // 🔴 표본의 못 — 이 날짜는 **언제나 한참 지나 있다.** 옛 규칙(사내 날짜로 재기)이
    // 되살아나면 아래 "지연 아님" 단언들이 전부 깨진다.
    internalTargetShipmentDate: "2026-01-05",
    ...overrides,
  };
}

// 2026-08-25 14:00 KST — 한국/UTC 달력 날짜가 둘 다 08-25인, 경계가 아닌 시각.
const MIDDAY_KST = new Date("2026-08-25T05:00:00.000Z");

test("표본 점검 — 사내 목표 완료일은 늘 지나 있다(옛 규칙이 되살아나면 바로 걸린다)", () => {
  const s = subject();
  assert.ok(s.internalTargetShipmentDate !== null);
  assert.ok(
    s.internalTargetShipmentDate < "2026-08-25",
    "표본의 사내 날짜가 지나 있지 않다 — 아래 시험들이 옛 규칙을 못 잡는다"
  );
});

/**
 * 🔴 **빌려 오기 시험이 공짜로 통과하지 못하게 박는 못.**
 *
 * 아래 「빌려 온 날짜」 묶음이 쓰는 표본(제 칸 null + 내자 줄 하나)이 **정말로 빌려
 * 오는 모양인지**를 판정 함수가 아니라 **빌려 오기 규칙 쪽에** 물어 본다. 이 못이
 * 없으면 표본이 조용히 틀어졌을 때(예: 제 칸을 비우는 것을 잊었을 때) 아래 단언들이
 * 「제 칸으로 재서」 통과하고, 그러면 이 조각이 고친 것을 한 줄도 안 재게 된다.
 */
test("🔴 표본 점검 — 「빌려 온다」 표본이 정말 빌려 오는 모양이다(안 그러면 아래가 공짜 통과)", () => {
  const borrowed = resolveRepairCaseRequestedDueDate({
    customerRequestedDueDate: null,
    domesticOrderDueDates: ["2026-08-24"],
  });
  assert.equal(borrowed.borrowed, true, "표본이 빌려 오지 않는다 — 아래 시험이 아무것도 안 잰다");
  assert.equal(borrowed.dueDate, "2026-08-24");
  assert.ok(borrowed.dueDate < "2026-08-25", "표본의 빌려 온 날짜가 지나 있지 않다");
});

test("🔴 사내 목표 완료일만 지났으면 납기 지연이 아니다 — 2026-11-03 사용자 결정", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: "2026-12-31", internalTargetShipmentDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 고객 요청 납기일이 어제면 납기 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-24" }), MIDDAY_KST),
    true
  );
});

test("고객 요청 납기일이 오늘(한국)이면 아직 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), MIDDAY_KST),
    false
  );
});

test("고객 요청 납기일이 내일이면 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-26" }), MIDDAY_KST),
    false
  );
});

test("출하 완료된 건은 고객 요청 납기일이 한참 지났어도 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ status: "SHIPMENT_COMPLETED", customerRequestedDueDate: "2026-01-05" }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 고객 요청 납기일이 없고 빌려 올 날짜도 없으면 납기 지연이 아니다 — 사내 날짜가 지나 있어도", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        customerRequestedDueDate: null,
        domesticOrderDueDates: [],
        internalTargetShipmentDate: "2026-01-05",
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("KST 경계: 한국 08-25 09:30(UTC 08-25 00:30)에 납기일 08-25는 지연이 아니다", () => {
  // UTC 기준으로 비교하는 구현이라면 new Date("2026-08-25")(UTC 자정)이
  // 이 시각보다 앞서므로 틀리게 "지연"이 나온다.
  const justAfterNineAmKst = new Date("2026-08-25T00:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), justAfterNineAmKst),
    false
  );
});

test("KST 경계: 한국 08-26 00:30(UTC 08-25 15:30)에 납기일 08-25는 지연이다", () => {
  // UTC 달력 날짜는 아직 08-25라, UTC 기준 구현이라면 틀리게 "지연 아님"이 나온다.
  const alreadyNextDayKst = new Date("2026-08-25T15:30:00.000Z");
  assert.equal(
    isRepairCaseOverdue(subject({ customerRequestedDueDate: "2026-08-25" }), alreadyNextDayKst),
    true
  );
});

/**
 * 아래 세 케이스가 "출하일이 찍힌 건은 지연이 아니다" 규칙의 자물쇠다.
 * 출하일이 있으면 그 물건은 이미 나간 것이므로, 워크플로 단계가 아직
 * SHIPMENT_COMPLETED에 닿지 않았어도 살아 있는 경보에서는 빠진다.
 */

test("납기일이 지났어도 실제 출하일이 찍혀 있으면 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: "2026-08-09",
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("납기일이 지났고 실제 출하일이 없으면(null) 여전히 납기 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: null,
      }),
      MIDDAY_KST
    ),
    true
  );
});

test("실제 출하일이 납기일보다 늦어도(늦게 나갔어도) 이미 출하됐으므로 납기 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "IN_REPAIR",
        customerRequestedDueDate: "2026-08-10",
        actualShipmentDate: "2026-08-20",
      }),
      MIDDAY_KST
    ),
    false
  );
});

/**
 * ════════════════════════════ 빌려 온 날짜 (2026-11-07 사용자 요구) ═════════
 */

test("🔴 사용자가 본 그 모양 — 제 칸이 비었고 내자 줄에 지난 날짜가 있고 아직 안 나갔으면 **지연이다**", () => {
  // 운영에서 신고된 건의 모양 그대로다(접수번호·고객사는 넣지 않는다 — 공개 저장소).
  assert.equal(
    isRepairCaseOverdue(
      subject({
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2026-08-24"],
        actualShipmentDate: null,
      }),
      MIDDAY_KST
    ),
    true
  );
});

test("🔴 빌려 온 날짜가 오늘(한국)이면 아직 지연이 아니다 — 제 칸과 같은 경계다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: null, domesticOrderDueDates: ["2026-08-25"] }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 빌려 온 날짜가 안 지났으면 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: null, domesticOrderDueDates: ["2026-12-31"] }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 빌려 온 날짜가 지났어도 실제 출하일이 찍혀 있으면 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2026-08-10"],
        actualShipmentDate: "2026-08-09",
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 빌려 온 날짜가 지났어도 출하 완료 상태면 지연이 아니다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({
        status: "SHIPMENT_COMPLETED",
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2026-08-10"],
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 제 칸에 적힌 값이 이긴다 — 내자에 지난 날짜가 있어도 제 칸이 미래면 지연이 아니다", () => {
  // 빌리는 것은 **비었을 때뿐**이다(requested-due-date-link.ts 의 「자기 자리에 적힌
  // 것이 먼저」). 이 갈림이 뒤집히면 사람이 일부러 미뤄 적은 날짜가 무시된다.
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: "2026-12-31", domesticOrderDueDates: ["2026-08-10"] }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 제 칸에 적힌 값이 이긴다 — 내자가 미래여도 제 칸이 지났으면 지연이다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: "2026-08-10", domesticOrderDueDates: ["2026-12-31"] }),
      MIDDAY_KST
    ),
    true
  );
});

test("🔴 공백만 적힌 제 칸은 「없음」으로 접혀 내자에서 빌린다 — 화면이 그렇게 그린다", () => {
  assert.equal(
    isRepairCaseOverdue(
      subject({ customerRequestedDueDate: "   ", domesticOrderDueDates: ["2026-08-10"] }),
      MIDDAY_KST
    ),
    true
  );
});

test("🔴 내자 날짜가 여럿이면 **가장 이른 하루**로 잰다 — 주간보고·상세와 같은 함수다", () => {
  // 가장 이른 하루만 지났고 나머지는 멀다. 「아무거나 하나」나 「가장 늦은 하루」로
  // 재는 구현이면 여기서 갈린다.
  assert.equal(
    isRepairCaseOverdue(
      subject({
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2026-12-31", "2026-08-10", "2026-09-30"],
      }),
      MIDDAY_KST
    ),
    true
  );
  // 거울: 가장 이른 하루가 아직 안 지났으면 뒤의 날짜가 지나 있어도 지연이 아니다…
  // 가 될 수 없다(가장 이른 것이 가장 과거다). 그래서 반대 방향은 **전부 미래**로 잰다.
  assert.equal(
    isRepairCaseOverdue(
      subject({
        customerRequestedDueDate: null,
        domesticOrderDueDates: ["2026-12-31", "2026-09-30"],
      }),
      MIDDAY_KST
    ),
    false
  );
});

test("🔴 빌려 오는 규칙을 베껴 적지 않고 화면이 쓰는 그 함수를 부른다", () => {
  // 규칙이 두 벌이 되면 어느 날 한쪽만 고쳐지고, 그날 이 배지는 화면에 그려진 날짜가
  // 아닌 다른 날짜로 잰다. 글자로 못 박는다 — 값으로는 두 벌이어도 같은 답이 나온다.
  const source = readFileSync(new URL("./repair-case-overdue.ts", import.meta.url), "utf8");
  assert.ok(
    source.includes("resolveRepairCaseRequestedDueDate("),
    "빌려 오기를 공용 함수로 하지 않는다"
  );
  assert.ok(
    source.includes("isRepairCaseShipmentFinished("),
    "출하 완료를 경보 넷이 함께 쓰는 잣대로 가르지 않는다"
  );
  // 🔴 pickEarliestDueDate 를 여기서 직접 **부르면** 「가장 이른 하루」 규칙이 두 벌이
  //    된다. 주석에 이름이 적히는 것은 괜찮으므로 여는 괄호까지 보고 판정한다.
  assert.equal(
    source.includes("pickEarliestDueDate("),
    false,
    "여럿 중 하나를 고르는 규칙을 이 파일이 또 적고 있다"
  );
});

/**
 * 핵심 비교 한 줄(isDueDateOverdue) — 날짜 하나만 받는다. 「모른다」가 「아니다」와
 * 같은 칸에 들어가는 것이 여기서 정해진다.
 */
test("핵심 비교: 날짜가 없으면 거짓이다 — 없는 약속을 어겼다고 말할 수 없다", () => {
  assert.equal(isDueDateOverdue(null, MIDDAY_KST), false);
});

test("핵심 비교: 어제는 참 · 오늘은 거짓 · 내일은 거짓(한국 달력)", () => {
  assert.equal(isDueDateOverdue("2026-08-24", MIDDAY_KST), true);
  assert.equal(isDueDateOverdue("2026-08-25", MIDDAY_KST), false);
  assert.equal(isDueDateOverdue("2026-08-26", MIDDAY_KST), false);
});
