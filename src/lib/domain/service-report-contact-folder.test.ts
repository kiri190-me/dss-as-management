import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { attachmentCategoryLabels } from "./attachment-category";
import { contactFolderCategoryFolderName } from "./contact-folder-naming";
import {
  SERVICE_REPORT_CONTACT_FOLDER_CATEGORY,
  serviceReportContactFolderCategory,
  serviceReportContactFolderRelativePath,
} from "./service-report-contact-folder";

/**
 * ============================================================================
 * 보고서가 연락서 폴더 **어디에 들어가는가** — 값으로 본다 (2026-10-12)
 * ============================================================================
 * 🔴 **둘을 섞지 않는다**가 이 시험의 전부다. 한 수리 건에 검사 보고서와 수리 보고서가
 * 함께 있는 것이 보통이라, 섞이면 사람이 탐색기에서 그것을 가릴 수 없다.
 * 실제로 그 폴더에 꽂히는지는 storage/contact-folder-report-copy.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

describe("🔴 종류가 분류를 정한다 — 검사는 검사, 수리는 수리", () => {
  test("검사 보고서 → INSPECTION_REPORT → 「검사 보고서」 폴더", () => {
    const category = serviceReportContactFolderCategory("INSPECTION");
    assert.equal(category, "INSPECTION_REPORT");
    assert.equal(contactFolderCategoryFolderName(category), "검사 보고서");
  });

  test("수리 보고서 → REPAIR_REPORT → 「수리 보고서」 폴더", () => {
    const category = serviceReportContactFolderCategory("REPAIR");
    assert.equal(category, "REPAIR_REPORT");
    assert.equal(contactFolderCategoryFolderName(category), "수리 보고서");
  });

  test("🔴 둘이 같은 자리로 떨어지지 않는다", () => {
    assert.notEqual(
      serviceReportContactFolderCategory("INSPECTION"),
      serviceReportContactFolderCategory("REPAIR")
    );
    assert.notEqual(
      contactFolderCategoryFolderName(serviceReportContactFolderCategory("INSPECTION")),
      contactFolderCategoryFolderName(serviceReportContactFolderCategory("REPAIR"))
    );
  });

  test("🔴 폴더 이름을 여기서 새로 짓지 않는다 — 이름표 한 자리에서 나온다", () => {
    for (const kind of ["INSPECTION", "REPAIR"] as const) {
      const category = SERVICE_REPORT_CONTACT_FOLDER_CATEGORY[kind];
      assert.equal(contactFolderCategoryFolderName(category), attachmentCategoryLabels[category]);
    }
  });

  test("🔴 표에 종류가 둘뿐이다 — 하나가 늘면 tsc 가 빠진 칸을 짚는다", () => {
    assert.deepEqual(Object.keys(SERVICE_REPORT_CONTACT_FOLDER_CATEGORY).sort(), ["INSPECTION", "REPAIR"]);
  });
});

describe("상대 폴더 경로 — 도우미가 받을 수 있는 모양만", () => {
  const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

  test("분류 폴더가 있으면 한 겹 안이다", () => {
    assert.equal(
      serviceReportContactFolderRelativePath(FOLDER, "검사 보고서"),
      `${FOLDER}/검사 보고서`
    );
  });

  test("분류 폴더가 없으면(파일이 막았다) 연락서 폴더 하나다", () => {
    assert.equal(serviceReportContactFolderRelativePath(FOLDER, null), FOLDER);
    assert.equal(serviceReportContactFolderRelativePath(FOLDER, ""), FOLDER);
  });

  test("🔴 규칙 밖이면 null — 주소를 지어내지 않는다", () => {
    // 끝이 점 · 공백인 마디(Windows 가 조용히 떼어 다른 이름이 된다)
    assert.equal(serviceReportContactFolderRelativePath("D260908 점검요청.", "검사 보고서"), null);
    // 구분자 · 절대 경로 · 금지 글자
    assert.equal(serviceReportContactFolderRelativePath("C:\\몰래", "검사 보고서"), null);
    assert.equal(serviceReportContactFolderRelativePath(FOLDER, ".."), null);
    assert.equal(serviceReportContactFolderRelativePath("", "검사 보고서"), null);
  });
});
