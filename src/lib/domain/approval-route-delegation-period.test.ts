import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  delegationPeriodDateText,
  delegationPeriodFromDateOnly,
  deriveApprovalRouteDelegationDisplayStatus,
  isActiveRouteDelegation,
} from "./approval-route-delegation";
import { isKstMidnight, kstMidnightInstant } from "./date-only";
import { validateDelegationPeriod } from "@/lib/validation/approval-route-delegation-input";

/**
 * ============================================================================
 * 결재권 위임의 기간 — **날짜로 적고, 시각으로 앉는다** (2026-11-17)
 * ============================================================================
 * 사용자가 눈으로 확인하고 고쳐 달라고 한 것: 「결재권을 위임할 때 **시간까지** 적도록
 * 되어 있는데, **날짜까지만** 적도록 해라. **(끝나는 날 24:00 까지로)**」
 *
 * 표는 그대로다(`starts_at` · `ends_at` 은 여전히 timestamptz). 바뀐 것은 **화면이
 * 거기 무엇을 굽느냐**뿐이고, 이 파일이 그 굽기를 잰다.
 *
 * 여기서 지키는 것:
 *
 *   ㉠ 🔴 「11월 18일까지」가 **18일 하루를 온전히 포함한다** — 끝이 19일 00:00 이다.
 *   ㉡ 🔴 그 자정이 **한국시간 자정**이다(UTC 자정이 아니다). 틀리면 아홉 시간이
 *      어긋나는데, 그 어긋남은 하루 중 00:00~09:00 에만 드러난다.
 *   ㉢ **같은 날 둘을 고르면 그 하루**다.
 *   ㉣ 🔴 **옛 줄이 화면에서 거짓말하지 않는다** — 끝이 자정이 아닌 줄은 날짜만으로
 *      적으면 안 된다(「18일까지」인데 실제로는 그날 21:25 에 끊긴다).
 *   ㉤ 🔴 **접기가 여전히 살아있음·끝남을 바르게 가른다**(2026-11-17 의 앞 조각).
 *   ㉥ 🔴 구운 값이 **서버의 기간 검증을 그대로 통과한다** — 화면만 바꾸고 서버가
 *      거절하면 단추가 눌리지 않는다.
 *
 * ── 🔵 왜 날짜가 아니라 **절대 시각**으로 단언하는가 ────────────────────────
 * `assert.equal(instant.toISOString(), "2026-11-18T15:00:00.000Z")` 는 이 시험이 도는
 * 기계의 시간대와 무관하게 같은 값이다. `getHours()` 나 `toLocaleString` 으로 재면
 * 개발 PC(KST)에서만 통과하고 UTC 로 도는 기계에서는 깨진다 — 그 반대도 마찬가지로
 * 나쁘다(틀린 코드가 KST 기계에서 영영 초록으로 통과한다).
 * ============================================================================
 */

/** 한국시간 날짜·시각을 **절대 시각**으로 적는다. 시험 안의 기대값을 눈으로 읽기 위한 것뿐이다. */
const kst = (text: string) => new Date(`${text}+09:00`);

/**
 * 구운 기간을 **위임 한 줄**로 만든다. `isActiveRouteDelegation` 은 줄을 통째로 받고
 * (누가 누구에게 맡겼는지까지), 이 시험이 재는 것은 그 가운데 기간 둘뿐이다. 🔵 사람
 * 열쇠는 뜻 없는 가짜 값이다 — 이 집 시험에 실제 이름을 넣지 않는다.
 */
const asRow = (period: { startsAt: Date; endsAt: Date }, revokedAt: Date | null = null) => ({
  delegatorUserId: "delegator-id",
  delegateUserId: "delegate-id",
  revokedAt,
  ...period,
});

/* ------------------------------------------------------------------ */
/* 0. 재려는 것이 비어 있지 않다                                        */
/* ------------------------------------------------------------------ */

describe("0. 잣대가 실제로 맞다", () => {
  test("🔴 이 시험이 쓰는 `kst()` 가 한국시간을 가리킨다 — 틀리면 아래가 전부 엉뚱한 것을 잰다", () => {
    // 한국시간 2026-11-18 00:00 = UTC 2026-11-17 15:00. 이 한 줄이 틀리면 아래
    // 기대값이 모두 아홉 시간 밀린 채로 **서로 들어맞아** 조용히 통과한다.
    assert.equal(kst("2026-11-18T00:00:00").toISOString(), "2026-11-17T15:00:00.000Z");
    assert.equal(kstMidnightInstant("2026-11-18").getTime(), kst("2026-11-18T00:00:00").getTime());
  });

  test("🔴 「한국시간 자정인가」가 양쪽으로 문다", () => {
    assert.equal(isKstMidnight(kst("2026-11-18T00:00:00")), true);
    assert.equal(isKstMidnight(kst("2026-11-18T21:25:00")), false);
    // 🔴 UTC 자정은 한국시간 오전 9시다 — 참으로 읽으면 옛 줄이 날짜로 적히기 시작한다.
    assert.equal(isKstMidnight(new Date("2026-11-18T00:00:00.000Z")), false);
    // 1분·1초·1밀리초만 어긋나도 거짓이다. 「거의 자정」을 자정으로 읽으면 안 된다.
    assert.equal(isKstMidnight(kst("2026-11-18T00:01:00")), false);
    assert.equal(isKstMidnight(new Date(kst("2026-11-18T00:00:00").getTime() + 1)), false);
  });
});

/* ------------------------------------------------------------------ */
/* ㉠㉡ 굽기 — 끝나는 날 24:00, 한국시간                                 */
/* ------------------------------------------------------------------ */

describe("㉠ 「11월 18일까지」는 18일 하루를 온전히 포함한다", () => {
  test("🔴 끝은 **19일 00:00**(한국시간)이다 — 18일 00:00 이 아니다", () => {
    const period = delegationPeriodFromDateOnly("2026-11-17", "2026-11-18");
    assert.equal(period.startsAt.toISOString(), "2026-11-16T15:00:00.000Z"); // 11-17 00:00 KST
    assert.equal(period.endsAt.toISOString(), "2026-11-18T15:00:00.000Z"); // 11-19 00:00 KST
    // 🔴 끝을 종료일 당일 0시로 구우면 18일이 **한순간도** 안 들어간다.
    assert.notEqual(period.endsAt.getTime(), kst("2026-11-18T00:00:00").getTime());
  });

  test("🔴 18일의 처음·한가운데·끝이 **전부** 기간 안이다", () => {
    const period = asRow(delegationPeriodFromDateOnly("2026-11-17", "2026-11-18"));
    for (const at of [
      "2026-11-18T00:00:00",
      "2026-11-18T09:00:00",
      "2026-11-18T21:25:00",
      "2026-11-18T23:59:59",
    ]) {
      assert.equal(
        isActiveRouteDelegation(period, kst(at)),
        true,
        `${at} (KST) 가 기간 밖으로 떨어졌다 — 「18일까지」가 18일을 못 담는다`
      );
    }
  });

  test("🔴 19일 00:00 에 **딱** 끝난다 — 반열린 구간이라 그 순간은 이미 밖이다", () => {
    const period = asRow(delegationPeriodFromDateOnly("2026-11-17", "2026-11-18"));
    assert.equal(isActiveRouteDelegation(period, kst("2026-11-19T00:00:00")), false);
    // 그 1밀리초 전까지는 살아 있다. 끝이 포함되면 기간을 잇대어 적을 때 두 위임이
    // 동시에 유효한 순간이 생긴다(domain 쪽 머리말).
    assert.equal(
      isActiveRouteDelegation(period, new Date(kst("2026-11-19T00:00:00").getTime() - 1)),
      true
    );
  });
});

describe("㉡ UTC 자정이 아니라 한국시간 자정이다", () => {
  test("🔴 `new Date(\"2026-11-18\")` 로 구운 것과 **다른 값**이다", () => {
    const period = delegationPeriodFromDateOnly("2026-11-18", "2026-11-18");
    assert.notEqual(period.startsAt.getTime(), new Date("2026-11-18").getTime());
    // 차이는 정확히 아홉 시간이다 — UTC 자정은 한국시간으로 그날 오전 9시다.
    assert.equal(
      new Date("2026-11-18").getTime() - period.startsAt.getTime(),
      9 * 60 * 60 * 1000
    );
  });

  test("🔴 한국시간 00:00~09:00 에 열어도 **오늘**이다 — 그 아홉 시간이 UTC 로는 어제다", () => {
    // 2026-11-18 01:00 KST = 2026-11-17 16:00 UTC. UTC 로 날짜를 자르면 17일이 되고,
    // 그 값을 그대로 저장하면 기간이 하루 밀린다.
    const earlyMorningKst = new Date("2026-11-17T16:00:00.000Z");
    const period = delegationPeriodFromDateOnly("2026-11-18", "2026-11-18");
    assert.equal(
      isActiveRouteDelegation(asRow(period), earlyMorningKst),
      true,
      "한국시간 새벽에 「오늘 하루」로 맡긴 위임이 아직 시작하지 않은 것으로 읽힌다"
    );
  });
});

describe("㉢ 같은 날 둘을 고르면 그 하루다", () => {
  test("🔴 시작 18일 00:00, 끝 19일 00:00 — 꼭 24시간이다", () => {
    const period = delegationPeriodFromDateOnly("2026-11-18", "2026-11-18");
    assert.equal(period.startsAt.toISOString(), "2026-11-17T15:00:00.000Z");
    assert.equal(period.endsAt.toISOString(), "2026-11-18T15:00:00.000Z");
    assert.equal(period.endsAt.getTime() - period.startsAt.getTime(), 24 * 60 * 60 * 1000);
  });

  test("🔵 그 하루 안에서만 살아 있다 — 전날 밤과 다음 날 새벽은 밖이다", () => {
    const period = asRow(delegationPeriodFromDateOnly("2026-11-18", "2026-11-18"));
    assert.equal(isActiveRouteDelegation(period, kst("2026-11-17T23:59:59")), false);
    assert.equal(isActiveRouteDelegation(period, kst("2026-11-18T12:00:00")), true);
    assert.equal(isActiveRouteDelegation(period, kst("2026-11-19T00:00:01")), false);
  });
});

describe("㉢-2 달과 해를 넘긴다", () => {
  test("🔴 11월 30일까지 → 12월 1일 00:00, 12월 31일까지 → 이듬해 1월 1일 00:00", () => {
    // 하루 더하기를 날짜 글자에 대고 하면(「30」+1 = 「31」) 11월 31일이라는 날이
    // 생긴다. 달력에 묻는 함수(addCalendarDays)에 맡기는 까닭이다.
    assert.equal(
      delegationPeriodFromDateOnly("2026-11-01", "2026-11-30").endsAt.toISOString(),
      kst("2026-12-01T00:00:00").toISOString()
    );
    assert.equal(
      delegationPeriodFromDateOnly("2026-12-01", "2026-12-31").endsAt.toISOString(),
      kst("2027-01-01T00:00:00").toISOString()
    );
    // 윤년의 2월도 달력에 묻는다.
    assert.equal(
      delegationPeriodFromDateOnly("2028-02-01", "2028-02-29").endsAt.toISOString(),
      kst("2028-03-01T00:00:00").toISOString()
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉣ 보여 주기 — 옛 줄이 거짓말하지 않는다                              */
/* ------------------------------------------------------------------ */

describe("㉣ 기간을 날짜로 적을 수 있는 줄 / 없는 줄", () => {
  test("🔴 **굽기와 읽기가 한 쌍이다** — 고른 날짜가 그대로 돌아온다", () => {
    // 이 왕복이 이 조각에서 가장 중요한 단언이다. 굽는 쪽이 하루를 더하고 읽는 쪽이
    // 하루를 빼므로, 한쪽만 고쳐지면 화면 날짜가 **하루씩 어긋난 채** 오류 없이 돈다.
    for (const [start, end] of [
      ["2026-11-17", "2026-11-18"],
      ["2026-11-18", "2026-11-18"],
      ["2026-11-01", "2026-11-30"],
      ["2026-12-25", "2027-01-05"],
    ] as const) {
      assert.equal(
        delegationPeriodDateText(delegationPeriodFromDateOnly(start, end)),
        `${start} ~ ${end}`,
        `${start} ~ ${end}: 고른 날짜와 보이는 날짜가 어긋난다`
      );
    }
  });

  test("🔴 끝이 자정이 아닌 **옛 줄**은 날짜로 적지 않는다 — 적으면 거짓말이 된다", () => {
    // 지금 표에 있는 줄들의 모양이다: 끝이 21:25 라면 「11월 18일까지」가 아니라
    // 「11월 18일 21:25 까지」다. 날짜만 적으면 그날 저녁에 끊긴 줄을 보고 사람은
    // 「아직 오늘까지는 되겠지」라고 읽는다.
    assert.equal(
      delegationPeriodDateText({
        startsAt: kst("2026-11-17T10:30:00"),
        endsAt: kst("2026-11-18T21:25:00"),
      }),
      null
    );
    // 한쪽만 자정이어도 날짜로 적지 않는다 — 한 줄 안에서 날짜와 시각이 섞이면
    // 어느 쪽이 정확한 값인지 읽는 사람이 가릴 수 없다.
    assert.equal(
      delegationPeriodDateText({
        startsAt: kst("2026-11-17T00:00:00"),
        endsAt: kst("2026-11-18T21:25:00"),
      }),
      null
    );
    assert.equal(
      delegationPeriodDateText({
        startsAt: kst("2026-11-17T10:30:00"),
        endsAt: kst("2026-11-19T00:00:00"),
      }),
      null
    );
  });

  test("🔴 UTC 자정으로 저장된 줄도 날짜로 적지 않는다 — 한국시간으로는 오전 9시다", () => {
    assert.equal(
      delegationPeriodDateText({
        startsAt: new Date("2026-11-17T00:00:00.000Z"),
        endsAt: new Date("2026-11-19T00:00:00.000Z"),
      }),
      null,
      "UTC 자정을 한국시간 자정으로 읽었다 — 아홉 시간 어긋난 기간이 날짜로 적힌다"
    );
  });

  test("🔵 승인함에서 전파돼 온 줄도 같은 자로 잰다 — 이 갈래는 앞으로도 살아 있다", () => {
    // 통합 승인함(`portal_approval_delegations`)의 시각은 저쪽 화면이 정한다. 같은
    // 화면이 두 표를 함께 그리므로, 「자정이 아니면 시각까지」는 옛 줄만의 규칙이
    // 아니라 영영 남는 규칙이다.
    assert.equal(
      delegationPeriodDateText({
        startsAt: kst("2026-11-16T18:00:00"),
        endsAt: kst("2026-11-20T18:00:00"),
      }),
      null
    );
    // 저쪽이 마침 자정으로 맡겼다면 날짜로 적어도 거짓이 아니다.
    assert.equal(
      delegationPeriodDateText({
        startsAt: kst("2026-11-16T00:00:00"),
        endsAt: kst("2026-11-21T00:00:00"),
      }),
      "2026-11-16 ~ 2026-11-20"
    );
  });
});

/* ------------------------------------------------------------------ */
/* ㉤ 접기 — 살아있음·끝남을 그대로 가른다                               */
/* ------------------------------------------------------------------ */

describe("㉤ 끝난 위임 접기가 여전히 바르게 가른다", () => {
  const period = delegationPeriodFromDateOnly("2026-11-17", "2026-11-18");

  /**
   * 조회가 SQL 로 거르는 규칙을 그대로 옮긴 잣대(`revoked_at IS NOT NULL OR
   * ends_at <= now`). 🔵 「조회가 정말 이렇게 거르는가」는 옆 시험
   * (approval-route-delegation-finished-fold.test.ts)과 실제 DB 시험이 지킨다.
   * 여기서 재는 것은 **날짜로 구운 기간이 그 자에 걸리는 때**다.
   */
  const isFinishedByQueryRule = (now: Date) => period.endsAt.getTime() <= now.getTime();

  test("🔴 종료일 당일에는 **접히지 않는다** — 아직 살아 있는 위임이다", () => {
    for (const at of ["2026-11-18T00:00:00", "2026-11-18T23:59:59"]) {
      assert.equal(
        deriveApprovalRouteDelegationDisplayStatus(asRow(period), kst(at)),
        "ACTIVE",
        `${at} (KST): 종료일 당일인데 만료로 읽힌다`
      );
      assert.equal(isFinishedByQueryRule(kst(at)), false, `${at} (KST): 당일인데 접기 안으로 간다`);
    }
  });

  test("🔴 다음 날 00:00 부터 **접힌다** — 딱지도 「만료」다", () => {
    const at = kst("2026-11-19T00:00:00");
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(asRow(period), at),
      "EXPIRED"
    );
    assert.equal(isFinishedByQueryRule(at), true);
  });

  test("🔵 시작 전에는 「예정」이고 접히지 않는다 — 앞으로 쓸 위임이 사라지면 안 된다", () => {
    const at = kst("2026-11-16T12:00:00");
    assert.equal(
      deriveApprovalRouteDelegationDisplayStatus(asRow(period), at),
      "SCHEDULED"
    );
    assert.equal(isFinishedByQueryRule(at), false);
  });
});

/* ------------------------------------------------------------------ */
/* ㉥ 서버가 그대로 받는다                                               */
/* ------------------------------------------------------------------ */

describe("㉥ 구운 값이 서버의 기간 검증을 통과한다", () => {
  test("🔴 같은 날 하루짜리도 통과한다 — 끝이 시작보다 하루 뒤라서다", () => {
    const period = delegationPeriodFromDateOnly("2026-11-18", "2026-11-18");
    const checked = validateDelegationPeriod(
      period.startsAt.toISOString(),
      period.endsAt.toISOString()
    );
    assert.equal(checked.ok, true, "서버가 하루짜리 위임을 거절한다 — 단추가 눌리지 않는다");
    assert.ok(checked.ok && checked.startsAt.getTime() === period.startsAt.getTime());
    assert.ok(checked.ok && checked.endsAt.getTime() === period.endsAt.getTime());
  });

  test("🔴 거꾸로인 기간은 **서버가** 거절한다 — 화면이 한 벌 더 막지 않는다", () => {
    // 굽기는 거꾸로인 날짜도 그대로 굽는다(막는 자리가 둘이 되면 안 된다). 막히는
    // 곳이 서버 하나인지를 여기서 못 박는다.
    const period = delegationPeriodFromDateOnly("2026-11-20", "2026-11-18");
    assert.ok(period.endsAt.getTime() < period.startsAt.getTime(), "굽기가 제 손으로 막았다");
    const checked = validateDelegationPeriod(
      period.startsAt.toISOString(),
      period.endsAt.toISOString()
    );
    assert.equal(checked.ok, false);
  });
});
