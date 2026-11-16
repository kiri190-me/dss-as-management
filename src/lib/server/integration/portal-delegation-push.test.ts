import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyPortalDelegationPush,
  decidePortalDelegationTargets,
  parsePortalDelegationPush,
  type PortalDelegationOutcome,
  type PortalDelegationPushDeps,
  type PortalDelegationUpsertCommand,
} from "./portal-delegation-push";

/**
 * ============================================================================
 * 포털이 써 주는 결재권 위임 — **받는 쪽의 판단**을 실제로 돌려 본다
 * ============================================================================
 * 라우트는 DB 를 끌어와 단위 시험이 불러올 수 없으므로, 판단을 전부 모듈로 빼고
 * 여기서 돌린다(그 까닭은 모듈 머리말에). 라우트가 **그 모듈을 쓰는지**는
 * app/api/integration/route-source.test.ts 가 소스로 센다.
 *
 * 🔴 여기서 못 박는 것:
 *  1. **모양이 틀리면 400** — uuid 아닌 번호 · 거꾸로 된 기간 · 모르는 action.
 *  2. 🔴 **열쇠를 못 바꾸면 `not_applicable` 이고 오류가 아니다.** 이것이 뒤집히면
 *     「A/S 계정이 없는 사람에게는 위임을 아예 못 맡기는」 일이 된다(설계 B-13).
 *  3. 🔴 **같은 `id` 로 두 번 와도 저장은 같은 번호 한 줄이다**(멱등의 윗단 —
 *     DB 가 실제로 한 줄로 모으는지는 mutations 쪽 통합 시험이 잰다).
 *  4. 🔴 **없는 줄을 거두는 것도 오류가 아니다**(`not_applicable`).
 *  5. 🔴 **철회는 `id` 로만 한다** — 사람 번호를 다시 맞춰 보지 않는다.
 *
 * 🔵 표본이 비어서 공짜로 통과하지 않게, 가짜 저장 함수가 **몇 번 어떤 값으로**
 * 불렸는지를 모아 두고 그것까지 단언한다.
 * ============================================================================
 */

const 포털번호_위임자 = "11111111-1111-4111-8111-111111111111";
const 포털번호_대리인 = "22222222-2222-4222-8222-222222222222";
const 위임번호 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const AS_위임자 = "33333333-3333-4333-8333-333333333333";
const AS_대리인 = "44444444-4444-4444-8444-444444444444";

function 몸통(덮어쓰기: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "upsert",
    id: 위임번호,
    delegatorSub: 포털번호_위임자,
    delegateSub: 포털번호_대리인,
    startsAt: "2026-11-16T00:00:00.000Z",
    endsAt: "2026-11-20T00:00:00.000Z",
    reason: "출장",
    ...덮어쓰기,
  };
}

/** 가짜 저장소. 🔴 `id` 를 열쇠로 모아 두므로 **멱등이 깨지면 여기서 드러난다.** */
function 가짜저장소(options: { 있는줄?: string[] } = {}) {
  const 줄 = new Map<string, Record<string, unknown>>();
  for (const id of options.있는줄 ?? []) 줄.set(id, { id });
  const 부른값: { 종류: string; id: string }[] = [];

  const deps: PortalDelegationPushDeps = {
    lookupUserIdsBySubjects: async (subjects) => {
      const 명부: Record<string, string> = {
        [포털번호_위임자]: AS_위임자,
        [포털번호_대리인]: AS_대리인,
      };
      return subjects.flatMap((sub) =>
        명부[sub] ? [{ id: 명부[sub], ssoSubject: sub }] : []
      );
    },
    storeDelegation: async (row) => {
      부른값.push({ 종류: "store", id: row.id });
      줄.set(row.id, { ...row });
      return "stored" as PortalDelegationOutcome;
    },
    revokeDelegation: async ({ id, revokedAt }) => {
      부른값.push({ 종류: "revoke", id });
      const 앞 = 줄.get(id);
      if (!앞) return "not_applicable";
      줄.set(id, { ...앞, revokedAt });
      return "stored";
    },
  };

  return { deps, 줄, 부른값 };
}

/** 가짜 저장소 가운데 **열쇠를 하나도 못 바꾸는** 판. */
function 계정없는저장소() {
  const 기본 = 가짜저장소();
  return {
    ...기본,
    deps: { ...기본.deps, lookupUserIdsBySubjects: async () => [] },
  };
}

function 읽어야한다(body: unknown): PortalDelegationUpsertCommand {
  const parsed = parsePortalDelegationPush(body);
  assert.equal(parsed.ok, true, `읽히지 않았다: ${parsed.ok ? "" : parsed.message}`);
  if (!parsed.ok) throw new Error("unreachable");
  assert.equal(parsed.command.action, "upsert");
  if (parsed.command.action !== "upsert") throw new Error("unreachable");
  return parsed.command;
}

describe("parsePortalDelegationPush — 모양 검사", () => {
  test("제대로 된 upsert 를 읽는다 — 시각은 Date 로, 사유는 그대로", () => {
    const command = 읽어야한다(몸통());
    assert.equal(command.id, 위임번호);
    assert.equal(command.delegatorSub, 포털번호_위임자);
    assert.equal(command.delegateSub, 포털번호_대리인);
    assert.equal(command.startsAt.toISOString(), "2026-11-16T00:00:00.000Z");
    assert.equal(command.endsAt.toISOString(), "2026-11-20T00:00:00.000Z");
    assert.equal(command.reason, "출장");
  });

  test("제대로 된 revoke 를 읽는다 — id 와 revokedAt 만 쓴다", () => {
    const parsed = parsePortalDelegationPush({
      action: "revoke",
      id: 위임번호,
      // 🔴 사람 번호가 함께 와도 읽지 않는다. 철회는 번호로만 한다.
      delegatorSub: 포털번호_위임자,
      delegateSub: 포털번호_대리인,
      revokedAt: "2026-11-18T09:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.command.action, "revoke");
    if (parsed.command.action !== "revoke") return;
    assert.equal(parsed.command.id, 위임번호);
    assert.equal(parsed.command.revokedAt.toISOString(), "2026-11-18T09:00:00.000Z");
    // 사람 번호가 명령에 섞여 들어오지 않았는가 — 들어오면 철회가 사람으로도
    // 걸러지게 되고, 그 사이 번호가 바뀐 줄은 영영 못 거둔다.
    assert.ok(!("delegatorSub" in parsed.command));
  });

  test("사유가 없으면 빈 글자다 — 널로 두지 않는다(표의 칸이 NOT NULL)", () => {
    assert.equal(읽어야한다(몸통({ reason: undefined })).reason, "");
    assert.equal(읽어야한다(몸통({ reason: null })).reason, "");
    assert.equal(읽어야한다(몸통({ reason: "" })).reason, "");
  });

  test("🔴 모양이 틀리면 거절한다 — 400 이 될 자리들", () => {
    const 틀린것: [string, unknown][] = [
      ["본문이 객체가 아니다", "upsert"],
      ["본문이 배열이다", [몸통()]],
      ["본문이 널이다", null],
      ["action 이 없다", 몸통({ action: undefined })],
      ["모르는 action", 몸통({ action: "delete" })],
      ["id 가 없다", 몸통({ id: undefined })],
      ["id 가 uuid 가 아니다", 몸통({ id: "not-a-uuid" })],
      ["위임자 번호가 없다", 몸통({ delegatorSub: "" })],
      ["대리인 번호가 없다", 몸통({ delegateSub: undefined })],
      ["위임자와 대리인이 같다", 몸통({ delegateSub: 포털번호_위임자 })],
      ["startsAt 이 시각이 아니다", 몸통({ startsAt: "어제" })],
      ["startsAt 이 숫자다", 몸통({ startsAt: 1794531794552 })],
      ["endsAt 이 없다", 몸통({ endsAt: undefined })],
      ["기간이 거꾸로다", 몸통({ endsAt: "2026-11-15T00:00:00.000Z" })],
      ["기간이 한순간도 없다", 몸통({ endsAt: "2026-11-16T00:00:00.000Z" })],
      ["사유가 글이 아니다", 몸통({ reason: 7 })],
      ["revoke 에 시각이 없다", { action: "revoke", id: 위임번호 }],
      ["revoke 의 시각이 시각이 아니다", { action: "revoke", id: 위임번호, revokedAt: "곧" }],
      ["revoke 의 id 가 uuid 가 아니다", { action: "revoke", id: "x", revokedAt: "2026-11-18T09:00:00.000Z" }],
      // 🔴 시간대가 없는 글자 — 서버의 지역 시각으로 읽혀 **아홉 시간 어긋나는데**
      //    오류가 한 번도 안 난다(KST 개발 PC ↔ UTC 컨테이너).
      ["시작 시각에 시간대가 없다", 몸통({ startsAt: "2026-11-16T00:00:00" })],
      ["끝 시각에 시간대가 없다", 몸통({ endsAt: "2026-11-20T00:00:00.000" })],
      ["날짜만 보냈다", 몸통({ startsAt: "2026-11-16" })],
      ["revoke 의 시각에 시간대가 없다", { action: "revoke", id: 위임번호, revokedAt: "2026-11-18T09:00:00" }],
      // 🔴 넘어가는 날짜 — `new Date("2026-02-30…")` 은 던지지 않고 3월 2일이 된다.
      ["없는 날짜(2월 30일)", 몸통({ startsAt: "2026-02-30T00:00:00.000Z" })],
      ["없는 달(13월)", 몸통({ startsAt: "2026-13-01T00:00:00.000Z" })],
      ["평년의 2월 29일", 몸통({ startsAt: "2026-02-29T00:00:00.000Z" })],
      ["없는 시각(25시)", 몸통({ startsAt: "2026-11-16T25:00:00.000Z" })],
      ["upsert 의 revokedAt 에 시간대가 없다", 몸통({ revokedAt: "2026-11-18T09:00:00" })],
    ];
    for (const [이름, body] of 틀린것) {
      const parsed = parsePortalDelegationPush(body);
      assert.equal(parsed.ok, false, `🔴 거절했어야 한다: ${이름}`);
      if (!parsed.ok) assert.ok(parsed.message.length > 0, `${이름}: 까닭이 비었다`);
    }
  });

  test("🔴 upsert 의 revokedAt — **없음과 널은 같다**(살아 있는 줄)", () => {
    // 🔴 널을 거절하면 멀쩡한 지정이 전부 막힌다 — 포털이 객체를 통째로 보내면
    //    이 칸이 늘 실린다.
    assert.equal(읽어야한다(몸통({ revokedAt: undefined })).revokedAt, null);
    assert.equal(읽어야한다(몸통({ revokedAt: null })).revokedAt, null);
    assert.equal(읽어야한다(몸통({ revokedAt: "" })).revokedAt, null);
  });

  test("🔴 upsert 에 revokedAt 값이 실려 오면 **그대로 읽는다** — 버리지 않는다", () => {
    // 버리면 「포털은 거뒀다고 믿는데 여기서는 살아 있는」 줄이 남는다(설계 B-13).
    const command = 읽어야한다(몸통({ revokedAt: "2026-11-18T09:00:00.000Z" }));
    assert.equal(command.revokedAt?.toISOString(), "2026-11-18T09:00:00.000Z");
  });

  test("시간대 표기는 Z 와 ±HH:MM 둘 다 받는다 — 같은 순간으로 읽힌다", () => {
    const utc = 읽어야한다(몸통({ startsAt: "2026-11-16T09:00:00.000Z" }));
    const kst = 읽어야한다(몸통({ startsAt: "2026-11-16T18:00:00.000+09:00" }));
    assert.equal(utc.startsAt.getTime(), kst.startsAt.getTime());
  });
});

describe("decidePortalDelegationTargets — 열쇠 변환", () => {
  test("둘 다 바뀌면 A/S 번호 둘이 나온다", () => {
    const command = 읽어야한다(몸통());
    const targets = decidePortalDelegationTargets(
      [
        { id: AS_위임자, ssoSubject: 포털번호_위임자 },
        { id: AS_대리인, ssoSubject: 포털번호_대리인 },
      ],
      command
    );
    assert.deepEqual(targets, {
      applicable: true,
      delegatorUserId: AS_위임자,
      delegateUserId: AS_대리인,
    });
  });

  test("🔴 하나만 바뀌어도 해당 없음이다 — 반쪽짜리 줄을 만들지 않는다", () => {
    const command = 읽어야한다(몸통());
    for (const rows of [
      [{ id: AS_위임자, ssoSubject: 포털번호_위임자 }],
      [{ id: AS_대리인, ssoSubject: 포털번호_대리인 }],
      [],
    ]) {
      assert.deepEqual(decidePortalDelegationTargets(rows, command), { applicable: false });
    }
  });

  test("🔴 둘이 한 계정으로 모이면 해당 없음이다 — 표의 CHECK 가 500 으로 나가지 않게", () => {
    const command = 읽어야한다(몸통());
    const targets = decidePortalDelegationTargets(
      [
        { id: AS_위임자, ssoSubject: 포털번호_위임자 },
        { id: AS_위임자, ssoSubject: 포털번호_대리인 },
      ],
      command
    );
    assert.deepEqual(targets, { applicable: false });
  });
});

describe("applyPortalDelegationPush — 받아 적기", () => {
  test("upsert 한 번 → 저장한다", async () => {
    const { deps, 줄, 부른값 } = 가짜저장소();
    const outcome = await applyPortalDelegationPush(읽어야한다(몸통()), deps);
    assert.equal(outcome, "stored");
    assert.equal(줄.size, 1);
    assert.deepEqual(부른값, [{ 종류: "store", id: 위임번호 }]);
    assert.deepEqual(줄.get(위임번호), {
      id: 위임번호,
      delegatorUserId: AS_위임자,
      delegateUserId: AS_대리인,
      startsAt: new Date("2026-11-16T00:00:00.000Z"),
      endsAt: new Date("2026-11-20T00:00:00.000Z"),
      reason: "출장",
      revokedAt: null,
    });
  });

  test("🔴 upsert 에 실려 온 철회 시각이 **저장까지 간다** — 중간에서 흘리지 않는다", async () => {
    const { deps, 줄 } = 가짜저장소();
    await applyPortalDelegationPush(
      읽어야한다(몸통({ revokedAt: "2026-11-18T09:00:00.000Z" })),
      deps
    );
    assert.deepEqual(
      줄.get(위임번호)?.revokedAt,
      new Date("2026-11-18T09:00:00.000Z"),
      "🔴 흘리면 포털은 거뒀다고 믿는데 여기서는 살아 있는 줄이 남는다"
    );
  });

  test("🔴 같은 id 로 두 번 → 한 줄이다(멱등). 포털이 재시도해도 안전하다", async () => {
    const { deps, 줄, 부른값 } = 가짜저장소();
    const 첫째 = await applyPortalDelegationPush(읽어야한다(몸통()), deps);
    const 둘째 = await applyPortalDelegationPush(
      읽어야한다(몸통({ reason: "출장(기간 연장)", endsAt: "2026-11-25T00:00:00.000Z" })),
      deps
    );
    assert.equal(첫째, "stored");
    assert.equal(둘째, "stored");
    assert.equal(줄.size, 1, "🔴 재시도가 줄을 하나 더 만들었다");
    assert.deepEqual(
      부른값.map((하나) => 하나.id),
      [위임번호, 위임번호],
      "두 번 다 같은 번호로 저장을 불러야 한다"
    );
    assert.equal(줄.get(위임번호)?.reason, "출장(기간 연장)", "둘째가 덮어쓰지 않았다");
  });

  test("🔴 열쇠를 못 바꾸면 not_applicable 이고 **저장을 부르지도 않는다**", async () => {
    const { deps, 줄, 부른값 } = 계정없는저장소();
    const outcome = await applyPortalDelegationPush(읽어야한다(몸통()), deps);
    assert.equal(outcome, "not_applicable", "🔴 오류가 아니다 — 포털이 지정을 거절한다");
    assert.equal(줄.size, 0);
    assert.deepEqual(부른값, [], "해당 없는데 저장을 불렀다");
  });

  test("revoke → 그 줄을 거둔다", async () => {
    const { deps, 줄 } = 가짜저장소({ 있는줄: [위임번호] });
    const parsed = parsePortalDelegationPush({
      action: "revoke",
      id: 위임번호,
      revokedAt: "2026-11-18T09:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(await applyPortalDelegationPush(parsed.command, deps), "stored");
    assert.deepEqual(줄.get(위임번호)?.revokedAt, new Date("2026-11-18T09:00:00.000Z"));
  });

  test("🔴 없는 줄을 거두면 not_applicable 이다 — 오류가 아니다", async () => {
    const { deps, 줄 } = 가짜저장소();
    const parsed = parsePortalDelegationPush({
      action: "revoke",
      id: 위임번호,
      revokedAt: "2026-11-18T09:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(
      await applyPortalDelegationPush(parsed.command, deps),
      "not_applicable",
      "🔴 오류로 답하면 포털이 철회를 거절해 영영 못 거둔다"
    );
    assert.equal(줄.size, 0);
  });

  test("🔴 revoke 는 열쇠 변환을 부르지 않는다 — id 로만 거둔다", async () => {
    const 기본 = 가짜저장소({ 있는줄: [위임번호] });
    let 물어본횟수 = 0;
    const deps: PortalDelegationPushDeps = {
      ...기본.deps,
      lookupUserIdsBySubjects: async (subjects) => {
        물어본횟수 += 1;
        return 기본.deps.lookupUserIdsBySubjects(subjects);
      },
    };
    const parsed = parsePortalDelegationPush({
      action: "revoke",
      id: 위임번호,
      revokedAt: "2026-11-18T09:00:00.000Z",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    await applyPortalDelegationPush(parsed.command, deps);
    assert.equal(물어본횟수, 0, "철회가 사람 번호를 다시 맞춰 봤다");

    // 🔵 표본이 공짜로 통과하지 않게 — upsert 는 **반드시** 물어본다.
    await applyPortalDelegationPush(읽어야한다(몸통()), deps);
    assert.equal(물어본횟수, 1);
  });

  test("저장이 던지면 그대로 올라간다 — 라우트가 500 으로 답하고 포털이 재시도한다", async () => {
    const 기본 = 가짜저장소();
    const deps: PortalDelegationPushDeps = {
      ...기본.deps,
      storeDelegation: async () => {
        throw new Error("DB 가 잠깐 안 된다");
      },
    };
    await assert.rejects(() => applyPortalDelegationPush(읽어야한다(몸통()), deps));
  });
});
