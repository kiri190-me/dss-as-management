import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPortalApprovalHistory,
  parseApprovalHistoryPeriod,
  portalApprovalHistoryCounterpart,
  toPortalApprovalHistoryEntry,
} from "./portal-approval-history";
import {
  buildApprovalHistoryEntry,
  type ApprovalHistoryEntry,
} from "@/lib/domain/approval-history";
import type { ApprovalOutcomeTarget } from "@/lib/domain/notifications";
import type { ApprovalHistoryPeriod } from "@/lib/db/queries/approval-history";
import type { PortalActor } from "./portal-notifications";

/**
 * ============================================================================
 * 결재 내역을 통합 승인함에 내줄 모양 — DB 없이 그대로 돌려 본다
 * ============================================================================
 * 여기서 지키는 것:
 *  · 🔴 대상 사람은 **토큰이 실어 온 sub** 하나로만 정해지고, 조회에는 **되짚은
 *    A/S id** 가 간다. 부르는 쪽이 남의 번호를 끼워 넣을 자리가 없다.
 *  · 🔴 A/S 에 계정이 없는 사람은 **빈 목록**이다 — 오류가 아니다. 포털이 세 집을
 *    모으는데 한 집이 오류를 뱉으면 나머지 둘까지 못 그릴 수 있다.
 *  · 🔴 주소가 **절대 주소**가 된다 — 갈래마다 제 구역으로.
 *  · 🔴 「상대는 누구인가」가 `relation` 마다 다른 칸에서 온다(뒤바뀌면 내가 나를
 *    대신한 줄이 선다).
 *  · 🔴 계약의 **여덟 칸만** 나간다 — 결재 사유 같은 속내가 포털로 새지 않는다.
 *  · 🔴 기간은 한 함수가 읽고, **읽은 값을 손보지 않는다**(반열린 구간이 깨진다).
 *
 * 🔴 값은 전부 가짜다 — 실제 고객사 · 사람 이름 · L/N · S/N 을 적지 않는다.
 *
 * 🔵 줄의 밑감을 손으로 적지 않고 **도메인 빌더**(buildApprovalHistoryEntry)로 짓는다.
 * 손으로 적으면 `relation` 이 `ON_BEHALF` 인데 맡긴 사람 칸이 비어 있는, 조회가
 * 내놓을 수 없는 줄로 시험하게 된다 — 그런 표본으로는 뒤바뀜을 잡을 수 없다.
 * ============================================================================
 */

const BASE = "http://192.168.0.13:3000";
/** 포털 쪽 사람 id. 🔴 A/S 의 id 와 **다른 값**이어야 시험이 뜻을 갖는다. */
const SUBJECT = "portal-user-0001";
/** 되짚어 낸 A/S 계정의 id — 조회에 가야 하는 값. */
const VIEWER = "33333333-3333-4333-8333-333333333333";
/** 남 — 대리인이거나 자리 주인이거나. */
const OTHER = "99999999-9999-4999-8999-999999999999";

const CASE_ID = "44444444-4444-4444-8444-444444444444";
const QUOTE_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
/** 결재 **행**의 id. 🔵 아래 둘은 일부러 **같은 값**이다 — 표가 둘이라 겹칠 수 있다. */
const APPROVAL_ROW_ID = "11111111-1111-4111-8111-111111111111";

const DECIDED_AT = new Date("2026-11-10T02:00:00.000Z");

const REPAIR_CASE_TARGET: ApprovalOutcomeTarget = {
  source: "REPAIR_CASE",
  approvalId: APPROVAL_ROW_ID,
  repairCaseId: CASE_ID,
  intakeNumber: "DSS-2026-0007",
  approvalType: "REPAIR_INSPECTION",
};
const QUOTE_TARGET: ApprovalOutcomeTarget = {
  source: "QUOTE",
  approvalId: APPROVAL_ROW_ID,
  quoteId: QUOTE_ID,
  quoteNumber: "Q-2026-0001",
};
const DOMESTIC_ORDER_TARGET: ApprovalOutcomeTarget = {
  source: "DOMESTIC_ORDER",
  approvalId: "22222222-2222-4222-8222-222222222222",
  domesticOrderId: ORDER_ID,
  modelName: "가상형식-100",
};

type EntryOverrides = {
  status?: ApprovalHistoryEntry["status"];
  decidedAt?: Date;
  decidedByUserId?: string;
  decidedByName?: string;
  delegatedFromUserId?: string | null;
  delegatedFromName?: string | null;
};

/** 조회가 내놓는 줄 하나 — 기본은 「내가 내 자리를 눌렀다」. */
function entryOf(
  target: ApprovalOutcomeTarget,
  overrides: EntryOverrides = {}
): ApprovalHistoryEntry {
  return buildApprovalHistoryEntry({
    target,
    viewerUserId: VIEWER,
    status: "APPROVED",
    decidedAt: DECIDED_AT,
    decidedByUserId: VIEWER,
    decidedByName: "본인이름",
    delegatedFromUserId: null,
    delegatedFromName: null,
    requestedByName: "요청자이름",
    requestReason: "올리며 적은 말",
    decisionReason: "결정하며 적은 말",
    ...overrides,
  });
}

/** 내가 **남을 대신해** 눌렀다 — 상대는 자리 주인이다. */
function onBehalfEntry(): ApprovalHistoryEntry {
  return entryOf(REPAIR_CASE_TARGET, {
    decidedByUserId: VIEWER,
    decidedByName: "본인이름",
    delegatedFromUserId: OTHER,
    delegatedFromName: "자리주인이름",
  });
}

/** **내 자리를 남이** 눌렀다 — 상대는 누른 사람이다. */
function byDelegateEntry(): ApprovalHistoryEntry {
  return entryOf(REPAIR_CASE_TARGET, {
    decidedByUserId: OTHER,
    decidedByName: "대리인이름",
    delegatedFromUserId: VIEWER,
    delegatedFromName: "본인이름",
  });
}

function actor(overrides: Partial<PortalActor> = {}): PortalActor {
  return {
    id: VIEWER,
    role: "ADMIN",
    isDeveloper: false,
    approvalStatus: "APPROVED",
    isActive: true,
    lockedAt: null,
    ...overrides,
  };
}

const PERIOD: ApprovalHistoryPeriod = {
  from: new Date("2026-11-01T00:00:00.000Z"),
  to: new Date("2026-12-01T00:00:00.000Z"),
};

describe("내역 한 줄을 밖으로 내줄 모양으로", () => {
  test("🔵 표본 확인 — 조회가 주는 주소는 **상대 주소**다(아니면 아래 절대 주소 시험이 공짜로 통과한다)", () => {
    for (const target of [REPAIR_CASE_TARGET, QUOTE_TARGET, DOMESTIC_ORDER_TARGET]) {
      const href = entryOf(target).href;
      assert.ok(href.startsWith("/"), `상대 주소가 아니다: ${href}`);
    }
  });

  test("🔴 주소가 절대 주소가 된다 — 갈래마다 제 구역으로", () => {
    const expected: Array<[ApprovalOutcomeTarget, string]> = [
      [REPAIR_CASE_TARGET, `${BASE}/repair-cases/`],
      [QUOTE_TARGET, `${BASE}/quotes/`],
      // 🔴 기타건은 접수 건과 **같은 표**의 행이라 `/repair-cases/` 로 나가기 쉬운
      //    자리다. 그렇게 나가면 404 이고, 그 404 는 포털 화면에서만 보인다.
      [DOMESTIC_ORDER_TARGET, `${BASE}/domestic-orders/`],
    ];
    for (const [target, prefix] of expected) {
      const asEntry = entryOf(target);
      const out = toPortalApprovalHistoryEntry(asEntry, BASE);
      assert.equal(out.href, `${BASE}${asEntry.href}`);
      assert.ok(out.href.startsWith(prefix), `엉뚱한 구역으로 간다: ${out.href}`);
    }
  });

  test("🔴 계약의 여덟 칸만 나간다 — 결재 사유 · 사람 id 가 포털로 새지 않는다", () => {
    const out = toPortalApprovalHistoryEntry(onBehalfEntry(), BASE);
    assert.deepEqual(Object.keys(out).sort(), [
      "approvalName",
      "counterpartName",
      "decidedAt",
      "decision",
      "href",
      "id",
      "relation",
      "subject",
    ]);
    // 🔵 표본 확인 — 걸러 낼 것이 실제로 들어 있는 줄로 쟀는가.
    const asEntry = onBehalfEntry();
    assert.equal(asEntry.decisionReason, "결정하며 적은 말");
    assert.equal(asEntry.requestReason, "올리며 적은 말");
  });

  test("제목 · 결재 이름 · 결정 시각 · 결정은 조회가 준 값 그대로다", () => {
    const asEntry = entryOf(REPAIR_CASE_TARGET, { status: "REJECTED" });
    const out = toPortalApprovalHistoryEntry(asEntry, BASE);
    assert.equal(out.subject, "DSS-2026-0007");
    assert.equal(out.approvalName, asEntry.approvalName);
    assert.ok(out.approvalName.length > 0, "결재 이름이 비었다");
    assert.equal(out.decidedAt, "2026-11-10T02:00:00.000Z");
    assert.equal(out.decision, "REJECTED");
  });

  test("🔴 열쇠에 갈래 딱지가 붙는다 — 표가 둘이라 행 id 가 겹칠 수 있다", () => {
    const fromCase = toPortalApprovalHistoryEntry(entryOf(REPAIR_CASE_TARGET), BASE);
    const fromQuote = toPortalApprovalHistoryEntry(entryOf(QUOTE_TARGET), BASE);
    // 밑감의 행 id 가 같은데(위 상수) 열쇠는 갈려야 한다.
    assert.equal(REPAIR_CASE_TARGET.approvalId, QUOTE_TARGET.approvalId);
    assert.notEqual(fromCase.id, fromQuote.id);
    assert.equal(fromCase.id, `REPAIR_CASE:${APPROVAL_ROW_ID}`);
    assert.equal(fromQuote.id, `QUOTE:${APPROVAL_ROW_ID}`);
    // 🔵 결과 글자(승인/반려)가 열쇠에 섞이지 않는다 — 같은 행이면 결정이 무엇이든
    //    같은 열쇠다.
    const rejected = toPortalApprovalHistoryEntry(
      entryOf(REPAIR_CASE_TARGET, { status: "REJECTED" }),
      BASE
    );
    assert.equal(rejected.id, fromCase.id);
  });

  test("🔴 같은 건의 단계 둘은 **행이 둘**이라 열쇠가 갈린다 — 단계 번호를 붙일 일이 없다", () => {
    // 🔵 재고관리는 (신청, 단계)가 열쇠라 단계 번호를 붙였다(2026-11-17). 이 집은
    //    결재 **행 하나**가 열쇠이고, 한 접수 건의 검수와 출하는 서로 다른 행이다.
    const inspection = toPortalApprovalHistoryEntry(entryOf(REPAIR_CASE_TARGET), BASE);
    const shipment = toPortalApprovalHistoryEntry(
      entryOf({
        source: "REPAIR_CASE",
        approvalId: "88888888-8888-4888-8888-888888888888",
        repairCaseId: CASE_ID,
        intakeNumber: "DSS-2026-0007",
        approvalType: "FINAL_SHIPMENT",
      }),
      BASE
    );
    // 같은 건(제목이 같다)인데 열쇠도 결재 이름도 갈린다.
    assert.equal(inspection.subject, shipment.subject);
    assert.notEqual(inspection.id, shipment.id);
    assert.notEqual(inspection.approvalName, shipment.approvalName);
  });
});

describe("🔴 상대는 누구인가 — relation 마다 다른 칸에서 온다", () => {
  test("직접 결재한 줄에는 상대가 없다", () => {
    const asEntry = entryOf(REPAIR_CASE_TARGET);
    assert.equal(asEntry.relation, "SELF");
    assert.equal(toPortalApprovalHistoryEntry(asEntry, BASE).counterpartName, null);
  });

  test("🔴 내가 대신 누른 줄 — 상대는 **자리 주인**이지 누른 나가 아니다", () => {
    const asEntry = onBehalfEntry();
    assert.equal(asEntry.relation, "ON_BEHALF");
    const out = toPortalApprovalHistoryEntry(asEntry, BASE);
    assert.equal(out.counterpartName, "자리주인이름");
    // 뒤바꿔 적으면 「내가 나를 대신했다」가 된다 — 오류 없이 화면에서만 보인다.
    assert.notEqual(out.counterpartName, "본인이름");
  });

  test("🔴 내 자리를 남이 누른 줄 — 상대는 **누른 사람**이지 자리 주인이 아니다", () => {
    const asEntry = byDelegateEntry();
    assert.equal(asEntry.relation, "BY_DELEGATE");
    const out = toPortalApprovalHistoryEntry(asEntry, BASE);
    assert.equal(out.counterpartName, "대리인이름");
    assert.notEqual(out.counterpartName, "본인이름");
  });

  test("이름을 못 찾았으면 빈 글자가 아니라 null 이다", () => {
    // 조회는 사람을 LEFT JOIN 으로 들고 오고 못 찾으면 빈 글자를 넣는다.
    const missingDecider = entryOf(REPAIR_CASE_TARGET, {
      decidedByUserId: OTHER,
      decidedByName: "",
      delegatedFromUserId: VIEWER,
      delegatedFromName: "본인이름",
    });
    assert.equal(portalApprovalHistoryCounterpart(missingDecider), null);
    const missingOwner = entryOf(REPAIR_CASE_TARGET, {
      delegatedFromUserId: OTHER,
      delegatedFromName: null,
    });
    assert.equal(missingOwner.relation, "ON_BEHALF");
    assert.equal(portalApprovalHistoryCounterpart(missingOwner), null);
  });
});

describe("🔴 기간 읽기 — 못 읽으면 통로가 400 invalid_period 로 답한다", () => {
  function parse(query: string) {
    return parseApprovalHistoryPeriod(new URLSearchParams(query));
  }

  test("둘 다 있으면 읽고, **값을 손보지 않는다** — 하루를 더하지도 자정으로 내리지도 않는다", () => {
    const parsed = parse("from=2026-11-01T00:00:00.000Z&to=2026-11-30T15:00:00.000Z");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.period.from.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(parsed.period.to.toISOString(), "2026-11-30T15:00:00.000Z");
  });

  test("🔴 돌려주는 것은 기간뿐이다 — 쿼리에 사람을 적어 보내도 흘러들 자리가 없다", () => {
    const parsed = parse(
      `from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z&sub=${OTHER}&user=${OTHER}`
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(Object.keys(parsed.period).sort(), ["from", "to"]);
  });

  test("🔴 하나라도 없거나 비어 있으면 못 읽는다", () => {
    const full = "from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00.000Z";
    // 🔵 표본 확인 — 온전한 쿼리는 읽힌다. 아니면 아래 넷이 공짜로 통과한다.
    assert.equal(parse(full).ok, true);
    for (const query of [
      "",
      "to=2026-12-01T00:00:00.000Z",
      "from=2026-11-01T00:00:00.000Z",
      "from=&to=2026-12-01T00:00:00.000Z",
      "from=2026-11-01T00:00:00.000Z&to=   ",
    ]) {
      assert.equal(parse(query).ok, false, `읽히면 안 되는 쿼리가 읽혔다: "${query}"`);
    }
  });

  test("🔴 못 읽는 글자는 거절한다", () => {
    for (const query of [
      "from=어제&to=2026-12-01T00:00:00.000Z",
      "from=2026-11-01T00:00:00.000Z&to=오늘",
      "from=2026-13-45T00:00:00.000Z&to=2026-12-01T00:00:00.000Z",
    ]) {
      assert.equal(parse(query).ok, false, `읽히면 안 되는 쿼리가 읽혔다: "${query}"`);
    }
  });

  test("🔴 `0` · `2026` 처럼 Date 가 **읽어 버리는** 글자도 거절한다 — 모양 한 겹", () => {
    // 🔵 먼저 그 함정이 진짜인지 이 자리에서 재 둔다. `NaN` 검사만으로 걸렀다고
    //    믿으면, 아래 단언이 무엇을 막고 있는지 나중에 아무도 모른다.
    assert.equal(Number.isNaN(new Date("0").getTime()), false, "Date 의 동작이 달라졌다");
    assert.equal(new Date("0").toISOString(), "1999-12-31T15:00:00.000Z");
    assert.equal(Number.isNaN(new Date("2026").getTime()), false, "Date 의 동작이 달라졌다");

    // 거르지 않으면 `?from=0` 이 26년치 기간으로 조용히 열린다.
    for (const query of [
      "from=0&to=2026-12-01T00:00:00.000Z",
      "from=2026&to=2026-12-01T00:00:00.000Z",
      "from=2026-11-01T00:00:00.000Z&to=0",
      "from=2026-11&to=2026-12-01T00:00:00.000Z",
    ]) {
      assert.equal(parse(query).ok, false, `읽히면 안 되는 쿼리가 읽혔다: "${query}"`);
    }
  });

  test("🔴 **시간대가 없는 글자는 거절한다** — 이 한 줄이 아홉 시간 결함을 막는다", () => {
    // 🔵 함정을 먼저 재 둔다: `T` 가 붙었는데 시간대가 없는 꼴은 **그 기계의 지역
    //    시간**으로 읽힌다. 개발 PC(KST)와 NAS 컨테이너(UTC)가 아홉 시간 어긋나고,
    //    증상은 「월말 하루치가 안 보인다」뿐이다.
    const zoneless = new Date("2026-11-01T00:00:00");
    const utc = new Date("2026-11-01T00:00:00Z");
    assert.equal(Number.isNaN(zoneless.getTime()), false, "Date 의 동작이 달라졌다");
    // 같은 글자인데 `Z` 하나로 **그 기계의 시간대만큼** 어긋난다(KST 면 아홉 시간,
    // 컨테이너의 UTC 면 0). 그래서 개발 PC 에서만 맞는 답이 나올 수 있다.
    assert.equal(utc.getTime() - zoneless.getTime(), -zoneless.getTimezoneOffset() * 60_000);

    for (const query of [
      "from=2026-11-01T00:00:00&to=2026-12-01T00:00:00.000Z",
      "from=2026-11-01T00:00:00.000Z&to=2026-12-01T00:00:00",
      "from=2026-11-01T00:00&to=2026-12-01T00:00:00.000Z",
    ]) {
      assert.equal(parse(query).ok, false, `시간대 없는 글자가 읽혔다: "${query}"`);
    }
  });

  test("🔴 **날짜만 적힌 글자도 거절한다** — UTC 자정은 한국 시간 그날 오전 9시다", () => {
    // 「11월을 보여 달라」가 11월 1일 오전 9시부터가 되어 첫날 아홉 시간이 조용히
    // 빠진다. 시간대까지 적어 보내는 것은 부르는 쪽의 몫이다.
    assert.equal(new Date("2026-11-01").toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(parse("from=2026-11-01&to=2026-12-01").ok, false);
  });

  test("🔵 시간대가 적힌 꼴은 **모두** 통과한다 — 이 집만 더 좁히면 이 집 줄만 사라진다", () => {
    // 포털이 보내는 값은 `toISOString()` 이라 언제나 맨 위 꼴이다. 나머지도 같은
    // 계약의 ISO 8601 이므로 거절하지 않는다.
    for (const value of [
      "2026-11-17T00:00:00.000Z",
      "2026-11-17T00:00:00Z",
      "2026-11-17T00:00Z",
      "2026-11-17T09:00:00%2B09:00",
      "2026-11-17T09:00:00.123456789%2B09:00",
      "2026-11-16T19:00:00-05:00",
    ]) {
      assert.equal(
        parse(`from=${value}&to=2026-12-01T00:00:00.000Z`).ok,
        true,
        `시간대가 적힌 꼴을 거절한다: "${value}"`
      );
    }
  });

  test("🔴 `+09:00` 을 인코딩 없이 붙이면 못 읽는다 — `+` 가 공백으로 풀린다", () => {
    // 쿼리 문자열에서 `+` 는 공백이다. 여기서 공백을 `+` 로 되돌리는 짐작을 넣으면
    // 세 집 가운데 이 집만 다르게 답한다 — 그래서 거절하는 쪽이 맞다.
    const raw = new URLSearchParams("from=2026-11-01T00:00:00+09:00&to=2026-12-01T00:00:00Z");
    assert.equal(raw.get("from"), "2026-11-01T00:00:00 09:00", "쿼리 해석이 달라졌다");
    assert.equal(parseApprovalHistoryPeriod(raw).ok, false);

    // 제대로 적어 보내면 읽고, **시간대를 그대로** 옮긴다.
    const encoded = parse("from=2026-11-01T00:00:00%2B09:00&to=2026-12-01T00:00:00Z");
    assert.equal(encoded.ok, true);
    if (!encoded.ok) return;
    assert.equal(encoded.period.from.toISOString(), "2026-10-31T15:00:00.000Z");
  });

  test("🔵 거꾸로 된 기간은 **거절하지 않는다** — 계약이 400 으로 적은 것은 둘뿐이다", () => {
    const parsed = parse("from=2026-12-01T00:00:00.000Z&to=2026-11-01T00:00:00.000Z");
    assert.equal(parsed.ok, true);
  });
});

describe("이 사람의 내역을 모아 내주기", () => {
  type Call = { viewerUserId: string; period: ApprovalHistoryPeriod };

  function recorder(entries: ApprovalHistoryEntry[]) {
    const calls: Call[] = [];
    return {
      calls,
      listHistory: async (viewerUserId: string, period: ApprovalHistoryPeriod) => {
        calls.push({ viewerUserId, period });
        return entries;
      },
    };
  }

  test("🔴 조회에 가는 것은 **되짚은 A/S id** 다 — 토큰의 sub 가 아니다", async () => {
    const seen: string[] = [];
    const { calls, listHistory } = recorder([entryOf(REPAIR_CASE_TARGET)]);
    const history = await buildPortalApprovalHistory({
      subject: SUBJECT,
      baseUrl: BASE,
      period: PERIOD,
      findActor: async (subject) => {
        seen.push(subject);
        return actor();
      },
      listHistory,
    });
    assert.deepEqual(seen, [SUBJECT], "되짚는 데 쓴 값이 토큰의 sub 가 아니다");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].viewerUserId, VIEWER);
    assert.notEqual(calls[0].viewerUserId, SUBJECT);
    // 🔴 기간도 손대지 않고 그대로 넘긴다 — 여기서 한 밀리초라도 옮기면 반열린
    //    구간 `[from, to)` 이 조용히 깨진다.
    assert.equal(calls[0].period.from.toISOString(), PERIOD.from.toISOString());
    assert.equal(calls[0].period.to.toISOString(), PERIOD.to.toISOString());
    assert.equal(history.entries.length, 1);
  });

  test("🔴 A/S 에 계정이 없으면 **빈 목록**이다 — 오류가 아니고, 조회에 닿지도 않는다", async () => {
    const { calls, listHistory } = recorder([entryOf(REPAIR_CASE_TARGET)]);
    const history = await buildPortalApprovalHistory({
      subject: SUBJECT,
      baseUrl: BASE,
      period: PERIOD,
      findActor: async () => null,
      listHistory,
    });
    assert.deepEqual(history, { entries: [] });
    assert.equal(calls.length, 0, "계정도 못 찾았는데 조회를 불렀다");
  });

  test("🔴 지금 일할 수 없는 계정도 빈 목록이다 — 승인 전 · 비활성 · 잠김", async () => {
    const cases: Array<Partial<PortalActor>> = [
      { approvalStatus: "PENDING" },
      { isActive: false },
      { lockedAt: new Date("2026-11-01T00:00:00.000Z") },
    ];
    for (const overrides of cases) {
      const { calls, listHistory } = recorder([entryOf(REPAIR_CASE_TARGET)]);
      const history = await buildPortalApprovalHistory({
        subject: SUBJECT,
        baseUrl: BASE,
        period: PERIOD,
        findActor: async () => actor(overrides),
        listHistory,
      });
      assert.deepEqual(history.entries, [], `막혀야 할 계정이 통과했다: ${JSON.stringify(overrides)}`);
      assert.equal(calls.length, 0);
    }
  });

  test("🔴 조회가 준 차례를 다시 세우지 않는다", async () => {
    // 일부러 「새것 먼저」가 아닌 차례로 준다 — 여기서 다시 세우면 규칙이 두 벌이 된다.
    const older = entryOf(QUOTE_TARGET, { decidedAt: new Date("2026-11-02T00:00:00.000Z") });
    const newer = entryOf(DOMESTIC_ORDER_TARGET, {
      decidedAt: new Date("2026-11-20T00:00:00.000Z"),
    });
    const { listHistory } = recorder([older, newer]);
    const history = await buildPortalApprovalHistory({
      subject: SUBJECT,
      baseUrl: BASE,
      period: PERIOD,
      findActor: async () => actor(),
      listHistory,
    });
    assert.deepEqual(
      history.entries.map((entry) => entry.decidedAt),
      ["2026-11-02T00:00:00.000Z", "2026-11-20T00:00:00.000Z"]
    );
  });

  test("조회가 한 줄도 안 주면 빈 목록이다 — 줄을 지어내지 않는다", async () => {
    const { listHistory } = recorder([]);
    const history = await buildPortalApprovalHistory({
      subject: SUBJECT,
      baseUrl: BASE,
      period: PERIOD,
      findActor: async () => actor(),
      listHistory,
    });
    assert.deepEqual(history, { entries: [] });
  });
});
