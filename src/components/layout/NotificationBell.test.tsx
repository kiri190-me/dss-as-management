import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import NotificationBell, {
  BrowserNotificationNotice,
  NotificationList,
  NotificationSelfTest,
  acknowledgeInBackground,
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
  type NotificationItem,
} from "@/lib/domain/notifications";
import { NOTIFICATION_KIND_META } from "@/lib/domain/notification-settings";
import { isAcknowledgeableNotificationKind } from "@/lib/domain/notification-acknowledgement";
import {
  NOTIFICATION_PANEL_OPENED_EVENT,
  describeNotificationToastFailure,
} from "@/lib/domain/notification-toast";

/**
 * 정적 렌더로 볼 수 있는 것은 **첫 화면**(닫힌 종)과, 따로 떼어 둔 목록
 * 컴포넌트다. 펼침/바깥 클릭/Escape는 브라우저 이벤트라 여기서 검사하지
 * 않는다 — 대신 닫힌 상태의 계약(배지 유무, aria)과 펼쳤을 때 그려질 내용을
 * 각각 붙잡아 둔다.
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

test("불출 승인 대기도 화면을 고치지 않고 같은 한 줄로 그려진다 — 이름·대상·상세·링크", () => {
  const html = renderToStaticMarkup(
    <NotificationList
      items={[
        buildPartIssueApprovalNotification({
          issueRequestId: "issue-1",
          intakeNumber: null,
          destinationNote: "상해수리소",
          routeStepOrder: 1,
          requestedByName: "홍길동",
        }),
      ]}
      onNavigate={() => {}}
    />
  );
  assert.ok(html.includes('href="/inventory/approvals"'), "[승인 요청건] 탭으로 가야 한다");
  assert.ok(html.includes(NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING.label));
  assert.ok(html.includes(NOTIFICATION_KIND_META.PART_ISSUE_APPROVAL_PENDING.toneClassName));
  assert.ok(html.includes("상해수리소"));
  assert.ok(html.includes("결재선 1단계 · 신청자 홍길동"));
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

// ─────────────────────────── 종을 열면 그 자리에서 다시 센다

/**
 * 펼침은 브라우저 이벤트라 정적 렌더로는 볼 수 없다. 대신 **두 파일 사이의
 * 계약**을 소스로 붙잡는다 — 신호 하나로 이어져 있고, 그 신호가 권한으로 막히지
 * 않는다는 것. 한쪽만 고쳐지면 조용히 끊기는 자리라서 시험이 필요하다.
 */
function readLayoutSource(fileName: "NotificationBell.tsx" | "BrowserNotifications.tsx") {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

test("🔴 종을 열면 다시 세라는 신호를 보낸다 — 닫을 때는 보내지 않는다", () => {
  // 여기 그려지는 목록은 서버 렌더 때 한 번 계산돼 내려온 값이라, 종을 열어도
  // 다시 세지 않으면 마지막으로 센 뒤에 생긴 알림이 안 보인다.
  const source = readLayoutSource("NotificationBell.tsx");

  const dispatchIndex = source.indexOf(`dispatchEvent(new Event(NOTIFICATION_PANEL_OPENED_EVENT))`);
  assert.ok(dispatchIndex > 0, "종이 여는 신호를 보내지 않는다");

  const effectStart = source.lastIndexOf("useEffect(", dispatchIndex);
  assert.ok(effectStart > 0, "신호를 보내는 자리가 효과 안에 있어야 한다");
  assert.ok(
    source.slice(effectStart, dispatchIndex).includes("if (!isOpen) return;"),
    "닫을 때는 보내지 않는다 — 다 봤다는 행동이라 서버를 두드릴 이유가 없다"
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

// ─────────────────────────── 눌러서 확인하는 알림 — 승인 완료 · 반려됨

test("승인 완료·반려됨도 화면을 고치지 않고 같은 한 줄로 그려진다 — 이름·대상·상세·링크", () => {
  const html = renderToStaticMarkup(
    <NotificationList items={[grantedItem(), rejectedItem()]} onNavigate={() => {}} />
  );
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

test("🔴 눌러서 확인하는 줄을 누르면 확인을 부르고 이동한다 — 할 일 줄은 이동만 한다", () => {
  for (const item of oneOfEachKind()) {
    const acknowledged: string[] = [];
    let navigated = 0;
    handleNotificationPicked(item, {
      onAcknowledge: (picked) => acknowledged.push(picked.id),
      onNavigate: () => {
        navigated += 1;
      },
    });
    assert.equal(navigated, 1, `${item.kind}: 이동하지 않았다`);
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

test("🔴 확인이 던져도 이동은 막히지 않는다 — 확인을 넘기지 않은 종은 이동만 한다", () => {
  let navigated = 0;
  handleNotificationPicked(grantedItem(), {
    onAcknowledge: () => {
      throw new Error("저장 실패");
    },
    onNavigate: () => {
      navigated += 1;
    },
  });
  assert.equal(navigated, 1);

  navigated = 0;
  handleNotificationPicked(grantedItem(), {
    onNavigate: () => {
      navigated += 1;
    },
  });
  assert.equal(navigated, 1);
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

test("확인 함수를 받아도 첫 화면(닫힌 종)의 배지는 서버가 준 목록 그대로 센다", () => {
  const { acknowledge } = fakeAcknowledge();
  const html = renderToStaticMarkup(
    <NotificationBell items={[grantedItem(), rejectedItem()]} acknowledge={acknowledge} />
  );
  assert.ok(html.includes('aria-label="알림 2건"'), "결재 결과는 사건 단위로 센다");
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
  const listStart = source.indexOf("export function NotificationList(");
  assert.ok(pickedStart > 0 && backgroundStart > pickedStart && listStart > backgroundStart, "함수 순서가 바뀌었다");
  assert.ok(!/\bawait\b/.test(source.slice(pickedStart, listStart)), "확인 경로가 저장을 기다린다");
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
