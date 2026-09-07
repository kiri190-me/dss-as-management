import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import DatabaseWorkHistoryScreen from "./DatabaseWorkHistoryScreen";
import type { WorkRecordRow } from "@/lib/db/queries/repair-case-work-records";

/**
 * 작업 기록 무효화는 예전에 작업내용 탭의 "최근 작업 기록" 구역에만 있었다.
 * 그 구역을 없애면서 무효화를 이 탭(작업 이력)으로 옮겼다 — 이 시험은 옮긴
 * 자리를 못 박는다. 특히 **권한이 없으면 그리지 않는다** 쪽이 중요하다.
 *
 * 정적 렌더로 볼 수 있는 것은 "무효 처리 단추가 있는가"와 "무효 처리 창이
 * 붙어 있는가"다. 실제 클릭·제출은 브라우저 동작이라 여기서 다루지 않는다
 * (서버 액션은 자기 검사를 따로 하며 이 변경으로 손대지 않았다).
 */

const noopRouter = {
  refresh: () => {},
  push: () => {},
  replace: () => {},
  back: () => {},
  forward: () => {},
  prefetch: () => {},
} as unknown as AppRouterInstance;

function record(overrides: Partial<WorkRecordRow> = {}): WorkRecordRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    memo: "1차 점검 완료",
    recordKind: "GENERAL",
    authorUserId: "33333333-3333-4333-8333-333333333333",
    authorName: "홍길동",
    createdAt: "2026-08-30T01:02:03.000Z",
    workflowStepLabel: null,
    procedureNodeTitle: null,
    isInvalidated: false,
    invalidatedAt: null,
    invalidatedByUserId: null,
    invalidatedByName: null,
    invalidationReason: null,
    ...overrides,
  };
}

function render({
  canInvalidate,
  records = [record()],
}: {
  canInvalidate: boolean;
  records?: WorkRecordRow[];
}): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={noopRouter}>
      <DatabaseWorkHistoryScreen
        repairCaseId="22222222-2222-4222-8222-222222222222"
        records={records}
        total={records.length}
        page={1}
        pageSize={20}
        workflowHistory={[]}
        canInvalidate={canInvalidate}
        invalidateAction={async () => ({ ok: true as const, id: "unused", invalidatedAt: "2026-08-31T00:00:00.000Z" })}
      />
    </AppRouterContext.Provider>
  );
}

test("권한이 있으면 작업 이력 탭이 무효 처리를 그린다", () => {
  const html = render({ canInvalidate: true });
  assert.ok(html.includes(">무효 처리</button>"), "기록마다 무효 처리 단추가 있어야 한다");
  assert.ok(html.includes("작업 기록 무효 처리"), "무효 처리 확인 창이 붙어 있어야 한다");
  assert.ok(html.includes("무효 처리 사유"), "사유를 받는 자리가 있어야 한다");
});

test("🔴 권한이 없으면 무효 처리를 어디에도 그리지 않는다", () => {
  const html = render({ canInvalidate: false });
  assert.ok(!html.includes("무효 처리"), "단추도 확인 창도 나오면 안 된다");
  assert.ok(!html.includes("<dialog"), "무효 처리 창 자체가 붙으면 안 된다");
  // 기록 자체는 그대로 보인다 — 감춘 것은 행동뿐이다.
  assert.ok(html.includes("1차 점검 완료"), "기록 내용은 계속 보여야 한다");
});

test("무효화된 기록은 권한과 무관하게 무효 표시를 그대로 유지한다", () => {
  const html = render({
    canInvalidate: false,
    records: [record({ isInvalidated: true, invalidatedByName: "관리자", invalidatedAt: "2026-08-31T00:00:00.000Z", invalidationReason: "오기입" })],
  });
  assert.ok(html.includes("오기입"), "이미 무효 처리된 기록의 사유는 계속 보여야 한다");
  assert.ok(!html.includes(">무효 처리</button>"), "그래도 무효 처리 단추는 없어야 한다");
});

test("작업 이력 탭의 워크플로 변경 이력은 그대로 남아 있다", () => {
  const html = render({ canInvalidate: true });
  assert.ok(html.includes("워크플로 변경 이력"), "이 탭의 기존 구역을 없애면 안 된다");
});

// ─────────────────────────── 작업내용 탭 쪽에는 남아 있지 않다
//
// 그쪽 컴포넌트(WorkRecordsSection/execution page)는 서버 액션을 직접 들고
// 있어 이 시험 환경에서 그려 볼 수 없다(server-only). 그래서 원본을 읽어
// 되돌아오지 않았는지 확인한다.

/**
 * 주석은 걷어내고 읽는다 — 없앴다는 사실을 적어 둔 주석이 "아직 남아 있다"로
 * 잘못 잡히면 안 되고, 우리가 보려는 것은 실제로 그리는 코드뿐이다.
 */
function readSource(url: URL): string {
  return readFileSync(url, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

test("🔴 작업내용 탭에 '최근 작업 기록'도 무효화 배선도 남아 있지 않다", () => {
  const section = readSource(
    new URL("../work-records/WorkRecordsSection.tsx", import.meta.url)
  );
  assert.ok(!section.includes("최근 작업 기록"), "최근 작업 기록 구역이 되살아났다");
  assert.ok(!section.includes("invalidateWorkRecordAction"), "무효화 서버 액션 배선이 되살아났다");
  assert.ok(!section.includes("InvalidateWorkRecordDialog"), "무효 처리 창이 되살아났다");
  assert.ok(!section.includes("WorkRecordList"), "최근 기록 목록이 되살아났다");
  // 남겨야 하는 것: 새 기록을 쓰는 폼.
  assert.ok(section.includes("WorkRecordForm"), "작업 기록 작성 폼은 그대로 있어야 한다");
});

test("🔴 작업내용 탭에서 '워크플로 변경 이력' 구역이 사라졌다", () => {
  const page = readSource(
    new URL("../../../app/(app)/repair-cases/[id]/execution/page.tsx", import.meta.url)
  );
  assert.ok(!page.includes("워크플로 변경 이력"), "이 탭의 워크플로 변경 이력 구역이 되살아났다");
  assert.ok(!page.includes("DatabaseWorkflowHistoryList"), "그 목록을 다시 그리고 있다");
  assert.ok(!page.includes("getRecentWorkRecordsForCase"), "최근 5건 조회가 되살아났다");
  // 없애면 안 되는 것: holdState는 여전히 workflowHistory에서 나온다.
  assert.ok(page.includes("deriveCurrentHoldState(workflowHistory)"), "보류 상태 계산이 사라졌다");
});

test("🔴 작업 이력 탭의 무효화 권한 판정이 작업내용 탭이 쓰던 것과 같다", () => {
  const workHistoryPage = readSource(
    new URL("../../../app/(app)/repair-cases/[id]/work-history/page.tsx", import.meta.url)
  );
  assert.ok(
    workHistoryPage.includes('hasPermission(actingUser, "repairCases.workRecords", "MANAGE")'),
    "작업내용 탭이 쓰던 것과 같은 권한(repairCases.workRecords / MANAGE)이어야 한다"
  );
});
