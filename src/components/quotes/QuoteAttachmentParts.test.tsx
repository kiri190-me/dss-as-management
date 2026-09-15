import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ExcelOnlyClearLinesDialog,
  ExcelOnlySwitch,
  QuoteAttachmentDeleteDialog,
  QuoteAttachmentSlotsView,
  QuoteFileBadges,
  type PendingFileLike,
  type QuoteAttachmentSlotsMode,
} from "./QuoteAttachmentParts";
import type { QuoteAttachmentSlotCategory } from "@/lib/domain/attachment-category";
import type { QuoteAttachmentSlotFileView, ResolvedQuoteSlots } from "./quote-attachment-files";

/**
 * ============================================================================
 * 견적서 파일 · 엑셀 전용 — 그리기 조각이 무엇을 그리는가
 * ============================================================================
 * QuoteEditForm · QuoteAttachmentsSection 은 서버 액션을 부르고 그 사슬 끝에
 * `server-only` 가 있어 이 시험 환경에서 그려 볼 수 없다. 그래서 조각을 따로 그려 보고,
 * 화면이 조각을 제자리에서 부르는지는 quote-attachment-screens.test.ts 가 원본을 읽어 본다.
 * ============================================================================
 */

const PDF_FILE: QuoteAttachmentSlotFileView = {
  id: "att-pdf",
  originalFileName: "DSS 2026-077 결재본.pdf",
  fileSize: 2048,
  uploadedAt: "2026-09-15T05:03:00.000Z",
  uploadedByName: "홍길동",
};

const EXCEL_FILE: QuoteAttachmentSlotFileView = {
  id: "att-xlsx",
  originalFileName: "DSS 2026-077 수기.xlsx",
  fileSize: 4096,
  uploadedAt: "2026-09-15T06:00:00.000Z",
  uploadedByName: null,
};

function renderSlots(props: {
  mode: QuoteAttachmentSlotsMode;
  slots?: Partial<ResolvedQuoteSlots>;
  pending?: Partial<Record<QuoteAttachmentSlotCategory, PendingFileLike>>;
  errors?: Partial<Record<QuoteAttachmentSlotCategory, string>>;
  busyCategory?: QuoteAttachmentSlotCategory | null;
  statusText?: string | null;
  notice?: string | null;
}): string {
  return renderToStaticMarkup(
    <QuoteAttachmentSlotsView
      mode={props.mode}
      slots={{ SIGNED_QUOTE_PDF: null, QUOTE_EXCEL: null, ...props.slots }}
      pending={props.pending ?? {}}
      errors={props.errors ?? {}}
      busyCategory={props.busyCategory ?? null}
      statusText={props.statusText ?? null}
      notice={props.notice ?? null}
      disabled={false}
      onPickFile={() => {}}
      onRetry={() => {}}
      onClearPending={() => {}}
      onRequestDelete={() => {}}
    />
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("두 칸 — 저장된 견적서(수정 화면)", () => {
  const html = renderSlots({ mode: "saved", slots: { SIGNED_QUOTE_PDF: PDF_FILE, QUOTE_EXCEL: EXCEL_FILE } });

  test("칸 이름 둘과 지금 파일(이름 · 크기 · 올린 때 · 올린 사람)", () => {
    assert.ok(html.includes("결재 견적서 PDF") && html.includes("수기 견적서 엑셀"), html);
    assert.ok(html.includes("DSS 2026-077 결재본.pdf"), html);
    assert.ok(html.includes("2.0 KB · 2026-09-15 14:03 · 홍길동"), html);
    // 방금 올려 이름을 모르는 파일.
    assert.ok(html.includes("4.0 KB · 2026-09-15 15:00 · 방금 올림"), html);
  });

  test("🔴 [보기]는 PDF 칸에만 — 새 탭에서 view=full 로 연다", () => {
    assert.equal(count(html, ">보기<"), 1);
    assert.ok(
      html.includes('href="/api/attachments/att-pdf/download?view=full" target="_blank" rel="noopener noreferrer"'),
      html
    );
    assert.ok(!html.includes("att-xlsx/download?view=full"), "엑셀을 페이지 안으로 열려 한다");
  });

  test("[내려받기] · [바꾸기] · [지우기]가 칸마다 하나씩", () => {
    assert.equal(count(html, ">내려받기<"), 2);
    assert.ok(html.includes('href="/api/attachments/att-pdf/download"'), html);
    assert.ok(html.includes('href="/api/attachments/att-xlsx/download"'), html);
    assert.equal(count(html, ">바꾸기<"), 2);
    assert.equal(count(html, ">지우기<"), 2);
    assert.ok(html.includes('aria-label="결재 견적서 PDF 지우기"'), html);
    assert.equal(count(html, ">파일 올리기<"), 0, "파일이 있는 칸에 [파일 올리기]가 있다");
  });

  test("파일 고르기 칸은 칸마다 받는 형식만 — 하나씩(multiple 아님)", () => {
    assert.ok(html.includes('accept=".pdf,application/pdf"'), html);
    assert.ok(html.includes('accept=".xlsx,.xls,'), html);
    assert.ok(!html.includes("multiple"), "칸마다 파일은 하나다");
  });

  test("🔴 [저장]과 따로 곧바로 반영된다고 적는다", () => {
    assert.ok(html.includes("[저장]을 누르지 않아도 바로 반영됩니다"), html);
    assert.ok(html.includes("옛 파일은 첨부 휴지통으로"), html);
  });

  test("폭 400px 에서도 넘치지 않는다 — 좁으면 한 줄에 한 칸, 긴 이름은 줄바꿈", () => {
    assert.ok(html.includes("grid gap-3 sm:grid-cols-2"), html);
    assert.ok(html.includes("break-all"), html);
    assert.ok(html.includes("min-w-0"), html);
  });
});

describe("빈 칸", () => {
  test("수정 화면의 빈 칸 — 안내와 [파일 올리기]뿐, 보기 · 내려받기 · 지우기 없음", () => {
    const html = renderSlots({ mode: "saved" });
    assert.equal(count(html, "아직 붙인 파일이 없습니다."), 2);
    assert.equal(count(html, ">파일 올리기<"), 2);
    for (const absent of [">보기<", ">내려받기<", ">지우기<", ">바꾸기<"]) {
      assert.ok(!html.includes(absent), `빈 칸에 '${absent}' 가 있다`);
    }
  });

  test("수정 화면에서 못 올린 파일은 까닭과 함께 들고 [다시 올리기] · [빼기]", () => {
    const html = renderSlots({
      mode: "saved",
      pending: { QUOTE_EXCEL: { name: "수기.xlsx", size: 10 } },
      errors: { QUOTE_EXCEL: "네트워크 문제로 보내지 못했습니다" },
    });
    assert.ok(html.includes("올리지 못한 파일: 수기.xlsx — 네트워크 문제로 보내지 못했습니다"), html);
    assert.ok(html.includes(">다시 올리기<"), html);
    assert.ok(html.includes(">빼기<"), html);
  });

  test("사전 검사에 걸린 까닭은 칸 안에 보인다", () => {
    const html = renderSlots({
      mode: "saved",
      errors: { SIGNED_QUOTE_PDF: "결재.jpg: 결재 견적서는 PDF 로만 올릴 수 있습니다" },
    });
    assert.ok(html.includes('role="alert"'), html);
    assert.ok(html.includes("결재 견적서는 PDF 로만 올릴 수 있습니다"), html);
  });

  test("올리는 중인 칸", () => {
    const html = renderSlots({ mode: "saved", busyCategory: "SIGNED_QUOTE_PDF" });
    assert.equal(count(html, "올리는 중…"), 1);
  });
});

describe("새 견적서 — 들고 있다가 [저장] 뒤에 올린다", () => {
  test("🔴 들고 있다고 적는다 — 고른 파일은 [저장]하면 올라간다", () => {
    const html = renderSlots({ mode: "pending", pending: { SIGNED_QUOTE_PDF: { name: "결재.pdf", size: 2048 } } });
    assert.ok(html.includes("아직 저장 전이라 고른 파일을 들고만 있습니다"), html);
    assert.ok(html.includes("결재.pdf"), html);
    assert.ok(html.includes("2.0 KB · [저장]하면 올라갑니다"), html);
    assert.ok(html.includes(">다른 파일로<") && html.includes(">빼기<"), html);
    // 아직 서버에 없는 파일이다 — 보기 · 내려받기 · 지우기가 있을 수 없다.
    for (const absent of [">보기<", ">내려받기<", ">지우기<"]) {
      assert.ok(!html.includes(absent), `대기 파일에 '${absent}' 가 있다`);
    }
    // 다른 칸은 비어 있다.
    assert.ok(html.includes("아직 고른 파일이 없습니다."), html);
    assert.equal(count(html, ">파일 올리기<"), 1);
  });
});

describe("엑셀 전용 안내 · 방금 한 일", () => {
  test("안내가 오면 구역 맨 위에 눈에 띄게, 없으면 그리지 않는다", () => {
    const notice = "수기 견적서 엑셀을 붙여 주세요 — 테스트";
    const withNotice = renderSlots({ mode: "saved", notice });
    assert.ok(withNotice.includes(notice), withNotice);
    assert.ok(withNotice.indexOf(notice) < withNotice.indexOf("결재 견적서 PDF"), "안내가 칸 아래에 있다");
    assert.ok(withNotice.includes("border-amber-300"), withNotice);
    assert.ok(!renderSlots({ mode: "saved" }).includes("수기 견적서 엑셀을 붙여 주세요"));
  });

  test("방금 한 일의 한 줄", () => {
    const html = renderSlots({ mode: "saved", statusText: "「결재 견적서 PDF」 파일을 올렸습니다." });
    assert.ok(html.includes('role="status"') && html.includes("파일을 올렸습니다."), html);
  });
});

describe("지우기 확인 창", () => {
  test("🔴 첨부 휴지통으로 간다고 말하고, 무엇을 지우는지 보인다", () => {
    const html = renderToStaticMarkup(
      <QuoteAttachmentDeleteDialog
        category="SIGNED_QUOTE_PDF"
        file={PDF_FILE}
        isSubmitting={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.ok(html.includes("「결재 견적서 PDF」 파일을 지우시겠습니까?"), html);
    assert.ok(html.includes("첨부 휴지통으로 옮깁니다"), html);
    assert.ok(html.includes("DSS 2026-077 결재본.pdf"), html);
    assert.ok(html.includes(">취소<") && html.includes(">지우기<"), html);
  });

  test("옮기는 중 · 실패 문장", () => {
    const html = renderToStaticMarkup(
      <QuoteAttachmentDeleteDialog
        category="QUOTE_EXCEL"
        file={EXCEL_FILE}
        isSubmitting={true}
        error="파일을 찾을 수 없습니다."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.ok(html.includes("옮기는 중..."), html);
    assert.ok(html.includes("파일을 찾을 수 없습니다."), html);
  });
});

describe("엑셀 전용 스위치 · 줄 비우기 확인", () => {
  test("스위치 — 체크 상태는 부르는 쪽의 값, 무엇이 달라지는지 적는다", () => {
    const on = renderToStaticMarkup(<ExcelOnlySwitch checked={true} disabled={false} onToggle={() => {}} />);
    const off = renderToStaticMarkup(<ExcelOnlySwitch checked={false} disabled={false} onToggle={() => {}} />);
    assert.ok(on.includes('checked=""'), on);
    assert.ok(!off.includes('checked=""'), off);
    assert.ok(on.includes("엑셀 전용 견적서"), on);
    assert.ok(on.includes("공급가액을 직접"), on);
    assert.ok(on.includes("[견적서 받기]"), on);
  });

  test("🔴 줄 비우기 확인 — 줄이 있으면 저장이 거절된다고, 무엇을 비우는지, 끄면 돌아온다고", () => {
    const html = renderToStaticMarkup(
      <ExcelOnlyClearLinesDialog
        counts={{ items: 2, workScopeLines: 3, repairTasks: 0 }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.ok(html.includes("저장이 거절됩니다"), html);
    assert.ok(html.includes("부품 2줄 · 작업 내역 3줄"), html);
    assert.ok(!html.includes("수리 작업 0건"), "없는 줄을 센다");
    assert.ok(html.includes("비운 줄이 그대로 돌아옵니다"), html);
    assert.ok(html.includes(">줄을 비우고 켜기<") && html.includes(">취소<"), html);
    // 「저장하면 지워집니다」가 아니다 — 서버는 조용히 지우지 않고 거절한다.
    assert.ok(!html.includes("저장하면 품목 · 작업 줄이 지워집니다"), html);
  });
});

describe("목록 표시", () => {
  test("엑셀 전용 · 엑셀 없음 — 경고는 호박색, 설명은 마우스를 올리면", () => {
    const html = renderToStaticMarkup(
      <QuoteFileBadges row={{ isExcelOnly: true, hasSignedPdf: false, hasExcel: false }} />
    );
    assert.ok(html.includes(">엑셀 전용<"), html);
    assert.ok(html.includes(">엑셀 없음<"), html);
    assert.ok(html.includes("border-amber-300"), html);
    assert.ok(html.includes('title="엑셀 전용인데 수기 견적서 엑셀이 붙지 않아'), html);
  });

  test("결재 PDF 있음", () => {
    const html = renderToStaticMarkup(
      <QuoteFileBadges row={{ isExcelOnly: false, hasSignedPdf: true, hasExcel: false }} />
    );
    assert.equal(html.includes(">결재 PDF<"), true, html);
    assert.equal(html.includes("엑셀"), false, html);
  });

  test("붙일 것이 없으면 아무것도 그리지 않는다 — 일반 견적서 줄은 지금 그대로", () => {
    assert.equal(
      renderToStaticMarkup(<QuoteFileBadges row={{ isExcelOnly: false, hasSignedPdf: false, hasExcel: true }} />),
      ""
    );
  });
});
