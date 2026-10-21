import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 알림 확인 서버 액션 **둘**이 서로 섞이지 않는가 (2026-10-22, 조각 2-다)
 * ============================================================================
 * 2026-10-22 에 종의 줄을 누르는 일이 「지움」에서 「확인」으로 바뀌면서, 이
 * 파일에 확인 액션이 **둘**이 됐다:
 *  · acknowledgeNotificationAction        — **A/S 자신의 줄** → A/S 의 표
 *    (notification_acknowledgements). 2026-10-22 이전과 한 글자도 다르지 않다.
 *  · acknowledgePortalNotificationAction  — **포털에서 온 줄** → 포털.
 *
 * 🔴 **섞이면 아무 오류도 안 난다.** 제 줄이 포털로 가면 남의 표에 우리 일이
 * 적히고, 포털 줄이 우리 표로 가면 남의 시스템 알림 id 로 우리 표가 쌓인다 —
 * 둘 다 돌려받는 값은 「적혔다」이고 화면은 멀쩡하다. 그래서 **글자로** 못
 * 박는다.
 *
 * ── 🔴 왜 글자로 재나 ───────────────────────────────────────────────────
 * 이 파일은 `"use server"` 에 세션·DB·포털 사슬을 물고 있어 값으로 부를 수
 * 없다(부르는 순간 DB 가 필요해진다). 바로 옆
 * server/integration/portal-inbox.test.ts 가 **나가는 왕복**을 값으로 재고,
 * components/layout/NotificationBell.test.tsx 가 **가르는 판정**을 값으로
 * 잰다. 여기가 재는 것은 그 둘 사이 — **어느 액션이 어느 길로 나가는가**다.
 *
 * 🔴 토막을 잘라 보는 시험이므로, 자른 자리가 **빈 문자열이 아닌 것**을 단언
 * 마다 먼저 확인한다. 안 하면 이름이 바뀐 날 아무것도 안 보면서 초록으로
 * 통과한다(이 저장소에 그런 식으로 반쯤 죽은 시험이 실제로 있다).
 * ============================================================================
 */

const 액션파일 = new URL("./notification-acknowledgements.ts", import.meta.url);

/**
 * 주석을 걷어낸 **코드만**. 두 액션의 머리말이 서로의 이름을 적어 두고 있어서
 * (일부러 그렇게 적었다 — 섞지 말라는 말이다) 주석을 둔 채 세면 모든 단언이
 * 뒤집힌다.
 */
function 코드만(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** 두 액션의 몸통을 갈라 돌려준다. 🔴 둘 다 비어 있지 않은 것을 여기서 확인한다. */
function 두액션() {
  const source = 코드만(readFileSync(액션파일, "utf8"));
  const 제줄시작 = source.indexOf("export async function acknowledgeNotificationAction");
  const 포털시작 = source.indexOf("export async function acknowledgePortalNotificationAction");

  assert.ok(제줄시작 > 0, "🔴 제 줄 확인 액션이 사라졌다");
  assert.ok(포털시작 > 제줄시작, "🔴 포털 확인 액션이 없다 — 포털 줄이 영영 종에 남는다");

  const 제줄 = source.slice(제줄시작, 포털시작);
  const 포털 = source.slice(포털시작);
  assert.ok(제줄.length > 0 && 포털.length > 0, "자른 토막이 비었다 — 이 시험이 아무것도 안 본다");
  // 🔴 엉뚱한 자리를 자르지 않았는지 — 각 토막에 그 액션만의 표식이 있어야 한다.
  assert.ok(제줄.includes("checkNotificationAcknowledgementKey("), "제 줄 토막이 엉뚱한 자리다");
  assert.ok(포털.includes("acknowledgePortalNotification("), "포털 토막이 엉뚱한 자리다");

  return { source, 제줄, 포털 };
}

test("🔴 이 파일의 **첫 토큰**이 `use server` 다 — 본문이 브라우저 번들로 새지 않는다", () => {
  // 🔴 주석에 그 낱말이 적힌 서버 파일이 다른 저장소마다 실제로 있었다. 단순
  //    grep 으로 세면 통과하므로 **주석을 걷어낸 뒤 첫 토큰**으로 판정한다
  //    (옆 지움 액션에 같은 시험이 있다 — NotificationBell.test.tsx).
  const 코드 = 코드만(readFileSync(액션파일, "utf8")).trim();
  assert.ok(코드.length > 0, "파일이 비었다 — 이 시험이 아무것도 안 본다");
  assert.ok(코드.startsWith('"use server";'), `🔴 첫 토큰이 "use server" 가 아니다: ${코드.slice(0, 40)}`);
  // 🔴 `"use client"` 가 섞이면 세션·DB·시크릿이 브라우저로 간다.
  assert.ok(!/"use client"/.test(코드), "클라이언트 조각으로 바뀌었다");
});

test("🔴 **제 줄의 확인은 포털로 가지 않는다** — 적히는 곳은 A/S 의 표 하나뿐이다", () => {
  // 제 줄이 포털로도 나가면 같은 일이 두 곳에 적히고, 어느 쪽이 참인지 알 수
  // 없게 된다. 🔵 2026-10-22 조각에서 이 액션은 **한 글자도 안 바뀌었다** —
  // 그것을 여기서 못 박는다.
  const { 제줄 } = 두액션();

  assert.ok(!제줄.includes("acknowledgePortalNotification"), "🔴 제 줄의 확인이 포털로 샜다");
  assert.ok(!제줄.includes("getSsoSubjectForUser"), "🔴 제 줄 쪽이 포털 사람 번호를 읽고 있다");
  assert.ok(!/dismiss/i.test(제줄), "🔴 제 줄의 확인이 지움도 적는다");

  // 가던 길은 그대로다 — 우리 표에 적고, 종이 다시 계산되게 무효화한다.
  assert.match(제줄, /acknowledgeNotification\(\{ userId: actorCheck\.userId/);
  assert.match(제줄, /revalidatePath\("\/", "layout"\);/);
});

test("🔴 **포털 줄의 확인은 A/S 의 표로 가지 않는다** — 우리 DB 에 한 줄도 안 적는다", () => {
  // 남의 시스템 알림 id 로 우리 표가 쌓이면 아무 오류 없이 영영 남는다.
  const { 포털 } = 두액션();

  assert.ok(!포털.includes("acknowledgeNotification({"), "🔴 포털 줄이 우리 표에 적혔다");
  assert.ok(!포털.includes("checkNotificationAcknowledgementKey"), "우리 표의 열쇠 검사를 타고 있다");
  assert.ok(!포털.includes("revalidatePath"), "줄 한 번 누르기마다 레이아웃을 통째로 다시 계산한다");

  // 🔴 **지움으로도 적지 않는다.** 둘 다 적으면 동작이 필요한 줄(결재 승인·부품
  //    요청)이 눌린 순간 숨어 2026-10-22 요구 ②가 깨진다.
  assert.ok(!/dismiss/i.test(포털), "🔴 포털 줄의 확인이 지움도 적는다");

  // 가는 길은 **포털 하나**다.
  assert.match(포털, /acknowledgePortalNotification\(subject, notificationKey\)/);
});

test("🔴 포털 확인도 **사람 번호를 받지 않는다** — 서버가 제 세션에서 읽는다", () => {
  // 받으면 브라우저가 아무 번호나 실어 **남의 알림을 확인 처리하는** 통로가
  // 된다(옆 지움 액션과 같은 규약).
  const { 포털 } = 두액션();

  const 서명 = 포털.slice(0, 포털.indexOf("): Promise<{ ok: boolean }>"));
  assert.ok(서명.length > 0, "서명을 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(서명.includes("notificationKey: string"), "자른 토막이 서명이 아니다");
  assert.doesNotMatch(서명, /sub|subject|userId|actor/i, "브라우저가 보낸 사람 번호를 받는다");

  // 그 값은 서버가 제 세션에서 읽는다.
  assert.match(포털, /const session = await readSession\(\);/);
  assert.match(포털, /await getSsoSubjectForUser\(session\.userId\)/);
  // 포털 계정에 이어지지 않은 로컬 계정은 적을 곳이 없다 — 조용히 돌아간다.
  assert.match(포털, /if \(!subject\) return \{ ok: false \};/);
});

test("🔴 포털 확인은 **던지지 않는다** — 종이 누름 처리 한가운데서 부른다", () => {
  // 던지면 종이, 곧 모든 화면의 머리말이 깨진다. 남기는 것은 오류의 **종류**
  // 뿐이다 — 열쇠에는 수리 건 번호 같은 업무 식별자가 들어 있다.
  const { 포털 } = 두액션();

  const 몸통시작 = 포털.indexOf("{", 포털.indexOf("): Promise<{ ok: boolean }>"));
  assert.ok(몸통시작 > 0, "몸통을 못 찾았다 — 이 시험이 아무것도 안 본다");
  const 몸통 = 포털.slice(몸통시작);
  assert.ok(몸통.includes("try {"), "🔴 포털 확인이 아무것도 받아 내지 않는다");

  assert.match(포털, /catch \(error\) \{/);
  assert.match(포털, /name: error instanceof Error \? error\.name : "unknown",/);
  // 🔴 열쇠도 사람도 로그에 싣지 않는다.
  const 로그 = 포털.slice(포털.indexOf("console.error("));
  assert.ok(로그.length > 0, "로그 자리를 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(!로그.includes("notificationKey,"), "🔴 로그에 열쇠를 실었다");
  assert.ok(!로그.includes("subject"), "🔴 로그에 사람 번호를 실었다");
});
