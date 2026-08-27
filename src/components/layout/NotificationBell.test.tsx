import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import NotificationBell, { BrowserNotificationNotice, NotificationList } from "./NotificationBell";
import {
  NOTIFICATION_KINDS,
  buildApprovalNotification,
  buildPartStockBelowMinimumNotification,
  buildPendingPartRequestNotification,
} from "@/lib/domain/notifications";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";

/**
 * 정적 렌더로 볼 수 있는 것은 **첫 화면**(닫힌 종)과, 따로 떼어 둔 목록
 * 컴포넌트다. 펼침/바깥 클릭/Escape는 브라우저 이벤트라 여기서 검사하지
 * 않는다 — 대신 닫힌 상태의 계약(배지 유무, aria)과 펼쳤을 때 그려질 내용을
 * 각각 붙잡아 둔다.
 */

function approval(repairCaseId: string, intakeNumber: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT") {
  return buildApprovalNotification({ repairCaseId, intakeNumber, approvalType });
}

/** 종류가 서로 다른 세 줄 — 색과 이름이 실제로 갈라지는지 보려면 셋이 함께 있어야 한다. */
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
  ];
}

test("0건이면 종은 남아 있고 배지만 없다", () => {
  const html = renderToStaticMarkup(<NotificationBell items={[]} />);
  assert.ok(html.includes('aria-label="알림"'), "종 버튼 자체는 사라지지 않는다");
  assert.ok(html.includes('aria-expanded="false"'), "처음은 닫힌 상태다");
  assert.ok(!html.includes("bg-amber-500"), "0건에 배지를 그리면 할 일이 있는 것처럼 보인다");
});

test("1건 이상이면 개수 배지를 그리고 aria-label에도 건수가 들어간다", () => {
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );
  assert.ok(html.includes('aria-label="알림 1건"'));
  assert.ok(html.includes("bg-amber-500"), "배지가 있어야 한다");
});

test("배지 숫자는 접수 건 단위다 — 한 건에 두 종류가 걸려도 1건이다", () => {
  // 사이드바 결재 배지와 같은 숫자여야 한다. 두 배지가 다른 수를 말하면
  // 어느 쪽도 믿지 않게 된다.
  const html = renderToStaticMarkup(
    <NotificationBell
      items={[
        approval("case-1", "D9705-012", "REPAIR_INSPECTION"),
        approval("case-1", "D9705-012", "FINAL_SHIPMENT"),
      ]}
    />
  );
  assert.ok(html.includes('aria-label="알림 1건"'), "같은 접수 건은 한 번만 센다");
});

test("닫혀 있는 동안에는 패널 내용이 아예 렌더되지 않는다", () => {
  const html = renderToStaticMarkup(
    <NotificationBell items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} />
  );
  assert.ok(!html.includes("/repair-cases/case-1"), "닫힌 패널의 링크가 탭 순서에 남아서는 안 된다");
});

test("항목은 인수번호와 승인 종류 라벨을 함께 보여 주고 그 건의 검수/승인 화면으로 바로 링크한다", () => {
  const html = renderToStaticMarkup(
    <NotificationList items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} onNavigate={() => {}} />
  );
  // 상세 첫 화면이 아니라 결재를 처리할 수 있는 화면으로 곧장 간다.
  assert.ok(html.includes('href="/repair-cases/case-1/approval"'));
  assert.ok(html.includes("D9705-012"));
  assert.ok(html.includes("수리 검수 승인"));
});

test("여러 건이면 건별로 한 줄씩 나온다", () => {
  const html = renderToStaticMarkup(
    <NotificationList
      items={[
        approval("case-1", "D9705-012", "REPAIR_INSPECTION"),
        approval("case-2", "D9705-013", "FINAL_SHIPMENT"),
      ]}
      onNavigate={() => {}}
    />
  );
  assert.ok(html.includes('href="/repair-cases/case-1/approval"'));
  assert.ok(html.includes('href="/repair-cases/case-2/approval"'));
  assert.ok(html.includes("최종 출하 승인"));
});

test("알림이 없을 때 펼치면 빈 상태 문구가 나온다", () => {
  const html = renderToStaticMarkup(<NotificationList items={[]} onNavigate={() => {}} />);
  assert.ok(html.includes("처리할 알림이 없습니다."));
  assert.ok(!html.includes("<a"), "빈 상태에는 누를 것이 없어야 한다");
});

// ─────────────────────────────────────────────── 종류를 눈으로 구분한다

test("🔴 종류마다 다른 글자색으로 그린다", () => {
  const html = renderToStaticMarkup(<NotificationList items={oneOfEachKind()} onNavigate={() => {}} />);

  const tones = NOTIFICATION_KINDS.map((kind) => NOTIFICATION_KIND_META[kind].toneClassName);
  for (const tone of tones) {
    assert.ok(html.includes(tone), `${tone} 이 화면에 나오지 않는다`);
  }
  assert.equal(new Set(tones).size, tones.length, "두 종류가 같은 색이면 갈라 보이지 않는다");
});

test("🔴 색만으로 구분하지 않는다 — 종류 이름이 글자로도 보인다", () => {
  // 색약이신 분에게는 색 차이가 사라지고, 흑백 인쇄에는 아무것도 남지 않는다.
  const html = renderToStaticMarkup(<NotificationList items={oneOfEachKind()} onNavigate={() => {}} />);

  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(html.includes(NOTIFICATION_KIND_META[kind].label), `${kind} 의 이름이 글자로 보이지 않는다`);
  }
});

test("종류 이름은 윗줄에 따로 온다 — 지금 줄(대상 · 상세)이 길어져 잘리지 않게", () => {
  const html = renderToStaticMarkup(
    <NotificationList items={[approval("case-1", "D9705-012", "REPAIR_INSPECTION")]} onNavigate={() => {}} />
  );

  const labelIndex = html.indexOf("결재 대기");
  const subjectIndex = html.indexOf("D9705-012");
  assert.ok(labelIndex >= 0 && subjectIndex >= 0);
  assert.ok(labelIndex < subjectIndex, "종류 이름이 대상보다 앞에 온다");

  // 그 이름이 담긴 span이 block이라 자기 줄을 차지한다 — 같은 줄에 끼워 넣으면
  // 그만큼 상세가 먼저 잘린다.
  const labelSpan = html.slice(html.lastIndexOf("<span", labelIndex), labelIndex);
  assert.ok(labelSpan.includes("block"), "종류 이름이 대상·상세와 같은 줄에 끼어들면 안 된다");
  assert.ok(html.includes("truncate text-sm text-zinc-600"), "상세의 truncate는 그대로 남아 있다");
});

test("🔴 화면에는 종류별 분기가 없다 — 종류가 늘어도 이 파일은 고치지 않는다", () => {
  // 이 구조의 목적이다(NotificationItem 한 모양만 그린다). 색과 이름은 도메인
  // 표를 **읽기만** 하므로, 종류가 늘면 그 표를 채우는 것으로 끝나야 한다.
  const source = readFileSync(new URL("./NotificationBell.tsx", import.meta.url), "utf8");

  for (const kind of NOTIFICATION_KINDS) {
    assert.ok(!source.includes(kind), `화면이 ${kind} 를 직접 알고 있다`);
  }
  assert.ok(!/switch\s*\(\s*[A-Za-z.]*[kK]ind/.test(source), "화면에 종류 switch 가 생겼다");
  assert.ok(!/[kK]ind\s*===/.test(source), "화면에 종류 비교가 생겼다");
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
