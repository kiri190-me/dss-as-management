import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExcelImportPreviewEmptyRow, ExcelImportPreviewFilterCards } from "./ExcelImportPreviewFilterCards";

describe("ExcelImportPreviewFilterCards", () => {
  test("renders full-card native buttons with one accessible selected state", () => {
    const html = renderToStaticMarkup(
      <ExcelImportPreviewFilterCards
        selected="CONFLICT"
        counts={{ total: 661, executable: 652, autoExcluded: 1, conflicts: 8, imported: 0 }}
        onSelect={() => {}}
      />,
    );

    assert.equal((html.match(/<button/g) ?? []).length, 5);
    assert.equal((html.match(/type="button"/g) ?? []).length, 5);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 4);
    for (const value of ["661", "652", "1", "8", "0", "전체", "접수 가능", "자동 제외", "충돌", "완료"]) {
      assert.match(html, new RegExp(`>${value}<`));
    }
  });

  test("renders a non-error empty result message across the Preview table", () => {
    const html = renderToStaticMarkup(<table><tbody><ExcelImportPreviewEmptyRow /></tbody></table>);
    assert.match(html, /colSpan="18"/);
    assert.match(html, /해당하는 항목이 없습니다/);
  });
});
