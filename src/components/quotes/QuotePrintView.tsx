"use client";

import Link from "next/link";
import { sumQuoteSupplyAmount } from "@/lib/domain/quote-list";
import type { QuoteEditData } from "@/lib/db/queries/quotes";
import type { QuoteTemplateHeader } from "@/lib/storage/quote-template";

/**
 * ============================================================================
 * 견적서 미리보기 · PDF — 실제 발행본과 같은 모양
 * ============================================================================
 * **JS PDF 라이브러리를 쓰지 않는다.** `window.print()` 와 `@media print` 로
 * 만든다 — 브라우저의 "PDF 로 저장"이 곧 내려받기다.
 *
 * ── 사용자가 준 실제 발행본을 보고 맞췄다 ───────────────────────────────
 * 앞선 두 판은 비슷하게 생긴 표를 새로 그린 것이었다. 실제로 나가는 PDF 는
 * 이렇게 생겼다:
 *
 *   · 제목 `견 적 서` 는 **왼쪽**, 로고는 **오른쪽 위**.
 *   · 회사 정보 블록 아래에 **굵은 가로선**, 그 위에도 한 줄.
 *   · 상단 정보는 `1.` ~ `9.` 번호 + 라벨 + 값. **9번이 은행계좌**다.
 *   · 품목 표 머리(번호/품명/수량/단가/합계)는 위아래 굵은 선 사이.
 *   · 아래 합계 셋은 상자가 아니라 **굵은 선 사이 오른쪽**에 라벨과 값.
 *   · 본문 글꼴은 명조 계열.
 *
 * ── 치수는 원본 xlsx 실측이다 ───────────────────────────────────────────
 *   · 열 A~I: 4.25 / 8.25 / 1.5 / 15.125 / 8.25 / 17.875 / 7.125 / 13.75 / 15.25
 *     (Excel 문자 단위 → px = width×7+5 → pt). 합 513.5pt = 181.1mm.
 *   · 인쇄 배율 92%, A4 세로, 여백 좌우 10mm · 위아래 15mm (pageSetup/pageMargins).
 *
 * 배율은 CSS transform 이 아니라 **수치에 미리 곱해 둔다**(SCALE) — transform 은
 * 인쇄에서 브라우저마다 다르게 처리돼 자리가 틀어진다.
 *
 * 행 높이는 고정하지 않는다. 원본은 55행짜리 격자에 맞춰 두었지만, 부품 품명이
 * 길면 줄바꿈돼야 하고 그때 칸을 고정해 두면 글자가 잘린다. 세로 자리는 각
 * 구역의 여백으로 맞춘다.
 *
 * ── 회사 정보와 계좌는 양식에서 읽어 온다 ───────────────────────────────
 * 코드에 베껴 적지 않는다. **계좌번호를 코드에도 DB 에도 두지 않는다는 규칙을
 * 지키면서** 정본과 같은 값을 보여 주는 유일한 방법이고, 상호·주소가 바뀌면
 * 양식만 고치면 따라온다(storage/quote-template.ts 의 readQuoteTemplateHeader).
 *
 * 로고와 직인도 같은 이유로 양식에서 꺼낸다(api/quotes/template-image).
 * ============================================================================
 */

const SCALE = 0.92;

/** Excel 문자 단위 → pt. px = width×7+5, pt = px×0.75. */
function colPt(chars: number): number {
  return (chars * 7 + 5) * 0.75 * SCALE;
}

const COLUMNS = [4.25, 8.25, 1.5, 15.125, 8.25, 17.875, 7.125, 13.75, 15.25];
const SHEET_WIDTH_PT = COLUMNS.reduce((sum, chars) => sum + colPt(chars), 0);

const AMOUNT = new Intl.NumberFormat("ko-KR");
const VAT_RATE = 0.1;

function won(value: number): string {
  return `₩${AMOUNT.format(Math.round(value))}`;
}

function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

/**
 * 미리보기가 실제로 읽는 값만.
 *
 * 🔴 **`id` 와 `version` 을 요구하지 않는다.** 아직 저장하지 않은 견적서도 이
 * 화면으로 그려야 하기 때문이다 — 저장하기 전에 어떻게 나갈지 보고 싶은 것이
 * 미리보기의 본래 쓸모다. id 가 있어야만 볼 수 있게 두면, 새로 만드는 사람은
 * 일단 저장해 놓고 열어 본 뒤 다시 고치는 길밖에 없다.
 */
export type QuotePrintData = Pick<
  QuoteEditData,
  | "quoteNumber"
  | "quoteDate"
  | "customerNameText"
  | "subject"
  | "validity"
  | "delivery"
  | "payment"
  | "modelNameText"
  | "serialNumberText"
  | "lotNumberText"
  | "workCost"
  | "items"
>;

function productLine(quote: QuotePrintData): string {
  const pieces: string[] = [];
  if (quote.modelNameText?.trim()) pieces.push(`MODEL: ${quote.modelNameText.trim()}`);
  if (quote.serialNumberText?.trim()) pieces.push(`S/N:${quote.serialNumberText.trim()}`);
  if (quote.lotNumberText?.trim()) pieces.push(`L/N:${quote.lotNumberText.trim()}`);
  return pieces.join(", ");
}

export default function QuotePrintView({
  quote,
  header,
  quoteId,
  onClose,
}: {
  quote: QuotePrintData;
  /** 양식에서 읽어 온 회사 정보·기본 문구·계좌. 못 읽은 칸은 null 이고 그 줄은 비운다. */
  header: QuoteTemplateHeader;
  /**
   * 저장된 견적서면 그 id, **아직 저장하지 않았으면 null**.
   *
   * 이 값이 갈라 놓는 것은 둘이다 — 돌아가는 길(주소인가 닫기인가)과 Excel
   * 받기(저장된 장에만 있다). 값 자체는 미리보기에 쓰이지 않는다.
   */
  quoteId: string | null;
  /** 저장 전 미리보기를 닫는다. quoteId 가 null 일 때만 쓰인다. */
  onClose?: () => void;
}) {
  const items = quote.items.map((item) => ({
    name: item.partNameText,
    quantity: item.quantity,
    unitPrice: Number(item.unitPrice),
  }));

  /**
   * 부품은 **있는 그대로** 적는다.
   *
   * 예전에는 다섯 줄이 넘으면 「부품 비용 일괄」 한 줄로 합쳤다. 양식의 부품 칸이
   * 다섯 줄로 고정이라 파일이 그렇게밖에 못 나갔기 때문이고, 미리보기도 파일과
   * 같아 보여야 해서 같은 규칙을 따랐다. 이제 파일이 담을 만큼 줄을 늘리므로
   * (xlsx/quote-sheet-layout.ts) 여기서도 합치지 않는다 — 합치면 미리보기에
   * 한 줄로 보이는데 파일에는 전부 적혀 나가서, 둘이 다른 문서가 된다.
   */
  const printed = items;

  const supply = sumQuoteSupplyAmount(
    quote.items.map((item) => ({ quantity: item.quantity, unitPrice: item.unitPrice })),
    quote.workCost
  );
  const vat = supply * VAT_RATE;
  const workCost = Number(quote.workCost);

  const infoRows: [string, string][] = [
    ["발행일자", formatDate(quote.quoteDate)],
    ["발행번호", quote.quoteNumber],
    ["공 급 처", quote.customerNameText],
    ["품     명", quote.subject],
    ["금     액", `${won(supply)}　(V.A.T. 별도)`],
    ["유효기간", quote.validity ?? header.defaultValidity ?? ""],
    ["납     기", quote.delivery ?? header.defaultDelivery ?? ""],
    ["결재조건", quote.payment ?? header.defaultPayment ?? ""],
    ["은행계좌", header.bankAccount ?? ""],
  ];

  return (
    <div className="qp-root">
      <style>{STYLES}</style>

      <div className="qp-toolbar">
        {quoteId === null ? (
          // 아직 저장 전이다. 주소로 돌아갈 곳이 없으므로 폼을 다시 보여 준다 —
          // 적어 둔 값이 그대로 살아 있다(폼은 그 자리에 그대로 있고 화면만 바뀐다).
          <button type="button" onClick={onClose} className="qp-btn">
            ← 편집으로 돌아가기
          </button>
        ) : (
          <Link href={`/quotes/${quoteId}`} className="qp-btn">
            ← 견적서로 돌아가기
          </Link>
        )}
        <div className="qp-toolbar-actions">
          {quoteId === null ? (
            // 🔴 Excel 은 저장된 장에서만 받을 수 있다 — 파일을 만드는 라우트가
            // DB 의 그 줄을 읽기 때문이다. 단추를 회색으로 두기만 하면 "왜 안
            // 눌리지"가 되므로, 왜인지를 그 자리에 적는다.
            <span className="qp-toolbar-note">Excel 은 저장한 뒤에 받을 수 있습니다</span>
          ) : (
            <a href={`/api/quotes/${quoteId}/xlsx`} className="qp-btn">
              Excel 받기
            </a>
          )}
          <button type="button" onClick={() => window.print()} className="qp-btn qp-btn-primary">
            인쇄 · PDF로 저장
          </button>
        </div>
      </div>
      <p className="qp-note">
        인쇄 창에서 대상 <b>&ldquo;PDF로 저장&rdquo;</b>, 용지 <b>A4</b>, 배율 <b>기본(100%)</b>,
        여백 <b>기본</b>으로 두세요. 배율 92%는 이미 반영되어 있으니 인쇄 창에서 또 줄이지 마세요.
        머리글·바닥글(주소·날짜)은 인쇄 창의 <b>&ldquo;머리글 및 바닥글&rdquo;</b> 체크를 해제하면
        사라집니다.
      </p>

      <div className="qp-page">
        <div className="qp-sheet" style={{ width: `${SHEET_WIDTH_PT}pt` }}>
          <header className="qp-top">
            <h1 className="qp-title">견 적 서</h1>
            {/* next/image 를 쓰지 않는다: 인쇄 화면이라 지연 로딩이 오히려
                방해가 되고(아직 안 뜬 그림이 빈칸으로 나간다), 인증이 걸린 API
                라우트에서 온다. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="qp-logo" src="/api/quotes/template-image/logo" alt="" />
          </header>

          <section className="qp-company">
            <p className="qp-company-name">{header.companyName ?? ""}</p>
            <p className="qp-ceo">
              <span className="qp-ceo-text">{header.ceoLine ?? ""}</span>
              {/* 직인 — drawing1.xml 앵커가 대표자 이름 끝에 겹치도록 되어 있다. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="qp-seal" src="/api/quotes/template-image/seal" alt="" />
            </p>
            <p>{header.address ?? ""}</p>
            <p>
              <span className="qp-col1">{header.tel ?? ""}</span>
              <span>{header.fax ?? ""}</span>
            </p>
            <p>
              <span className="qp-col1">{header.email ?? ""}</span>
              <span>{header.homepage ?? ""}</span>
            </p>
          </section>

          <div className="qp-rule-thick" />

          <dl className="qp-info">
            {infoRows.map(([label, value], index) => (
              <div className="qp-info-row" key={label}>
                <dt>
                  <span className="qp-info-n">{index + 1}.</span>
                  <span className="qp-info-label">{label}</span>
                  <span className="qp-info-colon">:</span>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <table className="qp-items">
            <colgroup>
              {COLUMNS.map((chars, index) => (
                <col key={index} style={{ width: `${colPt(chars)}pt` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th colSpan={2}>번 호</th>
                <th colSpan={4}>품 명</th>
                <th>수 량</th>
                <th>단 가</th>
                <th>합 계</th>
              </tr>
            </thead>
            <tbody>
              <tr className="qp-spacer-row">
                <td colSpan={9} />
              </tr>
              <tr>
                <td className="qp-c-no" colSpan={2}>
                  1.
                </td>
                <td className="qp-c-title" colSpan={7}>
                  {quote.subject}
                </td>
              </tr>
              {productLine(quote) && (
                <tr>
                  <td colSpan={2} />
                  <td className="qp-c-model" colSpan={7}>
                    {productLine(quote)}
                  </td>
                </tr>
              )}

              <tr className="qp-group-row">
                <td colSpan={2} />
                <td className="qp-c-group" colSpan={7}>
                  1)　부품 비용
                </td>
              </tr>
              {printed.length === 0 ? (
                <tr>
                  <td colSpan={2} />
                  <td className="qp-c-item qp-muted" colSpan={7}>
                    (부품 없음)
                  </td>
                </tr>
              ) : (
                printed.map((part, index) => (
                  <tr key={`${part.name}-${index}`}>
                    <td colSpan={2} />
                    <td className="qp-c-dash">-</td>
                    <td className="qp-c-item" colSpan={3}>
                      {part.name}
                    </td>
                    <td className="qp-c-qty">{part.quantity}</td>
                    <td className="qp-c-money">{won(part.unitPrice)}</td>
                    <td className="qp-c-money">{won(part.quantity * part.unitPrice)}</td>
                  </tr>
                ))
              )}

              <tr className="qp-group-row">
                <td colSpan={2} />
                <td className="qp-c-group" colSpan={4}>
                  2)　작업비 (조사,수리,개조,통전,출하검사)
                </td>
                <td className="qp-c-qty">1</td>
                <td className="qp-c-money">{won(workCost)}</td>
                <td className="qp-c-money">{won(workCost)}</td>
              </tr>
              <tr>
                <td colSpan={2} />
                <td className="qp-c-dash">*</td>
                <td className="qp-c-fine" colSpan={6}>
                  수리에 필요한 인건비, 유지관리비(계측기 유지관리, 전기 및 수도세등), 소모품등이
                  포함되어 책정된 가격입니다.
                </td>
              </tr>

              {WORK_SECTIONS.map((section) => (
                <SectionRows key={section.mark} section={section} />
              ))}
            </tbody>
          </table>

          <div className="qp-rule-thick qp-rule-totals" />
          <div className="qp-totals">
            <div className="qp-total-row">
              <span className="qp-total-label">공 급 가</span>
              <span className="qp-total-value">{won(supply)}</span>
            </div>
            <div className="qp-total-row">
              <span className="qp-total-label">부 가 세</span>
              <span className="qp-total-value">{won(vat)}</span>
            </div>
            <div className="qp-total-row qp-total-grand">
              <span className="qp-total-label">합　　계</span>
              <span className="qp-total-value">{won(supply + vat)}</span>
            </div>
          </div>
          <div className="qp-rule-thick" />
        </div>
      </div>
    </div>
  );
}

type WorkSection = { mark: string; label: string; items: string[] };

function SectionRows({ section }: { section: WorkSection }) {
  return (
    <>
      <tr className="qp-group-row">
        <td colSpan={2} />
        <td className="qp-c-group" colSpan={7}>
          {section.mark}　{section.label}
        </td>
      </tr>
      {section.items.map((line) => (
        <tr key={line}>
          <td colSpan={2} />
          <td className="qp-c-dash">-</td>
          <td className="qp-c-item" colSpan={6}>
            {line}
          </td>
        </tr>
      ))}
    </>
  );
}

/** 양식 36~52행의 고정 문구. 견적서마다 달라지는 값이 아니라 그대로 옮긴다. */
const WORK_SECTIONS: WorkSection[] = [
  {
    mark: "①",
    label: "인수 조사",
    items: ["외관검사", "파라메타 체크", "내부확인(각 보드 별 상태 확인 및 기타)"],
  },
  { mark: "②", label: "수리 작업", items: [] },
  {
    mark: "③",
    label: "통전검사[출하검사]",
    items: [
      "절연저항치・내압시험",
      "각 AMP기판의 전압・전류치 확인",
      "정격출력시험",
      "스크리닝시험",
      "오픈・쇼트시험",
      "출력의 직선성 확인",
      "에이징 시험 (정격연속출력:1시간)",
    ],
  },
  { mark: "④", label: "서류작업", items: [] },
];

const STYLES = `
.qp-root { background: #fff; color: #000; }
.qp-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem; margin-bottom: .5rem; }
.qp-toolbar-actions { display: flex; gap: .5rem; }
.qp-btn { border: 1px solid #d4d4d8; border-radius: .375rem; padding: .375rem .75rem; font-size: .875rem; text-decoration: none; color: #3f3f46; background: #fff; cursor: pointer; }
.qp-btn-primary { border-color: #18181b; background: #18181b; color: #fff; }
.qp-toolbar-note { align-self: center; font-size: .75rem; color: #71717a; }
.qp-note { margin-bottom: 1rem; font-size: .75rem; line-height: 1.7; color: #71717a; }

.qp-page { background: #fff; border: 1px solid #e4e4e7; padding: 15pt 10pt; width: fit-content; margin: 0 auto; }
.qp-sheet {
  font-family: "Batang", "바탕", "BatangChe", "Apple SD Gothic Neo", serif;
  font-size: 9.5pt; line-height: 1.5; color: #000;
}

/* 제목은 왼쪽, 로고는 오른쪽 위 — 실제 발행본 그대로. */
.qp-top { display: flex; align-items: flex-start; justify-content: space-between; }
.qp-title { margin: 0; font-size: 26pt; font-weight: 700; letter-spacing: .3em; line-height: 1.1; }
.qp-logo { max-height: 42pt; max-width: 160pt; object-fit: contain; }

.qp-company { margin-top: 6pt; padding-left: 8pt; }
.qp-company p { margin: 0; }
.qp-company-name { font-size: 13pt; font-weight: 700; }
.qp-ceo { position: relative; }
.qp-ceo-text { letter-spacing: .05em; }
.qp-seal { position: absolute; left: 74pt; top: -9pt; width: 37pt; height: 35pt; }
.qp-col1 { display: inline-block; min-width: 132pt; }

.qp-rule-thick { border-top: 2pt solid #000; margin-top: 4pt; }
.qp-rule-totals { margin-top: 10pt; }

.qp-info { margin: 6pt 0 8pt; padding-left: 8pt; }
.qp-info-row { display: flex; align-items: baseline; }
.qp-info-row dt { display: flex; flex: none; }
.qp-info-n { display: inline-block; width: 18pt; }
.qp-info-label { display: inline-block; width: 56pt; white-space: pre; }
.qp-info-colon { display: inline-block; width: 12pt; }
.qp-info-row dd { margin: 0; }

.qp-items { width: 100%; border-collapse: collapse; table-layout: fixed; }
.qp-items th { border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; padding: 2pt 3pt; font-weight: 400; text-align: center; }
.qp-items td { padding: 1pt 3pt; vertical-align: top; }
.qp-spacer-row td { height: 6pt; }
.qp-group-row td { padding-top: 5pt; }

.qp-c-no { text-align: right; padding-right: 8pt; }
.qp-c-title { font-weight: 400; }
.qp-c-model { padding-left: 12pt; }
.qp-c-group { padding-left: 10pt; }
.qp-c-dash { text-align: right; padding-right: 2pt; }
.qp-c-item { }
.qp-c-fine { font-size: 8pt; white-space: normal; }
.qp-c-qty { text-align: center; }
.qp-c-money { text-align: right; font-variant-numeric: tabular-nums; }
.qp-muted { color: #71717a; }

.qp-totals { padding: 3pt 0; }
.qp-total-row { display: flex; justify-content: flex-end; align-items: baseline; }
.qp-total-label { width: 70pt; text-align: center; letter-spacing: .1em; }
.qp-total-value { width: 110pt; text-align: right; font-variant-numeric: tabular-nums; }
.qp-total-grand .qp-total-label, .qp-total-grand .qp-total-value { font-weight: 700; }

@media print {
  @page { size: A4 portrait; margin: 15mm 10mm; }
  .qp-toolbar, .qp-note { display: none !important; }
  .qp-page { border: 0; padding: 0; margin: 0; width: auto; }
  .qp-items tr { break-inside: avoid; }
}
`;
