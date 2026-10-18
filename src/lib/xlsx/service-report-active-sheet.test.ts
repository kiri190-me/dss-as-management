import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  readServiceReportTemplate,
  type ServiceReportTemplateProductKind,
} from "@/lib/storage/service-report-template";
import {
  hasTabSelected,
  parseWorkbookSheets,
  readActiveTabIndex,
  setActiveSheet,
} from "@/lib/xlsx/active-sheet";
import {
  SERVICE_REPORT_SHEET_NAME,
  type ServiceReportKind,
} from "@/lib/xlsx/service-report-template";
import { resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * 보고서도 **코드가** 활성 시트를 세운다 (2026-10-19)
 * ============================================================================
 * 그 PC 의 도우미는 통합문서가 아니라 **활성 시트 하나**만 PDF 로 바꾼다
 * (`server/quote-folder-helper.ts` 의 `$book.ActiveSheet.ExportAsFixedFormat`).
 * 견적서는 2026-10-08 부터 서버가 활성 탭을 세우고 있었지만
 * (`server/services/quote-workbook.ts` → `xlsx/active-sheet.ts`),
 * 🔴 **보고서는 양식 파일에 저장된 활성 탭에 기대고 있었다.**
 *
 * 보고서 양식에는 보고서 말고도 `List`(숨김) · `Repair_Record` · `oh 참고` 가 들어 있다.
 * 지금은 네 양식 다 `Repair_Report (한글)` 이 활성이지만, 사람이 레이아웃을 손보다가
 * **다른 탭을 켠 채 저장하면 엉뚱한 시트가 고객에게 나간다** — 아무 오류도 나지 않는다.
 * 그래서 보고서가 엑셀을 내보내는 자리에서 **견적서와 같은 함수**로 세운다.
 *
 * 여기서 보는 것은 셋이다:
 *  ㉠ **나가는 통로 셋**이 전부 `setActiveSheet` 를 거치는가 — 하나만 빠져도 그 통로로
 *     뽑은 문서에서만 조용히 엉뚱한 시트가 나간다. 통로는 디스크에서 양식을 읽어 시험에서
 *     부를 수 없으므로 **원본 글자**를 읽어 본다(이 저장소의 관례 ·
 *     `server/services/quote-workbook-active-sheet.test.ts` 와 같은 방식).
 *  ㉡ **실제 양식 넷**에 걸면 보고서 탭이 활성이 되고 다른 탭은 골라지지 않는가
 *     (경로가 설정된 양식만 돈다 — 그 파일에는 직인이 들어 있어 저장소에 없다).
 *  ㉢ 🔴 **미리보기는 일부러 빠져 있다** — 그쪽은 파일을 내보내지 않고 시트를 **이름으로**
 *     집어 격자만 읽는다(`readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME)`).
 *     활성 탭이 무엇이든 결과가 같으므로 세울 까닭이 없다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

/** 🔴 보고서 엑셀이 **밖으로 나가는** 자리 전부. 하나라도 늘면 여기에 적어야 한다. */
const EXPORT_ROUTES: readonly { label: string; path: string; sites: number }[] = [
  {
    label: "내려받기(POST · 편집 중인 장 / GET · 저장된 장)",
    path: "src/app/api/repair-cases/[id]/service-report/xlsx/route.ts",
    sites: 2,
  },
  {
    label: "연락서 폴더에 꽂기(PDF 로 바뀌는 바로 그 파일)",
    path: "src/app/api/repair-cases/[id]/service-report/contact-folder/route.ts",
    sites: 1,
  },
];

/** 양식 넷 — 문서 종류 × 제품 종류. 환경변수가 없으면 그 짝만 건너뛴다. */
const TEMPLATES: readonly {
  kind: ServiceReportKind;
  productKind: ServiceReportTemplateProductKind;
  envVar: string;
}[] = [
  { kind: "INSPECTION", productKind: "MATCHER", envVar: "MATCHER_INSPECTION_REPORT_TEMPLATE_PATH" },
  { kind: "INSPECTION", productKind: "GENERATOR", envVar: "GENERATOR_INSPECTION_REPORT_TEMPLATE_PATH" },
  { kind: "REPAIR", productKind: "MATCHER", envVar: "MATCHER_REPAIR_REPORT_TEMPLATE_PATH" },
  { kind: "REPAIR", productKind: "GENERATOR", envVar: "GENERATOR_REPAIR_REPORT_TEMPLATE_PATH" },
];

describe("㉠ 나가는 통로 셋이 전부 활성 시트를 세운다", () => {
  for (const route of EXPORT_ROUTES) {
    const source = flat(read(route.path));

    test(`${route.label} — 채운 뒤 setActiveSheet 로 감싼다(${route.sites}자리)`, () => {
      assert.equal(
        source.match(/setActiveSheet\(/g)?.length,
        route.sites,
        `활성 시트를 세우는 자리가 ${route.sites} 이 아니다: ${route.path}`
      );
      // 🔴 채우개를 **감싼다** — 채우기 전에 걸면 채우개가 새로 쓴 바이트에 묻힌다.
      assert.equal(
        source.match(/setActiveSheet\( fillServiceReportWorkbook\(/g)?.length,
        route.sites,
        `채우개를 감싸지 않았다: ${route.path}`
      );
      // 🔴 채우개를 부르는 자리마다 하나씩 — 하나만 감싸고 넘어간 통로가 없다.
      assert.equal(source.match(/fillServiceReportWorkbook\(/g)?.length, route.sites, route.path);
    });

    test(`${route.label} — 🔴 시트 이름을 베껴 적지 않는다`, () => {
      assert.equal(
        source.match(/SERVICE_REPORT_SHEET_NAME/g)?.length,
        route.sites + 1, // 쓰는 자리 + 들여오는 줄 하나
        route.path
      );
      assert.equal(
        source.includes(`"${SERVICE_REPORT_SHEET_NAME}"`),
        false,
        `시트 이름을 통로에 베껴 적었다: ${route.path}`
      );
    });
  }

  test("🔴 견적서와 **같은 함수**다 — 보고서용 복제본을 새로 만들지 않았다", () => {
    for (const route of EXPORT_ROUTES) {
      assert.ok(
        flat(read(route.path)).includes('import { setActiveSheet } from "@/lib/xlsx/active-sheet";'),
        `다른 모듈에서 가져온다: ${route.path}`
      );
    }
    assert.ok(
      flat(read("src/lib/server/services/quote-workbook.ts")).includes(
        'import { setActiveSheet } from "@/lib/xlsx/active-sheet";'
      ),
      "견적서가 쓰는 자리가 옮겨졌다"
    );
  });

  test("㉢ 미리보기는 세우지 않는다 — 시트를 이름으로 집어 격자만 읽는다", () => {
    const preview = flat(read("src/lib/server/service-report-preview-grid.ts"));
    assert.equal(preview.includes("setActiveSheet"), false, "미리보기가 활성 탭을 세운다");
    assert.ok(preview.includes("readSheetPrintGrid(workbook, SERVICE_REPORT_SHEET_NAME)"), preview);
  });
});

describe("㉡ 실제 양식 넷 — 보고서 탭만 활성이다", () => {
  for (const template of TEMPLATES) {
    const label = `${template.productKind}:${template.kind}`;
    const skip = process.env[template.envVar] ? false : `${template.envVar} 가 설정되지 않았습니다`;

    test(`${label} → 「${SERVICE_REPORT_SHEET_NAME}」 탭이 활성이고 다른 탭은 골라지지 않는다`, { skip }, async () => {
      const made = setActiveSheet(
        await readServiceReportTemplate(template.kind, template.productKind),
        SERVICE_REPORT_SHEET_NAME
      );
      const archive = ZipArchive.fromBuffer(made);
      const workbookXml = archive.readText("xl/workbook.xml");
      const names = parseWorkbookSheets(workbookXml).map((sheet) => sheet.name);

      assert.ok(
        names.includes(SERVICE_REPORT_SHEET_NAME),
        `양식에 「${SERVICE_REPORT_SHEET_NAME}」 탭이 없다: ${names.join(" · ")}`
      );
      assert.equal(readActiveTabIndex(workbookXml), names.indexOf(SERVICE_REPORT_SHEET_NAME));

      // 🔴 「고른 탭」은 하나뿐이다 — 둘이면 엑셀이 묶음으로 다루고 활성 탭과도 어긋난다.
      const selected = names.filter((name) =>
        hasTabSelected(archive.readText(resolveSheetPart(archive, name)))
      );
      assert.deepEqual(selected, [SERVICE_REPORT_SHEET_NAME]);
    });

    test(`${label} — 🔴 같은 입력이면 같은 바이트 · 한 번 더 걸어도 같다`, { skip }, async () => {
      const bytes = await readServiceReportTemplate(template.kind, template.productKind);
      const once = setActiveSheet(bytes, SERVICE_REPORT_SHEET_NAME);
      assert.ok(setActiveSheet(bytes, SERVICE_REPORT_SHEET_NAME).equals(once), "같은 입력인데 바이트가 다르다");
      assert.ok(setActiveSheet(once, SERVICE_REPORT_SHEET_NAME).equals(once), "한 번 더 걸었더니 바이트가 달라졌다");
    });
  }
});
