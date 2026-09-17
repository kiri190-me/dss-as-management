import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { CABLE_QUOTE_MAX_LINES } from "@/lib/xlsx/cable-quote-template";
import { QUOTE_KINDS, quoteKindLabels } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 케이블 견적서를 그리는 화면의 규칙 — 원본을 읽어 본다 (2026-09-16 케이블 ③)
 * ============================================================================
 * 이 화면(QuoteEditForm)은 브라우저 상태가 얽혀 있어 통째로 그려 보기 어렵다. 그래서
 * 형제 시험들과 같은 방법을 쓴다 — **원본 글자를 읽어 규칙이 제자리에 있는지** 본다
 * (quote-new-start.test.ts · quote-edit-work-scope-suppression.test.ts 와 같은 방식).
 *
 * 여기서 지키는 것 넷:
 *
 *  ㉠ **케이블이면 작업 구역이 없다** — 감추기만 하는 것이 아니라 **저장에도 안 실린다.**
 *     감춘 작업비가 실려 가면 그 장을 다시 열었을 때 보이지 않는 금액이 합계에 있다.
 *  ㉡ **설명 줄에는 수량 · 단가가 없다** — 값이 남으면 DB 가 그 줄을 거절한다
 *     (CHECK quote_items_amounts_item_line_only).
 *  ㉢ **합계는 도메인 한 곳이 가른다** — 화면이 설명 줄을 0원짜리 품목으로 접지 않는다.
 *  ㉣ **아홉 줄은 채우개의 상수 하나다** — 화면이 숫자를 다시 적지 않는다. 두 벌이 되면
 *     양식이 바뀌는 날 한쪽만 고쳐지고, 그 증상은 「저장은 됐는데 받기가 실패한다」다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = indexOrFail(source, startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const form = flat(read("src/components/quotes/QuoteEditForm.tsx"));
const newPage = flat(read("src/app/(app)/quotes/new/page.tsx"));
const editPage = flat(read("src/app/(app)/quotes/[id]/page.tsx"));
const collect = () => sliceBetween(form, "function collectFields() {", "async function handleSubmit(");

describe("㉠ 입구 — 케이블이 고를 수 있는 종류다", () => {
  test("🔴 종류 목록에 케이블이 있고 이름표가 붙어 있다", () => {
    assert.ok((QUOTE_KINDS as readonly string[]).includes("CABLE"), "케이블을 아직 고를 수 없다");
    assert.equal(quoteKindLabels.CABLE, "케이블 견적서");
  });

  test("🔴 화면은 종류 하나로 갈린다 — 갈림길이 여럿이면 한 곳만 고쳐지는 날이 온다", () => {
    assert.ok(form.includes('const isCable = kind === "CABLE";'), "케이블 갈림이 없다");
    assert.equal(form.split('kind === "CABLE"').length - 1, 1, "케이블을 가르는 곳이 하나가 아니다");
  });

  test("🔴 저장된 장은 품목 표 **전체**로 편다 — 설명 줄이 사라지지 않게", () => {
    // items 는 문서로 나가는 쪽이 읽는 품목 줄만이다(queries/quotes.ts 의 두 항목).
    assert.ok(form.includes("quote?.itemLines.length"), "품목 표를 itemLines 로 펴지 않는다");
    assert.ok(form.includes("quote.itemLines.map((item) => ({"), "품목 표를 itemLines 로 펴지 않는다");
    assert.ok(form.includes("lineKind: item.kind,"), "줄 종류를 되살리지 않는다");
    assert.ok(form.includes('partSpecText: item.partSpecText ?? "",'), "규격을 되살리지 않는다");
    // 설명 줄의 수량 · 단가는 NULL 이다 — 0 으로 접으면 품목 줄과 구별되지 않는다.
    assert.ok(form.includes('quantity: item.quantity === null ? "" : String(item.quantity),'));
    assert.ok(form.includes('unitPrice: item.unitPrice ?? "",'));
  });
});

describe("㉡ 케이블이면 작업 구역을 접고, 저장에도 안 싣는다", () => {
  test("🔴 인수번호로 불러오기 · 출고된 부품 · 세 작업 구역이 접힌다", () => {
    // 인수번호 구역 — 케이블에는 고칠 물건이 없다.
    const intake = indexOrFail(form, "{!isCable && ( <section");
    assert.ok(intake < indexOrFail(form, ">인수번호로 불러오기</h2>"), "인수번호 구역이 접는 조건 밖이다");
    // 출고된 부품(참고) — 수리 건에 딸린 값이다.
    assert.ok(form.includes("{!isCable && usedParts.length > 0 && ("), "출고된 부품 구역이 접히지 않는다");
    // 수리 작업 목록 · 작업 내역 · 작업비 — 양식에 그 구역이 없다.
    const works = indexOrFail(form, "{!isCable && ( <>");
    for (const marker of [">수리 작업 목록</span>", ">작업 내역</span>", 'label="작업비"']) {
      assert.ok(works < indexOrFail(form, marker), `${marker} 가 접는 조건 밖이다`);
    }
    // O/H 부품 템플릿은 이미 종류가 OH 일 때만 그린다 — 케이블에는 저절로 없다.
    assert.ok(form.includes('{kind === "OVERHAUL" && ( <section'), "O/H 템플릿 구역의 조건이 달라졌다");
  });

  test("🔴 감춘 값은 **저장에 실리지 않는다** — 보이지 않는 작업비가 합계에 남지 않게", () => {
    const fields = collect();
    for (const [what, marker] of [
      ["작업비", 'workCost: isCable ? "0" : workCost,'],
      ["장비 종류", "laborEquipmentKind: isCable ? null : laborKind,"],
      ["기본 작업비", "laborBaseCost: isCable || laborSuggestion.baseCost === null ? null :"],
      ["통전작업 제외", "powerTestExcluded: isCable ? false : powerTestExcluded,"],
      ["통전 차감액", "laborPowerTestDeduction: isCable || powerTestDeduction === null ? null :"],
      ["조사작업 제외", "investigationExcluded: isCable ? false : investigationExcluded,"],
      ["서류작업 제외", "documentExcluded: isCable ? false : documentExcluded,"],
      ["고른 수리 작업", "repairTasks: isCable ? [] : selectedTasks,"],
      ["작업 내역 줄", "workScopeLines: isCable ? [] :"],
    ] as const) {
      assert.ok(fields.includes(marker), `케이블인데 ${what} 를 그대로 보낸다`);
    }
  });

  test("🔴 화면의 상태는 지우지 않는다 — 종류를 되돌리면 적어 둔 것이 돌아온다", () => {
    // 비우는 일은 보내는 자리(collectFields)에서만 일어난다. 상태를 지우면 되돌릴 길이 없다.
    const setters = ["setWorkCost(", "setLaborKind(", "setTaskQuantities(", "setScopeLines("];
    for (const setter of setters) {
      assert.ok(!collect().includes(setter), `저장이 ${setter} 로 화면 상태를 지운다`);
    }
    assert.ok(!form.includes("if (isCable) setWorkCost"), "종류를 바꾸며 작업비를 지운다");
  });

  test("🔴 수리 건 연결은 끊지 않는다 — 그 건의 탭에서 소리 없이 사라지면 안 된다", () => {
    assert.ok(collect().includes("repairCaseId,"), "수리 건 연결을 보내지 않는다");
    assert.ok(!collect().includes("repairCaseId: isCable"), "케이블이면 연결을 끊는다");
  });
});

describe("㉢ 품목 표 — 규격 · 설명 줄 · 차례", () => {
  test("🔴 규격 칸은 케이블에만 있고, 다른 종류에서는 저장하지도 않는다", () => {
    assert.ok(form.includes('placeholder="규격 (없으면 비워 두세요)"'), "규격 칸이 없다");
    const specCell = sliceBetween(form, "{isCable && ( <div> <input value={row.partSpecText}", "</div> )}");
    assert.ok(specCell.includes('aria-label={`${index + 1}번째 품목 규격`}'), specCell);
    assert.ok(
      collect().includes("partSpecText: isCable && !isNote ? row.partSpecText : null,"),
      "규격을 종류와 무관하게 보낸다"
    );
  });

  test("🔴 설명 줄에는 수량 · 단가 칸이 **아예 없다** — 잠가 두면 적힌 값이 실려 간다", () => {
    const noteRow = sliceBetween(form, 'row.lineKind === "NOTE" ? (', ") : (");
    assert.ok(noteRow.includes("설명 줄 </span>"), "설명 줄임을 알아볼 표시가 없다");
    assert.ok(noteRow.includes("value={row.partNameText}"), "설명 줄에 글자 칸이 없다");
    assert.ok(noteRow.includes("aria-label={`${index + 1}번째 설명 줄`}"), "설명 줄에 이름이 없다");
    assert.ok(!noteRow.includes("value={row.quantity}"), "설명 줄에 수량 칸이 있다");
    assert.ok(!noteRow.includes("<AmountInput"), "설명 줄에 단가 칸이 있다");
    assert.ok(!noteRow.includes("row.partSpecText"), "설명 줄에 규격 칸이 있다");
    // 보내는 쪽도 못 박는다 — Number("") 가 NaN 으로 새어 나가지 않게.
    assert.ok(collect().includes("quantity: isNote ? null : Number(row.quantity),"));
    assert.ok(collect().includes("unitPrice: isNote ? null : row.unitPrice,"));
  });

  test("🔴 설명 줄은 더하고 지우는 두 길뿐이다 — 줄마다 종류를 바꾸는 스위치를 두지 않았다", () => {
    assert.ok(
      form.includes("onClick={() => addNoteRowAboveLastItem(emptyNoteItem())}"),
      "설명 줄을 더할 길이 없다"
    );
    assert.ok(form.includes("+ 설명 줄 추가"), "설명 줄 단추 글자가 달라졌다");
    // 빈 설명 줄은 수량 · 단가를 비운 채 시작한다(품목 줄은 수량 1 로 시작한다).
    const empty = sliceBetween(form, "function emptyNoteItem(): ItemRow {", "}");
    assert.ok(empty.includes('lineKind: "NOTE",'), empty);
    assert.ok(empty.includes('quantity: "",') && empty.includes('unitPrice: "",'), empty);
    assert.ok(!form.includes("updateItem(row.key, { lineKind:"), "줄 종류를 바꾸는 길이 생겼다");
  });

  test("🔴 설명 줄은 **마지막 품목 줄 위**에 들어간다 — 밑에 오는 품목들의 머리글이라서", () => {
    /**
     * 단추 둘은 서로 다른 길이다 — 설명 줄만 끼워 넣고, 품목은 지금까지처럼 끝에 붙인다.
     * (품목까지 끼워 넣으면 방금 적은 줄이 어디로 갔는지 알 수 없다.)
     */
    assert.ok(form.includes("onClick={() => addItemRow(emptyItem())}"), "품목 추가가 끝에 붙이는 길에서 벗어났다");
    assert.ok(
      form.includes("setItems((prev) => (prev.length >= maxItemLines ? prev : [...prev, row]));"),
      "끝에 붙이는 길(addItemRow)이 달라졌다"
    );

    const insert = sliceBetween(form, "function addNoteRowAboveLastItem(row: ItemRow) {", "}); }");
    // 마지막 **품목** 줄을 찾는다 — 설명 줄 뒤에 끼우면 머리글이 머리글을 설명한다.
    assert.ok(insert.includes('const lastItemAt = prev.map((line) => line.lineKind).lastIndexOf("ITEM");'), insert);
    // 그 자리에 끼운다 — 마지막 품목과 그 뒤 줄들은 차례 그대로 한 칸씩 밀린다.
    assert.ok(insert.includes("[...prev.slice(0, lastItemAt), row, ...prev.slice(lastItemAt)]"), insert);
    // 품목 줄이 하나도 없으면 얹을 것이 없다 — 그때만 끝에 붙인다.
    assert.ok(insert.includes("lastItemAt < 0 ? [...prev, row] :"), insert);
    // 어디로 들어가는지 화면에서도 말한다 — 눌러 보고 나서 알게 하지 않는다.
    assert.ok(form.includes("[+ 설명 줄 추가]는 <b>마지막 품목 줄 위</b>에"), "설명 줄 자리 안내가 없다");
  });

  test("🔴 차례가 곧 뜻이다 — 품목과 설명을 종류별로 나누지 않고 한 목록으로 보낸다", () => {
    const items = sliceBetween(collect(), "items: items", "}), }; }");
    assert.ok(!items.includes("filter((row) => row.lineKind"), "보내는 쪽이 줄 종류로 나눈다");
    assert.ok(items.includes("kind: row.lineKind,"), "줄 종류를 보내지 않는다");
  });
});

describe("㉣ 합계 — 설명 줄은 들어가지 않는다", () => {
  test("🔴 도메인 한 곳이 가른다 — 화면이 0 으로 접지 않는다", () => {
    const sum = sliceBetween(form, "const supplyAmount = useMemo(", "const vat =");
    assert.ok(sum.includes("quoteSupplyAmountOf({"), "합계를 화면이 따로 셈한다");
    assert.ok(sum.includes("kind: item.lineKind,"), "합계에 줄 종류를 넘기지 않는다");
    assert.ok(sum.includes('quantity: item.lineKind === "NOTE" ? null : Number(item.quantity) || 0,'), sum);
    assert.ok(sum.includes('unitPrice: item.lineKind === "NOTE" ? null : item.unitPrice,'), sum);
    // 셈법을 새로 짜지 않았다 — 도메인 함수 말고 더하는 자리가 없다.
    assert.ok(!form.includes("reduce((sum"), "화면이 합계를 다시 짠다");
  });
});

describe("㉤ 아홉 줄 — 화면이 미리 막는다", () => {
  test("🔴 숫자는 채우개의 상수 하나다 — 화면은 서버가 넘긴 값을 쓴다", () => {
    assert.ok(form.includes("cableMaxLines: number;"), "폼이 상한을 받지 않는다");
    assert.ok(form.includes("const maxItemLines = isCable ? cableMaxLines : MAX_QUOTE_ITEMS;"), "상한 갈림이 없다");
    /**
     * 🔴 폼은 채우개 모듈을 **값으로 가져올 수 없다** — 그 파일은 `node:fs`·`node:zlib` 를
     * 끌고 오고 이 화면은 브라우저에서 돈다(ServiceReportTabs 의 같은 항목). 그래서
     * 서버 컴포넌트인 두 페이지가 상수를 읽어 넘긴다.
     */
    assert.ok(!form.includes("lib/xlsx"), "클라이언트 화면이 xlsx 모듈을 가져온다 — 빌드가 깨진다");
    for (const [name, page] of [["새 견적서", newPage], ["수정", editPage]] as const) {
      assert.ok(
        page.includes('import { CABLE_QUOTE_MAX_LINES } from "@/lib/xlsx/cable-quote-template";'),
        `${name} 화면이 상수를 읽지 않는다`
      );
      assert.ok(page.includes("cableMaxLines={CABLE_QUOTE_MAX_LINES}"), `${name} 화면이 상한을 넘기지 않는다`);
    }
    // 그 상수가 곧 양식의 품목 자리 수다 — 숫자를 시험에도 다시 적지 않는다.
    assert.equal(CABLE_QUOTE_MAX_LINES > 0, true);
  });

  test("🔴 줄을 더하는 자리에서 막는다 — 단추를 잠그고, 더하는 함수도 막는다", () => {
    assert.ok(form.includes("const itemLinesFull = items.length >= maxItemLines;"), "찼는지 보는 곳이 없다");
    assert.ok(
      form.includes("setItems((prev) => (prev.length >= maxItemLines ? prev : [...prev, row]));"),
      "더하는 함수가 상한을 보지 않는다"
    );
    // 🔴 끼워 넣는 길(설명 줄)도 같은 상한을 본다 — 한쪽만 새면 열째 줄이 들어가고,
    //    그 증상은 저장은 되는데 [견적서 받기]가 던지는 것이다.
    assert.ok(
      sliceBetween(form, "function addNoteRowAboveLastItem(row: ItemRow) {", "}); }").includes(
        "if (prev.length >= maxItemLines) return prev;"
      ),
      "설명 줄을 끼워 넣는 함수가 상한을 보지 않는다"
    );
    assert.equal(form.split("disabled={disabled || itemLinesFull}").length - 1, 2, "두 단추가 다 잠기지 않는다");
    // 왜 못 넣는지 말한다 — 잠긴 단추만 두면 「왜 안 눌리지」가 된다.
    assert.ok(form.includes("{isCable && itemLinesFull && ("), "상한 안내가 없다");
    assert.ok(form.includes("줄이 {cableMaxLines}줄을 다 찼습니다"), "상한 안내 문구가 달라졌다");
    assert.ok(form.includes("품목 줄과 설명 줄을 합쳐 <b>{cableMaxLines}줄</b>까지"), "상한 설명이 없다");
  });
});

describe("㉥ 특이사항 · 아직 안 되는 일", () => {
  test("🔴 특이사항은 케이블에만 있고, 여러 줄이며, 그대로 다시 편다(왕복)", () => {
    assert.ok(form.includes('const [remarks, setRemarks] = useState(quote?.remarks ?? "");'), "특이사항 상태가 없다");
    const field = sliceBetween(form, '{isCable && ( <div className="sm:col-span-2"> <Field label="특이사항"', "</div> )}");
    assert.ok(field.includes("<textarea"), "특이사항이 한 줄짜리 칸이다");
    assert.ok(field.includes("value={remarks}"), field);
    assert.ok(field.includes("error={fieldErrors.remarks}"), "칸 밑에 오류가 붙지 않는다");
    assert.ok(collect().includes("remarks: isCable ? remarks : null,"), "다른 종류에서도 특이사항을 보낸다");
  });

  test("🔴 [미리보기] · [견적서 받기]의 열고 닫음은 화면이 정하지 않는다 — 함수 하나가 정한다", () => {
    /**
     * 🔴 판정은 서버 통로들과 **같은 함수 하나**다(domain/quote-document-support.ts) —
     * 케이블도 2026-09-17(케이블 ④)부터 미리보기와 받기가 **된다.** 화면은 그 함수가
     * 돌려준 값만 보고 단추를 그리고, 안 되는 종류에는 서버가 쓰는 그 문장을 그대로 적는다.
     * 화면이 종류를 다시 따지기 시작하면 서버와 갈라져, 눌렀는데 거절당하는 단추가 생긴다.
     */
    assert.ok(form.includes("const canGetDocument = canRenderQuoteDocument({ kind, isExcelOnly });"), "판정이 화면 것이다");
    assert.ok(form.includes('{canGetDocument && ( <button type="button" onClick={() => setShowPreview(true)}'), "미리보기 단추가 그대로 있다");
    assert.ok(form.includes("{savedQuote && canGetDocument && ( <QuoteIssueButton"), "받기 단추가 그대로 있다");
    // 못 하는 일을 말없이 감추지 않는다 — 문장은 서버가 돌려주는 그 하나다.
    assert.ok(form.includes("{!canGetDocument && ( <p"), "안내가 없다");
    assert.ok(form.includes("{QUOTE_DOCUMENT_UNSUPPORTED_MESSAGE} </p>"), "화면이 문장을 따로 적는다");
    // 미리보기로 넘기는 줄에서도 설명 줄은 빠진다 — 그 화면은 품목 줄만 안다.
    assert.ok(form.includes('items: items .filter((row) => row.lineKind === "ITEM")'), "미리보기에 설명 줄이 넘어간다");
  });

  test("🔴 품명 자동 제안은 케이블에서 하지 않는다 — 「수리 件」은 수리 건의 말이다", () => {
    const suggest = sliceBetween(form, "const suggestedSubject = useMemo(", "/**");
    assert.ok(suggest.includes('isCable ? "" : buildQuoteSubject({'), suggest);
    // 지어내는 규칙(내자 · OH 의 것)은 한 글자도 건드리지 않았다.
    assert.ok(
      flat(read("src/lib/domain/quote-subject.ts")).includes(
        'const suffix = input.kind === "OVERHAUL" ? `${REPAIR_SUFFIX}${OVERHAUL_SUFFIX}` : REPAIR_SUFFIX;'
      ),
      "품명 짓는 규칙이 바뀌었다"
    );
  });
});

/**
 * ============================================================================
 * ㉦ 물건 정보 네 칸 — 감추는 것과 지우는 것은 다르다 (2026-09-17)
 * ============================================================================
 * 케이블 견적서 양식에는 모델명 · L/N · S/N · 신고증상 칸이 **없다.** 그래서 화면도
 * 그리지 않는다. 그런데 ㉡ 의 작업 값들과 **정반대로 저장은 그대로 둔다** — 그 둘을
 * 가르는 것이 이 묶음의 일이다.
 *
 *  · 작업 값은 감추면 **비워 보내야** 한다 — 안 그러면 보이지 않는 금액이 합계에 남는다.
 *  · 이 네 값은 합계에 섞이지 않는다. 오히려 엑셀 자동 채우기가 이 칸들을 채우고
 *    (quote-excel-autofill-screens 의 「지금 값」 목록), 종류를 케이블로 바꿨다 되돌리면
 *    적어 둔 것이 돌아와야 한다. 비워 보내는 순간 그 둘이 다 깨진다.
 * ============================================================================
 */
describe("㉦ 모델명 · L/N · S/N · 신고증상 — 케이블에서는 그리지 않는다", () => {
  test("🔴 네 칸과 O/H 딱지가 케이블에서는 그려지지 않는다", () => {
    for (const [what, marker] of [
      ["모델명", '{!isCable && ( <Field label="모델명"'],
      ["L/N · S/N", '{!isCable && ( <div className="grid grid-cols-2 gap-4"> <Field label="L/N"'],
      // O/H 딱지는 S/N 에서 생산 연월을 읽는다 — 칸이 없으면 근거가 화면에 없는 딱지다.
      ["O/H 딱지", '{!isCable && ( <div className="sm:col-span-2"> <OverhaulBadge serialNumber={serialNumberText}'],
      ["신고증상", '{!isCable && ( <div className="sm:col-span-2"> <Field label="신고증상"'],
    ] as const) {
      assert.ok(form.includes(marker), `케이블인데 ${what} 칸을 그린다`);
    }
    // 같은 자리의 이웃들은 건드리지 않았다 — 케이블 양식에도 있는 칸들이다.
    for (const label of ["공급처", "품명(건명)", "유효기간", "납기", "결재조건"]) {
      assert.ok(form.includes(`<Field label="${label}"`), `${label} 칸이 사라졌다`);
      assert.ok(!form.includes(`{!isCable && ( <Field label="${label}"`), `${label} 칸까지 접었다`);
    }
  });

  test("🔴 감출 뿐 지우지 않는다 — 네 값은 케이블에서도 저장에 그대로 실린다", () => {
    // 🔴 작업 값들처럼 `isCable ? … : …` 로 비워 보내면 안 된다(위 머리말).
    assert.ok(
      collect().includes("modelNameText, lotNumberText, serialNumberText, faultDescriptionText,"),
      "네 값을 그대로 보내지 않는다"
    );
    for (const name of ["modelNameText", "lotNumberText", "serialNumberText", "faultDescriptionText"]) {
      assert.ok(!collect().includes(`${name}: isCable`), `${name} 를 케이블에서 비워 보낸다`);
    }
    // 상태를 지우는 길도 없다 — 종류를 되돌리면 적어 둔 것이 돌아와야 한다.
    for (const setter of ["setModelNameText(", "setLotNumberText(", "setSerialNumberText(", "setFaultDescriptionText("]) {
      assert.ok(!collect().includes(setter), `저장이 ${setter} 로 화면 상태를 지운다`);
      assert.ok(!form.includes(`if (isCable) ${setter}`), `종류를 바꾸며 ${setter} 로 지운다`);
    }
  });

  test("🔴 내자 · OH 에서는 그대로 있다 — 조건만 붙였고 칸 속은 한 글자도 안 달라졌다", () => {
    for (const [what, marker] of [
      ["모델명", "<input value={modelNameText} onChange={(e) => setModelNameText(e.target.value)}"],
      ["L/N", "<input value={lotNumberText} onChange={(e) => setLotNumberText(e.target.value)}"],
      ["S/N", "<input value={serialNumberText} onChange={(e) => setSerialNumberText(e.target.value)}"],
      ["신고증상", "<textarea value={faultDescriptionText} onChange={(e) => setFaultDescriptionText(e.target.value)}"],
    ] as const) {
      assert.ok(form.includes(marker), `${what} 칸의 속이 달라졌다`);
    }
    // 접는 조건은 `!isCable` 하나다 — 뒤집힌 조건이 붙으면 내자 · OH 에서 칸이 사라진다.
    for (const label of ["모델명", "L/N", "S/N", "신고증상"]) {
      assert.ok(!form.includes(`{isCable && ( <Field label="${label}"`), `${label} 칸이 케이블 전용이 됐다`);
    }
  });
});
