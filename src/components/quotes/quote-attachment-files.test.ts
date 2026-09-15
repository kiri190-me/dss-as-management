import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quoteSupplyAmountOf } from "@/lib/domain/quote-list";
import {
  EXCEL_ONLY_NO_SIGNED_PDF_TEXT,
  QUOTE_ATTACHMENT_SLOTS,
  checkQuoteAttachmentFile,
  countQuoteLinesForExcelOnly,
  createdWithAttachmentFailuresText,
  describeQuoteAttachmentFile,
  describeQuoteLineCounts,
  excelOnlyMissingExcelNotice,
  excelOnlyPrintAttachments,
  formatQuoteAttachmentUploadedAt,
  hasQuoteLines,
  isQuoteExcelAttachedOrQueued,
  pendingQuoteAttachmentQueue,
  planExcelOnlyToggle,
  quoteAttachmentDeleteText,
  quoteAttachmentDownloadUrl,
  quoteAttachmentUploadedText,
  quoteAttachmentUploadProgressText,
  quoteAttachmentUploadUrl,
  quoteAttachmentViewUrl,
  quoteListAmountNote,
  quoteListFileBadges,
  resolveQuoteSlotFile,
  resolveQuoteSlots,
  signedPdfForPreview,
  withPendingQuoteAttachment,
  type QuoteAttachmentSlotFileView,
} from "./quote-attachment-files";

/**
 * ============================================================================
 * 견적서 파일 · 엑셀 전용 — 화면의 순수 도우미 (2026-09-15 Q3)
 * ============================================================================
 * 칸 정의 · 사전 검사 · 주소 · 칸 상태(서버 칸 + 방금 한 일) · 새 견적서의 대기 파일 ·
 * 엑셀 전용 켜기/끄기와 줄 복원 · 합계 · 목록 표시 판정 · 미리보기 분기의 재료.
 * ============================================================================
 */

const MB = 1024 * 1024;

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

describe("칸 정의", () => {
  test("칸은 둘이고 차례는 결재 PDF → 수기 엑셀이다", () => {
    assert.deepEqual(
      QUOTE_ATTACHMENT_SLOTS.map((slot) => [slot.category, slot.label]),
      [
        ["SIGNED_QUOTE_PDF", "결재 견적서 PDF"],
        ["QUOTE_EXCEL", "수기 견적서 엑셀"],
      ]
    );
  });

  test("파일 고르기 칸의 accept 는 분류 허용목록의 확장자와 그 MIME 이다", () => {
    const [pdf, excel] = QUOTE_ATTACHMENT_SLOTS;
    assert.equal(pdf.accept, ".pdf,application/pdf");
    assert.equal(
      excel.accept,
      ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
    );
  });

  test("🔴 새 탭에서 페이지 안으로 보는 것은 PDF 칸뿐이다 — 엑셀은 내려받기만", () => {
    assert.deepEqual(
      QUOTE_ATTACHMENT_SLOTS.map((slot) => slot.viewableInBrowser),
      [true, false]
    );
  });
});

describe("사전 검사 — 확장자 · 빈 파일 · 20MB", () => {
  test("결재 PDF 칸은 pdf 만 받는다(대소문자 무관)", () => {
    assert.equal(checkQuoteAttachmentFile({ name: "결재본.pdf", size: 10 }, "SIGNED_QUOTE_PDF"), null);
    assert.equal(checkQuoteAttachmentFile({ name: "결재본.PDF", size: 10 }, "SIGNED_QUOTE_PDF"), null);
    for (const name of ["결재본.xlsx", "결재본.jpg", "결재본", "결재본.pdf.exe"]) {
      assert.equal(
        checkQuoteAttachmentFile({ name, size: 10 }, "SIGNED_QUOTE_PDF"),
        "결재 견적서는 PDF 로만 올릴 수 있습니다",
        name
      );
    }
  });

  test("수기 엑셀 칸은 xlsx · xls 만 받는다", () => {
    assert.equal(checkQuoteAttachmentFile({ name: "견적.xlsx", size: 10 }, "QUOTE_EXCEL"), null);
    assert.equal(checkQuoteAttachmentFile({ name: "견적.xls", size: 10 }, "QUOTE_EXCEL"), null);
    for (const name of ["견적.pdf", "견적.csv", "견적.xlsm"]) {
      assert.equal(
        checkQuoteAttachmentFile({ name, size: 10 }, "QUOTE_EXCEL"),
        "수기 견적서는 엑셀(xlsx · xls)로만 올릴 수 있습니다",
        name
      );
    }
  });

  test("🔴 형식 까닭은 올리기 통로의 415 문구와 같은 말이다 — 한쪽만 바뀌면 여기서 걸린다", () => {
    const route = read("src/app/api/quotes/[id]/attachments/route.ts");
    assert.ok(route.includes('SIGNED_QUOTE_PDF: "결재 견적서는 PDF 로만 올릴 수 있습니다"'));
    assert.ok(route.includes('QUOTE_EXCEL: "수기 견적서는 엑셀(xlsx · xls)로만 올릴 수 있습니다"'));
  });

  test("빈 파일과 20MB 초과는 보내기 전에 막는다 — 20MB 꼭 맞으면 통과", () => {
    assert.equal(checkQuoteAttachmentFile({ name: "a.pdf", size: 0 }, "SIGNED_QUOTE_PDF"), "빈 파일은 올릴 수 없습니다");
    assert.equal(checkQuoteAttachmentFile({ name: "a.pdf", size: 20 * MB }, "SIGNED_QUOTE_PDF"), null);
    assert.equal(
      checkQuoteAttachmentFile({ name: "a.xlsx", size: 20 * MB + 1 }, "QUOTE_EXCEL"),
      "20MB를 넘습니다 (20.0MB)"
    );
    assert.equal(checkQuoteAttachmentFile({ name: "a.xlsx", size: 31.5 * MB }, "QUOTE_EXCEL"), "20MB를 넘습니다 (31.5MB)");
  });

  test("형식이 먼저다 — 틀린 형식의 빈 파일은 형식 까닭으로 막힌다", () => {
    assert.equal(
      checkQuoteAttachmentFile({ name: "a.txt", size: 0 }, "SIGNED_QUOTE_PDF"),
      "결재 견적서는 PDF 로만 올릴 수 있습니다"
    );
  });
});

describe("주소", () => {
  test("올리기 — 이름 · 칸은 쿼리 문자열이고 한글 이름도 그대로 돌아온다", () => {
    const url = new URL(quoteAttachmentUploadUrl("q-1", "QUOTE_EXCEL", "견적 #1&2.xlsx"), "http://x");
    assert.equal(url.pathname, "/api/quotes/q-1/attachments");
    assert.equal(url.searchParams.get("fileName"), "견적 #1&2.xlsx");
    assert.equal(url.searchParams.get("category"), "QUOTE_EXCEL");
  });

  test("보기는 view=full(페이지 안), 내려받기는 view 없이(첨부 · 감사)", () => {
    assert.equal(quoteAttachmentViewUrl("a-1"), "/api/attachments/a-1/download?view=full");
    assert.equal(quoteAttachmentDownloadUrl("a-1"), "/api/attachments/a-1/download");
  });
});

const SERVER_FILE = {
  id: "server-1",
  originalFileName: "결재.pdf",
  fileSize: 2048,
  uploadedAt: "2026-09-15T01:00:00.000Z",
  uploadedByName: "홍길동",
};

const JUST_UPLOADED: QuoteAttachmentSlotFileView = {
  id: "new-1",
  originalFileName: "새 결재.pdf",
  fileSize: 4096,
  uploadedAt: "2026-09-15T02:00:00.000Z",
  uploadedByName: null,
};

describe("칸 상태 — 서버 칸 + 방금 한 일", () => {
  test("방금 한 일이 없으면 서버 칸 그대로(없으면 빈 칸)", () => {
    assert.deepEqual(resolveQuoteSlotFile(SERVER_FILE, undefined), SERVER_FILE);
    assert.equal(resolveQuoteSlotFile(null, undefined), null);
    assert.equal(resolveQuoteSlotFile(undefined, undefined), null);
  });

  test("방금 올렸는데 서버가 아직 옛 파일을 주면 방금 올린 것을 그린다", () => {
    assert.deepEqual(resolveQuoteSlotFile(SERVER_FILE, { kind: "uploaded", file: JUST_UPLOADED }), JUST_UPLOADED);
    assert.deepEqual(resolveQuoteSlotFile(null, { kind: "uploaded", file: JUST_UPLOADED }), JUST_UPLOADED);
  });

  test("서버가 같은 파일을 주면 서버 것 — 올린 사람 이름이 채워진다", () => {
    const caughtUp = { ...JUST_UPLOADED, uploadedByName: "김담당" };
    assert.deepEqual(resolveQuoteSlotFile(caughtUp, { kind: "uploaded", file: JUST_UPLOADED }), caughtUp);
  });

  test("그 사이 다른 사람이 더 나중에 올렸으면 서버 것이 이긴다", () => {
    const newer = { ...SERVER_FILE, id: "server-2", uploadedAt: "2026-09-15T03:00:00.000Z" };
    assert.deepEqual(resolveQuoteSlotFile(newer, { kind: "uploaded", file: JUST_UPLOADED }), newer);
  });

  test("방금 지웠으면 서버가 아직 그 파일을 줘도 빈 칸, 다른 파일이면 그 파일", () => {
    assert.equal(resolveQuoteSlotFile(SERVER_FILE, { kind: "deleted", attachmentId: "server-1" }), null);
    const other = { ...SERVER_FILE, id: "server-9" };
    assert.deepEqual(resolveQuoteSlotFile(other, { kind: "deleted", attachmentId: "server-1" }), other);
    assert.equal(resolveQuoteSlotFile(null, { kind: "deleted", attachmentId: "server-1" }), null);
  });

  test("두 칸을 한 번에 — 새 견적서(서버 칸 없음)도 방금 올린 것으로 그린다", () => {
    assert.deepEqual(resolveQuoteSlots(null, {}), { SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: null });
    assert.deepEqual(resolveQuoteSlots(null, { QUOTE_EXCEL: { kind: "uploaded", file: JUST_UPLOADED } }), {
      SIGNED_QUOTE_PDF: null,
      QUOTE_EXCEL: JUST_UPLOADED,
    });
    assert.deepEqual(
      resolveQuoteSlots({ SIGNED_QUOTE_PDF: SERVER_FILE, QUOTE_EXCEL: null }, {}),
      { SIGNED_QUOTE_PDF: SERVER_FILE, QUOTE_EXCEL: null }
    );
  });
});

describe("칸의 둘째 줄", () => {
  test("올린 때는 KST 로 — 자정을 넘기면 날짜가 넘어간다", () => {
    assert.equal(formatQuoteAttachmentUploadedAt("2026-09-15T05:03:00.000Z"), "2026-09-15 14:03");
    assert.equal(formatQuoteAttachmentUploadedAt("2026-09-15T15:30:00.000Z"), "2026-09-16 00:30");
    assert.equal(formatQuoteAttachmentUploadedAt("아무 글자"), "아무 글자");
  });

  test("크기 · 올린 때 · 올린 사람 — 방금 올려 이름을 모르면 「방금 올림」", () => {
    assert.equal(describeQuoteAttachmentFile({ ...SERVER_FILE }), "2.0 KB · 2026-09-15 10:00 · 홍길동");
    assert.equal(describeQuoteAttachmentFile(JUST_UPLOADED), "4.0 KB · 2026-09-15 11:00 · 방금 올림");
  });
});

describe("새 견적서의 대기 파일", () => {
  test("칸마다 하나 — 다시 고르면 바뀌고, 빼면 사라진다. 원본은 건드리지 않는다", () => {
    const empty = {};
    const one = withPendingQuoteAttachment<string>(empty, "QUOTE_EXCEL", "a.xlsx");
    assert.deepEqual(empty, {});
    assert.deepEqual(one, { QUOTE_EXCEL: "a.xlsx" });
    const replaced = withPendingQuoteAttachment(one, "QUOTE_EXCEL", "b.xlsx");
    assert.deepEqual(replaced, { QUOTE_EXCEL: "b.xlsx" });
    assert.deepEqual(withPendingQuoteAttachment(replaced, "QUOTE_EXCEL", null), {});
  });

  test("🔴 올릴 차례는 고른 순서가 아니라 칸 차례(결재 PDF → 엑셀)다", () => {
    let pending = withPendingQuoteAttachment<string>({}, "QUOTE_EXCEL", "a.xlsx");
    pending = withPendingQuoteAttachment(pending, "SIGNED_QUOTE_PDF", "b.pdf");
    assert.deepEqual(pendingQuoteAttachmentQueue(pending), [
      { category: "SIGNED_QUOTE_PDF", file: "b.pdf" },
      { category: "QUOTE_EXCEL", file: "a.xlsx" },
    ]);
    assert.deepEqual(pendingQuoteAttachmentQueue({}), []);
  });
});

describe("문구", () => {
  test("🔴 새 견적서 저장 뒤 실패 — 견적서는 등록됐다고, 무엇을 왜 못 올렸는지와 다시 올리는 길", () => {
    const text = createdWithAttachmentFailuresText(2, [
      { category: "QUOTE_EXCEL", fileName: "견적.xlsx", reason: "파일이 20MB를 넘습니다." },
    ]);
    assert.ok(text.startsWith("견적서는 등록됐습니다."), text);
    assert.ok(text.includes("파일 2개 중 1개를 올리지 못했습니다"), text);
    assert.ok(text.includes("수기 견적서 엑셀(견적.xlsx): 파일이 20MB를 넘습니다 · ") === false, text);
    assert.ok(text.includes("수기 견적서 엑셀(견적.xlsx): 파일이 20MB를 넘습니다."), "끝 마침표가 겹쳤다: " + text);
    assert.ok(text.includes("[다시 올리기]"), text);
  });

  test("진행 · 올린 뒤 · 바꾼 뒤", () => {
    assert.equal(quoteAttachmentUploadProgressText(1, 2), "파일 올리는 중 1/2…");
    assert.equal(quoteAttachmentUploadedText("SIGNED_QUOTE_PDF", false), "「결재 견적서 PDF」 파일을 올렸습니다.");
    assert.ok(quoteAttachmentUploadedText("QUOTE_EXCEL", true).includes("옛 파일은 첨부 휴지통으로"));
  });

  test("🔴 지우기 확인 — 첨부 휴지통으로 간다고, [저장]과 따로 바로 반영된다고 말한다", () => {
    const text = quoteAttachmentDeleteText("QUOTE_EXCEL");
    assert.equal(text.title, "「수기 견적서 엑셀」 파일을 지우시겠습니까?");
    assert.ok(text.body.includes("첨부 휴지통으로 옮깁니다"), text.body);
    assert.ok(text.body.includes("바로 반영"), text.body);
  });
});

describe("엑셀 전용 — 줄 세기", () => {
  test("저장이 거르는 빈 줄은 세지 않는다 — 서버가 세는 그대로", () => {
    const counts = countQuoteLinesForExcelOnly({
      items: [
        { partNameText: "", unitPrice: "" },
        { partNameText: "커넥터", unitPrice: "" },
        { partNameText: "  ", unitPrice: "1000" },
      ],
      workScopeTexts: ["외관검사", "   ", ""],
      repairTaskCount: 2,
    });
    assert.deepEqual(counts, { items: 2, workScopeLines: 1, repairTasks: 2 });
    assert.equal(hasQuoteLines(counts), true);
    assert.equal(describeQuoteLineCounts(counts), "부품 2줄 · 작업 내역 1줄 · 수리 작업 2건");
  });

  test("빈 첫 줄 하나뿐인 새 견적서는 줄이 없다", () => {
    const counts = countQuoteLinesForExcelOnly({
      items: [{ partNameText: "", unitPrice: "" }],
      workScopeTexts: [],
      repairTaskCount: 0,
    });
    assert.equal(hasQuoteLines(counts), false);
    assert.equal(describeQuoteLineCounts({ items: 0, workScopeLines: 3, repairTasks: 0 }), "작업 내역 3줄");
  });
});

describe("엑셀 전용 — 켜기 · 끄기와 줄 복원", () => {
  const CURRENT = { lines: ["부품 A", "외관검사"] };
  const CLEARED = { lines: [] as string[] };
  const WITH_LINES = { items: 1, workScopeLines: 1, repairTasks: 0 };
  const NO_LINES = { items: 0, workScopeLines: 0, repairTasks: 0 };

  test("🔴 줄이 있는데 아직 묻지 않았으면 켜지 않고 묻는다 — 줄 수를 들고", () => {
    const plan = planExcelOnlyToggle({
      turnOn: true,
      counts: WITH_LINES,
      confirmedClear: false,
      current: CURRENT,
      cleared: CLEARED,
      stash: null,
    });
    assert.deepEqual(plan, { kind: "ASK_TO_CLEAR", counts: WITH_LINES });
  });

  test("비우기를 고르면 켜고, 지금 줄은 넣어 두고 빈 묶음으로 바꾼다", () => {
    const plan = planExcelOnlyToggle({
      turnOn: true,
      counts: WITH_LINES,
      confirmedClear: true,
      current: CURRENT,
      cleared: CLEARED,
      stash: null,
    });
    assert.deepEqual(plan, { kind: "APPLY", isExcelOnly: true, lines: CLEARED, stash: CURRENT });
  });

  test("줄이 없으면 묻지 않고 켠다 — 그래도 지금 묶음은 넣어 둔다(손댐 표시를 돌려놓으려고)", () => {
    const plan = planExcelOnlyToggle({
      turnOn: true,
      counts: NO_LINES,
      confirmedClear: false,
      current: CURRENT,
      cleared: CLEARED,
      stash: null,
    });
    assert.deepEqual(plan, { kind: "APPLY", isExcelOnly: true, lines: CLEARED, stash: CURRENT });
  });

  test("🔴 끄면 넣어 둔 줄이 그대로 돌아온다 — 켜고 끄면 처음과 같은 묶음", () => {
    const on = planExcelOnlyToggle({
      turnOn: true,
      counts: WITH_LINES,
      confirmedClear: true,
      current: CURRENT,
      cleared: CLEARED,
      stash: null,
    });
    assert.equal(on.kind, "APPLY");
    const off = planExcelOnlyToggle({
      turnOn: false,
      counts: NO_LINES,
      confirmedClear: false,
      current: CLEARED,
      cleared: CLEARED,
      stash: on.kind === "APPLY" ? on.stash : null,
    });
    assert.deepEqual(off, { kind: "APPLY", isExcelOnly: false, lines: CURRENT, stash: null });
    assert.equal(off.kind === "APPLY" ? off.lines : null, CURRENT, "넣어 둔 바로 그 묶음이어야 한다");
  });

  test("처음부터 엑셀 전용이던 장을 끄면 줄은 그대로다(넣어 둔 것이 없다)", () => {
    const plan = planExcelOnlyToggle({
      turnOn: false,
      counts: NO_LINES,
      confirmedClear: false,
      current: CLEARED,
      cleared: CLEARED,
      stash: null,
    });
    assert.deepEqual(plan, { kind: "APPLY", isExcelOnly: false, lines: null, stash: null });
  });
});

describe("엑셀 전용 — 엑셀이 없다는 안내", () => {
  test("수정 화면: 엑셀 칸이 비었으면 안내한다 — 못 올리고 들고만 있는 파일은 세지 않는다", () => {
    const attached = isQuoteExcelAttachedOrQueued({ isNewQuote: false, excelSlot: null, hasPendingExcel: true });
    assert.equal(attached, false);
    const notice = excelOnlyMissingExcelNotice({ isExcelOnly: true, excelAttachedOrQueued: attached });
    assert.ok(notice?.startsWith("수기 견적서 엑셀을 붙여 주세요"), String(notice));
    assert.ok(notice?.includes("저장은 됩니다"), String(notice));
  });

  test("새 견적서: 엑셀을 골라 두었으면 [저장] 뒤에 올라가므로 안내하지 않는다", () => {
    const attached = isQuoteExcelAttachedOrQueued({ isNewQuote: true, excelSlot: null, hasPendingExcel: true });
    assert.equal(attached, true);
    assert.equal(excelOnlyMissingExcelNotice({ isExcelOnly: true, excelAttachedOrQueued: attached }), null);
  });

  test("엑셀 칸이 차 있거나 엑셀 전용이 아니면 안내가 없다", () => {
    assert.equal(
      isQuoteExcelAttachedOrQueued({ isNewQuote: false, excelSlot: JUST_UPLOADED, hasPendingExcel: false }),
      true
    );
    assert.equal(excelOnlyMissingExcelNotice({ isExcelOnly: false, excelAttachedOrQueued: false }), null);
  });
});

describe("합계 — 편집 화면이 넘기는 모양으로 quoteSupplyAmountOf 를 부른다", () => {
  const items = [{ quantity: Number("2") || 0, unitPrice: "12000" }];

  test("엑셀 전용이면 손으로 적은 공급가액 — 부품 줄 · 작업비는 보지 않는다", () => {
    assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "1500000", items, workCost: "300000" }), 1500000);
  });

  test("🔴 엑셀 전용인데 공급가액 칸이 비었으면 null(「—」) — 0 으로 접지 않는다", () => {
    assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "", items, workCost: "0" }), null);
    assert.equal(quoteSupplyAmountOf({ isExcelOnly: true, manualSupplyAmount: "0", items, workCost: "0" }), 0);
  });

  test("🔴 일반 견적서는 칸에 글자가 남아 있어도 부품 줄 합 + 작업비 — 예전 그대로", () => {
    assert.equal(quoteSupplyAmountOf({ isExcelOnly: false, manualSupplyAmount: "999", items, workCost: "300000" }), 324000);
  });
});

describe("목록 표시", () => {
  test("일반 견적서에 결재 PDF 가 없으면 아무것도 붙지 않는다(지금 그대로)", () => {
    assert.deepEqual(quoteListFileBadges({ isExcelOnly: false, hasSignedPdf: false, hasExcel: false }), []);
    // 일반 견적서에 엑셀이 붙어 있는 것은 따로 표시하지 않는다(받기는 앱 양식이다).
    assert.deepEqual(quoteListFileBadges({ isExcelOnly: false, hasSignedPdf: false, hasExcel: true }), []);
  });

  test("결재 PDF 가 있으면 「결재 PDF」", () => {
    assert.deepEqual(
      quoteListFileBadges({ isExcelOnly: false, hasSignedPdf: true, hasExcel: false }).map((badge) => badge.key),
      ["SIGNED_PDF"]
    );
  });

  test("🔴 엑셀 전용인데 엑셀이 없으면 「엑셀 전용」과 경고 「엑셀 없음」", () => {
    const badges = quoteListFileBadges({ isExcelOnly: true, hasSignedPdf: false, hasExcel: false });
    assert.deepEqual(
      badges.map((badge) => [badge.key, badge.label, badge.tone]),
      [
        ["EXCEL_ONLY", "엑셀 전용", "info"],
        ["EXCEL_MISSING", "엑셀 없음", "warning"],
      ]
    );
    assert.ok(badges[1].title.includes("[견적서 받기]"), badges[1].title);
  });

  test("엑셀 전용에 엑셀 · 결재 PDF 가 다 있으면 경고 없이 둘", () => {
    assert.deepEqual(
      quoteListFileBadges({ isExcelOnly: true, hasSignedPdf: true, hasExcel: true }).map((badge) => badge.key),
      ["EXCEL_ONLY", "SIGNED_PDF"]
    );
  });

  test("금액 옆 괄호 — 엑셀 전용은 「0품목」이 아니라 손으로 적은 금액이라고", () => {
    assert.equal(quoteListAmountNote({ isExcelOnly: false, itemCount: 3 }), "3품목");
    assert.equal(quoteListAmountNote({ isExcelOnly: true, itemCount: 0 }), "수기 공급가액");
  });
});

describe("미리보기의 재료", () => {
  test("인쇄 화면 — 결재 PDF 칸의 파일과 엑셀이 붙어 있는가", () => {
    assert.deepEqual(excelOnlyPrintAttachments({ SIGNED_QUOTE_PDF: SERVER_FILE, QUOTE_EXCEL: null }), {
      signedPdf: { kind: "saved", id: "server-1", originalFileName: "결재.pdf" },
      hasExcel: false,
    });
    assert.deepEqual(excelOnlyPrintAttachments({ SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: SERVER_FILE }), {
      signedPdf: null,
      hasExcel: true,
    });
  });

  test("편집 화면의 겹쳐 뜬 미리보기 — 올라간 것이 먼저, 새 견적서면 들고 있는 것", () => {
    assert.deepEqual(signedPdfForPreview({ isNewQuote: false, slot: JUST_UPLOADED, pendingFileName: "x.pdf" }), {
      kind: "saved",
      id: "new-1",
      originalFileName: "새 결재.pdf",
    });
    assert.deepEqual(signedPdfForPreview({ isNewQuote: true, slot: null, pendingFileName: "x.pdf" }), {
      kind: "pending",
      fileName: "x.pdf",
    });
    // 수정 화면에서 못 올리고 들고 있는 파일은 「올라갈 것」이 아니다.
    assert.equal(signedPdfForPreview({ isNewQuote: false, slot: null, pendingFileName: "x.pdf" }), null);
  });

  test("결재 PDF 가 없을 때의 문장은 사용자가 정한 그대로다", () => {
    assert.equal(EXCEL_ONLY_NO_SIGNED_PDF_TEXT, "결재 PDF 가 아직 없습니다 — [견적서 받기]로 붙인 엑셀을 받으세요");
  });
});
