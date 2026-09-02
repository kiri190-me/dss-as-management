import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { PERMISSION_LEVELS, findPermissionArea, type PermissionLevel } from "./permission-areas";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
  canDeleteServiceReports,
  canEditServiceReports,
  canViewServiceReports,
} from "./service-report-authorization";

/**
 * ============================================================================
 * 보고서를 누가 만들 수 있는가 — 내려받기보다 약해지지 않는다
 * ============================================================================
 * 이 파일이 지키는 것은 사다리 하나가 아니라 **두 문을 같은 높이로 붙들어 두는
 * 일**이다. 보고서를 저장하는 문과 그것을 xlsx 로 뽑아 가는 문은 같은 문서를
 * 만드는 두 길이고, 한쪽만 낮아지면 낮은 쪽으로 사람이 지나간다.
 * ============================================================================
 */

const XLSX_ROUTE = new URL(
  "../../app/api/repair-cases/[id]/service-report/xlsx/route.ts",
  import.meta.url
);

describe("요구 수준", () => {
  test("보기는 READ, 만들기·고치기는 WRITE, 지우기·되살리기는 MANAGE", () => {
    assert.deepEqual(SERVICE_REPORT_REQUIRED_LEVELS, {
      view: "READ",
      edit: "WRITE",
      delete: "MANAGE",
    });
  });

  test("권한 영역은 접수 건이다 — 보고서는 자기 메뉴를 갖지 않는다", () => {
    assert.equal(SERVICE_REPORT_PERMISSION_AREA, "repairCases");
    const area = findPermissionArea(SERVICE_REPORT_PERMISSION_AREA);
    assert.ok(area, "설정 화면에 없는 영역을 요구하면 아무도 통과할 수 없다");
    // 지우기가 MANAGE 인데 영역의 상한이 그보다 낮으면, 설정에서 그 수준을 고를
    // 방법이 없어 아무도 지울 수 없는 기능이 된다.
    assert.equal(area.maxMeaningfulLevel, "MANAGE");
  });
});

describe("수준별 판정", () => {
  const allow = (level: PermissionLevel) => ({
    view: canViewServiceReports(level),
    edit: canEditServiceReports(level),
    delete: canDeleteServiceReports(level),
  });

  test("접근 불가는 아무것도 못 한다", () => {
    assert.deepEqual(allow("NONE"), { view: false, edit: false, delete: false });
  });

  test("읽기는 보기만 한다", () => {
    assert.deepEqual(allow("READ"), { view: true, edit: false, delete: false });
  });

  test("🔴 쓰기는 만들고 고칠 수 있지만 지우지는 못한다", () => {
    assert.deepEqual(allow("WRITE"), { view: true, edit: true, delete: false });
  });

  test("관리는 전부 할 수 있다", () => {
    assert.deepEqual(allow("MANAGE"), { view: true, edit: true, delete: true });
  });

  test("수준이 오를수록 넓어지기만 한다 — 중간에서 좁아지는 자리가 없다", () => {
    let previous = { view: false, edit: false, delete: false };
    for (const level of PERMISSION_LEVELS) {
      const current = allow(level);
      for (const key of ["view", "edit", "delete"] as const) {
        assert.ok(
          !previous[key] || current[key],
          `${level} 에서 ${key} 가 도로 막히면 사다리가 아니다`
        );
      }
      previous = current;
    }
  });
});

/**
 * 🔴 저장이 내려받기보다 약하면, 보기 권한만 가진 사람이 우리 회사 이름으로 적어
 * 둔 글이 다음 사람의 손에서 그대로 문서가 된다. 라우트 쪽 수준은 그 파일의
 * 머리말이 근거까지 적어 두었으므로, 여기서는 **두 값이 같은지만** 본다 — 값을
 * 베껴 적지 않고 파일에서 읽는다(work-history 화면 시험의 같은 장치).
 */
test("🔴 저장 권한은 xlsx 내려받기 권한보다 약할 수 없다", () => {
  const route = readFileSync(XLSX_ROUTE, "utf8");
  assert.ok(
    route.includes(
      `hasPermission(actingUser.role, "${SERVICE_REPORT_PERMISSION_AREA}", "${SERVICE_REPORT_REQUIRED_LEVELS.edit}")`
    ),
    "내려받기 라우트가 요구하는 영역·수준이 저장의 것과 달라졌다"
  );
});
