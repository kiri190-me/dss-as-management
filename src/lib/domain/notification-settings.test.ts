import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NOTIFICATION_TONE_COUNT, notificationToneIndex } from "@dss/ui";
import {
  NOTIFICATION_KIND_META,
  NO_NOTIFICATION_SETTINGS,
  buildNotificationSettingsScreenData,
  canReceiveLowStockNotifications,
  defaultNotificationKindEnabled,
  defaultRoleReceivesNotification,
  deliversNotification,
  isNotificationKind,
  isNotificationKindEnabled,
  isRoleEditableInNotificationSettings,
  roleReceivesNotification,
  type NotificationSettingsOverrides,
} from "./notification-settings";
import {
  APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS,
  NOTIFICATION_KINDS,
  REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS,
  type NotificationKind,
} from "./notifications";
import { canReceivePartRequestNotifications } from "@/lib/auth/inventory-authorization";
import { ROLE_CODES, type Role } from "./types";

/**
 * ============================================================================
 * 알림 설정 — 기본값과 거르기 규칙
 * ============================================================================
 * 여기서 지키려는 것은 하나다: **설정이 하나도 저장돼 있지 않을 때 알림 설정을
 * 만들기 전과 한 줄도 다르지 않다.** 표를 만들었는데 기존 동작이 바뀌면 그것이
 * 가장 나쁜 결과이므로, 다섯 역할 × 두 종류 열 칸을 하나씩 못 박는다.
 * ============================================================================
 */

/**
 * 각 종류가 **누구에게 가야 하는가**를 이 파일 안에 손으로 다시 적은 것.
 *
 * 일부러 defaultRoleReceivesNotification을 부르지 않는다 — 그 함수를 그대로
 * 부르면 무엇을 고쳐도 늘 통과하는 시험이 된다. 앞의 두 종류는 알림 설정을
 * 만들기 **전**의 코드가 실제로 하던 일이 전부였다:
 *   · 결재 대기      — 역할로 막는 코드가 한 줄도 없었다(전원 통과)
 *   · 부품 요청 대기 — queries/notifications.ts가 canReceivePartRequestNotifications로 걸렀다
 *
 * 3단계에서 붙인 재고 부족은 그 이전에 존재하지 않았으므로 재현할 옛 동작이
 * 없다. 대신 **그때 내린 결정**을 여기 손으로 적는다 — 재고를 채우는 사람
 * 셋(재고관리자·관리자·최고관리자). 여전히 저쪽 함수를 부르지 않는 것이 요점이다.
 *
 * 모르는 종류는 계속 throw 한다. 종류만 늘리고 이 규칙을 적지 않으면, 아무도
 * 판정하지 않은 알림이 조용히 태어난다.
 */
function ruleBeforeNotificationSettings(kind: string, role: Role): boolean {
  if (kind === "REPAIR_CASE_APPROVAL") return true;
  if (kind === "PART_REQUEST_PENDING") return canReceivePartRequestNotifications(role);
  if (kind === "PART_STOCK_BELOW_MINIMUM") {
    return role === "SUPER_ADMIN" || role === "ADMIN" || role === "INVENTORY_MANAGER";
  }
  // CUSTOMER_REPAIR_REQUEST_NEW(「새 수리 의뢰」)는 2026-10-04 에 종류 자체가
  // 빠졌다 — 고객이 의뢰를 넣던 길(전용 주소)이 없어졌다. 되살아나면 아래
  // throw 가 잡는다(판정을 다시 세우지 않고는 못 지나간다).
  if (kind === "PART_ISSUE_APPROVAL_PENDING") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부. 결재 대기와 같은 이유다: 누가 받는지는 역할이
    // 아니라 결재선 지정(과 최고관리자 비상구)이 정하고, 결재선에는 역할 제한 없이
    // 누구든 올라간다. 역할을 하나라도 빼면 자기 차례인 결재자가 알림을 못 받는다.
    return true;
  }
  if (kind === "QUOTE_APPROVAL_PENDING") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부. 불출 승인 대기와 같은 이유다: 누가 받는지는
    // 역할이 아니라 견적서 승인 결재선의 지정(과 최고관리자 비상구)이 정하고,
    // 그 결재선에도 역할 제한이 없다. 결재를 막는 decideQuoteApproval 은 아예
    // 권한 영역을 묻지 않으므로, 역할을 하나라도 빼면 「지정은 됐는데 알림은 못
    // 받는」 결재자가 생긴다.
    return true;
  }
  if (kind === "REPAIR_CASE_DUE_DATE_NEAR") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부(2026-10-19 사용자 결정 「모두에게 보인다」).
    // 앞의 결재 대기 셋과 답은 같지만 까닭이 다르다: 저쪽은 결재선 지정이
    // 누가 받는지를 정해서이고, 이쪽은 **가를 축이 아예 없어서**다 — 납기가
    // 다가온 건은 네 역할에게 각자 다른 모양으로 걸린다.
    return true;
  }
  if (kind === "APPROVAL_GRANTED" || kind === "APPROVAL_REJECTED") {
    // 새로 태어난 종류라 재현할 옛 동작은 없고, **그때 내린 결정**을 손으로
    // 적는다 — 다섯 역할 전부. 요청자 본인에게만 가는 사람 단위 알림이라(조회가
    // requested_by_user_id = 나 로 정한다) 역할로 막을 것이 없고, 결재를 요청하는
    // 쪽은 역할이 여럿이다.
    return true;
  }
  throw new Error(`대상을 판정한 적 없는 종류다: ${kind}`);
}

test("등록된 종류마다 사람이 읽는 이름과 한 줄 설명과 글자색이 있다", () => {
  // 종류가 늘면 화면은 안 고치지만 이 표는 채워야 한다 — 이름 없는 줄이
  // 화면에 그려지면 관리자가 무엇을 끄는지 알 수 없다. 색도 같다: 화면은 이
  // 값을 읽기만 하므로, 여기가 비면 종 패널에 색 없는 줄이 그려진다.
  for (const kind of NOTIFICATION_KINDS) {
    const meta = NOTIFICATION_KIND_META[kind];
    assert.ok(meta, `${kind}의 이름·설명·색이 없다`);
    assert.ok(meta.label.length > 0, `${kind}의 이름이 비어 있다`);
    assert.ok(meta.description.length > 0, `${kind}의 설명이 비어 있다`);
    assert.ok(meta.toneClassName.length > 0, `${kind}의 글자색이 비어 있다`);
  }
});

test("🔴 종류마다 색이 서로 다르다 — 같은 색이면 갈라 보이지 않는다", () => {
  const tones = NOTIFICATION_KINDS.map((kind) => NOTIFICATION_KIND_META[kind].toneClassName);
  assert.equal(new Set(tones).size, tones.length, `색이 겹친다: ${tones.join(" / ")}`);
});

test("🔴 색은 밝은 화면과 어두운 화면 두 벌이고, 조립하지 않은 온전한 클래스 이름이다", () => {
  // Tailwind는 소스에 **글자 그대로** 적힌 클래스만 CSS로 만든다. 조각을 붙여
  // 만들면 빌드 결과에 그 클래스가 없어 화면에서 색이 아예 나오지 않는다
  // (customer-row-color.ts가 같은 이유로 같은 규칙을 지킨다). 어두운 화면 값이
  // 빠지면 한쪽 화면에서만 읽히는 색이 된다.
  for (const kind of NOTIFICATION_KINDS) {
    const tone = NOTIFICATION_KIND_META[kind].toneClassName;
    assert.match(tone, /^text-[a-z]+-\d{2,3} dark:text-[a-z]+-\d{2,3}$/, `${kind}: ${tone}`);
    assert.ok(!tone.includes("${"), `${kind}의 색을 조립하면 Tailwind가 만들지 않는다`);
  }
});

/* ── 🔴 색 이름(Tailwind)과 칸 번호(@dss/ui)가 **같은 색**인가 ─────────────
 *
 * 한 종류의 색이 두 곳에 적혀 있다. toneClassName 은 이 저장소의 Tailwind 가,
 * toneIndex 는 묶음 종의 CSS 가 색으로 바꾼다. 한쪽만 고치면 같은 종류가 자리에
 * 따라 다른 색이 되고 **아무 오류도 나지 않는다** — 2026-10-19 전까지 실제로
 * 그랬다(표에 red 라고 적힌 「재고 부족」이 화면에서는 초록이었다. 그때는 칸을
 * 넘기지 못해 묶음이 종류 이름을 해시해 집었다).
 *
 * 그래서 「칸 번호 → 색 이름」 표를 여기 손으로 적지 않고 **두 파일을 읽어**
 * 맞댄다:
 *   · vendor/dss-ui/src/notification-bell/notification-bell.css — 칸마다의 색
 *   · node_modules/tailwindcss/theme.css                        — 이름마다의 색
 * 묶음 CSS 가 Tailwind v4 값을 글자 그대로 베껴 두어서(그쪽 머리말) 두 파일의
 * oklch 글자꼴이 같고, 글자 비교만으로 맞댈 수 있다.
 *
 * 🔴 묶음은 **다른 저장소**(서브모듈)다. 그래도 베껴 적지 않고 읽는 쪽을 고른
 *    까닭은, 손으로 옮긴 표가 곧 또 하나의 「한쪽만 고쳐지는 자리」가 되기
 *    때문이다. 파일이 없으면 이 시험은 읽기에서 죽는데, 그때는 앱도 서지
 *    않으므로(소스가 @dss/ui 를 부른다) 조용한 실패가 아니다.
 */

/** 저장소 뿌리에서 센 경로로 파일을 읽는다. */
const repoFile = (relativePath: string) =>
  readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");

/** 묶음 종의 스타일시트. 🔴 주석 안에도 `.dss-bell {` 가 있어 먼저 걷어낸다. */
const BELL_CSS = repoFile("vendor/dss-ui/src/notification-bell/notification-bell.css").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

/**
 * 선택자로 시작하는 한 블록 안의 `--dss-bell-tone-N` 들. 이 스타일시트에는
 * 중첩 블록이 없어 다음 `}` 까지가 곧 한 블록이다.
 *
 * 라이트·다크 두 블록만 본다. 나머지 둘(system 다크 · 라이트 고정)이 이 둘과
 * 같은 값이라는 것은 묶음 제 시험(notification-bell.css.test.ts)이 본다.
 */
function toneSlots(selector: string): Map<number, string> {
  const start = BELL_CSS.indexOf(selector);
  assert.ok(start >= 0, `묶음 CSS 에서 ${selector} 블록을 못 찾았다`);
  const block = BELL_CSS.slice(start, BELL_CSS.indexOf("}", start));
  const slots = new Map<number, string>();
  for (const [, index, value] of block.matchAll(/--dss-bell-tone-(\d+)\s*:\s*([^;]+);/g)) {
    slots.set(Number(index), value.trim());
  }
  return slots;
}

/** Tailwind 가 내놓는 색표 — `amber-700` → `oklch(…)`. */
function tailwindColors(): Map<string, string> {
  const colors = new Map<string, string>();
  for (const [, name, value] of repoFile("node_modules/tailwindcss/theme.css").matchAll(
    /--color-([a-z]+-\d{2,3})\s*:\s*([^;]+);/g
  )) {
    colors.set(name, value.trim());
  }
  return colors;
}

test("🔴 toneClassName 의 색과 toneIndex 가 가리키는 칸의 색이 같다 — 두 파일을 읽어 맞댄다", () => {
  const light = toneSlots(".dss-bell {");
  const dark = toneSlots(".dark .dss-bell,");
  const colors = tailwindColors();

  // 읽기가 빗나가면 아래 단언이 통째로 공짜가 된다.
  assert.equal(light.size, NOTIFICATION_TONE_COUNT, "묶음 CSS 의 라이트 칸 수를 잘못 읽었다");
  assert.equal(dark.size, NOTIFICATION_TONE_COUNT, "묶음 CSS 의 다크 칸 수를 잘못 읽었다");
  assert.ok(colors.size > 100, `Tailwind 색표를 못 읽었다(${colors.size}개)`);

  for (const kind of NOTIFICATION_KINDS) {
    const { toneClassName, toneIndex } = NOTIFICATION_KIND_META[kind];
    const parsed = /^text-([a-z]+-\d{2,3}) dark:text-([a-z]+-\d{2,3})$/.exec(toneClassName);
    assert.ok(parsed, `${kind}: 색 클래스 모양이 다르다 — ${toneClassName}`);

    const wantLight = colors.get(parsed[1]);
    const wantDark = colors.get(parsed[2]);
    assert.ok(wantLight, `${kind}: Tailwind 에 ${parsed[1]} 색이 없다`);
    assert.ok(wantDark, `${kind}: Tailwind 에 ${parsed[2]} 색이 없다`);

    // 🔴 밝은 화면과 어두운 화면을 **둘 다** 맞춘다. 한쪽만 보면 라이트는 맞는데
    //    다크에서만 다른 색이 되는 칸을 지나친다.
    const matching = [...light.keys()]
      .filter((slot) => light.get(slot) === wantLight && dark.get(slot) === wantDark)
      .sort((a, b) => a - b);

    assert.deepEqual(
      matching,
      [toneIndex],
      `${kind}: ${toneClassName} 는 묶음의 칸 [${matching.join(", ")}] 인데 toneIndex 는 ${toneIndex} 다`
    );
  }
});

test("🔴 여덟 종류가 **지정한** 칸에 앉는다 — 2026-10-19 사용자 결정", () => {
  // 일부러 표를 그대로 읽지 않고 손으로 다시 적는다 — NOTIFICATION_KIND_META 를
  // 읽어 비교하면 무엇을 고쳐도 늘 통과하는 시험이 된다.
  // satisfies 가 빠진 종류와 없는 종류를 둘 다 잡는다.
  const 지정 = {
    REPAIR_CASE_DUE_DATE_NEAR: 0, // 빨강 — 급한 경고
    PART_STOCK_BELOW_MINIMUM: 14, // 호박 — 급한 경고
    APPROVAL_GRANTED: 12, // 초록 — 결과(됐다)
    APPROVAL_REJECTED: 9, // 장미 — 결과(안 됐다)
    REPAIR_CASE_APPROVAL: 15, // 파랑 — 내가 할 일
    PART_REQUEST_PENDING: 8, // 하늘 — 내가 할 일
    PART_ISSUE_APPROVAL_PENDING: 6, // 남보라 — 내가 할 일
    QUOTE_APPROVAL_PENDING: 13, // 보라 — 내가 할 일
  } satisfies Record<NotificationKind, number>;

  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(NOTIFICATION_KIND_META[kind].toneIndex, 지정[kind], `${kind} 의 색 칸이 달라졌다`);
  }
});

test("🔴 칸 번호는 서로 다르고, 묶음이 아는 범위 안이다", () => {
  const indexes = NOTIFICATION_KINDS.map((kind) => NOTIFICATION_KIND_META[kind].toneIndex);
  assert.equal(new Set(indexes).size, indexes.length, `칸이 겹친다: ${indexes.join(" / ")}`);

  for (const kind of NOTIFICATION_KINDS) {
    const tone = NOTIFICATION_KIND_META[kind].toneIndex;
    assert.ok(
      Number.isInteger(tone) && tone >= 0 && tone < NOTIFICATION_TONE_COUNT,
      `${kind}: ${tone} 은 묶음의 칸(0 … ${NOTIFICATION_TONE_COUNT - 1}) 밖이다 — 묶음이 해시로 떨어뜨려 뜻이 사라진다`
    );
  }
});

test("🔴 지정한 칸이 해시가 고르던 칸과 다르다 — 안 넘기면 뜻이 뒤집히던 셋", () => {
  // 넘기기 전에 화면에 실제로 나오던 색이다: 「재고 부족」이 초록(12),
  // 「승인 완료」가 분홍(2), 「반려됨」이 청록(1). 경고가 「괜찮다」로 읽히고
  // 좋고 나쁨이 뒤집혔다. 셋 중 하나라도 해시와 같아지면 이 조각이 무엇을
  // 고쳤는지 알 수 없게 되므로 여기서 못 박는다.
  for (const kind of ["PART_STOCK_BELOW_MINIMUM", "APPROVAL_GRANTED", "APPROVAL_REJECTED"] as const) {
    assert.notEqual(
      NOTIFICATION_KIND_META[kind].toneIndex,
      notificationToneIndex(kind),
      `${kind}: 지정한 칸이 해시와 같다`
    );
  }
});

test("isNotificationKind는 등록된 종류만 통과시킨다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(isNotificationKind(kind), true, kind);
  }
  assert.equal(isNotificationKind("INVENTORY_LOW_STOCK"), false, "아직 없는 종류");
  assert.equal(isNotificationKind(""), false);
});

test("종류 자체는 켜져 있는 것이 기본이다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(defaultNotificationKindEnabled(kind), true, kind);
    assert.equal(isNotificationKindEnabled(kind, NO_NOTIFICATION_SETTINGS), true, kind);
  }
});

test("🔴 설정이 하나도 없으면 다섯 역할의 알림이 손으로 적은 규칙 그대로다", () => {
  // 이 시험이 이번 작업의 성공 조건이다. 앞의 두 종류에서는 "1단계와 똑같다"가,
  // 재고 부족에서는 "정한 대로 간다"가 그 뜻이다.
  for (const kind of NOTIFICATION_KINDS) {
    for (const role of ROLE_CODES) {
      assert.equal(
        deliversNotification(kind, role, NO_NOTIFICATION_SETTINGS),
        ruleBeforeNotificationSettings(kind, role),
        `${kind} × ${role} 이 손으로 적은 규칙과 달라졌다`
      );
    }
  }
});

test("결재 대기의 기본값은 다섯 역할 전부 받음이다 — 지금 아무 역할도 막고 있지 않다", () => {
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("REPAIR_CASE_APPROVAL", role), true, role);
  }
});

test("🔴 불출 승인 대기의 기본값도 다섯 역할 전부 받음이다 — 누가 받는지는 결재선 지정이 정한다", () => {
  // 결재선에는 역할 제한 없이 누구든 올라간다(영업도). 여기서 어느 역할이
  // 빠지면 그 역할의 결재자는 자기 차례인데 알림을 못 받고, 그 실패는 화면에
  // 아무 표시도 남기지 않는다.
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("PART_ISSUE_APPROVAL_PENDING", role), true, role);
    assert.equal(deliversNotification("PART_ISSUE_APPROVAL_PENDING", role, NO_NOTIFICATION_SETTINGS), true, role);
  }
  assert.equal(defaultNotificationKindEnabled("PART_ISSUE_APPROVAL_PENDING"), true, "켜진 채로 태어난다");
});

test("불출 승인 대기는 결재 대기와 이름·색이 갈라진다 — 한 패널에 섞여도 구별된다", () => {
  const partIssue = NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING;
  const approval = NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL;
  assert.equal(partIssue.label, "불출 승인 대기");
  assert.notEqual(partIssue.label, approval.label);
  assert.notEqual(partIssue.toneClassName, approval.toneClassName);
  // 색상 이름까지 달라야 한다 — 같은 amber 의 진하기만 바꾸면 눈으로 갈라지지 않는다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const hues = NOTIFICATION_KINDS.map((kind) => hueOf(NOTIFICATION_KIND_META[kind].toneClassName));
  assert.equal(new Set(hues).size, hues.length, `색상 이름이 겹친다: ${hues.join(" / ")}`);
});

test("🔴 견적서 결재 대기의 기본값도 켜짐·다섯 역할 전부 받음이다 — 누가 받는지는 결재선 지정이 정한다", () => {
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("QUOTE_APPROVAL_PENDING", role), true, role);
    assert.equal(deliversNotification("QUOTE_APPROVAL_PENDING", role, NO_NOTIFICATION_SETTINGS), true, role);
  }
  assert.equal(defaultNotificationKindEnabled("QUOTE_APPROVAL_PENDING"), true, "켜진 채로 태어난다");
});

test("견적서 결재 대기는 다른 두 결재 대기와 이름·색이 갈라진다 — 한 패널에 섞여도 구별된다", () => {
  const quote = NOTIFICATION_KIND_META.QUOTE_APPROVAL_PENDING;
  assert.equal(quote.label, "견적서 결재 대기");
  assert.notEqual(quote.label, NOTIFICATION_KIND_META.REPAIR_CASE_APPROVAL.label);
  assert.notEqual(quote.label, NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING.label);
  // 색상 이름까지 달라야 한다(전체 유일성은 위 시험이 본다). 여기서는 **다른
  // 일곱 종류 어느 것의 색도 다시 쓰지 않는다**는 것만 못 박는다.
  //
  // 🔴 예전에는 그때 쓰이던 일곱 색을 손으로 적어 두었다. 2026-10-19 에 색을
  //    뜻으로 다시 배정하자 그 목록이 낡아 **멀쩡한 배정을 틀렸다고 말했다**
  //    (violet 은 그때 불출 승인 대기 것이었지만 지금은 아니다). 지금 표에서
  //    뽑아 비교하면 낡지 않는다 — 막으려던 사고(색을 나눠 쓴다)는 그대로 막힌다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const others = NOTIFICATION_KINDS.filter((kind) => kind !== "QUOTE_APPROVAL_PENDING").map((kind) =>
    hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
  );
  const quoteHue = hueOf(quote.toneClassName);
  assert.ok(quoteHue, quote.toneClassName);
  assert.ok(!others.includes(quoteHue), `견적서 결재 대기가 남의 색(${quoteHue})을 쓴다`);
});

test("견적서 결재 대기의 설명은 누가 받는지와 절차가 없을 때를 함께 적는다", () => {
  // 관리자가 이 설명만 읽고 무엇을 끄는지 알아야 한다. 특히 「절차가 없으면 이
  // 알림도 없다」는 견적서에만 있는 사실이라 적어 두지 않으면 고장으로 읽힌다.
  const description = NOTIFICATION_KIND_META.QUOTE_APPROVAL_PENDING.description;
  assert.ok(description.includes("지정된"), description);
  assert.ok(description.includes("최고관리자"), description);
  assert.ok(description.includes("절차"), description);
});

test("🔴 납기 임박의 기본값은 켜짐·다섯 역할 전부 받음이다 — 모두에게 보인다", () => {
  // 2026-10-19 사용자 결정. 여기서 어느 역할이 빠지면 그 사람은 자기 몫의
  // 납기가 다가오는 것을 모른 채 지나가고, 그 실패는 화면에 아무 표시도
  // 남기지 않는다(관리자가 나중에 이 화면에서 끌 수는 있다).
  assert.equal(defaultNotificationKindEnabled("REPAIR_CASE_DUE_DATE_NEAR"), true, "켜진 채로 태어난다");
  for (const role of ROLE_CODES) {
    assert.equal(defaultRoleReceivesNotification("REPAIR_CASE_DUE_DATE_NEAR", role), true, role);
    assert.equal(deliversNotification("REPAIR_CASE_DUE_DATE_NEAR", role, NO_NOTIFICATION_SETTINGS), true, role);
  }
});

test("납기 임박의 이름·설명·색 — 창의 날짜 수는 상수에서 오고, 색은 남은 일곱과 갈라진다", () => {
  const meta = NOTIFICATION_KIND_META.REPAIR_CASE_DUE_DATE_NEAR;
  assert.equal(meta.label, "납기 임박");
  // 관리자가 이 설명만 읽고 무엇을 끄는지 알아야 한다 — 며칠 창인가, 날짜가
  // 어디서 오는가, 언제 안 뜨는가.
  assert.ok(
    meta.description.includes(`${REPAIR_CASE_DUE_DATE_NOTIFICATION_WINDOW_DAYS}일`),
    meta.description
  );
  assert.ok(meta.description.includes("내자"), meta.description);
  assert.ok(meta.description.includes("뜨지 않습니다"), meta.description);

  // 색상 이름까지 달라야 한다(전체 유일성은 위 시험이 본다). 여기서는 **다른
  // 일곱 종류 어느 것의 색도 다시 쓰지 않는다**는 것만 못 박는다(위 견적서
  // 시험의 그 자리 주석 — 손으로 적은 목록은 낡는다).
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const others = NOTIFICATION_KINDS.filter((kind) => kind !== "REPAIR_CASE_DUE_DATE_NEAR").map(
    (kind) => hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
  );
  const hue = hueOf(meta.toneClassName);
  assert.ok(hue, meta.toneClassName);
  assert.ok(!others.includes(hue), `납기 임박이 남의 색(${hue})을 쓴다`);
  // 🔴 초록(green·emerald·lime)은 고르지 않는다 — 「됐다」로 읽혀 경보가
  // 「괜찮다」로 보인다. 승인 완료에 초록을 준 바로 그 이유의 반대편이다.
  assert.ok(hue !== "green" && hue !== "emerald" && hue !== "lime", `납기 임박이 초록(${hue})이다`);
});

test("🔴 승인 완료·반려됨의 기본값은 켜짐·다섯 역할 전부 받음이다 — 요청자 본인에게만 가는 알림이다", () => {
  for (const kind of ["APPROVAL_GRANTED", "APPROVAL_REJECTED"] as const) {
    assert.equal(defaultNotificationKindEnabled(kind), true, `${kind} 는 켜진 채로 태어난다`);
    for (const role of ROLE_CODES) {
      assert.equal(defaultRoleReceivesNotification(kind, role), true, `${kind}/${role}`);
      assert.equal(deliversNotification(kind, role, NO_NOTIFICATION_SETTINGS), true, `${kind}/${role}`);
    }
  }
});

test("승인 완료·반려됨의 이름과 설명 — 사람이 읽는 말로, 창의 날짜 수는 상수에서 온다", () => {
  const granted = NOTIFICATION_KIND_META.APPROVAL_GRANTED;
  const rejected = NOTIFICATION_KIND_META.APPROVAL_REJECTED;
  assert.equal(granted.label, "승인 완료");
  assert.equal(rejected.label, "반려됨");
  for (const meta of [granted, rejected]) {
    // 관리자가 이 설명만 읽고 무엇을 끄는지 알아야 한다 — 누구에게 가는가, 언제까지
    // 뜨는가, 어떻게 사라지는가.
    assert.ok(meta.description.includes("요청"), meta.description);
    assert.ok(meta.description.includes(`${APPROVAL_OUTCOME_NOTIFICATION_WINDOW_DAYS}일`), meta.description);
    assert.ok(meta.description.includes("확인하면 사라집니다"), meta.description);
  }
});

test("🔴 승인 완료·반려됨의 색은 남은 여섯 색과도, 서로도 갈라진다", () => {
  // 손으로 적은 목록은 낡는다(위 견적서 시험의 그 자리 주석) — 지금 표에서 뽑는다.
  const hueOf = (tone: string) => tone.match(/^text-([a-z]+)-/)?.[1];
  const 결과둘: readonly string[] = ["APPROVAL_GRANTED", "APPROVAL_REJECTED"];
  const others = NOTIFICATION_KINDS.filter((kind) => !결과둘.includes(kind)).map((kind) =>
    hueOf(NOTIFICATION_KIND_META[kind].toneClassName)
  );
  const grantedHue = hueOf(NOTIFICATION_KIND_META.APPROVAL_GRANTED.toneClassName);
  const rejectedHue = hueOf(NOTIFICATION_KIND_META.APPROVAL_REJECTED.toneClassName);
  assert.ok(grantedHue && rejectedHue);
  assert.ok(!others.includes(grantedHue), `승인 완료가 남의 색(${grantedHue})을 쓴다`);
  assert.ok(!others.includes(rejectedHue), `반려됨이 남의 색(${rejectedHue})을 쓴다`);
  assert.notEqual(grantedHue, rejectedHue);
  // 🔴 좋고 나쁨이 색으로 갈려야 한다 — 「승인 완료가 분홍 · 반려됨이 청록」이
  //    실제로 나왔던 자리다(그때는 묶음이 해시로 색을 골랐다).
  assert.ok(
    ["green", "emerald", "lime", "teal"].includes(grantedHue),
    `승인 완료가 초록 쪽이 아니다(${grantedHue}) — 「됐다」로 읽히지 않는다`
  );
  assert.ok(
    ["rose", "red", "pink", "orange"].includes(rejectedHue),
    `반려됨이 붉은 쪽이 아니다(${rejectedHue}) — 「안 됐다」로 읽히지 않는다`
  );
});

test("부품 요청 대기의 기본값은 명단을 옮겨 적지 않고 저쪽 함수를 부른 결과다", () => {
  // 명단이 저쪽에서 바뀌면 여기 기본값도 저절로 따라 바뀌어야 한다.
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification("PART_REQUEST_PENDING", role),
      canReceivePartRequestNotifications(role),
      role
    );
  }
  // 지금 답을 그대로 못 박아 둔다 — 위 단언만으로는 양쪽이 함께 틀려도 통과한다.
  assert.deepEqual(
    ROLE_CODES.filter((role) => defaultRoleReceivesNotification("PART_REQUEST_PENDING", role)),
    ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"]
  );
});

test("🔴 재고 부족의 기본값은 재고를 채우는 셋뿐이다 — 엔지니어·영업은 받지 않는다", () => {
  assert.deepEqual(
    ROLE_CODES.filter((role) => defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", role)),
    ["SUPER_ADMIN", "ADMIN", "INVENTORY_MANAGER"]
  );
  assert.equal(defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", "AS_ENGINEER"), false);
  assert.equal(defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", "SALES"), false);
});

test("재고 부족의 판정 함수는 부품 요청의 것과 별개다 — 지금 답이 같을 뿐이다", () => {
  // 두 함수가 같은 셋을 내는 것은 지금의 사실이지 규칙이 아니다. 여기서 못 박는
  // 것은 재고 부족 쪽이 **자기 함수**로 답한다는 것이다 — 저쪽 명단이 바뀌어도
  // 이쪽이 따라 움직이면 안 된다.
  for (const role of ROLE_CODES) {
    assert.equal(
      defaultRoleReceivesNotification("PART_STOCK_BELOW_MINIMUM", role),
      canReceiveLowStockNotifications(role),
      role
    );
  }
});

test("🔴 최고관리자가 받는 것은 끌 수 없다 — 저장된 false도 무시한다", () => {
  assert.equal(isRoleEditableInNotificationSettings("SUPER_ADMIN"), false);
  for (const role of ROLE_CODES.filter((candidate) => candidate !== "SUPER_ADMIN")) {
    assert.equal(isRoleEditableInNotificationSettings(role), true, role);
  }

  // DB를 직접 고쳤거나 옛 행이 남아 있는 상황. 판정에서도 한 번 더 막는다.
  const tampered: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: {
      REPAIR_CASE_APPROVAL: { SUPER_ADMIN: false },
      PART_REQUEST_PENDING: { SUPER_ADMIN: false },
      PART_STOCK_BELOW_MINIMUM: { SUPER_ADMIN: false },
    },
  };
  for (const kind of NOTIFICATION_KINDS) {
    assert.equal(roleReceivesNotification(kind, "SUPER_ADMIN", tampered), true, kind);
    assert.equal(deliversNotification(kind, "SUPER_ADMIN", tampered), true, kind);
  }
});

test("🔴 종류를 끄면 그 종류만 사라지고 다른 종류는 그대로다", () => {
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives: {},
  };

  for (const role of ROLE_CODES) {
    assert.equal(
      deliversNotification("PART_REQUEST_PENDING", role, overrides),
      false,
      `끈 종류가 ${role}에게 아직 간다`
    );
    assert.equal(
      deliversNotification("REPAIR_CASE_APPROVAL", role, overrides),
      deliversNotification("REPAIR_CASE_APPROVAL", role, NO_NOTIFICATION_SETTINGS),
      `다른 종류가 ${role}에게서 달라졌다`
    );
  }
});

test("종류를 껐다 켜면 역할 설정이 그대로 살아 있다 — '모든 역할 해제'와 갈라지는 지점", () => {
  // 관리자가 재고 담당자를 부품 요청 알림에서 뺀 상태.
  const roleReceives: NotificationSettingsOverrides["roleReceives"] = {
    PART_REQUEST_PENDING: { INVENTORY_MANAGER: false },
  };

  const off: NotificationSettingsOverrides = {
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives,
  };
  const backOn: NotificationSettingsOverrides = { kindEnabled: {}, roleReceives };

  assert.equal(deliversNotification("PART_REQUEST_PENDING", "ADMIN", off), false, "꺼 두면 관리자에게도 안 간다");
  // 다시 켰을 때 관리자는 돌아오고, 빼 두었던 재고 담당자는 여전히 빠져 있다.
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "ADMIN", backOn), true);
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "INVENTORY_MANAGER", backOn), false);
});

test("역할 스위치를 끄면 그 역할만 빠진다", () => {
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: { REPAIR_CASE_APPROVAL: { SALES: false } },
  };

  assert.equal(deliversNotification("REPAIR_CASE_APPROVAL", "SALES", overrides), false);
  for (const role of ROLE_CODES.filter((candidate) => candidate !== "SALES")) {
    assert.equal(deliversNotification("REPAIR_CASE_APPROVAL", role, overrides), true, role);
  }
  // 다른 종류는 건드려지지 않는다.
  assert.equal(
    deliversNotification("PART_REQUEST_PENDING", "SALES", overrides),
    canReceivePartRequestNotifications("SALES")
  );
});

test("역할 스위치를 켜도 기본값에 없던 종류가 열린다 — 윗단 필터이지 원래 판정이 아니다", () => {
  // 영업을 부품 요청 알림 대상으로 넣는다. 이 설정만으로 알림이 가는 것이
  // 아니라, 그 종류의 원래 판정이 여전히 따로 돈다는 것이 설계다 — 여기서는
  // 필터가 통과시킨다는 사실까지만 확인한다(원래 판정은 통합 테스트에서 본다).
  const overrides: NotificationSettingsOverrides = {
    kindEnabled: {},
    roleReceives: { PART_REQUEST_PENDING: { SALES: true } },
  };
  assert.equal(canReceivePartRequestNotifications("SALES"), false, "기본값에서는 닫혀 있다");
  assert.equal(deliversNotification("PART_REQUEST_PENDING", "SALES", overrides), true);
});

// ─────────────────────────────────────────────────────── 화면이 그릴 자료

test("화면 자료는 등록 순서대로 종류를 내고, 칸마다 지금 값과 기본값을 함께 준다", () => {
  const data = buildNotificationSettingsScreenData(NO_NOTIFICATION_SETTINGS);

  assert.deepEqual(
    data.kinds.map((row) => row.kind),
    [...NOTIFICATION_KINDS]
  );

  for (const row of data.kinds) {
    assert.equal(row.label, NOTIFICATION_KIND_META[row.kind].label);
    assert.equal(row.enabled, true);
    assert.equal(row.defaultEnabled, true);
    for (const role of ROLE_CODES) {
      const cell = row.roles[role];
      assert.equal(cell.defaultReceives, defaultRoleReceivesNotification(row.kind, role), `${row.kind}/${role}`);
      // 설정이 없으므로 지금 값 = 기본값이다. 이 둘이 갈라지면 화면이 아무도
      // 만지지 않은 칸에 '기본값에서 바뀜' 표시를 붙이게 된다.
      assert.equal(cell.receives, cell.defaultReceives, `${row.kind}/${role}`);
    }
  }
});

test("화면 자료는 저장된 값을 반영하되 기본값 칸은 그대로 남긴다", () => {
  const data = buildNotificationSettingsScreenData({
    kindEnabled: { PART_REQUEST_PENDING: false },
    roleReceives: { REPAIR_CASE_APPROVAL: { SALES: false } },
  });

  const approval = data.kinds.find((row) => row.kind === "REPAIR_CASE_APPROVAL");
  const partRequest = data.kinds.find((row) => row.kind === "PART_REQUEST_PENDING");
  assert.ok(approval && partRequest);

  assert.equal(partRequest.enabled, false);
  assert.equal(partRequest.defaultEnabled, true, "기본값은 저장된 값과 무관하게 그대로다");

  assert.equal(approval.roles.SALES.receives, false);
  assert.equal(approval.roles.SALES.defaultReceives, true, "기본값은 그대로여야 화면이 '바뀐 칸'을 표시한다");
  assert.equal(approval.roles.AS_ENGINEER.receives, true, "건드리지 않은 칸은 기본값 그대로다");

  // 종류를 꺼도 역할 칸의 값은 남아 있다 — 다시 켜면 그대로 돌아온다.
  assert.equal(partRequest.roles.INVENTORY_MANAGER.receives, true);
});
