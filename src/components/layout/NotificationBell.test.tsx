import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationBell as SharedNotificationBell } from "@dss/ui";
import NotificationBell, {
  BrowserNotificationNotice,
  NotificationBellFooter,
  NotificationSelfTest,
  acknowledgeInBackground,
  announceNotificationPanelOpened,
  handleNotificationPicked,
  type AcknowledgeNotification,
} from "./NotificationBell";
import {
  NOTIFICATION_KINDS,
  buildApprovalGrantedNotification,
  buildApprovalNotification,
  buildApprovalRejectedNotification,
  buildCustomerRepairRequestNotification,
  buildPartIssueApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
  buildQuoteApprovalNotification,
  type NotificationItem,
} from "@/lib/domain/notifications";
import { toNotificationBellItems } from "@/lib/domain/notification-bell-items";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import { isAcknowledgeableNotificationKind } from "@/lib/domain/notification-acknowledgement";
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
    buildPendingPartRequestNotification({ requestId: "req-1", intakeNumber: "D9705-100", requestedByName: "홍길동" }),
    buildPartStockBelowMinimumNotification({
      partId: "part-1",
      partName: "커넥터 SMA",
      owner: "DSS",
      currentQuantity: 15,
      minimumQuantity: 30,
    }),
    buildCustomerRepairRequestNotification({
      requestId: "req-c1",
      customerName: "주성 엔지니어링",
      productModelName: "MBK200-JS3",
      serialNumber: "1708075",
    }),
    buildPartIssueApprovalNotification({
      issueRequestId: "issue-1",
      intakeNumber: "D9705-200",
      destinationNote: null,
      routeStepOrder: 2,
      requestedByName: "홍길동",
    }),
    buildQuoteApprovalNotification({
      quoteId: "quote-1",
      quoteNumber: "Q-9705-001",
      routeStepOrder: 1,
      requestedByName: "박영업",
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

/** 눌러서 확인하는 줄 — 내가 올린 직접 사용 불출이 반려됐다. */
function rejectedItem(): NotificationItem {
  return buildApprovalRejectedNotification({
    source: "PART_ISSUE",
    approvalId: "approval-r1",
    partRequestId: null,
    intakeNumber: null,
    destinationNote: "상해수리소",
    decisionReason: "수량 과다",
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

test("🔴 종류마다 다른 색 칸에 앉는다", () => {
  // 색은 더 이상 이 저장소의 Tailwind 클래스가 아니다 — 묶음이 종류 코드를
  // 해시해 제 색 칸(data-tone)을 고른다. 그대로 옮겨 왔다면 색이 **조용히**
  // 사라졌을 자리라(Tailwind v4 는 node_modules 를 훑지 않는다), 「갈라 보인다」는
  // 성질만 여기서 지킨다.
  const html = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  const tones = [...html.matchAll(/class="dss-bell__kind" data-tone="(\d+)"/g)].map((match) => match[1]);
  assert.equal(tones.length, NOTIFICATION_KINDS.length, "종류마다 색 칸이 하나씩 붙지 않았다");
  assert.equal(new Set(tones).size, tones.length, "두 종류가 같은 색이면 갈라 보이지 않는다");
});

test("🔴 색만으로 구분하지 않는다 — 종류 이름이 글자로도 보인다", () => {
  // 색약이신 분에게는 색 차이가 사라지고, 흑백 인쇄에는 아무것도 남지 않는다.
  const html = renderToStaticMarkup(<NotificationBell items={oneOfEachKind()} />);

  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(html.includes(NOTIFICATION_KIND_META[kind].label), `${kind} 의 이름이 글자로 보이지 않는다`);
  }
});

test("불출 승인 대기도 화면을 고치지 않고 같은 한 줄로 그려진다 — 이름·대상·상세·링크", () => {
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[
        buildPartIssueApprovalNotification({
          issueRequestId: "issue-1",
          intakeNumber: null,
          destinationNote: "상해수리소",
          routeStepOrder: 1,
          requestedByName: "홍길동",
        }),
      ]}
    />
  );
  assert.ok(html.includes('href="/inventory/approvals"'), "[승인 요청건] 탭으로 가야 한다");
  assert.ok(html.includes(NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING.label));
  assert.match(html, /class="dss-bell__kind" data-tone="\d+"/, "색 칸이 붙지 않았다");
  assert.ok(html.includes("상해수리소"));
  assert.ok(html.includes("결재선 1단계 · 신청자 홍길동"));
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
  assert.ok(html.includes('href="/inventory"'));
  assert.ok(html.includes("부품 불출 승인 · 사유: 수량 과다"));
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
