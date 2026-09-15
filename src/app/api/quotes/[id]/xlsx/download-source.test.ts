import { test } from "node:test";
import assert from "node:assert/strict";

import { QUOTE_EXCEL_MISSING_MESSAGE, decideQuoteDownloadSource } from "./download-source";

/**
 * [견적서 받기]의 파일 고르기(2026-09-15 Q2) — 엑셀 전용 견적서는 붙인 엑셀을 그대로,
 * 일반 견적서는 예전처럼 앱 양식. 라우트는 세션을 읽어 시험에서 부르지 않으므로
 * (이 저장소의 관례) 라우트가 부르는 이 순수 함수를 여기서 못박는다.
 */

const QUOTE_ID = "7d3f0c1e-0000-4000-8000-000000000001";

function file(
  id: string,
  category: "SIGNED_QUOTE_PDF" | "QUOTE_EXCEL",
  options: { isDeleted?: boolean; uploadedAt?: string; extension?: string } = {}
) {
  return {
    id,
    category,
    isDeleted: options.isDeleted ?? false,
    uploadedAt: options.uploadedAt ?? "2026-09-15T01:00:00.000Z",
    storedPath: `quotes/${QUOTE_ID}/${id}.${options.extension ?? (category === "QUOTE_EXCEL" ? "xlsx" : "pdf")}`,
  };
}

test("🔴 일반 견적서는 붙인 엑셀이 있어도 예전 그대로 앱 양식이다", () => {
  const attachments = [file("excel", "QUOTE_EXCEL"), file("pdf", "SIGNED_QUOTE_PDF")];
  assert.deepEqual(decideQuoteDownloadSource({ isExcelOnly: false }, attachments), { kind: "TEMPLATE" });
  assert.deepEqual(decideQuoteDownloadSource({ isExcelOnly: false }, []), { kind: "TEMPLATE" });
});

test("엑셀 전용 견적서는 엑셀 칸의 살아 있는 파일을 그대로 — 결재 PDF 는 고르지 않는다", () => {
  const source = decideQuoteDownloadSource({ isExcelOnly: true }, [
    file("pdf", "SIGNED_QUOTE_PDF", { uploadedAt: "2026-09-15T09:00:00.000Z" }),
    file("excel", "QUOTE_EXCEL"),
  ]);
  assert.equal(source.kind, "ATTACHED_EXCEL");
  if (source.kind !== "ATTACHED_EXCEL") return;
  assert.equal(source.attachment.id, "excel");
  assert.equal(source.extension, "xlsx");
});

test("옛 xls 는 xls 로 내려준다 — 저장 경로의 확장자를 따른다", () => {
  const source = decideQuoteDownloadSource({ isExcelOnly: true }, [file("old", "QUOTE_EXCEL", { extension: "xls" })]);
  assert.equal(source.kind === "ATTACHED_EXCEL" && source.extension, "xls");
});

test("🔴 칸 교체로 휴지통에 간 옛 엑셀은 고르지 않는다 — 수정 화면의 칸과 같은 파일이 나간다", () => {
  const source = decideQuoteDownloadSource({ isExcelOnly: true }, [
    file("replaced", "QUOTE_EXCEL", { isDeleted: true, uploadedAt: "2026-09-15T09:00:00.000Z" }),
    file("current", "QUOTE_EXCEL", { uploadedAt: "2026-09-15T08:00:00.000Z" }),
  ]);
  assert.equal(source.kind === "ATTACHED_EXCEL" && source.attachment.id, "current");
});

test("엑셀 전용인데 붙인 엑셀이 없으면 MISSING_EXCEL — 앱 양식으로 대신 채우지 않는다", () => {
  assert.deepEqual(decideQuoteDownloadSource({ isExcelOnly: true }, []), { kind: "MISSING_EXCEL" });
  assert.deepEqual(
    decideQuoteDownloadSource({ isExcelOnly: true }, [
      file("pdf", "SIGNED_QUOTE_PDF"),
      file("trashed", "QUOTE_EXCEL", { isDeleted: true }),
    ]),
    { kind: "MISSING_EXCEL" }
  );
  // 사람이 읽는 문장 — 무엇을 하면 되는지까지 말하고, 내부 경로는 담지 않는다.
  assert.match(QUOTE_EXCEL_MISSING_MESSAGE, /엑셀/);
  assert.ok(!QUOTE_EXCEL_MISSING_MESSAGE.includes("quotes/"));
});
