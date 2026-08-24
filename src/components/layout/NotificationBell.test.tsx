import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import NotificationBell, { NotificationList } from "./NotificationBell";
import { buildApprovalNotification } from "@/lib/domain/notifications";

/**
 * 정적 렌더로 볼 수 있는 것은 **첫 화면**(닫힌 종)과, 따로 떼어 둔 목록
 * 컴포넌트다. 펼침/바깥 클릭/Escape는 브라우저 이벤트라 여기서 검사하지
 * 않는다 — 대신 닫힌 상태의 계약(배지 유무, aria)과 펼쳤을 때 그려질 내용을
 * 각각 붙잡아 둔다.
 */

function approval(repairCaseId: string, intakeNumber: string, approvalType: "REPAIR_INSPECTION" | "FINAL_SHIPMENT") {
  return buildApprovalNotification({ repairCaseId, intakeNumber, approvalType });
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
