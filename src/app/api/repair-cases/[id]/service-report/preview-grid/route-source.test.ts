import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
} from "@/lib/auth/service-report-authorization";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/service-report/preview-grid — 규율 (2026-10-19)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 디스크가 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 것**을 원본 글자로 본다:
 *
 *  · 🔴 **저장이 일어나지 않는다** — 보고서 표를 읽지도 쓰지도 않는다. 미리보기가
 *    사람 몰래 저장하면 「저장을 누르지 않은 채 봐 본다」가 성립하지 않는다
 *    (2026-10-19 사용자 요구의 핵심).
 *  · 🔴 **인가를 새로 뚫지 않았다** — 이웃 `../xlsx` 의 POST([Excel 내려받기]가
 *    쓰는 그 문)와 **같은 관문 · 같은 차례**다. 문턱을 손으로 적지 않는다.
 *  · 🔴 **양식 고르기를 우회하지 않는다** — 격자도 도장 주소도 공용 사슬 하나에서
 *    나온다(`lib/server/service-report-preview-grid.ts`).
 *  · 🔴 **응답에 경로 · 원래 오류가 실리지 않는다**(`cause` 는 로그에만).
 *
 * 값 쪽(보낸 값이 문서에 찍히는가 · 막기 · 양식 고르기)은
 * `lib/server/service-report-preview-grid.test.ts` 가 실제 양식을 채워서 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = code.replace(/\s+/g, " ");

/** 이웃 [Excel 내려받기] 통로 — 문턱을 견줄 상대다. */
const xlsxRoute = readFileSync(new URL("../xlsx/route.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
}

describe("저장 전 미리보기 통로 — 원본으로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    // 🔴 GET 을 만들지 않는다 — 주소에 값을 실어 보내는 길이 생기면 고객 정보가
    //    접근 로그 · 브라우저 기록에 그대로 남는다.
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 저장이 일어나지 않는다 — DB 로 가는 길이 하나도 없다", () => {
    for (const forbidden of [
      "@/lib/db/mutations",
      "@/lib/db/queries",
      "@/lib/db/schema",
      "@/lib/server/actions",
      "drizzle",
      "getServiceReportForEdit",
      "recordServiceReportExport",
      "serviceReports",
    ]) {
      assert.equal(code.includes(forbidden), false, `저장 · 조회로 가는 길이 생겼다: ${forbidden}`);
    }
    // 접수 건은 **있는지와 권한**을 보는 데만 쓴다 — 그 길은 공용 해석기 하나다.
    assert.equal(code.split("resolveRepairCaseForServer(").length - 1, 1);
  });

  test("🔴 디스크에도 쓰지 않는다", () => {
    for (const forbidden of [/\bwriteFile\b/, /\bmkdir\b/, /\bunlink\b/, /\brename\b/, /node:fs/, /\brm\(/]) {
      assert.equal(forbidden.test(code), false, `쓰는 길이 생겼다: ${forbidden}`);
    }
  });

  test("🔴 감사를 남기지 않는다 — 나가는 파일이 없다", () => {
    for (const forbidden of ["recordServiceReportExport", "EXCEL_EXPORT", "audit"]) {
      assert.equal(code.includes(forbidden), false, `감사를 남긴다: ${forbidden}`);
    }
  });
});

describe("🔴 인가 — [Excel 내려받기]와 같은 관문", () => {
  test("문턱을 손으로 적지 않는다 — 원본 한 자리에서 읽는다", () => {
    assert.ok(
      flat.includes(
        "hasPermission( actingUser, SERVICE_REPORT_PERMISSION_AREA, SERVICE_REPORT_REQUIRED_LEVELS.edit )"
      ),
      flat
    );
    // 베껴 적은 문턱이 없다.
    assert.equal(code.includes('"WRITE"'), false, "수준을 손으로 적었다");
    assert.equal(code.includes('"repairCases"'), false, "영역을 손으로 적었다");
  });

  test("🔴 그 원본이 가리키는 수준이 [Excel 내려받기] 통로의 것과 **같은 값**이다", () => {
    // 이웃 통로는 그 두 글자를 직접 적고 있다. 그러니 둘이 같은 문인지는
    // 「상수가 그 글자와 같은가」로 가린다 — 한쪽이 바뀌면 여기가 깨진다.
    assert.equal(SERVICE_REPORT_PERMISSION_AREA, "repairCases");
    assert.equal(SERVICE_REPORT_REQUIRED_LEVELS.edit, "WRITE");
    assert.ok(
      xlsxRoute.includes('hasPermission(actingUser, "repairCases", "WRITE")'),
      "[Excel 내려받기] 통로의 문턱이 바뀌었다 — 미리보기도 함께 봐야 한다"
    );
  });

  test("🔴 차례가 같다 — 저장 모드 → 세션 → 승인 → 살아 있는 계정 → 권한 → 접수 건", () => {
    const steps = [
      'getAuthSource() !== "database"',
      "await readSession()",
      'session.approvalStatus !== "APPROVED"',
      "await resolveActingUserForSession(session)",
      "hasPermission(",
      "await resolveRepairCaseForServer(id)",
      "await request.json()",
    ];
    let previous = -1;
    for (const step of steps) {
      const at = indexOrFail(code, step);
      assert.ok(at > previous, `'${step}' 가 차례에서 앞으로 왔다`);
      previous = at;
    }
  });

  test("🔴 권한이 접수 건 조회보다 **앞**이다 — 있는지조차 알려 주지 않는다", () => {
    assert.ok(indexOrFail(code, "hasPermission(") < indexOrFail(code, "resolveRepairCaseForServer("));
  });
});

describe("🔴 문서를 짓는 길은 공용 사슬 하나다", () => {
  test("양식 읽기 · 채우기 · 격자를 여기서 다시 적지 않는다", () => {
    assert.equal(code.split("buildServiceReportPreviewGrid(").length - 1, 1);
    for (const forbidden of [
      "fillServiceReportWorkbook",
      "readSheetPrintGrid",
      "readServiceReportTemplate",
      "validateServiceReportFields",
      "template-image",
      "TEMPLATE_PATH",
    ]) {
      assert.equal(code.includes(forbidden), false, `사슬을 다시 적었다: ${forbidden}`);
    }
  });

  test("🔴 응답에 원래 오류(`cause`)를 싣지 않는다 — 셀 주소 · 경로가 밖으로 나간다", () => {
    // 돌려주는 것은 격자 · 종류 이름 · 그림 주소 셋뿐이다.
    assert.ok(
      flat.includes(
        "{ grid: built.grid, kindLabel: built.kindLabel, templateImageBase: built.templateImageBase }"
      ),
      flat
    );
    // `cause` 가 쓰이는 자리는 **로그 한 줄**뿐이다(그 한 줄 안에서 세 번 읽는다).
    assert.equal(code.split("built.cause").length - 1, 3, "cause 를 쓰는 자리가 늘었다");
    assert.ok(
      flat.includes('console.error("[service-report-preview-grid] 미리보기를 그리지 못했다", {'),
      flat
    );
    // 🔴 로그에 담는 것은 **접수 건 id 와 오류 메시지 둘뿐**이다 — 본문 내용(고객사
    //    사정이 섞인다)이 서버 로그로 흘러서는 안 된다.
    assert.ok(
      flat.includes(
        "{ repairCaseId: repairCase.id, error: built.cause instanceof Error ? built.cause.message : String(built.cause), }"
      ),
      flat
    );
  });

  test("직인이 찍힌 문서라 중간 캐시에 남기지 않는다", () => {
    assert.ok(flat.includes('"Cache-Control": "no-store, must-revalidate"'));
  });
});
