import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import type { QuoteTemplateKey } from "@/lib/domain/quote-template-variant";
import { quoteTemplateSheetName, readQuoteTemplateFor } from "@/lib/storage/quote-template";
import {
  hasTabSelected,
  parseWorkbookSheets,
  readActiveTabIndex,
  setActiveSheet,
} from "@/lib/xlsx/active-sheet";
import { CABLE_QUOTE_SHEET_NAME } from "@/lib/xlsx/cable-quote-template";
import { MATCHER_QUOTE_SHEET_NAME } from "@/lib/xlsx/matcher-quote-template";
import { OH_QUOTE_SHEET_NAME } from "@/lib/xlsx/oh-quote-template";
import { QUOTE_SHEET_NAME } from "@/lib/xlsx/quote-template";
import { resolveSheetPart } from "@/lib/xlsx/workbook-parts";
import { ZipArchive } from "@/lib/xlsx/zip-reader";

/**
 * ============================================================================
 * 「내자는 내자 탭만, OH 는 OH 탭만」 — 양식 다섯이 맞는 탭을 활성으로 내보내는가
 * ============================================================================
 * 양식 파일 하나에 시트가 여럿이다(내자 양식은 `내자견적서` · `OH견적서` · `Sheet1`).
 * PC 의 도우미가 통합문서째 PDF 로 바꾸면 **인쇄 영역이 잡힌 다른 시트가 함께 딸려
 * 나간다** — 내자 견적서를 저장했는데 PDF 에 OH 장이 붙어 고객사로 간다(사용자 요구
 * 2026-10-08). 도우미는 **활성 시트만** 내보내고, 어느 시트가 활성인지는 **서버**가 정한다.
 *
 * 여기서 보는 것은 셋이다:
 *  ㉠ **양식 키마다 맞는 시트 이름**을 고르는가 — 채우개가 실제로 채우는 그 시트인가.
 *  ㉡ **실제 양식 다섯**에 걸면 그 탭이 활성이 되고 **다른 탭은 골라지지 않는가**
 *     (경로가 설정된 양식만 돈다 — 그 파일에는 직인 · 계좌가 들어 있어 저장소에 없다).
 *  ㉢ **갈림길이 한 자리뿐인가** — `renderQuoteWorkbook` 은 디스크에서 양식을 읽어
 *     시험에서 부를 수 없으므로 형제 시험들과 같이 **원본 글자**를 읽어 본다
 *     (quote-workbook-cable.test.ts 와 같은 방식).
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");

const source = flat(read("src/lib/server/services/quote-workbook.ts"));

/**
 * 🔴 **양식 다섯 전부**. 시트 이름은 여기 베껴 적지 않고 **채우개가 들고 있는 상수**를
 * 가져다 쓴다 — 두 벌이 되면 한쪽만 고쳐지는 날이 오고, 그때는 값이 안 들어간 견적서나
 * 엉뚱한 탭이 나간다.
 */
const TEMPLATES: readonly { key: QuoteTemplateKey; envVar: string; sheetName: string }[] = [
  { key: "GENERATOR:DOMESTIC", envVar: "QUOTE_TEMPLATE_PATH", sheetName: QUOTE_SHEET_NAME },
  { key: "GENERATOR:OVERHAUL", envVar: "OH_QUOTE_TEMPLATE_PATH", sheetName: OH_QUOTE_SHEET_NAME },
  { key: "MATCHER:DOMESTIC", envVar: "MATCHER_QUOTE_TEMPLATE_PATH", sheetName: MATCHER_QUOTE_SHEET_NAME },
  { key: "MATCHER:OVERHAUL", envVar: "MATCHER_OH_QUOTE_TEMPLATE_PATH", sheetName: MATCHER_QUOTE_SHEET_NAME },
  { key: "CABLE", envVar: "CABLE_QUOTE_TEMPLATE_PATH", sheetName: CABLE_QUOTE_SHEET_NAME },
];

describe("㉠ 양식 키 → 그 양식이 쓰는 시트 이름", () => {
  test("🔴 다섯 키 전부, 채우개가 채우는 바로 그 시트를 고른다", () => {
    for (const template of TEMPLATES) {
      assert.equal(quoteTemplateSheetName(template.key), template.sheetName, template.key);
    }
  });

  test("🔴 내자와 OH 는 서로 다른 탭이다 — 이 조각이 고치려는 바로 그 자리다", () => {
    assert.notEqual(
      quoteTemplateSheetName("GENERATOR:DOMESTIC"),
      quoteTemplateSheetName("GENERATOR:OVERHAUL")
    );
  });

  test("알 수 없는 키는 던진다 — 짐작해서 아무 탭이나 고르지 않는다", () => {
    assert.throws(() => quoteTemplateSheetName("GENERATOR:UNKNOWN" as QuoteTemplateKey));
  });
});

describe("㉡ 실제 양식 다섯 — 그 탭만 활성이다", () => {
  for (const template of TEMPLATES) {
    const skip = process.env[template.envVar] ? false : `${template.envVar} 가 설정되지 않았습니다`;

    test(`${template.key} → 「${template.sheetName}」 탭이 활성이고 다른 탭은 골라지지 않는다`, { skip }, async () => {
      const made = setActiveSheet(await readQuoteTemplateFor(template.key), quoteTemplateSheetName(template.key));
      const archive = ZipArchive.fromBuffer(made);
      const workbookXml = archive.readText("xl/workbook.xml");
      const names = parseWorkbookSheets(workbookXml).map((sheet) => sheet.name);

      assert.ok(names.includes(template.sheetName), `양식에 「${template.sheetName}」 탭이 없다: ${names.join(" · ")}`);
      assert.equal(readActiveTabIndex(workbookXml), names.indexOf(template.sheetName));

      // 🔴 「고른 탭」은 **하나뿐**이다 — 둘이면 엑셀이 묶음으로 다루고, 활성 탭과도 어긋난다.
      const selected = names.filter((name) => hasTabSelected(archive.readText(resolveSheetPart(archive, name))));
      assert.deepEqual(selected, [template.sheetName]);
    });

    test(`${template.key} — 🔴 같은 입력이면 같은 바이트 · 한 번 더 걸어도 같다`, { skip }, async () => {
      const bytes = await readQuoteTemplateFor(template.key);
      const sheetName = quoteTemplateSheetName(template.key);
      const once = setActiveSheet(bytes, sheetName);
      assert.ok(setActiveSheet(bytes, sheetName).equals(once), "같은 입력인데 바이트가 다르다");
      assert.ok(setActiveSheet(once, sheetName).equals(once), "한 번 더 걸었더니 바이트가 달라졌다");
    });
  }
});

describe("㉢ 갈림길 — 활성 탭을 거는 자리가 한 곳뿐이다", () => {
  test("🔴 채우기 뒤에 **한 번** 건다 — 양식 다섯이 같은 길을 지난다", () => {
    assert.ok(
      source.includes(
        "return setActiveSheet(await fillQuoteWorkbookFor(templateKey, quote), quoteTemplateSheetName(templateKey));"
      ),
      "renderQuoteWorkbook 이 활성 탭을 걸지 않는다"
    );
    assert.equal(source.match(/setActiveSheet\(/g)?.length, 1, "활성 탭을 거는 자리가 여럿이다");
  });

  test("🔴 시트 이름을 이 파일에 베껴 적지 않는다 — 양식 표에서 꺼내 쓴다", () => {
    assert.equal(source.match(/quoteTemplateSheetName\(/g)?.length, 1);
    for (const sheetName of ["내자견적서", "OH견적서"]) {
      assert.equal(source.includes(`"${sheetName}"`), false, `시트 이름을 베껴 적었다: ${sheetName}`);
    }
  });

  test("🔴 채우개 다섯 갈래는 그대로다 — 활성 탭은 그 위에서 건다", () => {
    const branches = source.slice(source.indexOf("async function fillQuoteWorkbookFor("));
    assert.equal(branches.includes("setActiveSheet"), false, "채우개 갈래가 저마다 활성 탭을 건다");
    assert.ok(branches.includes('if (templateKey === "CABLE") { return fillCableQuoteWorkbook('));
    assert.ok(branches.includes("return fillMatcherQuoteWorkbook(await readQuoteTemplateFor(templateKey), {"));
    assert.ok(branches.includes("? fillOhQuoteWorkbook(await readOhQuoteTemplate(), {"));
    assert.ok(branches.includes(": fillQuoteWorkbook(await readQuoteTemplate(), common);"));
  });
});
