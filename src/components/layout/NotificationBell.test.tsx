import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NotificationBell as SharedNotificationBell,
  isSafeNotificationHref,
  type NotificationBellItem,
} from "@dss/ui";
import NotificationBell, {
  BrowserNotificationNotice,
  DismissAllNotice,
  NotificationBellFooter,
  NotificationBellWithInbox,
  NotificationSelfTest,
  acknowledgeInBackground,
  acknowledgePortalInBackground,
  announceNotificationPanelOpened,
  handleNotificationPicked,
  handlePortalRowPicked,
  selectVisibleNotifications,
  type AcknowledgeNotification,
} from "./NotificationBell";
import {
  NOTIFICATION_KINDS,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildQuoteApprovalNotification,
  buildRepairCaseDueDateInvertedNotification,
  buildRepairCaseDueDateNearNotification,
  buildRepairCaseTargetShipmentMissingNotification,
  type NotificationItem,
} from "@/lib/domain/notifications";
import { toNotificationBellItems } from "@/lib/domain/notification-bell-items";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import { isAcknowledgeableNotificationKind } from "@/lib/domain/notification-acknowledgement";
import {
  canDismissNotification,
  dismissableNotificationKeys,
} from "@/lib/domain/notification-dismissal";
import {
  NOTIFICATION_PANEL_OPENED_EVENT,
  describeNotificationToastFailure,
} from "@/lib/domain/notification-toast";

/**
 * 🔴 종의 겉모습이 @dss/ui 의 묶음 종으로 바뀌면서 **정적 렌더로 볼 수 있는 것이
 * 늘었다.** 묶음 종은 <details>/<summary> 라 펼친 속까지 늘 마크업에 있다(여닫기는
 * 브라우저가 한다). 그래서 예전에 따로 떼어 두었던 NotificationList 없이도 목록을
 * 그대로 검사한다.
 *
 * 브라우저 이벤트로만 볼 수 있는 것(바깥 클릭·Escape·실제 여닫기)은 여기서
 * 검사하지 않는다 — 그 셋은 이제 묶음의 BellBehavior 가 하고 그쪽 시험이 지킨다.
 * 이 파일이 지키는 것은 **A/S 쪽 계약**이다: 개수 세는 규칙, 확인 판정, 열림 신호,
 * 묶음에 올 수 없어 footer 로 넣은 두 조각.
 */

function approval(repairCaseId: string, intakeNumber: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT") {
  return buildApprovalNotification({ repairCaseId, intakeNumber, approvalType });
}

/**
 * 종류마다 한 줄씩 — 색과 이름이 실제로 갈라지는지 보려면 전부 함께 있어야
 * 한다. 종류를 늘리면 여기에도 한 줄을 더해야 하고, 빠뜨리면 아래 두 시험이
 * 곧바로 잡는다("이름이 글자로 보이지 않는다").
 */
function oneOfEachKind() {
  return [
    approval("case-1", "D9705-012", "REPAIR_INSPECTION"),
    buildQuoteApprovalNotification({
      quoteId: "quote-1",
      quoteNumber: "Q-9705-001",
      routeStepOrder: 1,
      requestedByName: "박영업",
    }),
    buildRepairCaseDueDateNearNotification({
      repairCaseId: "case-due-1",
      intakeNumber: "D9705-400",
      dueDate: "2026-10-22",
      borrowed: true,
    }),
    buildRepairCaseTargetShipmentMissingNotification({
      repairCaseId: "case-target-1",
      intakeNumber: "D9705-401",
      orderIssuedDate: "2026-10-21",
    }),
    buildRepairCaseDueDateInvertedNotification({
      repairCaseId: "case-inverted-1",
      intakeNumber: "D9705-402",
      internalTargetShipmentDate: "2026-11-05",
      requestedDueDate: "2026-10-30",
      borrowed: false,
    }),
    grantedItem(),
    rejectedItem(),
  ];
}

/** 눌러서 확인하는 줄 — 내가 요청한 출하 승인이 끝났다. */
function grantedItem(): NotificationItem {
  return buildApprovalGrantedNotification({
    source: "REPAIR_CASE",
    approvalId: "approval-g1",
    repairCaseId: "case-9",
    intakeNumber: "D9705-300",
    approvalType: "FINAL_SHIPMENT",
    decidedByName: "김결재",
  });
}

/**
 * 눌러서 확인하는 줄 — 내가 올린 견적서 결재가 반려됐다.
 *
 * 🔴 승인 완료 줄(grantedItem)과 **다른 표**를 쓴다 — 한 표만 쓰면 「두 갈래가 각각
 * 그려지는가」를 못 잰다. 2026-10-27 까지는 부품 불출이었고, 그 갈래를 들어내면서
 * (13-C4) 남은 둘 중 접수 건이 아닌 쪽으로 바꿨다.
 */
function rejectedItem(): NotificationItem {
  return buildApprovalRejectedNotification({
    source: "QUOTE",
    approvalId: "approval-r1",
    quoteId: "quote-9",
    quoteNumber: "Q-9705-009",
    decisionReason: "금액 근거 보완 요망",
  });
}

test("🔴 0건이어도 종은 남아 있고 빈 칸 문구가 나온다 — 배지만 없다", () => {
  // 묶음의 기본값은 「목록이 비면 종 자체가 없다」다. A/S 는 머리말의 아이콘
  // 자리가 들쭉날쭉하면 안 되고 권한 안내가 그 안에 있으므로 뒤집어 켠다.
  const html = renderToStaticMarkup(<NotificationBell items={[]} />);

  assert.ok(html.includes("<details"), "종 버튼 자체는 사라지지 않는다");
  assert.ok(html.includes("<summary"), "펼칠 손잡이가 있어야 한다");
  assert.ok(html.includes(">알림</span>"), "낭독기가 읽을 이름이 남아 있다");
  assert.ok(html.includes("처리할 알림이 없습니다."), "빈 칸 문구는 A/S 의 말투 그대로다");
  assert.ok(!html.includes("dss-bell__badge"), "0건에 배지를 그리면 할 일이 있는 것처럼 보인다");
  assert.ok(!html.includes("<a"), "빈 상태에는 누를 것이 없어야 한다");
});

test("1건 이상이면 개수 배지를 그리고 낭독기가 읽는 이름에도 건수가 들어간다", () => {
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );
  assert.ok(html.includes(">알림 1건</span>"));
  assert.match(html, /class="dss-bell__badge"[^>]*>1</, "배지에 숫자가 찍혀야 한다");
});

test("🔴 배지 숫자는 접수 건 단위다 — 한 건에 두 종류가 걸려도 1건이다", () => {
  // 사이드바 결재 배지와 같은 숫자여야 한다. 두 배지가 다른 수를 말하면
  // 어느 쪽도 믿지 않게 된다. 🔴 묶음은 **받은 숫자를 그대로** 찍으므로,
  // 「같은 대상은 한 번만」 세는 일은 이쪽이 해서 넘겨야 한다.
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[
        approval("case-1", "D9705-012", "REPAIR_INSPECTION"),
        approval("case-1", "D9705-012", "FINAL_SHIPMENT"),
      ]}
    />
  );
  assert.ok(html.includes(">알림 1건</span>"), "같은 접수 건은 한 번만 센다");
  assert.match(html, /class="dss-bell__badge"[^>]*>1</);
  assert.equal((html.match(/class="dss-bell__item"/g) ?? []).length, 2, "줄은 둘 그대로 그린다");
});

test("🔴 펼침 상태는 마크업이 아니라 <details> 가 들고 있다 — 처음은 닫혀 있다", () => {
  // 예전 종은 펼칠 때만 패널을 그려서 「닫힌 패널의 링크가 탭 순서에 남지
  // 않는다」를 마크업으로 지켰다. 묶음 종은 속을 늘 그리고 **브라우저가** 접어
  // 둔다 — 닫힌 <details> 속은 그려지지 않으므로 탭 순서에도 들어가지 않는다.
  // 그래서 지켜야 할 것은 「처음이 닫혀 있다」로 옮겨 갔다.
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );

  const details = html.match(/<details[^>]*>/);
  assert.ok(details, "<details> 를 찾지 못했다");
  assert.ok(!/\sopen[\s>=]/.test(details[0]), "처음부터 펼쳐진 종이 되었다");
  assert.ok(html.includes("/repair-cases/case-1"), "속은 그려져 있다 — 접는 일은 브라우저가 한다");
});

test("항목은 인수번호와 승인 종류 라벨을 함께 보여 주고 그 건의 검수/승인 화면으로 바로 링크한다", () => {
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );
  // 상세 첫 화면이 아니라 결재를 처리할 수 있는 화면으로 곧장 간다.
  assert.ok(html.includes('href="/repair-cases/case-1/approval"'));
  assert.ok(html.includes("D9705-012"));
  assert.ok(html.includes("수리 검수 승인"));
});

test("여러 건이면 건별로 한 줄씩 나온다", () => {
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[
        approval("case-1", "D9705-012", "REPAIR_INSPECTION"),
        approval("case-2", "D9705-013", "FINAL_SHIPMENT"),
      ]}
    />
  );
  assert.ok(html.includes('href="/repair-cases/case-1/approval"'));
  assert.ok(html.includes('href="/repair-cases/case-2/approval"'));
  assert.ok(html.includes("최종 출하 승인"));
});

test("🔴 받은 차례 그대로 그린다", () => {
  const items = oneOfEachKind();
  const html = renderToStaticMarkup(<NotificationBell items={items} />);

  const drawn = [...html.matchAll(/data-notification-key="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(drawn, items.map((item) => item.id), "묶음이 목록을 다시 섞었다");
});

// ─────────────────────────────────────────────── 종류를 눈으로 구분한다

test("🔴 종류마다 **도메인 표가 지정한** 색 칸에 앉는다 — 해시가 고른 칸이 아니다", () => {
  // 색은 이 저장소의 Tailwind 클래스로 건너가지 않는다 — 그랬다면 색이 **조용히**
  // 사라졌을 자리다(Tailwind v4 는 node_modules 를 훑지 않는다). 건너가는 것은
  // 칸 번호 하나이고, 묶음의 CSS 가 그 번호로 색을 칠한다.
  //
  // 🔴 2026-10-19 전까지는 그 번호를 **묶음이 종류 이름을 해시해** 집었다. 셈은
  //    「종류마다 다른 색」만 지키고 뜻은 지키지 못해서 「재고 부족」이 초록으로,
  //    「승인 완료」가 분홍으로, 「반려됨」이 청록으로 나왔다. 이제 A/S 가 고른
  //    칸을 실어 보내는데, **실어 보낸 값이 정말 쓰이는가**가 여기서 볼 것이다.
  const kinds = oneOfEachKind();
  const html = renderToStaticMarkup(<NotificationBell items={kinds} />);

  const tones = [...html.matchAll(/class="dss-bell__kind" data-tone="(\d+)"/g)].map((match) =>
    Number(match[1])
  );
  assert.equal(tones.length, NOTIFICATION_KINDS.length, "종류마다 색 칸이 하나씩 붙지 않았다");
  assert.equal(new Set(tones).size, tones.length, "두 종류가 같은 색이면 갈라 보이지 않는다");

  // 그려진 차례는 받은 차례 그대로다(위 시험) — 그래서 줄마다 짝지어 볼 수 있다.
  assert.deepEqual(
    tones,
    kinds.map((item) => NOTIFICATION_KIND_META[item.kind].toneIndex),
    "도메인 표가 지정한 칸이 아니라 다른 칸에 앉았다 — 묶음이 해시로 집고 있다"
  );
});

test("🔴 색만으로 구분하지 않는다 — 종류 이름이 글자로도 보인다", () => {
  // 색약이신 분에게는 색 차이가 사라지고, 흑백 인쇄에는 아무것도 남지 않는다.
  const html = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(html.includes(NOTIFICATION_KIND_META[kind].label), `${kind} 의 이름이 글자로 보이지 않는다`);
  }
});

// 🔵 아래 시험은 2026-10-27(13-C4)까지 「불출 승인 대기」로 같은 것을 쟀다. 재고 알림
//    셋을 걷어내면서 **결재선을 타는 다른 종류**인 견적서 결재 대기로 갈아 끼웠다 —
//    재는 것은 종류 이름이 아니라 「화면을 안 고쳐도 같은 한 줄이 나오는가」다.
test("견적서 결재 대기도 화면을 고치지 않고 같은 한 줄로 그려진다 — 이름·대상·상세·링크", () => {
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[
        buildQuoteApprovalNotification({
          quoteId: "quote-7",
          quoteNumber: "Q-9705-007",
          routeStepOrder: 1,
          requestedByName: "홍길동",
        }),
      ]}
    />
  );
  assert.ok(html.includes('href="/quotes/quote-7"'), "그 견적서 화면으로 가야 한다");
  assert.ok(html.includes(NOTIFICATION_KIND_META.QUOTE_APPROVAL_PENDING.label));
  assert.match(html, /class="dss-bell__kind" data-tone="\d+"/, "색 칸이 붙지 않았다");
  assert.ok(html.includes("Q-9705-007"));
  assert.ok(html.includes("결재선 1단계 · 요청자 홍길동"));
});

test("종류 이름은 윗줄에 따로 온다 — 지금 줄(대상 · 상세)이 길어져 잘리지 않게", () => {
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );

  const metaIndex = html.indexOf("dss-bell__meta");
  const labelIndex = html.indexOf("결재 대기");
  const lineIndex = html.indexOf("dss-bell__line");
  const subjectIndex = html.indexOf("D9705-012");

  assert.ok(metaIndex >= 0 && labelIndex >= 0 && lineIndex >= 0 && subjectIndex >= 0);
  assert.ok(metaIndex < labelIndex, "종류 이름이 제 칸(meta) 안에 있어야 한다");
  assert.ok(labelIndex < lineIndex, "종류 이름이 대상·상세 줄보다 앞에 온다");
  assert.ok(lineIndex < subjectIndex, "대상은 그 아랫줄(line) 안에 있다");
  // 상세가 … 로 끊기는 자리는 그대로 남아 있다(묶음 CSS 의 dss-bell__detail).
  assert.ok(html.includes("dss-bell__detail"), "상세가 끊기는 자리를 잃었다");
});

test("🔴 화면에는 종류별 분기가 없다 — 종류가 늘어도 이 파일은 고치지 않는다", () => {
  // 이 구조의 목적이다(NotificationItem 한 모양만 그린다). 이름은 도메인 표를
  // **읽기만** 하고(옮겨 담는 자리가 읽는다) 색은 묶음이 고르므로, 종류가 늘면
  // 그 표를 채우는 것으로 끝나야 한다.
  const source = readFileSync(new URL("./NotificationBell.tsx", import.meta.url), "utf8");

  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(!source.includes(kind), `화면이 ${kind} 를 직접 알고 있다`);
  }
  assert.ok(!/switch\s*\(\s*[A-Za-z.]*[kK]ind/.test(source), "화면에 종류 switch 가 생겼다");
  assert.ok(!/[kK]ind\s*===/.test(source), "화면에 종류 비교가 생겼다");
});

// ───────────────────────── 자바스크립트 없이도 읽고 나갈 수 있다

test("🔴 마크업에 스크립트가 없고 줄은 평범한 <a href> 다", () => {
  // 사내망에서는 스크립트가 늦게 붙는 일이 실제로 있다. 그때도 종을 열어 읽고
  // 링크로 나갈 수 있어야 한다 — 여닫기는 <details> 가, 이동은 <a> 가 한다.
  const html = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  assert.ok(!html.includes("<script"), "마크업에 스크립트가 섞였다");
  assert.ok(!/\son[a-z]+=/i.test(html), "마크업에 인라인 이벤트가 섞였다");
  assert.ok(!html.includes("<button"), "줄이 단추가 되면 스크립트 없이는 아무 데도 못 간다");

  const links = html.match(/<a [^>]*>/g) ?? [];
  assert.equal(links.length, oneOfEachKind().length, "줄 수만큼 링크가 있어야 한다");
  for (const link of links) {
    assert.match(link, /\shref="[^"]+"/, "링크에 갈 곳이 없다");
  }
});

// ───────────────────────────────────── 컴퓨터·폰 알림창을 쓸 수 있는가

test("🔴 보안 접속이 아니면 왜 안 되는지 말한다", () => {
  // 아무 말도 안 하면 "왜 내 폰에는 안 뜨지"가 되고 사람들은 고장으로 여긴다.
  const html = renderToStaticMarkup(<BrowserNotificationNotice status="INSECURE_CONTEXT" onAsk={() => {}} />);

  assert.ok(html.includes("이 기기에서는 알림을 띄울 수 없습니다 — 보안 접속(HTTPS)이 아닙니다."));
  assert.ok(!html.includes("<button"), "눌러도 아무 일이 없는 단추를 그리면 그것이 더 헷갈린다");
});

test("🔴 아직 묻지 않았을 때만 `알림 받기` 단추가 나온다 — 열리자마자 묻지 않는다", () => {
  const html = renderToStaticMarkup(<BrowserNotificationNotice status="ASKABLE" onAsk={() => {}} />);

  assert.ok(html.includes("<button"));
  assert.ok(html.includes("알림 받기"));
  assert.ok(html.includes("새 알림이 생기면"), "무엇을 허락하는 것인지 미리 알려 준다");
});

test("이미 허락했거나 아직 브라우저에 물어보기 전이면 아무것도 그리지 않는다", () => {
  // UNKNOWN은 서버 렌더 때의 값이다 — 서버는 이 기기가 보안 접속인지 알 수
  // 없으므로 미리 무언가를 적으면 하이드레이션 뒤에 글자가 바뀐다.
  assert.equal(renderToStaticMarkup(<BrowserNotificationNotice status="GRANTED" onAsk={() => {}} />), "");
  assert.equal(renderToStaticMarkup(<BrowserNotificationNotice status="UNKNOWN" onAsk={() => {}} />), "");
});

test("차단된 상태에서는 단추 대신 되돌리는 법을 알려 준다", () => {
  const html = renderToStaticMarkup(<BrowserNotificationNotice status="DENIED" onAsk={() => {}} />);

  assert.ok(html.includes("브라우저 설정"));
  assert.ok(!html.includes("<button"), "다시 물어도 브라우저가 창을 띄우지 않는다");
});

test("서버 렌더에서 종이 알림 기능을 만지다 터지지 않는다", () => {
  // Notification·localStorage를 렌더 중에 직접 만지면 서버에서 터진다.
  // useSyncExternalStore의 서버 스냅샷이 그것을 막는다.
  assert.doesNotThrow(() => renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />));
});

// ───────────────────────────────── 시험 알림 — 왜 안 뜨는지 화면이 말한다

test("🔴 띄울 수 있는 상태에서는 `시험 알림` 단추를 그린다", () => {
  // 알림이 안 뜬다는 신고는 원인이 화면 밖에 있어 코드로 좇기 어렵다. 이
  // 단추가 그 자리에서 실제로 한 번 띄워 보는 진단 장치다.
  const html = renderToStaticMarkup(<NotificationSelfTest status="GRANTED" onTest={() => {}} result={null} />);

  assert.ok(html.includes("<button"));
  assert.ok(html.includes("시험 알림"));
});

test("아직 띄울 수 없는 상태에서는 시험 단추를 그리지 않는다", () => {
  // 권한이 없다는 안내는 바로 위 BrowserNotificationNotice가 이미 한다.
  // 눌러도 같은 말만 반복하는 단추를 하나 더 두면 그것이 더 헷갈린다.
  for (const status of ["UNKNOWN", "INSECURE_CONTEXT", "UNSUPPORTED", "ASKABLE", "DENIED"] as const) {
    assert.equal(
      renderToStaticMarkup(<NotificationSelfTest status={status} onTest={() => {}} result={null} />),
      "",
      status
    );
  }
});

test("아직 안 눌렀으면 무엇을 하는 단추인지 알려 준다", () => {
  const html = renderToStaticMarkup(<NotificationSelfTest status="GRANTED" onTest={() => {}} result={null} />);
  assert.ok(html.includes("왜 안 뜨는지"));
});

test("🔴 눌러 본 결과를 그 자리에 적는다 — 못 떴으면 왜 못 떴는지", () => {
  // 안드로이드 Chrome이 던지는 그 예외. 예전에는 빈 catch가 이것을 삼켜서
  // 폰에서는 아무 일도 안 일어나고 아무 흔적도 안 남았다.
  const reason = describeNotificationToastFailure(
    new TypeError("Failed to construct 'Notification': Illegal constructor.")
  );
  const html = renderToStaticMarkup(<NotificationSelfTest status="GRANTED" onTest={() => {}} result={reason} />);

  assert.ok(html.includes("서비스워커"), "왜 못 떴는지가 화면에 보여야 한다");
  assert.ok(!html.includes("왜 안 뜨는지"), "결과가 나왔으면 안내 문구 자리를 결과가 차지한다");
});

// ────────────── 묶음에 올 수 없는 둘은 펼친 칸 **맨 아래**로 들어간다

test("🔴 권한 안내와 「시험 알림」은 한 조각으로 묶여 그 차례로 그려진다", () => {
  // 묶음이 내주는 자리는 하나다(footer). 그 안의 차례는 A/S 가 정한다 —
  // 안내가 먼저, 진단 단추가 그 아래.
  assert.ok(
    renderToStaticMarkup(
      <NotificationBellFooter status="ASKABLE" onAsk={() => {}} onTest={() => {}} selfTestResult={null} />
    ).includes("알림 받기"),
    "아직 못 띄우는 상태에서 권한 안내가 안 나온다"
  );
  assert.ok(
    renderToStaticMarkup(
      <NotificationBellFooter status="GRANTED" onAsk={() => {}} onTest={() => {}} selfTestResult={null} />
    ).includes("시험 알림"),
    "띄울 수 있는 상태에서 진단 단추가 안 나온다"
  );
});

test("🔴 그 자리는 펼친 칸 **맨 아래**다 — 마지막 줄 뒤, 목록이 닫히기 전", () => {
  // 묶음 종이 서버 컴포넌트라 이 조합을 정적 렌더로 그대로 본다. 자리를 잃으면
  // 「알림이 안 떠요」의 진단 장치가 사람 눈에서 사라진다.
  const html = renderToStaticMarkup(
    <SharedNotificationBell
      items={toNotificationBellItems([approval("case-1", "D9705-012", "REPAIR_INSPECTION")])}
      count={1}
      showWhenEmpty
      emptyLabel="처리할 알림이 없습니다."
      footer={
        <NotificationBellFooter status="GRANTED" onAsk={() => {}} onTest={() => {}} selfTestResult={null} />
      }
    />
  );

  const itemIndex = html.indexOf("dss-bell__item");
  const footerIndex = html.indexOf("dss-bell__footer");
  const testButtonIndex = html.indexOf("시험 알림");
  const listEnd = html.indexOf("</ul>");

  assert.ok(itemIndex >= 0 && footerIndex >= 0 && testButtonIndex >= 0 && listEnd >= 0);
  assert.ok(itemIndex < footerIndex, "끼워 넣은 자리가 알림 줄보다 위에 있다");
  assert.ok(footerIndex < testButtonIndex, "진단 단추가 그 자리 밖으로 나갔다");
  assert.ok(testButtonIndex < listEnd, "그 자리가 펼친 칸 밖으로 나갔다 — 머리말이 두꺼워진다");
});

test("🔴 A/S 의 종이 그 자리를 실제로 쓴다 — 서버 렌더(상태를 모를 때)에도 자리가 선다", () => {
  // 서버 렌더에서는 권한을 알 수 없어(UNKNOWN) 두 조각 다 아무것도 안 그린다.
  // 그래도 **자리**는 있어야 한다 — 브라우저에서 상태가 잡히면 그 칸이 채워진다.
  const html = renderToStaticMarkup(<NotificationBell items={[]} />);

  const emptyIndex = html.indexOf("dss-bell__empty");
  const footerIndex = html.indexOf("dss-bell__footer");
  assert.ok(emptyIndex >= 0, "빈 칸 문구가 없다");
  assert.ok(footerIndex > emptyIndex, "끼워 넣는 자리가 빈 칸 문구 아래에 없다");
});

// ─────────────────────────── 종을 열면 그 자리에서 다시 센다

/**
 * 펼침 자체는 브라우저가 한다(묶음의 <details>). A/S 가 지켜야 하는 것은 그
 * 순간에 **다시 세라는 신호**가 나가는 것과, 그 신호를 듣는 쪽이 권한으로 막히지
 * 않는 것이다. 한쪽만 고쳐지면 조용히 끊기는 자리라서 시험이 필요하다.
 */
function readLayoutSource(fileName: "NotificationBell.tsx" | "BrowserNotifications.tsx") {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

test("🔴 종이 펼쳐지면 다시 세라는 신호를 실제로 던진다", () => {
  const host = new EventTarget();
  const heard: string[] = [];
  host.addEventListener(NOTIFICATION_PANEL_OPENED_EVENT, (event) => heard.push(event.type));

  announceNotificationPanelOpened(host);
  assert.deepEqual(heard, [NOTIFICATION_PANEL_OPENED_EVENT], "종이 여는 신호를 보내지 않는다");
});

test("신호를 못 던지는 환경이어도 종은 그대로 쓴다", () => {
  assert.doesNotThrow(() =>
    announceNotificationPanelOpened({
      dispatchEvent() {
        throw new Error("창이 없다");
      },
    })
  );
});

test("🔴 그 신호는 **펼쳐진 순간**에만 나간다 — 묶음의 onOpen 에 물려 있다", () => {
  // 닫을 때는 보내지 않는다(다 봤다는 행동이라 서버를 두드릴 이유가 없다).
  // 「펼쳐진 순간만」을 가리는 일은 이제 묶음이 하고(그쪽 BellBehavior), 여기는
  // 그 자리에 신호를 물려 두었는지만 지킨다 — 다른 자리에 물리면 조용히 끊긴다.
  const source = readLayoutSource("NotificationBell.tsx");

  const calls = source.match(/announceNotificationPanelOpened\(/g) ?? [];
  assert.equal(calls.length, 2, "신호를 던지는 자리가 함수 정의와 그 부름 하나가 아니다");
  assert.match(
    source,
    /onOpen=\{\(\) => announceNotificationPanelOpened\(window\)\}/,
    "신호가 묶음의 onOpen 에 물려 있지 않다"
  );
});

test("🔴 종 열기 신호는 알림 권한과 무관하게 받는다 — 알림을 안 받는 사람도 종은 본다", () => {
  // 이 조건이 붙는 순간 알림을 안 받는 사람의 종은 다시 "새로고침해야 바뀌는"
  // 종으로 되돌아간다. 그 사람에게는 종이 새것을 아는 유일한 창구다.
  const source = readLayoutSource("BrowserNotifications.tsx");

  const listenIndex = source.indexOf("addEventListener(NOTIFICATION_PANEL_OPENED_EVENT");
  assert.ok(listenIndex > 0, "종에서 오는 신호를 듣는 자리가 없다");

  const effectStart = source.lastIndexOf("useEffect(", listenIndex);
  assert.ok(effectStart > 0, "듣는 자리가 효과 안에 있어야 한다");
  assert.ok(
    !source.slice(effectStart, listenIndex).includes("canNotify"),
    "종에서 오는 신호를 권한으로 막고 있다"
  );
});

test("🔴 신호 이름은 도메인에 한 번만 적힌다 — 두 파일에 각각 적으면 조용히 끊긴다", () => {
  for (const fileName of ["NotificationBell.tsx", "BrowserNotifications.tsx"] as const) {
    const source = readLayoutSource(fileName);
    assert.ok(source.includes("NOTIFICATION_PANEL_OPENED_EVENT"), `${fileName} 가 신호를 쓰지 않는다`);
    assert.ok(
      !source.includes(NOTIFICATION_PANEL_OPENED_EVENT),
      `${fileName} 에 신호 이름이 직접 적혀 있다 — 한쪽만 고치면 이어지지 않는다`
    );
  }
});

// ─────────────────────────── 눌러서 확인하는 알림 — 승인 완료 · 반려됨

test("승인 완료·반려됨도 화면을 고치지 않고 같은 한 줄로 그려진다 — 이름·대상·상세·링크", () => {
  const html = renderToStaticMarkup(<NotificationBell items={[grantedItem(), rejectedItem()]} />);
  assert.ok(html.includes(NOTIFICATION_KIND_META.APPROVAL_GRANTED.label));
  assert.ok(html.includes(NOTIFICATION_KIND_META.APPROVAL_REJECTED.label));
  assert.ok(html.includes('href="/repair-cases/case-9/approval"'));
  assert.ok(html.includes("최종 출하 승인 · 김결재"));
  // 🔵 반려 줄의 표본은 2026-10-27(13-C4)에 부품 불출 → 견적서로 바뀌었다
  //    (rejectedItem 주석). 재는 것은 「두 갈래가 각각 제 주소·제 글로 그려지는가」다.
  assert.ok(html.includes('href="/quotes/quote-9"'));
  assert.ok(html.includes("견적서 승인 · 사유: 금액 근거 보완 요망"));
});

/** 부른 기록을 남기는 가짜 확인 함수. `result` 를 넘기지 않으면 끝나지 않는 약속을 돌려준다. */
function fakeAcknowledge(result?: Promise<{ ok: boolean }>) {
  const calls: { notificationKey: string }[] = [];
  const acknowledge: AcknowledgeNotification = (input) => {
    calls.push(input);
    return result ?? new Promise(() => {});
  };
  return { acknowledge, calls };
}

test("🔴 눌러서 확인하는 줄에서만 확인을 부른다 — 할 일 줄에서는 부르지 않는다", () => {
  // 🔴 묶음은 **모든 줄에서** 확인 함수를 부른다(그쪽 README 「4. 눌러서
  // 확인하는 종류인가를 사이트가 가린다」). 이 판정이 사라지면 처리하지 않은
  // 할 일을 「확인」으로 숨기는 길이 열린다.
  for (const item of oneOfEachKind()) {
    const acknowledged: string[] = [];
    handleNotificationPicked(item, { onAcknowledge: (picked) => acknowledged.push(picked.id) });
    assert.deepEqual(
      acknowledged,
      isAcknowledgeableNotificationKind(item.kind) ? [item.id] : [],
      `${item.kind}: 확인을 부르는지가 도메인 판정과 다르다`
    );
  }
  // 대조 — 위 반복이 실제로 두 갈래를 다 지났다.
  assert.ok(oneOfEachKind().some((item) => isAcknowledgeableNotificationKind(item.kind)));
  assert.ok(oneOfEachKind().some((item) => !isAcknowledgeableNotificationKind(item.kind)));
});

test("🔴 묶음이 돌려주는 줄로도 같은 판정을 한다 — 옮겨 담아도 갈래가 바뀌지 않는다", () => {
  // 실제로 이 함수에 들어오는 것은 묶음의 NotificationBellItem 이다(옮겨 담은
  // 뒤의 모양). 원본으로만 시험하면 옮겨 담기가 kind 를 떨어뜨려도 못 잡는다.
  const items = oneOfEachKind();
  for (const [index, row] of toNotificationBellItems(items).entries()) {
    const acknowledged: string[] = [];
    handleNotificationPicked(row, { onAcknowledge: (picked) => acknowledged.push(picked.id) });
    assert.deepEqual(
      acknowledged,
      isAcknowledgeableNotificationKind(items[index].kind) ? [items[index].id] : [],
      `${items[index].kind}: 옮겨 담은 뒤 갈래가 달라졌다`
    );
  }
});

test("🔴 확인이 던져도 밖으로 새지 않는다 — 이동은 <a href> 가 하므로 막히면 안 된다", () => {
  assert.doesNotThrow(() =>
    handleNotificationPicked(grantedItem(), {
      onAcknowledge: () => {
        throw new Error("저장 실패");
      },
    })
  );
  // 확인 함수를 아예 안 넘긴 종도 조용히 지나간다(이동만 한다).
  assert.doesNotThrow(() => handleNotificationPicked(grantedItem(), {}));
});

test("🔴 확인 저장은 기다리지 않는다 — 끝나지 않는 저장이어도 줄은 곧바로 빠지고 돌아온다", () => {
  const { acknowledge, calls } = fakeAcknowledge();
  const hidden: string[] = [];
  const restored: string[] = [];
  acknowledgeInBackground(grantedItem(), acknowledge, {
    hide: (id) => hidden.push(id),
    restore: (id) => restored.push(id),
  });
  // 여기 닿았다는 것 자체가 기다리지 않았다는 뜻이다(약속은 영영 끝나지 않는다).
  assert.deepEqual(calls, [{ notificationKey: grantedItem().id }], "알림 id 를 그대로 키로 보낸다");
  assert.deepEqual(hidden, [grantedItem().id], "저장 결과를 기다리지 않고 먼저 뺀다");
  assert.deepEqual(restored, []);
});

test("🔴 확인 저장이 실패하면 그 줄이 다시 나타난다 — 성공하면 빠진 채로 남는다", async () => {
  const outcomes: { label: string; run: AcknowledgeNotification; restoredExpected: boolean }[] = [
    { label: "성공", run: async () => ({ ok: true }), restoredExpected: false },
    { label: "거절(ok:false)", run: async () => ({ ok: false }), restoredExpected: true },
    { label: "약속이 깨짐", run: () => Promise.reject(new Error("network")), restoredExpected: true },
    {
      label: "곧바로 던짐",
      run: () => {
        throw new Error("sync");
      },
      restoredExpected: true,
    },
  ];
  for (const outcome of outcomes) {
    const restored: string[] = [];
    acknowledgeInBackground(rejectedItem(), outcome.run, {
      hide: () => {},
      restore: (id) => restored.push(id),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(restored, outcome.restoredExpected ? [rejectedItem().id] : [], outcome.label);
  }
});

test("확인 함수를 받아도 첫 화면의 배지는 서버가 준 목록 그대로 센다", () => {
  const { acknowledge } = fakeAcknowledge();
  const html = renderToStaticMarkup(
    <NotificationBell items={[grantedItem(), rejectedItem()]} acknowledge={acknowledge} />
  );
  assert.ok(html.includes(">알림 2건</span>"), "결재 결과는 사건 단위로 센다");
});

test("🔴 확인할지 가르는 자리는 도메인 판정 한 곳이다 — 화면은 서버 액션을 직접 가져오지 않는다", () => {
  const source = readLayoutSource("NotificationBell.tsx");
  const judgments = source.match(/isAcknowledgeableNotificationKind\(/g) ?? [];
  assert.equal(judgments.length, 1, "확인 판정을 부르는 자리가 하나가 아니다");
  assert.ok(
    source.includes('from "@/lib/domain/notification-acknowledgement"'),
    "판정은 도메인에서 가져온다"
  );
  // 서버 액션 파일을 가져오면 server-only 사슬 때문에 이 시험 파일부터 죽는다 —
  // 확인 함수는 프롭으로 받는다(AcknowledgeNotification).
  assert.ok(!source.includes("@/lib/server/actions/"), "화면이 서버 액션을 직접 가져온다");
  // 이동을 붙잡는 await 가 확인 경로에 없다.
  const pickedStart = source.indexOf("export function handleNotificationPicked(");
  const backgroundStart = source.indexOf("export function acknowledgeInBackground(");
  const noticeStart = source.indexOf("export function BrowserNotificationNotice(");
  assert.ok(pickedStart > 0 && backgroundStart > pickedStart && noticeStart > backgroundStart, "함수 순서가 바뀌었다");
  assert.ok(!/\bawait\b/.test(source.slice(pickedStart, noticeStart)), "확인 경로가 저장을 기다린다");
});

test("🔴 헤더(TopBar)가 종에 확인 서버 액션을 실제로 넘긴다 — 빠지면 눌러도 알림이 사라지지 않는다", () => {
  // 종은 서버 액션을 직접 가져오지 않고 프롭으로 받는다(위 시험). 그래서 넘기는 쪽이
  // 빠지면 아무 오류 없이 「눌러도 안 사라지는 알림」이 된다 — 화면에 흔적이 남지 않는
  // 실패라 원본으로 붙잡는다. TopBar 는 server-only 사슬을 물고 있어 정적 렌더로는
  // 가져올 수 없다.
  const source = readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8");

  assert.match(
    source,
    /import \{[^}]*\backnowledgeNotificationAction\b[^}]*\} from "@\/lib\/server\/actions\/notification-acknowledgements"/,
    "TopBar 가 확인 서버 액션을 가져오지 않는다"
  );
  const bells = source.match(/<NotificationBell\b[^>]*>/g) ?? [];
  assert.equal(bells.length, 1, "TopBar 가 그리는 종이 하나가 아니다 — 아래 단언이 엉뚱한 종을 볼 수 있다");
  assert.match(bells[0], /\backnowledge=\{acknowledgeNotificationAction\}/, "종에 확인 액션을 넘기지 않는다");
});

// ───────────────────── 다른 시스템들의 알림(포털이 모아 준 것)을 이어 붙인다

/**
 * 포털을 거쳐 온 한 줄. 🔴 A/S 자신의 줄과 갈라지는 칸이 `sourceId` 다 —
 * 자기 알림은 빈 문자열이고(notification-bell-items.ts) 여기는 값이 있다.
 */
function portalRow(overrides: Partial<NotificationBellItem> = {}): NotificationBellItem {
  return {
    key: "dss-improvements:IMPROVEMENT:7",
    sourceId: "dss-improvements",
    sourceName: "DSS 개선요청",
    id: "IMPROVEMENT:7",
    kind: "IMPROVEMENT",
    kindLabel: "검토 대기",
    subject: "IMP-2026-0031",
    detail: "검토를 기다리고 있습니다.",
    href: "http://192.168.1.132:3300/improvements/7",
    ...overrides,
  };
}

test("🔴 자기 알림이 앞, 포털에서 온 것이 뒤 — 차례가 섞이지 않는다", () => {
  const mine = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()];
  const received = [
    portalRow(),
    portalRow({ key: "njlee:CAL:3", sourceId: "njlee", sourceName: "DSS 계측기", subject: "NJ-3" }),
  ];
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={mine}
      inbox={{ items: received, count: 2, degraded: false, dismissed: [], acknowledged: [] }}
    />
  );

  const order = [
    "D9705-012",
    grantedItem().subject,
    "IMP-2026-0031",
    "NJ-3",
  ].map((needle) => ({ needle, at: html.indexOf(needle) }));
  for (const { needle, at } of order) {
    assert.ok(at > 0, `${needle} 이 목록에 없다`);
  }
  assert.deepEqual(
    [...order].sort((left, right) => left.at - right.at).map((one) => one.needle),
    order.map((one) => one.needle),
    "자기 것과 받은 것의 차례가 섞였다"
  );
  // 받은 줄에는 어느 시스템에서 왔는지가 보인다 — 자기 줄에는 그 칸이 없다.
  assert.ok(html.includes("DSS 개선요청"), "받은 줄에 시스템 이름이 없다");
  assert.ok(html.includes("DSS 계측기"));
});

test("🔴 배지는 자기 개수 + 받은 개수다 — 받은 값을 다시 세지 않는다", () => {
  // 받은 줄은 둘인데 포털이 센 값은 7 이다(세는 규칙이 시스템마다 다르다).
  // 배지는 자기 1건 + 7 = 8 이어야 한다 — 줄 수(2)로 다시 세면 3이 된다.
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]}
      inbox={{
        items: [portalRow(), portalRow({ key: "x:1" })],
        count: 7,
        degraded: false,
        dismissed: [],
        acknowledged: [],
      }}
    />
  );
  assert.ok(html.includes(">알림 8건</span>"), "배지가 자기 개수 + 받은 개수가 아니다");
});

test("자기 알림이 없어도 받은 것만으로 배지가 선다 — 반대도 같다", () => {
  const onlyReceived = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[]}
      inbox={{ items: [portalRow()], count: 3, degraded: false, dismissed: [], acknowledged: [] }}
    />
  );
  assert.ok(onlyReceived.includes(">알림 3건</span>"));
  assert.ok(onlyReceived.includes("IMP-2026-0031"));

  const onlyMine = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[grantedItem()]}
      inbox={{ items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] }}
    />
  );
  assert.ok(onlyMine.includes(">알림 1건</span>"));
});

test("🔴 포털에서 온 줄에서는 **A/S 의** 확인을 부르지 않는다 — 남의 id 로 우리 표를 적으면 안 된다", () => {
  // 「확인했다」를 **A/S 의 표**에 적을 수 있는 것은 A/S 가 만든 알림뿐이다.
  // 🔴 묶음은 **모든 줄에서** 확인 함수를 부르므로, 이 갈래가 없으면
  // `IMPROVEMENT:7` 같은 남의 id 로 A/S 에 확인 기록이 쌓인다.
  // 🔵 2026-10-22 부터 포털 줄의 확인은 **포털**에 적힌다(handlePortalRowPicked)
  //    — 길이 생긴 것이지 이 가드가 풀린 것이 아니다.
  for (const kind of NOTIFICATION_KINDS) {
    // 최악의 경우 — 종류 코드까지 A/S 의 「눌러서 확인하는」 종류와 같을 때.
    const acknowledged: string[] = [];
    handleNotificationPicked(portalRow({ kind }), {
      onAcknowledge: (picked) => acknowledged.push(picked.id),
    });
    assert.deepEqual(acknowledged, [], `${kind}: 포털에서 온 줄로 확인을 불렀다`);
  }

  // 대조 — 같은 종류라도 자기 줄(sourceId 가 빈 문자열)에서는 부른다.
  const mine: string[] = [];
  handleNotificationPicked(toNotificationBellItems([grantedItem()])[0], {
    onAcknowledge: (picked) => mine.push(picked.id),
  });
  assert.deepEqual(mine, [grantedItem().id], "자기 줄에서 확인이 사라졌다");
});

test("🔴 머리말은 포털을 기다리지 않는다 — 끝나지 않는 약속이어도 자기 알림은 곧바로 그려진다", () => {
  // 이 자리에 `await`(또는 use() + Suspense)가 있었다면 이 렌더는 목록 대신
  // 빈 것을 내놓거나 아예 돌아오지 못한다. 그림이 나온다는 것 자체가 단언이다.
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]}
      portalInbox={new Promise(() => {})}
    />
  );

  assert.ok(html.includes("D9705-012"), "자기 알림이 포털을 기다리느라 안 그려졌다");
  assert.ok(html.includes(">알림 1건</span>"), "배지가 포털을 기다린다");
  // 🔴 종이 **통째로** 늦게 뜨는 것이 아니다(Suspense fallback 으로 대체되지
  //    않았다) — 그 건의 화면으로 가는 줄이 마크업에 그대로 있다.
  assert.ok(html.includes('href="/repair-cases/case-1/approval"'), "종이 빈 자리로 대체됐다");
  assert.ok(!html.includes("처리할 알림이 없습니다."), "알림이 있는데 빈 칸 문구가 나왔다");
});

test("포털 목록을 안 넘기면 예전과 똑같은 종이다 — 데모 모드 · 포털에 이어지지 않은 계정", () => {
  const withoutInbox = renderToStaticMarkup(<NotificationBell items={[grantedItem()]} />);
  const withEmptyInbox = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[grantedItem()]}
      inbox={{ items: [], count: 0, degraded: true, dismissed: [], acknowledged: [] }}
    />
  );
  assert.equal(withoutInbox, withEmptyInbox, "포털을 못 물어본 종이 예전 종과 다르게 그려졌다");
});

test("🔴 포털 줄의 그릴 수 없는 주소는 **그 줄만** 빠진다", () => {
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[grantedItem()]}
      inbox={{
        items: [portalRow({ href: "javascript:alert(1)" }), portalRow({ key: "ok:1", subject: "NJ-9" })],
        count: 2,
        degraded: false,
        dismissed: [],
        acknowledged: [],
      }}
    />
  );

  assert.ok(!html.includes("javascript:"), "그릴 수 없는 주소가 마크업에 실렸다");
  assert.ok(!html.includes("IMP-2026-0031"), "그 줄이 빠지지 않았다");
  assert.ok(html.includes("NJ-9"), "다른 줄까지 사라졌다");
  assert.ok(html.includes(grantedItem().subject), "자기 줄까지 사라졌다");
});

test("🔴 약속을 여기까지 지나 보내는 길이 이어져 있다 — layout → AppShell → TopBar → 종", () => {
  // 이 사슬 어디가 끊겨도 화면에는 흔적이 없다: 종은 자기 알림만 그리고 아무
  // 오류도 나지 않는다(포털을 못 물어본 것과 구분되지 않는다). 그래서 원본으로
  // 붙잡는다 — 이 파일들은 server-only 사슬을 물고 있어 정적 렌더로 가져올 수 없다.
  const layout = readFileSync(new URL("../../app/(app)/layout.tsx", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const topBar = readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8");

  assert.match(
    layout,
    /const portalInbox = portalSubject \? fetchPortalNotificationInbox\(portalSubject\) : undefined;/,
    "레이아웃이 포털에 묻지 않는다"
  );
  // 🔴 여기에 await 가 붙는 순간 **모든 화면 이동**이 포털 왕복만큼 느려진다.
  assert.ok(
    !/await\s+fetchPortalNotificationInbox/.test(layout),
    "레이아웃이 포털을 기다린다 — 모든 화면이 그만큼 느려진다"
  );
  assert.match(layout, /portalInbox=\{portalInbox\}/, "레이아웃이 껍데기에 넘기지 않는다");

  for (const [name, source] of [
    ["AppShell", appShell],
    ["TopBar", topBar],
  ] as const) {
    assert.match(source, /portalInbox\?: Promise<unknown>;/, `${name} 이 약속을 받지 않는다`);
    assert.match(source, /portalInbox,/, `${name} 이 약속을 꺼내지 않는다`);
    assert.match(source, /portalInbox=\{portalInbox\}/, `${name} 이 약속을 지나 보내지 않는다`);
  }

  // 종이 실제로 받는 자리 — 위 시험이 TopBar 의 종을 하나로 못 박아 두었다.
  const bells = topBar.match(/<NotificationBell\b[^>]*>/g) ?? [];
  assert.equal(bells.length, 1);
  assert.match(bells[0], /portalInbox=\{portalInbox\}/, "종에 약속을 넘기지 않는다");
});

test("🔴 종은 포털 목록을 값으로도, 약속으로도 **다시 묻지 않는다** — 되풀이 장치가 없다", () => {
  // 포털이 30초 캐시를 들고 있어 더 자주 물으면 같은 답을 받는다. 그 장치를
  // 붙이는 순간 브라우저에서 부를 중계 통로가 필요해지고, 그것은 시크릿을
  // 다루는 자리를 하나 더 만드는 일이다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.ok(!source.includes("setInterval"), "종에 되풀이 장치가 생겼다");
  assert.ok(!source.includes("setTimeout"), "종에 되풀이 장치가 생겼다");
  // 포털 주소를 종이 알아서는 안 된다 — 부르는 자리는 서버 하나뿐이다.
  assert.ok(!source.includes("/api/integration/"), "종이 포털을 직접 부른다");
  assert.ok(!source.includes("fetch("), "종이 직접 망을 탄다");
});

// ─────────────────── 종에서 알림 **지우기**(2026-10-20부터 적히는 곳은 포털)

/**
 * 🔴 확인 기록(A/S 의 표 · 영구)과 **다른 것**이다. 여기가 지키는 선:
 *  1. 지우는 **서버 액션**을 안 넘기면 **예전 종 그대로**다(적을 곳을 모르는
 *     채 단추만 서면 눌러도 아무 일이 없다).
 *  2. 단추는 **보이는 줄 전부**에 선다(2026-10-20부터 — 종류를 가리지 않는다).
 *  3. 🔴 **✕ 만 지움이다.** 줄을 **누르는 것**은 2026-10-22 부터 지움이 아니라
 *     확인으로 간다(위 handlePortalRowPicked). 둘을 섞지 마라 — 지움은
 *     재로그인하면 돌아오고 확인은 안 돌아온다.
 *  4. 지운 줄은 목록에서도 **배지에서도** 빠진다.
 */

/**
 * 종이 받는 「지움을 포털에 적는 서버 액션」의 가짜.
 *
 * 🔴 **사람을 가리키는 칸이 없다** — 누구의 지움인지는 서버가 제 세션에서 다시
 * 읽는다(server/actions/notification-dismissals.ts). 한때 이 자리에 있던
 * `notificationDismissal={{ userId, issuedAt }}` 은 localStorage 어느 칸에 적을지
 * 가르는 값이었고, 지움이 포털로 옮겨 가면서 통째로 걷혔다.
 */
function 지움(적힌것: string[] = []) {
  return async ({ keys }: { keys: string[] }) => {
    적힌것.push(...keys);
  };
}

/** 지우기 단추들의 열쇠를 차례대로. 줄의 링크가 가진 같은 이름의 칸과 섞이지 않는다. */
function 지우기열쇠들(html: string): string[] {
  return [
    ...html.matchAll(/<button[^>]*class="dss-bell__dismiss"[^>]*data-notification-key="([^"]*)"/g),
  ].map((m) => m[1]);
}

test("🔴 지우는 서버 액션을 안 넘기면 지우기가 아예 없다 — 예전 종과 한 글자도 다르지 않다", () => {
  // 적는 길(포털로 가는 서버 액션)은 머리말(TopBar)이 건넨다. 못 받았으면 단추를
  // 그리지 않는다 — 눌러도 아무 일이 없는 단추가 줄마다 서는 것이 더 나쁘다.
  const 예전 = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  assert.ok(!예전.includes("dss-bell__dismiss"), "지우기 단추가 그려졌다");
  assert.ok(!예전.includes("보이는 알림 지우기"), "일괄 지우기가 그려졌다");
  assert.ok(!예전.includes("<button"), "스크립트 없이 못 쓰는 종이 되었다");
});

test("🔴 지우기 단추는 **8종류 전부**에 선다 — 할 일 알림에도(2026-10-20)", () => {
  // 가리는 규칙은 도메인 한 곳이고(canDismissNotification) 화면은 그것을 묶음에
  // 넘기기만 한다. 옛 규칙은 결재 결과 둘에만 ✕ 를 세웠는데, 같은 줄이 포털을
  // 거쳐 간 다른 사이트에서는 이미 전부 지워지고 있었다 — A/S 안에서만 막혀
  // 헷갈리기만 했다(도메인 쪽 주석).
  const mine = oneOfEachKind();
  assert.equal(mine.length, NOTIFICATION_KINDS.length, "종류마다 한 줄씩이 아니다 — 일부만 본다");

  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={mine}
      inbox={{ items: [portalRow()], count: 1, degraded: false, dismissed: [], acknowledged: [] }}
      dismiss={지움()}
    />
  );

  assert.deepEqual(
    지우기열쇠들(html),
    [...mine.map((item) => item.id), portalRow().key],
    "✕ 가 서는 줄이 도메인 판정과 다르다 — 종류를 가리는 자리가 되살아났다"
  );
  // 🔴 대조 — **옛 규칙이 막던 할 일 줄에도** 실제로 단추가 섰다. 이것이 없으면
  //    종류가 전부 「눌러서 확인하는」 것이 되는 날 위 단언이 공짜로 통과한다.
  const 옛날에막히던줄 = mine.filter((item) => !isAcknowledgeableNotificationKind(item.kind));
  assert.ok(옛날에막히던줄.length > 0, "할 일 줄이 하나도 없다 — 이 시험이 아무것도 안 본다");
  for (const item of 옛날에막히던줄) {
    assert.ok(지우기열쇠들(html).includes(item.id), `${item.kind}: 할 일 줄에 ✕ 가 안 섰다`);
  }
  assert.ok(mine.every((item) => canDismissNotification({ kind: item.kind, sourceId: "" })));
});

test("🔴 포털 줄은 **종류를 가리지 않고** 지울 수 있다 — 저쪽 이름을 박아 두지 않았다", () => {
  for (const kind of NOTIFICATION_KINDS) {
    // 최악의 경우 — 종류 코드까지 A/S 의 할 일 알림과 같을 때.
    const html = renderToStaticMarkup(
      <NotificationBellWithInbox
        items={[]}
        inbox={{ items: [portalRow({ kind })], count: 1, degraded: false, dismissed: [], acknowledged: [] }}
        dismiss={지움()}
      />
    );
    assert.deepEqual(지우기열쇠들(html), [portalRow().key], `${kind}: 남의 줄을 못 지운다`);
  }
});

/* ─────────── 일괄 지우기는 **묶음 것**이다(2026-10-20, 조각 B-3) ───────────
 *
 * 🔴 이 단추는 A/S 가 손수 지어 footer 안에 넣고 있었다(NotificationDismissAll).
 * 묶음이 자리를 내주면서(`onDismissAll` — dss-ui 1210d11) 단추·글자·적히는 수가
 * 전부 묶음 것이 됐고, A/S 는 함수만 넘긴다. 여기가 지키는 선은 둘이다 —
 * **단추가 하나만 설 것**(제 것을 안 걷으면 둘이 된다)과, **적히는 수가 그려지는
 * 줄 수와 같을 것**.
 */

/** 묶음이 그린 일괄 단추의 글자. 단추가 없으면 null. */
function 일괄글자(html: string): string | null {
  return /<button[^>]*class="dss-bell__dismissall"[^>]*>([^<]*)</.exec(html)?.[1] ?? null;
}

/** 줄의 링크들이 가진 열쇠 — 곧 **실제로 그려진 줄**. */
function 그려진줄열쇠들(html: string): string[] {
  return [
    ...html.matchAll(/<a[^>]*class="dss-bell__link"[^>]*data-notification-key="([^"]*)"/g),
  ].map((m) => m[1]);
}

test("🔴 일괄 지우기 단추는 **하나뿐**이다 — A/S 가 제 것을 걷어냈다", () => {
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={oneOfEachKind()}
      inbox={{ items: [portalRow()], count: 1, degraded: false, dismissed: [], acknowledged: [] }}
      dismiss={지움()}
    />
  );

  // 🔴 묶음 것이 footer **위**에 서므로, A/S 가 제 단추를 남겨 두면 같은 글자가
  //    두 번 나온다. 눈으로는 「단추가 둘」로 보이고 시험으로는 이 수로 보인다.
  assert.equal(
    (html.match(/보이는 알림 지우기/g) ?? []).length,
    1,
    "🔴 일괄 지우기 단추가 둘이다 — A/S 가 제 것을 안 걷었다"
  );
  // 그 하나는 **묶음 것**이다(A/S 가 짓던 단추에는 이 클래스가 없었다).
  assert.equal(
    (html.match(/class="dss-bell__dismissall"/g) ?? []).length,
    1,
    "묶음이 그린 단추가 아니다 — A/S 가 다시 제 단추를 짓고 있다"
  );
  // 🔴 A/S 쪽 소스에서도 단추가 사라졌다 — 마크업만 보면 조건이 거짓이라
  //    안 그려졌을 뿐인 상태를 통과시킨다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.ok(
    !/<button[\s\S]{0,200}보이는 알림 지우기/.test(source),
    "🔴 A/S 가 일괄 지우기 단추를 다시 짓고 있다"
  );
  assert.match(
    source,
    /onDismissAll=\{canDismissHere/,
    "묶음에 일괄 지우기를 안 넘긴다 — 일곱 중 혼자 그 기능이 없어진다"
  );
});

test("🔴 단추에 적히는 수가 **그려지는 줄 수**와 같다", () => {
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={oneOfEachKind()}
      inbox={{ items: [portalRow()], count: 1, degraded: false, dismissed: [], acknowledged: [] }}
      dismiss={지움()}
    />
  );

  // 🔴 자기 줄 **전부**(종류마다 하나) + 포털 한 줄. 옛 규칙에서는 결재 결과
  //    둘 + 포털 하나 = 3 이었다. 수를 글자로 박지 않고 종류 수에서 뽑으므로
  //    종류가 늘어도 따라온다.
  assert.equal(일괄글자(html), `보이는 알림 지우기 ${NOTIFICATION_KINDS.length + 1}건`);
  // 🔴 그리고 그 수는 **실제로 그려진 줄 수**다. 글자만 맞추면 목록이 달라지는
  //    날 조용히 어긋난다.
  assert.equal(그려진줄열쇠들(html).length, NOTIFICATION_KINDS.length + 1);

  // 🔴 묶음은 **그릴 수 없는 주소의 줄을 안 그리고** 수에서도 뺀다. A/S 도 같은
  //    기준으로 걸러야 한다 — 안 그러면 「n건」을 눌렀는데 n+1 건이 나간다
  //    (보이지도 않은 줄이 말없이 지워진다).
  const 적힌것: string[] = [];
  const 나쁜줄 = portalRow({ key: "njlee:CAL:9", href: "javascript:alert(1)" });
  const 섞인종 = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[]}
      inbox={{ items: [portalRow(), 나쁜줄], count: 2, degraded: false, dismissed: [], acknowledged: [] }}
      dismiss={지움(적힌것)}
    />
  );
  assert.deepEqual(그려진줄열쇠들(섞인종), [portalRow().key], "못 그릴 줄이 그려졌다");
  assert.equal(일괄글자(섞인종), "보이는 알림 지우기 1건");

  // 눌렀을 때 실제로 나가는 열쇠도 그 한 줄뿐이다.
  const keys = dismissableNotificationKeys(
    [portalRow(), 나쁜줄].filter((item) => isSafeNotificationHref(item.href))
  );
  assert.deepEqual(keys, [portalRow().key], "🔴 안 보이는 줄까지 지우려 한다");
  assert.deepEqual(적힌것, [], "그리기만 했는데 지움이 적혔다");

  // 🔴 **마크업으로는 못 보는 선**이라 소스로 못 박는다. 나가는 열쇠가 어디서
  //    모이는지는 정적 렌더에 흔적이 남지 않는다 — 수가 어긋나도 화면은 멀쩡하고
  //    「3건을 눌렀는데 4건이 사라졌다」로만 드러난다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.match(
    source,
    /import \{ NotificationBell as SharedNotificationBell, isSafeNotificationHref \} from "@dss\/ui";/,
    "거르는 함수를 묶음에서 가져오지 않았다 — 같은 판정을 두 벌로 적으면 갈라진다"
  );
  assert.match(
    source,
    /const drawableItems = bellItems\.filter\(\(item\) => isSafeNotificationHref\(item\.href\)\);/,
    "🔴 묶음과 같은 기준으로 거르지 않는다"
  );
  assert.match(source, /dismissableNotificationKeys\(drawableItems\)/);
  assert.ok(
    !/dismissableNotificationKeys\(bellItems\)/.test(source),
    "🔴 거르기 전 목록(bellItems)을 그대로 집는다 — 안 보이는 줄까지 나간다"
  );
});

test("보이는 줄이 없으면 일괄 지우기를 그리지 않는다 — 눌러도 아무 일 없는 단추를 안 남긴다", () => {
  const 빈종 = renderToStaticMarkup(<NotificationBell items={[]} dismiss={지움()} />);
  assert.equal(일괄글자(빈종), null);
  assert.ok(!빈종.includes("보이는 알림 지우기"));
  assert.deepEqual(지우기열쇠들(빈종), []);
  // 🔴 설명만 남아서도 안 된다 — 없는 단추를 설명하는 글이 된다.
  assert.ok(!빈종.includes("사내 시스템 전체의 종에서 사라집니다"));

  // 🔴 반대쪽 — 줄이 **할 일 하나뿐**이어도 둘 다 선다. 옛 규칙에서는 이 종이
  //    「지울 것이 없는 종」이었다(여기가 그 뒤집힌 자리다).
  const 할일하나 = approval("case-1", "D9705-012", "REPAIR_INSPECTION");
  const 할일만 = renderToStaticMarkup(
    <NotificationBell items={[할일하나]} dismiss={지움()} />
  );
  assert.ok(!isAcknowledgeableNotificationKind(할일하나.kind), "표본이 할 일 줄이 아니다");
  assert.equal(일괄글자(할일만), "보이는 알림 지우기 1건", "할 일 줄 하나를 세지 않았다");
  assert.deepEqual(지우기열쇠들(할일만), [할일하나.id], "할 일 줄에 ✕ 가 안 섰다");
});

test("🔴 지울 곳을 모르는 종에는 일괄 단추도 설명도 없다 — 예전 종 그대로다", () => {
  // 적는 길(포털로 가는 서버 액션)을 못 받았으면 묶음에 onDismissAll 을 안
  // 넘긴다 = 묶음이 단추를 아예 안 그린다(그쪽 README).
  const html = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  assert.equal(일괄글자(html), null);
  assert.ok(!html.includes("사내 시스템 전체의 종에서 사라집니다"));
  // 🔴 줄은 그대로 그려진다 — 사라진 것은 지우는 길뿐이다.
  assert.equal(그려진줄열쇠들(html).length, NOTIFICATION_KINDS.length);
});

test("🔴 안내 문구는 footer 에 남았다 — 묶음은 「지운다」의 뜻을 모른다", () => {
  // 묶음이 그리는 것은 단추와 「보이는 알림 지우기 n건」뿐이다. 「사내 시스템
  // 전체의 종에서 사라집니다 / 끝나지 않은 일 자체는 그대로 남습니다」는 이
  // 시스템의 사정이라 A/S 가 제 자리(footer)에서 그린다.
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox items={oneOfEachKind()} dismiss={지움()} />
  );

  const 단추 = html.indexOf("dss-bell__dismissall");
  const 안내 = html.indexOf("사내 시스템 전체의 종에서 사라집니다");
  const 자리 = html.indexOf("dss-bell__footer");
  assert.ok(단추 > 0 && 안내 > 0 && 자리 > 0);
  assert.ok(단추 < 자리, "🔴 묶음 단추가 footer 위에 서지 않았다");
  assert.ok(안내 > 자리, "안내가 footer 밖에 있다");
  assert.ok(안내 < html.indexOf("</ul>"), "그 자리가 펼친 칸 밖으로 나갔다");
  // 🔵 footer 안의 차례(안내가 맨 위)는 아래 조각 시험이 본다 — 정적 렌더에서는
  //    기기 설정 쪽 둘이 「모르는 상태」라 그려지지 않는다.

  // 조각 자신도 같은 판단을 한다 — 단추가 없는 종에서는 아무것도 안 그린다.
  assert.equal(renderToStaticMarkup(<DismissAllNotice show={false} />), "");
  assert.ok(
    renderToStaticMarkup(<DismissAllNotice show />).includes("아직 끝나지 않은 일 자체는")
  );
  // 🔴 설명만 하고 **누르는 것은 없다** — 단추는 묶음 것 하나뿐이다.
  assert.ok(!renderToStaticMarkup(<DismissAllNotice show />).includes("<button"));
});

test("🔴 footer 의 안내를 안 넘기면 예전 그대로다 — 이미 있던 호출부가 흔들리지 않는다", () => {
  const 예전 = renderToStaticMarkup(
    <NotificationBellFooter status="GRANTED" onAsk={() => {}} onTest={() => {}} selfTestResult={null} />
  );

  assert.ok(!예전.includes("사내 시스템 전체의 종에서 사라집니다"));
  assert.ok(예전.includes("시험 알림"), "원래 있던 것이 사라졌다");

  // 넘기면 그 말이 **시험 알림 위**에 붙는다.
  const 켠것 = renderToStaticMarkup(
    <NotificationBellFooter
      status="GRANTED"
      onAsk={() => {}}
      onTest={() => {}}
      selfTestResult={null}
      showDismissAllNotice
    />
  );
  assert.ok(
    켠것.indexOf("사내 시스템 전체의 종에서 사라집니다") < 켠것.indexOf("시험 알림")
  );
});

test("🔴 줄을 누르면 **포털 줄만** 포털에 **확인**으로 적는다 — 자기 줄은 그 길로 가지 않는다", () => {
  // 🔴 2026-10-22 에 뒤집힌 단언이다. 그 전까지 이 길은 **지움**이었다 — 포털
  //    줄은 A/S 가 「확인했다」를 적을 데가 없어(그 통로가 포털에 없었다) 눌러
  //    본 뒤에도 영영 종에 남던 유일한 줄이었고, 그래서 누른 것만으로 치웠다.
  //    포털이 그 통로를 열면서 전제가 사라졌다(규격서의 「acknowledged」절).
  //    정보 확인용 줄은 이제 **영영** 빠지고, 결재 승인·부품 요청처럼 동작이
  //    필요한 줄은 확인을 적어도 **해소될 때까지 남는다**(포털이 판단한다).
  for (const kind of NOTIFICATION_KINDS) {
    const 확인한것: string[] = [];
    handlePortalRowPicked(portalRow({ kind }), { onAcknowledge: (key) => 확인한것.push(key) });
    assert.deepEqual(확인한것, [portalRow().key], `${kind}: 포털 줄의 확인을 안 적었다`);
  }

  // 🔴 넘어가는 것은 **열쇠**(`client_id:id`)다 — 포털은 그 모양으로만 제 목록에서
  //    줄을 찾는다. `id` 만 보내면 아무 오류 없이 조용히 버려진다(dropped).
  const 열쇠 = portalRow().key;
  assert.notEqual(열쇠, portalRow().id, "표본이 열쇠와 id 를 못 가른다 — 이 단언이 헛돈다");

  // 🔴 자기 줄은 여기서 끝난다 — 그 줄의 확인은 이미 **A/S 의 표**로 가고 있다.
  //    같은 누름을 포털에도 적으면 같은 일이 두 곳에 적혀 어느 쪽이 참인지 알 수
  //    없게 된다.
  for (const item of toNotificationBellItems(oneOfEachKind())) {
    const 확인한것: string[] = [];
    handlePortalRowPicked(item, { onAcknowledge: (key) => 확인한것.push(key) });
    assert.deepEqual(확인한것, [], "자기 줄이 포털 확인 길로 갔다");
  }

  // 던져도 새지 않고, 적을 곳이 없으면 조용히 지나간다(이동을 막으면 안 된다).
  assert.doesNotThrow(() =>
    handlePortalRowPicked(portalRow(), {
      onAcknowledge: () => {
        throw new Error("망이 끊겼다");
      },
    })
  );
  assert.doesNotThrow(() => handlePortalRowPicked(portalRow(), {}));
});

test("🔴 포털 줄을 **A/S 의 표**에 적는 길은 그대로 막혀 있다 — 포털 확인 길과 다르다", () => {
  // 🔴 **이 단언의 뜻은 2026-10-22 에도 그대로다.** 포털 줄이 확인으로 적히게
  //    바뀐 것은 **포털 쪽** 길이고, A/S 의 표(notification_acknowledgements)로
  //    가는 길은 여전히 막혀 있어야 한다. 풀리면 남의 시스템 알림 id 로 우리
  //    표가 쌓인다 — 아무 오류도 없이, 그 줄은 남은 채.
  const 확인한것: string[] = [];
  handleNotificationPicked(portalRow(), { onAcknowledge: (picked) => 확인한것.push(picked.id) });
  assert.deepEqual(확인한것, [], "포털 줄이 A/S 표 길로 들어갔다");

  // 🔴 **두 길을 한 번에** — 묶음은 모든 줄에서 한 번 부르므로, 실제 누름처럼
  //    둘 다 불러 본다. 포털 줄이면 포털 쪽만, 자기 줄이면 A/S 표 쪽만 일해야
  //    한다. 한쪽이라도 새면 같은 누름이 두 곳에 적힌다.
  for (const [이름, item] of [
    ["포털 줄", portalRow()],
    ["자기 줄", toNotificationBellItems([grantedItem()])[0]],
  ] as const) {
    const AS표: string[] = [];
    const 포털: string[] = [];
    handleNotificationPicked(item, { onAcknowledge: (picked) => AS표.push(picked.id) });
    handlePortalRowPicked(item, { onAcknowledge: (key) => 포털.push(key) });

    if (이름 === "포털 줄") {
      assert.deepEqual(AS표, [], "포털 줄이 A/S 표에도 적혔다");
      assert.deepEqual(포털, [item.key]);
    } else {
      assert.deepEqual(AS표, [item.id], "자기 줄이 A/S 표에 안 적혔다");
      assert.deepEqual(포털, [], "자기 줄이 포털로 샜다");
    }
  }

  const source = readLayoutSource("NotificationBell.tsx");
  assert.match(source, /if \(item\.sourceId\) return;/, "A/S 표 쪽 가드가 사라졌다");
  // 🔴 종은 어느 표에도 직접 적지 않는다 — 두 길 다 **받은 함수**로만 나간다.
  assert.ok(
    !/from "@\/lib\/server\//.test(source) && !/from "@\/lib\/db\//.test(source),
    "종이 서버·DB 모듈을 직접 가져왔다"
  );
  // 지우는 규칙은 **도메인 한 곳**에서 가져온다 — 화면이 종류를 보지 않는다.
  assert.ok(
    source.includes('from "@/lib/domain/notification-dismissal"'),
    "가리는 규칙이 화면 안으로 들어왔다"
  );
});

test("🔴 줄을 누르는 길에 **지움이 한 글자도 없다** — 동작이 필요한 줄이 숨으면 안 된다", () => {
  // 🔴 2026-10-22 요구 ②. 포털 줄을 확인과 **함께** 지움으로도 적으면, 결재
  //    승인·부품 요청처럼 해소될 때까지 남아야 하는 줄이 눌린 순간 종에서
  //    사라진다(포털은 그런 줄을 확인해도 일부러 남겨 둔다). 확인 저장이
  //    실패했을 때 되살아나야 할 줄이 지움 때문에 그대로 숨기도 한다.
  const 지운것: string[] = [];
  const 확인한것: string[] = [];
  // 🔴 걷어낸 칸(`onDismiss`)을 일부러 함께 끼워 넣는다 — 되살아나면 여기서 잡힌다.
  //    글자로 쓰면 칸 이름이 바뀌는 날 조용히 통과하므로 **값으로** 본다.
  const 양쪽: Record<string, (key: string) => void> = {
    onAcknowledge: (key) => 확인한것.push(key),
    onDismiss: (key) => 지운것.push(key),
  };
  handlePortalRowPicked(portalRow(), 양쪽);
  assert.deepEqual(지운것, [], "🔴 누르는 길이 아직 지움을 부른다");
  assert.deepEqual(확인한것, [portalRow().key]);

  // 🔴 묶음에 물린 **누름 처리 안**에도 지움이 없어야 한다. 함수만 고치고 호출부에
  //    지움을 남겨 두면 값으로는 안 드러난다.
  const source = readLayoutSource("NotificationBell.tsx");
  const 누름처리 = source.slice(
    source.indexOf("      onAcknowledge={(picked: NotificationBellItem) => {"),
    source.indexOf("      // 🔴 줄마다 서는 지우기 단추.")
  );
  assert.ok(누름처리.length > 0, "누름 처리를 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(누름처리.includes("handlePortalRowPicked("), "자른 토막이 엉뚱한 자리다");
  assert.ok(!/dismiss\(/.test(누름처리), "🔴 줄을 누르면 아직 지움이 불린다");

  // 🔵 **✕ 는 그대로 지움으로 간다** — 바뀐 것은 줄을 누를 때뿐이다.
  const 지우기길 = source.slice(
    source.indexOf("      // 🔴 줄마다 서는 지우기 단추."),
    source.indexOf("      footer={")
  );
  assert.ok(지우기길.length > 0, "지우기 쪽을 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.match(지우기길, /onDismiss=\{canDismissHere \? \(picked: NotificationBellItem\) => dismiss\(\[picked\.key\]\) : undefined\}/);
  assert.match(지우기길, /onDismissAll=\{canDismissHere \? \(\) => dismiss\(dismissableKeys\) : undefined\}/);
});

test("🔴 포털 확인은 **기다리지 않고 감추지도 않는다** — 이동을 붙잡으면 안 된다", () => {
  // 이 줄의 주소는 다른 시스템의 절대 주소라 누르면 페이지를 통째로 떠난다.
  // 감췄다 되살릴 틈이 없고, 포털이 센 개수는 줄 수와 달라 감추면 배지가 어긋난다.
  const 보낸것: string[] = [];
  // 영영 안 풀리는 약속을 돌려준다 — 기다린다면 여기서 멈춘다.
  const 결과 = acknowledgePortalInBackground(
    "dss-improvements:IMPROVEMENT:7",
    ({ notificationKey }) => {
      보낸것.push(notificationKey);
      return new Promise<{ ok: boolean }>(() => {});
    }
  );
  assert.equal(결과, undefined, "🔴 약속을 돌려준다 — 누름 처리가 망 왕복만큼 붙잡힌다");
  assert.deepEqual(보낸것, ["dss-improvements:IMPROVEMENT:7"], "저장을 시작도 안 했다");

  // 🔴 넘어간 것은 **열쇠**다 — 감추는 쪽(acknowledgeInBackground)은 `id` 로
  //    감추지만 여기는 감출 것이 없고, 포털이 아는 모양은 열쇠뿐이다.
  const source = readLayoutSource("NotificationBell.tsx");
  const 포털확인함수 = source.slice(
    source.indexOf("export function acknowledgePortalInBackground"),
    source.indexOf("export function selectVisibleNotifications")
  );
  assert.ok(포털확인함수.length > 0, "포털 확인 함수를 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(포털확인함수.includes("acknowledge({ notificationKey: key })"), "자른 토막이 엉뚱한 자리다");
  assert.ok(!/view\.|hide\(|restore\(/.test(포털확인함수), "🔴 포털 줄을 감췄다 되살리고 있다");
  assert.ok(!/await /.test(포털확인함수), "🔴 포털 왕복을 기다리고 있다");

  // 🔴 부르는 것 자체가 터져도, 거절이 와도 새지 않는다 — 안 삼키면 「처리되지
  //    않은 거절」이 모든 화면의 머리말에서 터진다.
  assert.doesNotThrow(() =>
    acknowledgePortalInBackground("x:1", () => {
      throw new Error("망이 끊겼다");
    })
  );
  assert.doesNotThrow(() =>
    acknowledgePortalInBackground("x:1", async () => {
      throw new Error("포털이 거절했다");
    })
  );
});

test("🔴 포털 확인 서버 액션도 머리말이 건넨다 — 종은 직접 가져오지 않는다", () => {
  const source = readLayoutSource("NotificationBell.tsx");
  // 받아서 쓰는 모양 그대로다 — A/S 표 쪽(acknowledge)과 **같은 타입, 다른 함수**다.
  assert.match(source, /acknowledgePortal\?: AcknowledgeNotification;/, "받는 칸이 없다");

  const topBar = readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8");
  assert.match(
    topBar,
    /import \{[^}]*\backnowledgePortalNotificationAction\b[^}]*\} from "@\/lib\/server\/actions\/notification-acknowledgements"/,
    "머리말이 포털 확인 액션을 가져오지 않는다"
  );
  const bells = topBar.match(/<NotificationBell\b[^>]*>/g) ?? [];
  assert.equal(bells.length, 1, "TopBar 가 그리는 종이 하나가 아니다");
  assert.match(
    bells[0],
    /acknowledgePortal=\{acknowledgePortalNotificationAction\}/,
    "🔴 종에 포털 확인 액션을 안 건넨다 — 아무 오류 없이 포털 줄이 영영 안 빠진다"
  );
  // 🔴 나머지 둘은 그대로다 — 셋이 가는 곳이 다 다르다.
  assert.match(bells[0], /\backnowledge=\{acknowledgeNotificationAction\}/);
  assert.match(bells[0], /dismiss=\{dismissNotificationsAction\}/);
});

/* ─────────────── 적는 곳이 포털로 옮겨 갔다(2026-10-20, 조각 A-2) ─────────────── */

test("🔴 종은 브라우저 저장소에 지움을 **한 글자도 적지 않는다** — 포털과 두 벌이 되면 안 된다", () => {
  // 2026-10-20 까지는 localStorage 에 적고 그것을 읽어 걸렀다. 둘 다 두면
  // 「브라우저엔 있는데 포털엔 없거나 반대이거나」가 생기고, 그 어긋남은
  // **「계측기에서는 지웠는데 A/S 에만 뜬다」** 라는 신고로만 드러난다.
  const source = readLayoutSource("NotificationBell.tsx");

  assert.ok(!/\.setItem\(/.test(source), "🔴 종이 브라우저 저장소에 다시 적고 있다");
  assert.ok(!/\.getItem\(/.test(source), "🔴 종이 브라우저 저장소에서 다시 읽고 있다");
  assert.ok(
    !/readDismissedNotificationKeys|writeDismissedNotificationKeys|notificationDismissalStorageKey/.test(
      source
    ),
    "걷어낸 저장 함수가 되살아났다"
  );

  // 🔴 저장소에 **남아 있는 옛 칸을 치우는** 일만 남았다 — 한 번 돌고 끝난다.
  assert.match(source, /purgeStoredDismissals\(getDismissalStore\(\)\)/);
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*purgeStoredDismissals\(getDismissalStore\(\)\);\s*\}, \[\]\);/,
    "옛 칸 치우기가 한 번만 도는 자리에 있지 않다"
  );
});

test("🔴 ✕ 는 **먼저 감추고** 나서 포털에 적는다 — A/S 만의 「즉시 사라짐」을 지킨다", () => {
  // 다른 여섯 사이트는 서버가 다시 그릴 때(한 박자 뒤) 줄이 빠진다. A/S 는 그
  // 자리에서 사라지고, 그것이 더 나은 동작이라 유지하기로 했다(2026-10-20).
  // 포털의 답을 기다리면 ✕ 를 눌러도 한 박자 동안 아무 일이 없다.
  const source = readLayoutSource("NotificationBell.tsx");
  const 지우는함수 = source.slice(
    source.indexOf("  const dismiss = useCallback("),
    source.indexOf("  // 적을 곳을 아는 종만 지울 수 있다")
  );
  assert.ok(지우는함수.length > 0, "지우는 함수를 못 찾았다 — 이 시험이 아무것도 안 본다");

  const 감추는자리 = 지우는함수.indexOf("setDismissed(");
  const 적는자리 = 지우는함수.indexOf("record({ keys:");
  assert.ok(감추는자리 > 0, "화면에서 감추는 자리가 없다");
  assert.ok(적는자리 > 0, "포털에 적는 자리가 없다");
  assert.ok(감추는자리 < 적는자리, "🔴 포털의 답을 기다린 뒤에 감추고 있다");

  // 🔴 **기다리지 않는다**(await 가 아니다). 기다리면 누름 처리가 망 왕복만큼
  //    붙잡히고, 그 사이에 같은 줄을 또 누르게 된다.
  assert.ok(!/await record\(/.test(지우는함수), "포털 왕복을 기다리고 있다");
  // 🔴 거절을 삼킨다 — 안 삼키면 「처리되지 않은 거절」이 모든 화면에서 터진다.
  assert.match(지우는함수, /\.catch\(\(\) => \{/);
});

test("🔴 일괄 지우기는 열쇠를 **한 번에** 넘긴다 — 줄마다 따로 부르지 않는다", () => {
  // 50줄을 지우면서 서버 액션을 50번 부르면 포털로 가는 왕복도 50번이 된다.
  // 한 번에 넘기면 200개씩 나누는 일은 서버가 한 번만 한다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.match(
    source,
    /onDismissAll=\{canDismissHere \? \(\) => dismiss\(dismissableKeys\) : undefined\}/,
    "일괄 지우기가 열쇠 묶음을 한 번에 넘기지 않는다"
  );
  // 줄 하나짜리 길도 그대로다(✕ 와 포털 줄 누름).
  assert.match(source, /onDismiss=\{canDismissHere \? \(picked: NotificationBellItem\) => dismiss\(\[picked\.key\]\) : undefined\}/);
});

test("🔴 종은 지움 서버 액션을 **직접 가져오지 않는다** — 머리말이 건넨다", () => {
  // 그 액션 파일은 `server-only` 사슬(세션·DB·포털)을 물고 있다. 여기서
  // 가져오면 이 시험 파일이 종을 가져오는 순간 죽는다 — 확인 기록이 같은
  // 까닭으로 이미 그렇게 돼 있다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.ok(
    !/from "@\/lib\/server\//.test(source),
    "🔴 종이 서버 모듈을 직접 가져왔다 — 정적 렌더 시험이 죽는다"
  );
  assert.ok(!/from "@\/lib\/db\//.test(source), "🔴 종이 DB 모듈을 직접 가져왔다");
  assert.match(source, /export type DismissNotifications = /, "받아서 쓰는 모양이 사라졌다");

  // 🔴 머리말이 실제로 건넨다 — 빠지면 아무 오류 없이 ✕ 가 통째로 사라진다.
  const topBar = readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8");
  assert.match(
    topBar,
    /import \{ dismissNotificationsAction \} from "@\/lib\/server\/actions\/notification-dismissals";/
  );
  assert.match(topBar, /dismiss=\{dismissNotificationsAction\}/, "머리말이 종에 안 건넨다");
  // 확인 기록 쪽은 그대로다 — 둘은 다른 길이다.
  assert.match(topBar, /acknowledge=\{acknowledgeNotificationAction\}/);
});

test("🔴 사람을 가리키는 값은 이 줄기를 타고 내려가지 않는다 — 서버가 제 세션에서 읽는다", () => {
  // 한때 `notificationDismissal={{ userId, issuedAt }}` 이 layout → AppShell →
  // TopBar → 종으로 내려갔다(localStorage 어느 칸에 적을지 가르는 값이었다).
  // 🔴 그 칸이 되살아나면 「브라우저가 보낸 사람 번호」가 생기고, 그것을 믿는
  //    순간 남의 알림을 지우는 통로가 된다.
  // 🔵 **주석은 빼고 본다.** 걷어낸 경위를 적어 둔 주석에 그 이름이 그대로
  //    적혀 있다 — 글자로 세면 그 설명을 지워야 통과하게 된다.
  const 코드만 = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  for (const [이름, source] of [
    ["layout.tsx", readFileSync(new URL("../../app/(app)/layout.tsx", import.meta.url), "utf8")],
    ["AppShell.tsx", readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8")],
    ["TopBar.tsx", readFileSync(new URL("./TopBar.tsx", import.meta.url), "utf8")],
    ["NotificationBell.tsx", readLayoutSource("NotificationBell.tsx")],
  ] as const) {
    assert.ok(!/notificationDismissal/.test(코드만(source)), `${이름}: 걷어낸 프롭이 되살아났다`);
  }
  // 받는 칸 자체가 없다 — 칸이 없으면 실수로 믿을 수도 없다.
  assert.ok(
    !/issuedAt/.test(코드만(readLayoutSource("NotificationBell.tsx"))),
    "종이 로그인 시각을 다시 받는다"
  );
});

test("🔴 지움 서버 액션의 **첫 토큰**이 `use server` 다 — 본문이 번들로 새지 않는다", () => {
  // 🔴 주석에 그 낱말이 적힌 서버 파일이 다른 저장소마다 실제로 있었다. 단순
  //    grep 으로 세면 통과하므로 **주석을 걷어낸 뒤 첫 토큰**으로 판정한다.
  const source = readFileSync(
    new URL("../../lib/server/actions/notification-dismissals.ts", import.meta.url),
    "utf8"
  );
  const 코드만 = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .trim();

  assert.ok(
    코드만.startsWith('"use server";'),
    `🔴 첫 토큰이 "use server" 가 아니다: ${코드만.slice(0, 40)}`
  );
  // 🔴 `"use client"` 가 섞이면 세션·DB·시크릿이 브라우저로 간다.
  assert.ok(!/"use client"/.test(코드만), "클라이언트 조각으로 바뀌었다");

  // 🔴 사람 번호를 **받지 않는다** — 받는 칸이 없어야 실수로 믿을 수도 없다.
  const signature = 코드만.slice(
    코드만.indexOf("export async function dismissNotificationsAction"),
    코드만.indexOf("): Promise<void>")
  );
  assert.match(signature, /input: \{ keys: string\[\] \}/);
  assert.doesNotMatch(signature, /sub|subject|userId|actor/i, "브라우저가 보낸 사람 번호를 받는다");
  // 그 값은 서버가 제 세션에서 읽는다.
  assert.match(코드만, /const session = await readSession\(\);/);
  assert.match(코드만, /await getSsoSubjectForUser\(session\.userId\)/);
});

test("🔴 지운 줄은 목록에서도 **배지에서도** 빠진다", () => {
  // 안 빠지면 열어 보면 아무것도 없는데 숫자만 붙어 있는 종이 된다. 지운
  // 상태는 눌러야 생기므로 정적 렌더로 만들 수 없다 — 값으로 본다.
  const mine = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()];
  const inbox = {
    items: [portalRow(), portalRow({ key: "njlee:CAL:3", sourceId: "njlee", subject: "NJ-3" })],
    count: 7, // 🔴 줄은 둘인데 포털이 센 값은 7 이다(세는 규칙이 시스템마다 다르다).
    degraded: false,
    dismissed: [],
    acknowledged: [],
  };

  const 그대로 = selectVisibleNotifications({
    items: mine,
    inbox,
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
  });
  assert.equal(그대로.items.length, 2);
  assert.equal(그대로.inboxItems.length, 2);
  assert.equal(그대로.count, 2 + 7, "지우기 전 배지가 예전과 다르다");

  const 지운뒤 = selectVisibleNotifications({
    items: mine,
    inbox,
    acknowledgedIds: new Set(),
    // 자기 줄 하나(열쇠 = 알림 id)와 포털 줄 하나(열쇠 = client_id:id).
    dismissedKeys: new Set([grantedItem().id, "njlee:CAL:3"]),
  });
  assert.deepEqual(지운뒤.items.map((item) => item.id), [mine[0].id]);
  assert.deepEqual(지운뒤.inboxItems.map((row) => row.key), [portalRow().key]);
  assert.equal(지운뒤.count, 1 + 6, "🔴 지운 줄이 배지에 남았다");
});

test("🔴 배지는 0 아래로 내려가지 않는다 — 포털의 세는 규칙을 우리가 모른다", () => {
  // 한 대상에 두 줄이 걸려 저쪽이 1로 셌다면 둘을 지울 때 2가 빠진다.
  const inbox = {
    items: [portalRow(), portalRow({ key: "x:2" })],
    count: 1,
    degraded: false,
    dismissed: [],
    acknowledged: [],
  };
  const 지운뒤 = selectVisibleNotifications({
    items: [],
    inbox,
    acknowledgedIds: new Set(),
    dismissedKeys: new Set([portalRow().key, "x:2"]),
  });

  assert.equal(지운뒤.count, 0, "음수 배지가 나왔다");
  assert.deepEqual(지운뒤.inboxItems, []);
});

test("확인 중인 줄과 지운 줄은 **함께** 빠진다 — 서로를 지우지 않는다", () => {
  const mine = [grantedItem(), rejectedItem()];
  const 둘다 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [portalRow()], count: 1, degraded: false, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set([grantedItem().id]),
    dismissedKeys: new Set([rejectedItem().id]),
  });

  assert.deepEqual(둘다.items, []);
  assert.equal(둘다.count, 0 + 1, "포털 줄은 그대로 세어져야 한다");
  assert.equal(둘다.inboxItems.length, 1);
});

/* ─────────────────────────────────────────────────────────────────────────
   🔴 지움을 포털과 맞춘다 (2026-10-20, A-1 — 읽는 방향만)

   다른 사내 시스템의 종에서 지운 A/S 줄이 포털의 `dismissed` 로 돌아와 여기서도
   빠진다. 그러려면 제 줄의 열쇠가 포털에 적히는 모양(`{client_id}:{id}`)이어야
   하고, 거르는 쪽도 그 열쇠로 맞춰 봐야 한다.

   🔴 **적는 쪽은 아직 이 브라우저다** — 여기서 누른 ✕ 는 포털에 가지 않는다.
   ───────────────────────────────────────────────────────────────────────── */

/** 포털에 등록된 이 시스템의 식별자. 제 줄 열쇠의 접두사가 되는 값이다. */
const CLIENT_ID = "rf-service-system";

test("🔴 제 줄의 지움도 **열쇠**로 맞춰 본다 — `id` 로 맞춰 보면 영영 안 맞는다", () => {
  // 접두사가 붙으면 `item.key` 와 `item.id` 가 갈라진다. 거르는 쪽이 `id` 로
  // 남아 있으면 ✕ 를 눌러도(열쇠로 적힌다) 줄이 그대로 남는다 — 오류는 없다.
  const mine = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()];
  const 지울열쇠 = `${CLIENT_ID}:${grantedItem().id}`;

  const 지운뒤 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set([지울열쇠]),
    clientId: CLIENT_ID,
  });
  assert.deepEqual(지운뒤.items.map((item) => item.id), [mine[0].id], "🔴 지운 제 줄이 남았다");
  assert.equal(지운뒤.count, 1, "🔴 지운 줄이 배지에 남았다");

  // 🔴 대조 — 접두사 **없는** id 로 적힌 옛 기록은 이제 안 맞는다. 그것이
  //    정상이다(열쇠 모양이 바뀌면 그 브라우저의 옛 기록은 그냥 안 듣는다).
  const 옛기록 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set([grantedItem().id]),
    clientId: CLIENT_ID,
  });
  assert.equal(옛기록.items.length, 2, "접두사 없는 열쇠가 접두사 붙은 줄에 맞았다");
  assert.notEqual(지울열쇠, grantedItem().id, "둘이 같으면 이 시험이 아무것도 못 본다");
});

test("🔴 접두사를 못 읽어도 거르기는 돈다 — 만드는 쪽과 거르는 쪽이 함께 물러선다", () => {
  // 설정을 못 읽으면 양쪽 다 접두사 없는 예전 모양이라 여전히 맞는다. 한쪽만
  // 물러서면 그때부터 지우기가 통째로 안 듣는다.
  const mine = [grantedItem()];
  for (const clientId of [undefined, ""]) {
    const 지운뒤 = selectVisibleNotifications({
      items: mine,
      inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] },
      acknowledgedIds: new Set(),
      dismissedKeys: new Set([grantedItem().id]),
      clientId,
    });
    assert.deepEqual(지운뒤.items, [], `${String(clientId)}: 예전 모양에서 안 지워졌다`);
    assert.equal(지운뒤.count, 0);
  }
});

test("🔴 포털이 돌려준 지움으로 **제 줄**이 빠진다 — 두 목록을 합쳐 본다", () => {
  // 남의 시스템 줄은 포털이 제 손으로 걸러 보낸다(items 에 없고 count 도 줄어
  // 있다). 포털이 손댈 수 없는 것은 A/S 자신의 줄이라, 그것을 거르라고
  // `dismissed` 가 온다. 안 거르면 「계측기에서 지웠는데 A/S 종에만 뜬다」가 된다.
  const mine = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()];
  const inbox = {
    items: [portalRow()],
    count: 3,
    degraded: false,
    // 🔴 그 사이트 몫만 온다 — 남의 줄 열쇠는 애초에 실리지 않는다(규격서).
    dismissed: [`${CLIENT_ID}:${grantedItem().id}`],
    acknowledged: [],
  };

  const 보이는것 = selectVisibleNotifications({
    items: mine,
    inbox,
    acknowledgedIds: new Set(),
    // 🔴 이 브라우저에는 아무것도 안 적혀 있다 — 오직 포털이 보낸 목록으로만
    //    빠져야 한다.
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });

  assert.deepEqual(보이는것.items.map((item) => item.id), [mine[0].id], "🔴 포털의 지움이 안 들었다");
  assert.deepEqual(보이는것.inboxItems, inbox.items, "남의 줄까지 건드렸다");
  // 🔴 **개수도 함께 줄어든다.** 자기 몫은 걸러진 목록에서 다시 세고(1), 포털이
  //    센 값(3)은 그대로 더한다 — 저쪽 몫은 이미 저쪽에서 빠져 있다.
  assert.equal(보이는것.count, 1 + 3, "🔴 지운 줄이 배지에 남았다");
});

test("🔴 두 지움 목록이 **함께** 든다 — 방금 누른 것과 포털이 돌려준 것", () => {
  const mine = [grantedItem(), rejectedItem()];
  const 보이는것 = selectVisibleNotifications({
    items: mine,
    inbox: {
      items: [portalRow(), portalRow({ key: "njlee:CAL:3", sourceId: "njlee" })],
      count: 2,
      degraded: false,
      dismissed: [`${CLIENT_ID}:${rejectedItem().id}`],
      acknowledged: [],
    },
    acknowledgedIds: new Set(),
    // 이 화면에서 방금 누른 것에 제 줄 하나와 포털 줄 하나가 들어 있다. 둘 다
    // 포털로도 나갔지만, 그 답이 돌아오기 전까지 감추는 일은 이 목록이 한다.
    dismissedKeys: new Set([`${CLIENT_ID}:${grantedItem().id}`, "njlee:CAL:3"]),
    clientId: CLIENT_ID,
  });

  assert.deepEqual(보이는것.items, [], "🔴 두 목록 가운데 한쪽만 들었다");
  assert.deepEqual(보이는것.inboxItems.map((row) => row.key), [portalRow().key]);
  assert.equal(보이는것.count, 0 + 1, "포털 줄 하나를 지웠으니 2에서 1이 빠진다");
});

test("포털이 지움을 안 보내도(빈 배열·안 고친 포털) 예전 그대로 돈다", () => {
  const mine = [grantedItem()];
  const 그대로 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [portalRow()], count: 1, degraded: true, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.equal(그대로.items.length, 1);
  assert.equal(그대로.inboxItems.length, 1);
  assert.equal(그대로.count, 1 + 1);
});

/* ─────────────────────────────────────────────────────────────────────────
   🔴 다른 집에서 누른 ✓ 확인을 읽어 제 줄을 거른다 (2026-10-22, `acknowledged`)

   A/S 의 알림은 다른 시스템의 종에도 뜬다(포털이 날라 준다). 그 줄을 PO·게시판
   등 **거기서** 눌러 확인하면 포털에 적히고 거기서는 사라지는데, 이 칸을 안
   읽으면 **A/S 제 종에만 그대로 남는다** — A/S 는 제 줄을 제 표로만 걸러 왔다.

   🔴 거르는 길이 이제 **셋**이고 셋 다 나란히 돈다:
    · `acknowledgedIds`  — **이 집에서** 누른 확인(A/S 의 표). 열쇠가 알림 `id`.
    · `inbox.dismissed`  — 어느 집에서든 누른 ✕ 지움(포털). 열쇠가 `client_id:id`.
    · `inbox.acknowledged` — **다른 집에서** 누른 ✓ 확인(포털). 같은 열쇠 모양.
   ───────────────────────────────────────────────────────────────────────── */

test("🔴 포털이 돌려준 **확인**으로 제 줄이 빠진다 — 배지도 함께 줄어든다", () => {
  // 안 거르면 「PO 종에서 눌러 확인했는데 A/S 종에만 그대로 뜬다」가 된다.
  const mine = [approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()];
  const inbox = {
    items: [portalRow()],
    count: 3,
    degraded: false,
    dismissed: [],
    // 🔴 그 사이트 몫만 온다 — 남의 줄 열쇠는 애초에 실리지 않는다(규격서).
    acknowledged: [`${CLIENT_ID}:${grantedItem().id}`],
  };

  const 보이는것 = selectVisibleNotifications({
    items: mine,
    inbox,
    // 🔴 이 집에서는 아무것도 안 눌렀다 — 오직 포털이 보낸 **확인** 목록으로만
    //    빠져야 한다(지움 목록도 비어 있다).
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });

  assert.deepEqual(
    보이는것.items.map((item) => item.id),
    [mine[0].id],
    "🔴 다른 집에서 누른 확인이 안 들었다"
  );
  assert.deepEqual(보이는것.inboxItems, inbox.items, "남의 줄까지 건드렸다");
  // 🔴 줄만 빼고 숫자를 그대로 두면 「없는데 빨간 점」이 된다. 자기 몫은 걸러진
  //    목록에서 다시 세고(1), 포털이 센 값(3)은 그대로 더한다.
  assert.equal(보이는것.count, 1 + 3, "🔴 확인한 줄이 배지에 남았다");
});

test("🔴 제 표로 거르는 길과 **나란히** 돈다 — 둘 다 걸러진다", () => {
  // 제 표는 「이 집에서 눌러 확인한 것」, 포털 열쇠는 「다른 집에서 눌러 확인한
  // 것」이다. 한쪽만 돌면 그쪽에서 누른 확인만 듣는다.
  const mine = [grantedItem(), rejectedItem()];
  const 포털열쇠 = `${CLIENT_ID}:${rejectedItem().id}`;
  assert.notEqual(포털열쇠, rejectedItem().id, "둘이 같으면 이 시험이 아무것도 못 본다");

  const 둘다 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [포털열쇠] },
    // 🔴 제 표의 열쇠는 **알림 id** 다(확인 기록이 그 모양으로 적힌다).
    acknowledgedIds: new Set([grantedItem().id]),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.deepEqual(둘다.items, [], "🔴 두 길 가운데 한쪽만 들었다");
  assert.equal(둘다.count, 0, "🔴 거른 줄이 배지에 남았다");

  // 🔴 서로를 지우지 않는다 — 한쪽만 있을 때는 **그 줄만** 빠진다.
  const 제표만 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set([grantedItem().id]),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.deepEqual(
    제표만.items.map((item) => item.id),
    [rejectedItem().id],
    "제 표로 거르는 길이 깨졌다"
  );

  const 포털만 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [포털열쇠] },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.deepEqual(
    포털만.items.map((item) => item.id),
    [grantedItem().id],
    "포털이 준 확인이 엉뚱한 줄을 걸렀다"
  );
});

test("🔴 지움과 확인을 **따로** 거른다 — 둘이 함께 와도 각자 제 줄만 뺀다", () => {
  const mine = [grantedItem(), rejectedItem()];
  const 보이는것 = selectVisibleNotifications({
    items: mine,
    inbox: {
      items: [portalRow(), portalRow({ key: "njlee:CAL:3", sourceId: "njlee" })],
      count: 2,
      degraded: false,
      // 🔴 수명이 정반대인 두 목록이다(지움은 로그아웃하면 돌아오고 확인은 안
      //    돌아온다). 한 뭉치로 만들면 가를 수 없다 — 칸도 거르는 줄도 둘이다.
      dismissed: [`${CLIENT_ID}:${grantedItem().id}`],
      acknowledged: [`${CLIENT_ID}:${rejectedItem().id}`],
    },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });

  assert.deepEqual(보이는것.items, [], "🔴 두 목록 가운데 한쪽만 들었다");
  assert.deepEqual(
    보이는것.inboxItems.map((row) => row.key),
    [portalRow().key, "njlee:CAL:3"],
    "남의 줄까지 건드렸다"
  );
  assert.equal(보이는것.count, 0 + 2, "포털이 센 값은 그대로 더해져야 한다");
});

test("🔴 확인을 안 보내도(빈 배열·안 고친 포털) 예전 그대로 돈다", () => {
  // 이 칸은 2026-10-22 에 늘었다. 포털이 먼저 올라가지 않아도 종은 예전과
  // 똑같이 그려져야 한다 — 확인해 둔 줄이 다시 보일 뿐이다(규격서: 「틀렸을 때
  // 덜 나쁜 쪽」).
  const mine = [grantedItem()];
  const 그대로 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [portalRow()], count: 1, degraded: true, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set(),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.equal(그대로.items.length, 1);
  assert.equal(그대로.inboxItems.length, 1);
  assert.equal(그대로.count, 1 + 1);
});

test("🔴 확인한 제 줄은 **그린 종에서도** 사라진다 — 배지까지", () => {
  // 값으로만 보면 그리는 쪽이 이 함수를 안 쓰게 바뀌어도 통과한다. 마크업으로
  // 한 번 더 본다.
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION"), grantedItem()]}
      notificationClientId={CLIENT_ID}
      inbox={{
        items: [],
        count: 0,
        degraded: false,
        dismissed: [],
        acknowledged: [`${CLIENT_ID}:${grantedItem().id}`],
      }}
    />
  );

  assert.ok(!html.includes(grantedItem().subject), "🔴 다른 집에서 확인한 줄이 종에 남았다");
  assert.ok(html.includes("D9705-012"), "확인하지 않은 줄까지 사라졌다");
  assert.ok(html.includes(">알림 1건</span>"), "🔴 줄은 빠졌는데 배지가 그대로다");
});

test("🔴 지움과 확인을 **한 Set 으로 합치지 않는다** — 소스에도 못 박는다", () => {
  // 지금 그리는 한 화면에서는 둘 다 「감춘다」라 값 시험으로는 갈라지지 않는다.
  // 합쳐 두면 나중에 「지운 것만 되살린다」를 할 때 어느 쪽이 어느 쪽인지 알 수
  // 없다 — 확인을 지움으로 읽으면 안 돌아와야 할 줄이 돌아온다.
  const source = readLayoutSource("NotificationBell.tsx");
  const 고르는함수 = source.slice(
    source.indexOf("export function selectVisibleNotifications"),
    source.indexOf("export function acknowledgeInBackground")
  );
  assert.ok(고르는함수.length > 0, "고르는 함수를 못 찾았다 — 이 시험이 아무것도 안 본다");
  assert.ok(고르는함수.includes("input.inbox.acknowledged"), "자른 토막이 엉뚱한 자리다");

  const 지움Set = 고르는함수.slice(
    고르는함수.indexOf("const dismissedKeys ="),
    고르는함수.indexOf("const portalAcknowledgedKeys")
  );
  assert.ok(지움Set.length > 0, "지움 Set 을 만드는 자리를 못 찾았다");
  assert.equal(/acknowledg/i.test(지움Set), false, "🔴 확인 목록이 지움 Set 에 섞였다");
});

test("🔴 확인 기록은 깨지지 않는다 — 확인에 넘어가는 값은 `id` 이고 `key` 와 다르다", () => {
  // 🔴 여기가 이 조각에서 가장 위험한 자리다. 확인이 `item.key` 로 바뀌면 운영
  //    DB 에 쌓인 열쇠와 모양이 달라져 **이미 확인한 알림이 전부 다시 뜬다** —
  //    되돌릴 수도 없다(사람들이 다시 확인해야 한다).
  const [row] = toNotificationBellItems([grantedItem()], CLIENT_ID);
  assert.notEqual(row.key, row.id, "둘이 같으면 이 시험이 아무것도 못 본다");

  const { acknowledge, calls } = fakeAcknowledge();
  const hidden: string[] = [];
  acknowledgeInBackground(row, acknowledge, {
    hide: (id) => hidden.push(id),
    restore: () => {},
  });

  assert.deepEqual(calls, [{ notificationKey: row.id }], "🔴 확인에 접두사가 붙은 열쇠가 넘어갔다");
  assert.deepEqual(hidden, [row.id], "감추는 값도 확인 기록의 키(id)와 같아야 한다");

  // 가짜 함수를 넘기는 위 단언만으로는 **다른 경로가 생겼을 때** 조용히
  // 지나간다 — 소스에도 못 박는다.
  const source = readLayoutSource("NotificationBell.tsx");
  assert.match(source, /acknowledge\(\{ notificationKey: item\.id \}\)/);
  assert.equal(/notificationKey: item\.key/.test(source), false, "🔴 확인이 열쇠로 적힌다");
});

test("🔴 확인해서 감춘 줄은 **접두사와 상관없이** 빠진다 — 그 목록은 `id` 다", () => {
  // acknowledgedIds 에 드는 값은 위 시험이 못 박은 `id` 다. 거르는 쪽이 그것을
  // 열쇠로 맞춰 보게 바뀌면 눌러 확인한 줄이 종에 그대로 남는다.
  const mine = [grantedItem(), rejectedItem()];
  const 확인중 = selectVisibleNotifications({
    items: mine,
    inbox: { items: [], count: 0, degraded: false, dismissed: [], acknowledged: [] },
    acknowledgedIds: new Set([grantedItem().id]),
    dismissedKeys: new Set(),
    clientId: CLIENT_ID,
  });
  assert.deepEqual(확인중.items.map((item) => item.id), [rejectedItem().id]);
  assert.equal(확인중.count, 1);
});

test("🔴 종이 그리는 열쇠에 접두사가 붙는다 — 만드는 쪽과 거르는 쪽이 같은 값을 쓴다", () => {
  // 두 곳에 다른 값이 가면 ✕ 는 접두사 붙은 열쇠로 적는데 거르기는 안 붙은
  // 열쇠로 맞춰 보게 되어, 눌러도 줄이 안 사라진다. 그 어긋남은 오류를 내지
  // 않으므로 값과 소스 양쪽으로 본다.
  const mine = [grantedItem()];
  const html = renderToStaticMarkup(
    <NotificationBellWithInbox
      items={mine}
      inbox={{ items: [portalRow()], count: 1, degraded: false, dismissed: [], acknowledged: [] }}
      dismiss={지움()}
      notificationClientId={CLIENT_ID}
    />
  );
  assert.deepEqual(
    지우기열쇠들(html),
    [`${CLIENT_ID}:${grantedItem().id}`, portalRow().key],
    "🔴 ✕ 가 적는 열쇠에 접두사가 없다"
  );

  // 안 넘기면 예전 모양이다(데모 모드 · 설정을 못 읽은 서버).
  const 예전 = renderToStaticMarkup(
    <NotificationBellWithInbox items={mine} dismiss={지움()} />
  );
  assert.deepEqual(지우기열쇠들(예전), [grantedItem().id]);

  const source = readLayoutSource("NotificationBell.tsx");
  assert.match(source, /toNotificationBellItems\(visible\.items, notificationClientId\)/);
  assert.match(source, /clientId: notificationClientId,/);
});

test("🔴 머리말이 종까지 client_id 를 실제로 날라 준다 — 빠지면 조용히 접두사가 사라진다", () => {
  // 종은 환경변수를 읽을 수 없다(클라이언트 조각). 서버가 내려보내는 줄이
  // 어디 한 군데서 끊기면 아무 오류 없이 **예전 모양으로 물러선다** — 화면에
  // 흔적이 남지 않는 실패라 원본으로 붙잡는다.
  const 레이아웃 = readFileSync(new URL("../../app/(app)/layout.tsx", import.meta.url), "utf8");
  // 🔴 던지는 getter 가 아니라 물러서는 쪽으로 읽는다. 그냥 읽으면 설정이 빠진
  //    서버에서 이 레이아웃이, 곧 모든 화면이 깨진다.
  assert.match(레이아웃, /const notificationClientId = getSsoClientIdOrEmpty\(\);/);
  assert.match(레이아웃, /notificationClientId=\{notificationClientId\}/);

  for (const 파일 of ["AppShell.tsx", "TopBar.tsx"] as const) {
    const source = readFileSync(new URL(`./${파일}`, import.meta.url), "utf8");
    assert.match(
      source,
      /notificationClientId=\{notificationClientId\}/,
      `${파일} 이 client_id 를 지나 보내지 않는다`
    );
  }

  // 그 읽는 함수가 **던지지 않는다**는 것까지 본다.
  const config = readFileSync(new URL("../../lib/config/sso.ts", import.meta.url), "utf8");
  const reader = config.slice(config.indexOf("export function getSsoClientIdOrEmpty"));
  assert.match(reader, /try \{\s*return getSsoClientId\(\);\s*\} catch \{\s*return "";/);
});
