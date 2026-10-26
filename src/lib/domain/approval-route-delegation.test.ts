import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  actingApproverUserIds,
  actingDelegateUserIdsFor,
  APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES,
  type ApprovalRouteDelegationPeriod,
  delegatorUserIdsFor,
  deriveApprovalRouteDelegationDisplayStatus,
  isActiveRouteDelegation,
} from "./approval-route-delegation";

/**
 * ============================================================================
 * 결재선 단계 위임 — 순수 규칙
 * ============================================================================
 * 여기서 못 박는 것 여섯. 전부 **틀려도 그 자리에서는 아무 오류가 안 나는** 것들이다.
 *
 *  1. **끝은 포함하지 않는다**(`[starts_at, ends_at)`). 부등호 하나를 `<=` 로 바꾸면
 *     잇대어 적은 두 위임이 한순간 둘 다 살아 있고, 그 순간에 들어온 결재는 나중에
 *     설명할 수 없다. 시험이 없으면 영영 안 드러난다 — 밀리초 하나짜리 틈이다.
 *  2. **되돌린 줄은 죽은 것이다.** 되돌리기는 기간을 줄여 적는 것이 아니라 칸 하나에
 *     시각을 적는 것이라, 기간만 보는 판정은 되돌린 뒤에도 계속 참을 준다.
 *  3. 🔴 **이어 붙지 않는다.** A→B · B→C 가 둘 다 살아 있어도 C 는 A 의 결재권을 얻지
 *     못한다. 이어 붙는 쪽이 「더 친절한」 동작처럼 보이기 때문에 다음 사람이 고칠
 *     위험이 실제로 있다 — 그러면 A 가 동의한 적 없는 사람이 A 의 이름으로 누른다.
 *  4. **본인은 언제나 들어 있다.** 맡긴 사람이 직접 눌러도 막히지 않아야 하고, 목록이
 *     빌 수 있으면 DB 쪽에서 `inArray(…, [])` 가 되어 아무도 아무것도 못 누르게 된다.
 *  5. **화면 낱말과 판정이 어긋나지 않는다.** 옛 출하 위임 쪽은 끝을 포함하므로
 *     (`nowMs > ends`) 그 함수를 베껴 오면 화면은 「활성」인데 판정은 거짓인 한 순간이
 *     생긴다. 경계 시각에서 둘을 맞대어 본다.
 *  6. 🔴 **방향 둘이 안 섞인다.** `delegatorUserIdsFor`(「내가 누구를 대신하나」)와
 *     `actingDelegateUserIdsFor`(「나를 누가 대신하나」)는 이름도 인자 모양도 닮았는데
 *     거르는 칸이 반대다. 바꿔 꽂아도 **오류 없이 빈 목록**이 돌아오고, 그 빈 목록은
 *     「대신할 사람이 없다」라는 정상적인 답과 구별되지 않는다 — 그래서 같은 줄을
 *     양쪽으로 물어 둘 다 맞는지 본다.
 *
 * 🔵 표본이 비어서 공짜로 통과하는 일이 없게, 거르는 시험은 **「거르기 전에는 있었다」**
 *    를 먼저 단언한다. 이어 붙기 시험은 **두 겹이 둘 다 살아 있음**을 먼저 확인한 뒤에
 *    「그래도 안 이어진다」를 본다 — 표본을 잘못 만들어 애초에 죽은 줄이었다면 그 시험은
 *    아무것도 지키지 못한다.
 * ============================================================================
 */

/** 형식만 맞으면 되는 가짜 `users.id` — 이 층은 uuid 인지 보지 않는다. */
function user(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const A = user(1);
const B = user(2);
const C = user(3);
const D = user(4);

const T = (iso: string) => new Date(iso);

/** 2026-03-10 00:00 ~ 2026-03-20 00:00 (끝은 포함하지 않는다). */
const START = "2026-03-10T00:00:00.000Z";
const END = "2026-03-20T00:00:00.000Z";

function delegation(
  overrides: Partial<ApprovalRouteDelegationPeriod> = {}
): ApprovalRouteDelegationPeriod {
  return {
    delegatorUserId: A,
    delegateUserId: B,
    startsAt: T(START),
    endsAt: T(END),
    revokedAt: null,
    ...overrides,
  };
}

// ── 1. 살아 있는가 ───────────────────────────────────────────────────────

describe("isActiveRouteDelegation", () => {
  test("기간 한가운데면 살아 있다", () => {
    assert.equal(isActiveRouteDelegation(delegation(), T("2026-03-15T12:00:00.000Z")), true);
  });

  test("기간 전이면 아직 아니다", () => {
    assert.equal(isActiveRouteDelegation(delegation(), T("2026-03-09T23:59:59.999Z")), false);
  });

  test("기간 뒤면 끝났다", () => {
    assert.equal(isActiveRouteDelegation(delegation(), T("2026-03-20T00:00:00.001Z")), false);
  });

  test("🔴 경계 — 시작하는 그 순간은 **포함한다**", () => {
    assert.equal(isActiveRouteDelegation(delegation(), T(START)), true);
  });

  test("🔴 경계 — 끝나는 그 순간은 **포함하지 않는다**(반열린 구간)", () => {
    // 이 한 줄이 이 파일에서 가장 쉽게 뒤집히는 단언이다. `<` 를 `<=` 로 바꾸면
    // 아래 「잇대어 적은 두 위임」이 한순간 둘 다 살아 있게 된다.
    assert.equal(isActiveRouteDelegation(delegation(), T(END)), false);
    // 바로 앞 밀리초까지는 살아 있다 — 경계가 **그 순간 하나**임을 못 박는다.
    assert.equal(isActiveRouteDelegation(delegation(), T("2026-03-19T23:59:59.999Z")), true);
  });

  test("🔴 잇대어 적은 두 위임은 어느 순간에도 함께 살아 있지 않다", () => {
    const first = delegation({ delegateUserId: B });
    // 앞 위임이 끝나는 바로 그 시각에 시작한다 — 사람이 실제로 적는 모양이다.
    const second = delegation({ delegateUserId: C, startsAt: T(END), endsAt: T("2026-03-30T00:00:00.000Z") });

    for (const at of [T("2026-03-19T23:59:59.999Z"), T(END), T("2026-03-20T00:00:00.001Z")]) {
      const alive = [first, second].filter((row) => isActiveRouteDelegation(row, at));
      assert.equal(alive.length, 1, `${at.toISOString()} 에 살아 있는 위임이 ${alive.length}개다`);
    }
  });

  test("🔴 되돌린 줄은 기간 한가운데여도 죽은 것이다", () => {
    const row = delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") });
    // 표본이 제대로 만들어졌는지부터 — 되돌림만 없었다면 살아 있어야 한다.
    assert.equal(
      isActiveRouteDelegation({ ...row, revokedAt: null }, T("2026-03-15T00:00:00.000Z")),
      true
    );
    assert.equal(isActiveRouteDelegation(row, T("2026-03-15T00:00:00.000Z")), false);
  });

  test("되돌린 시각이 지금보다 뒤여도 죽은 것이다 — 기간을 줄여 적는 것이 아니다", () => {
    // 되돌림 시각은 「언제 되돌렸나」를 적어 두는 칸이지 「언제까지 유효한가」가 아니다.
    const row = delegation({ revokedAt: T("2026-03-18T00:00:00.000Z") });
    assert.equal(isActiveRouteDelegation(row, T("2026-03-12T00:00:00.000Z")), false);
  });
});

// ── 2. 누구를 대신할 수 있나 ─────────────────────────────────────────────

describe("delegatorUserIdsFor", () => {
  const now = T("2026-03-15T00:00:00.000Z");

  test("나에게 걸린 살아 있는 위임의 결재권자를 준다", () => {
    assert.deepEqual(delegatorUserIdsFor([delegation()], B, now), [A]);
  });

  test("남에게 걸린 줄·죽은 줄이 섞여 있어도 걸러 낸다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }), // 살아 있고 내 것
      delegation({ delegatorUserId: C, delegateUserId: D }), // 남의 것
      delegation({ delegatorUserId: C, delegateUserId: B, revokedAt: T(START) }), // 되돌림
      delegation({
        delegatorUserId: D,
        delegateUserId: B,
        startsAt: T("2026-04-01T00:00:00.000Z"),
        endsAt: T("2026-04-10T00:00:00.000Z"),
      }), // 아직 시작 안 함
    ];
    // 🔵 표본이 비어서 공짜로 통과하지 않게 — 거르기 전에는 넷이 있었다.
    assert.equal(rows.length, 4);
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [A]);
  });

  test("둘 이상에게서 위임받을 수 있다 — 차례는 목록에 처음 나온 순서", () => {
    const rows = [
      delegation({ delegatorUserId: C, delegateUserId: B }),
      delegation({ delegatorUserId: A, delegateUserId: B }),
    ];
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [C, A]);
  });

  test("🔴 겹치는 위임이 여럿이어도 결재권자는 한 번만 — 표가 겹침을 막지 않는다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({
        delegatorUserId: A,
        delegateUserId: B,
        startsAt: T("2026-03-14T00:00:00.000Z"),
        endsAt: T("2026-03-25T00:00:00.000Z"),
      }),
    ];
    // 표본 확인 — 둘 다 **지금 살아 있어야** 중복 거르기를 실제로 재는 셈이 된다.
    assert.deepEqual(
      rows.map((row) => isActiveRouteDelegation(row, now)),
      [true, true]
    );
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [A]);
  });

  test("위임이 하나도 없으면 빈 목록", () => {
    assert.deepEqual(delegatorUserIdsFor([], B, now), []);
  });

  test("🔴 이어 붙지 않는다 — A→B · B→C 라도 C 는 A 를 못 얻는다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({ delegatorUserId: B, delegateUserId: C }),
    ];
    // 🔵 두 겹이 **둘 다 살아 있는** 표본인지 먼저 못 박는다. 하나라도 죽어 있으면
    // 「안 이어진다」는 공짜로 통과하고 아무것도 지키지 못한다.
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [A]);
    assert.deepEqual(delegatorUserIdsFor(rows, C, now), [B]);
    // 여기가 본론 — C 가 얻는 것에 A 는 없다.
    assert.equal(delegatorUserIdsFor(rows, C, now).includes(A), false);
  });

  test("🔴 고리가 있어도 멈춘다 — A→B · B→A", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({ delegatorUserId: B, delegateUserId: A }),
    ];
    assert.deepEqual(delegatorUserIdsFor(rows, A, now), [B]);
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [A]);
  });
});

// ── 2-b. 나를 누가 대신할 수 있나 (방향이 반대) ──────────────────────────

/**
 * 🔴 **위 `delegatorUserIdsFor` 와 한 글자도 안 겹치는 방향이다.** 여기서 재는 것은
 * 「이 결재권자를 지금 누가 대신하나」이고, 쓰는 자리는 **결재 생성 알림**이다
 * (server/integration/approval-created-notice.ts). 두 함수를 섞어 쓰면 오류 없이 빈
 * 목록이 돌아오므로, 아래 「방향이 반대다」 시험이 그 바꿔치기를 잡는다.
 */
describe("actingDelegateUserIdsFor", () => {
  const now = T("2026-03-15T00:00:00.000Z");

  test("나에게 걸린 살아 있는 위임의 **대리인**을 준다", () => {
    assert.deepEqual(actingDelegateUserIdsFor([delegation()], A, now), [B]);
  });

  test("🔴 방향이 반대다 — 같은 줄을 반대로 물으면 빈 목록이다", () => {
    const rows = [delegation({ delegatorUserId: A, delegateUserId: B })];
    // 먼저 표본이 살아 있는지 — 안 그러면 아래 둘이 공짜로 통과한다.
    assert.equal(isActiveRouteDelegation(rows[0], now), true);
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [B]);
    // 🔴 이 한 줄이 두 함수를 바꿔 꽂은 날 울린다. 바꿔 꽂아도 오류는 안 난다.
    assert.deepEqual(actingDelegateUserIdsFor(rows, B, now), []);
    assert.deepEqual(delegatorUserIdsFor(rows, B, now), [A]);
    assert.deepEqual(delegatorUserIdsFor(rows, A, now), []);
  });

  test("남에게 걸린 줄·죽은 줄이 섞여 있어도 걸러 낸다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }), // 살아 있고 내 것
      delegation({ delegatorUserId: C, delegateUserId: D }), // 남의 것
      delegation({ delegatorUserId: A, delegateUserId: C, revokedAt: T(START) }), // 되돌림
      delegation({
        delegatorUserId: A,
        delegateUserId: D,
        startsAt: T("2026-04-01T00:00:00.000Z"),
        endsAt: T("2026-04-10T00:00:00.000Z"),
      }), // 아직 시작 안 함
      delegation({
        delegatorUserId: A,
        delegateUserId: D,
        startsAt: T("2026-02-01T00:00:00.000Z"),
        endsAt: T("2026-02-10T00:00:00.000Z"),
      }), // 이미 끝남
    ];
    // 🔵 표본이 비어서 공짜로 통과하지 않게 — 거르기 전에는 다섯이 있었고, 그중
    //    **넷이 A 의 줄**이다. 하나만 살아남는 것이 본론이다.
    assert.equal(rows.length, 5);
    assert.equal(rows.filter((row) => row.delegatorUserId === A).length, 4);
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [B]);
  });

  test("🔴 되돌린 위임의 대리인은 빠진다 — 되돌림만 없었다면 들어왔을 줄이다", () => {
    const row = delegation({ delegatorUserId: A, delegateUserId: B, revokedAt: T(START) });
    assert.deepEqual(actingDelegateUserIdsFor([{ ...row, revokedAt: null }], A, now), [B]);
    assert.deepEqual(actingDelegateUserIdsFor([row], A, now), []);
  });

  test("🔴 경계 — 끝나는 그 순간에는 이미 빠져 있다(반열린 구간)", () => {
    const rows = [delegation({ delegatorUserId: A, delegateUserId: B })];
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, T("2026-03-19T23:59:59.999Z")), [B]);
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, T(END)), []);
    // 시작하는 순간은 포함한다 — 경계가 **끝 한쪽**임을 못 박는다.
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, T(START)), [B]);
  });

  test("한 사람이 둘에게 맡길 수 있다 — 차례는 목록에 처음 나온 순서", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: C }),
      delegation({ delegatorUserId: A, delegateUserId: B }),
    ];
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [C, B]);
  });

  test("🔴 겹치는 위임이 여럿이어도 대리인은 한 번만 — 표가 겹침을 막지 않는다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({
        delegatorUserId: A,
        delegateUserId: B,
        startsAt: T("2026-03-14T00:00:00.000Z"),
        endsAt: T("2026-03-25T00:00:00.000Z"),
      }),
    ];
    // 표본 확인 — 둘 다 **지금 살아 있어야** 중복 거르기를 실제로 재는 셈이 된다.
    assert.deepEqual(
      rows.map((row) => isActiveRouteDelegation(row, now)),
      [true, true]
    );
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [B]);
  });

  test("위임이 하나도 없으면 빈 목록 — 그것이 정상이다", () => {
    assert.deepEqual(actingDelegateUserIdsFor([], A, now), []);
  });

  test("🔴 이어 붙지 않는다 — A→B · B→C 라도 A 를 대신하는 사람에 C 는 없다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({ delegatorUserId: B, delegateUserId: C }),
    ];
    // 🔵 두 겹이 **둘 다 살아 있는** 표본인지 먼저 못 박는다. 하나라도 죽어 있으면
    //    「안 이어진다」는 공짜로 통과하고 아무것도 지키지 못한다.
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [B]);
    assert.deepEqual(actingDelegateUserIdsFor(rows, B, now), [C]);
    // 여기가 본론 — A 를 대신하는 사람에 C 는 없다. 알림으로 이어 붙이면 C 는
    // 누를 수도 없는 결재의 차례를 먼저 알게 된다.
    assert.equal(actingDelegateUserIdsFor(rows, A, now).includes(C), false);
  });

  test("🔴 고리가 있어도 멈춘다 — A→B · B→A", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({ delegatorUserId: B, delegateUserId: A }),
    ];
    assert.deepEqual(actingDelegateUserIdsFor(rows, A, now), [B]);
    assert.deepEqual(actingDelegateUserIdsFor(rows, B, now), [A]);
  });

  test("🔴 결재권자 본인은 들어 있지 않다 — `actingApproverUserIds` 와 일부러 다르다", () => {
    const rows = [delegation({ delegatorUserId: A, delegateUserId: B })];
    assert.equal(actingDelegateUserIdsFor(rows, A, now).includes(A), false);
    // 본인을 맨 앞에 끼우는 쪽은 저쪽이다 — 둘을 맞대어 그 차이를 못 박는다.
    assert.equal(actingApproverUserIds(rows, A, now)[0], A);
  });
});

// ── 3. 자기 몫까지 포함해 누를 수 있는 자리 ──────────────────────────────

describe("actingApproverUserIds", () => {
  const now = T("2026-03-15T00:00:00.000Z");

  test("🔴 본인은 언제나 맨 앞에 있다 — 위임이 하나도 없어도 빈 목록이 아니다", () => {
    assert.deepEqual(actingApproverUserIds([], B, now), [B]);
  });

  test("본인 + 지금 대신할 수 있는 결재권자들", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({ delegatorUserId: C, delegateUserId: B }),
    ];
    assert.deepEqual(actingApproverUserIds(rows, B, now), [B, A, C]);
  });

  test("🔴 맡긴 사람 본인은 그대로 누를 수 있다 — 위임은 넘기는 것이 아니라 늘리는 것", () => {
    const rows = [delegation({ delegatorUserId: A, delegateUserId: B })];
    assert.deepEqual(actingApproverUserIds(rows, A, now), [A]);
  });

  test("죽은 위임은 아무것도 늘리지 않는다", () => {
    const rows = [delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") })];
    assert.deepEqual(actingApproverUserIds(rows, B, now), [B]);
  });

  test("겹치는 위임이 여럿이어도 같은 결재권자가 두 번 들어가지 않는다", () => {
    const rows = [
      delegation({ delegatorUserId: A, delegateUserId: B }),
      delegation({
        delegatorUserId: A,
        delegateUserId: B,
        startsAt: T("2026-03-14T00:00:00.000Z"),
        endsAt: T("2026-03-25T00:00:00.000Z"),
      }),
    ];
    assert.deepEqual(actingApproverUserIds(rows, B, now), [B, A]);
  });
});

// ── 4. 화면에 보여 줄 상태 ───────────────────────────────────────────────

describe("deriveApprovalRouteDelegationDisplayStatus", () => {
  test("네 갈래 — 활성 · 예정 · 만료 · 철회됨", () => {
    const row = delegation();
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(row, T("2026-03-15T00:00:00.000Z")),
      "ACTIVE"
    );
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(row, T("2026-03-01T00:00:00.000Z")),
      "SCHEDULED"
    );
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(row, T("2026-03-21T00:00:00.000Z")),
      "EXPIRED"
    );
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(
        delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") }),
        T("2026-03-15T00:00:00.000Z")
      ),
      "REVOKED"
    );
  });

  test("철회가 기간보다 세다 — 기간 전·뒤에도 철회됨으로 보인다", () => {
    const row = delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") });
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(row, T("2026-03-01T00:00:00.000Z")),
      "REVOKED"
    );
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(row, T("2026-03-25T00:00:00.000Z")),
      "REVOKED"
    );
  });

  test("🔴 경계 — 끝나는 그 순간은 이미 **만료**다(옛 출하 위임 쪽은 아직 활성이다)", () => {
    assert.equal(deriveApprovalRouteDelegationDisplayStatus(delegation(), T(END)), "EXPIRED");
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(delegation(), T("2026-03-19T23:59:59.999Z")),
      "ACTIVE"
    );
    // 시작하는 순간은 예정이 아니라 활성이다.
    assert.equal(deriveApprovalRouteDelegationDisplayStatus(delegation(), T(START)), "ACTIVE");
  });

  test("🔴 화면 상태와 판정이 어긋나지 않는다 — 경계를 포함해 ACTIVE ⟺ 살아 있다", () => {
    const rows = [delegation(), delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") })];
    const moments = [
      "2026-03-09T23:59:59.999Z",
      START,
      "2026-03-15T00:00:00.000Z",
      "2026-03-19T23:59:59.999Z",
      END,
      "2026-03-20T00:00:00.001Z",
    ].map(T);

    // 🔵 이 시험이 실제로 무엇을 재는지 먼저 — 두 함수가 **둘 다 참인 순간**과
    //    **둘 다 거짓인 순간**을 모두 지나가야 짝 맞추기를 재는 셈이 된다.
    const aliveCount = moments.filter((at) => isActiveRouteDelegation(rows[0], at)).length;
    assert.ok(aliveCount > 0 && aliveCount < moments.length, "표본이 한쪽으로 쏠려 있다");

    for (const row of rows) {
      for (const at of moments) {
        assert.equal(
          deriveApprovalRouteDelegationDisplayStatus(row, at) === "ACTIVE",
          isActiveRouteDelegation(row, at),
          `${at.toISOString()} 에서 화면 상태와 판정이 어긋난다`
        );
      }
    }
  });

  test("낱말은 넷뿐이고, 넷 모두 실제로 나온다", () => {
    assert.deepEqual(APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES, [
      "ACTIVE",
      "SCHEDULED",
      "EXPIRED",
      "REVOKED",
    ]);

    const produced = new Set([
      deriveApprovalRouteDelegationDisplayStatus(delegation(), T("2026-03-15T00:00:00.000Z")),
      deriveApprovalRouteDelegationDisplayStatus(delegation(), T("2026-03-01T00:00:00.000Z")),
      deriveApprovalRouteDelegationDisplayStatus(delegation(), T("2026-03-25T00:00:00.000Z")),
      deriveApprovalRouteDelegationDisplayStatus(
        delegation({ revokedAt: T("2026-03-12T00:00:00.000Z") }),
        T("2026-03-15T00:00:00.000Z")
      ),
    ]);
    assert.deepEqual(
      [...produced].sort(),
      [...APPROVAL_ROUTE_DELEGATION_DISPLAY_STATUSES].sort()
    );
  });
});
