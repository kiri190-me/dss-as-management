import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProductModelHistoryBreakdown, { FaultPartInventoryPanel } from "./ProductModelHistoryBreakdown";
import {
  FAULT_PART_INVENTORY_NOT_FOUND,
  FAULT_PART_INVENTORY_NO_KEY,
  faultPartInventoryUnreachableNotice,
  type FaultPartInventoryIndex,
  type FaultPartInventoryRow,
} from "@/lib/domain/fault-part-inventory";
import type { FaultPartDetail } from "@/lib/domain/product-model-breakdown";
import type { PieSlice } from "@/lib/domain/pie-slices";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * ============================================================================
 * 🔴 [고장 부품] 조각을 누르면 **그 부품의 재고 관리 줄이 펼쳐진다** (2026-10-29)
 * ============================================================================
 * 사용자 요청: 「고장 부품을 누르면 그 아랫부분에 **그 부품의 전체 이름과 현재 재고 등을**
 * 구체적으로 확인할 수 있도록 해줘.」 사용자 결정: 🔴 **소유구분을 나눠서 보여 준다.**
 *
 * 열쇠가 맞는지 · 문장이 셋으로 갈리는지는 unit 목록의 `fault-part-inventory.test.ts` 가
 * 값으로 본다. 여기서 보는 것은 **화면까지 연결돼 있는가**와 **실제로 그려지는가**다.
 *
 * ── 🔴 카드를 열 수 없어 **펼친 자리만 따로 그린다** ───────────────────
 * [고장 부품] 그래프는 처음에 꺼져 있고(INITIAL_OPEN_CHARTS 가 고장 증상 하나) 이 환경에는
 * 눌러 볼 도구가 없다(`renderToStaticMarkup` 뿐 — 이웃 product-model-fault-part-warning
 * .test.tsx 와 같은 형편). 그래서 펼친 자리(FaultPartInventoryPanel)를 **내보내어 따로**
 * 그려 본다. 🔵 배선(그 자리가 [고장 부품] 카드에 걸려 있는가)은 아래 글자 검사가 본다.
 *
 * 🔴 **그래서 주석을 먼저 걷어 낸다.** 이 저장소에서 소스를 글자로 재는 검사가 주석 때문에
 *    헛통과한 적이 있다(「있어야 한다」 쪽은 주석만으로 영영 통과한다).
 *
 * 🔴 고객사명·품번은 **전부 가짜**다 — 이 저장소는 공개된다.
 * ============================================================================
 */

const source = readFileSync(new URL("./ProductModelHistoryBreakdown.tsx", import.meta.url), "utf8");

/** 🔴 주석을 걷어 낸 코드. JSX 주석(`{/* … *\/}`)은 빈 `{}` 로 남는다(해롭지 않다). */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** 빈칸을 하나로 눌러 줄바꿈된 JSX 도 한 글자로 견준다. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * [고장 부품] 카드 **한 장의 코드**만 잘라 낸다 — 다음 카드([End-User])가 시작하는
 * 자리까지다.
 *
 * 🔴 **거리로 자르지 않는 까닭**(`[\s\S]{0,600}?` 같은 것): 설명 줄 한 줄만 길어져도
 *    규칙이 조용히 안 걸리고, 그때 시험은 「못 찾았다」로 실패해 **고칠 자리를 엉뚱한
 *    데서 찾게** 만든다. 카드 경계는 제목으로 분명히 갈린다.
 * 🔴 못 찾으면 **그 자리에서 실패**한다 — 빈 글자를 돌려주면 아래 단언들이 공짜로
 *    통과한다(「없다」는 쪽 단언이 특히 그렇다).
 */
function partCardCode(): string {
  const from = code.indexOf("title={CHART_LABELS.PART}");
  const to = code.indexOf("title={CHART_LABELS.END_USER}");
  assert.ok(from > 0 && to > from, "[고장 부품] 카드의 자리를 못 찾았다");
  return code.slice(from, to);
}

function inventoryRow(overrides: Partial<FaultPartInventoryRow> & { no: number }): FaultPartInventoryRow {
  return {
    // 🔵 `no` 는 기본값을 두지 않는다 — 타입이 부르는 쪽에 적게 만든다.
    name: "",
    name2: "",
    customerName: "",
    kyosanPartNo: "",
    drawingNo: "",
    quantity: 0,
    ownerLabel: "DSS",
    noteFirstLine: "",
    ...overrides,
  };
}

/** 🔴 **소유만 다른 같은 부품 둘** — 사용자가 보낸 실물의 모양이다. */
const TWO_OWNERS: FaultPartInventoryRow[] = [
  inventoryRow({
    no: 101,
    drawingNo: "DWG-AA1001",
    customerName: "종단 증폭 기판",
    name: "AMP-XX(13M)",
    name2: "AC100V",
    kyosanPartNo: "KY-7001",
    quantity: 1,
    ownerLabel: "KYOSAN",
    noteFirstLine: "라인 가 전용",
  }),
  inventoryRow({
    no: 102,
    drawingNo: "DWG-AA1001",
    customerName: "종단 증폭 기판",
    name: "AMP-XX(13M)",
    quantity: 153,
    ownerLabel: "DSS",
  }),
];

const INDEX: FaultPartInventoryIndex = {
  status: "ok",
  rowsByKey: { dwgaa1001: TWO_OWNERS },
};

function faultPartSlice(
  parts: FaultPartDetail["parts"],
  overrides: Partial<PieSlice<FaultPartDetail>> = {}
): PieSlice<FaultPartDetail> {
  const label = parts[0]?.displayName ?? "";
  return {
    key: `VALUE:${label}`,
    label,
    sliceKind: "VALUE",
    count: parts.reduce((sum, entry) => sum + entry.count, 0),
    percentage: 100,
    startAngle: 0,
    sweepAngle: 360,
    foldedGroupCount: 1,
    detail: { parts },
    ...overrides,
  };
}

function renderPanel(
  slice: PieSlice<FaultPartDetail>,
  inventory: FaultPartInventoryIndex = INDEX
): string {
  return renderToStaticMarkup(createElement(FaultPartInventoryPanel, { slice, inventory }));
}

describe("[고장 부품] 펼친 자리 — 그려지는 것", () => {
  const slice = faultPartSlice([
    { displayName: "종단 증폭 기판 (DWG-AA1001)", matchKey: "dwgaa1001", count: 3 },
  ]);

  test("🔴 **같은 품번에 소유가 둘이면 두 줄**이다 — 합치지 않는다", () => {
    const html = renderPanel(slice);

    assert.ok(html.includes("KYOSAN"), "소유구분이 안 보인다");
    assert.ok(html.includes("DSS"), "둘째 소유가 안 보인다");
    // 🔴 수를 합친 「154」가 **어디에도** 있으면 안 된다.
    assert.equal(html.includes("154"), false, `소유를 합쳐 적었다: ${html}`);
    assert.ok(html.includes("재고 1개(불러온 때 기준)"), "첫 줄의 재고가 안 보인다");
    assert.ok(html.includes("재고 153개(불러온 때 기준)"), "둘째 줄의 재고가 안 보인다");
    // 🔴 「불러온 때 기준」을 떼면 「지금 153개 있다」로 읽힌다.
    assert.equal(
      html.split("불러온 때 기준").length - 1,
      2,
      "재고 수에 언제 잰 값인지가 안 붙어 있다"
    );
    // 🔵 번호도 적는다 — 재고 관리에서 그 줄을 그대로 찾는 값이다.
    assert.ok(html.includes("No. 101") && html.includes("No. 102"), html);
  });

  test("🔴 **전체 이름**이 보인다 — 고객사 품명 · 품명 · 품명2 · 교산 품번 · 도번", () => {
    const html = renderPanel(slice);
    assert.ok(html.includes("종단 증폭 기판"), "고객사 품명이 안 보인다");
    assert.ok(html.includes("AMP-XX(13M)"), "품명이 안 보인다");
    assert.ok(html.includes("AC100V"), "품명2가 안 보인다");
    assert.ok(html.includes("KY-7001"), "교산 품번이 안 보인다");
    assert.ok(html.includes("DWG-AA1001"), "도번이 안 보인다");
    // 🔵 같은 품명이 여럿일 때 가르는 단서.
    assert.ok(html.includes("라인 가 전용"), "비고 첫 줄이 안 보인다");
  });

  test("🔴 **값이 없는 칸은 그리지 않는다** — 「없음」이 줄줄이 적히면 있는 값이 묻힌다", () => {
    const bare = renderPanel(
      faultPartSlice([{ displayName: "DWG-ZZ0001", matchKey: "k", count: 1 }]),
      {
        status: "ok",
        rowsByKey: {
          // 🔴 `-` 만 적힌 칸도 **없는 칸**이다(엑셀에서 넘어온 자료라 흔하다).
          k: [inventoryRow({ no: 900, name: "전원 퓨즈", name2: "-", customerName: "-", drawingNo: "-", kyosanPartNo: "-" })],
        },
      }
    );
    assert.ok(bare.includes("전원 퓨즈"), "이 시험의 표본이 비었다 — 품명은 보여야 한다");
    assert.equal(bare.includes(">-<"), false, `「-」 가 값인 것처럼 그려졌다: ${bare}`);
    assert.equal(bare.includes("· -"), false, `빈 칸이 점으로 이어졌다: ${bare}`);
  });

  test("🔴 **돈이 한 글자도 안 나온다** — 이 화면의 문은 productModels.view 하나다", () => {
    const html = renderPanel(slice);
    for (const word of ["견적", "단가", "원", "가격"]) {
      // 🔵 「원」은 「종단 증폭 기판」에 안 들어 있다 — 표본이 그 글자를 안 쓰게 골랐다.
      assert.equal(html.includes(word), false, `돈에 관한 글자가 떴다(${word}): ${html}`);
    }
  });

  test("🔴 **재고 관리에서 못 찾은 부품**도 깨지지 않는다 — 그 사실을 적는다", () => {
    const html = renderPanel(
      faultPartSlice([{ displayName: "DWG-ZZ9999", matchKey: "dwgzz9999", count: 1 }])
    );
    assert.ok(html.includes(FAULT_PART_INVENTORY_NOT_FOUND), html);
    // 🔴 「재고 0개」로 읽히면 안 된다.
    assert.equal(html.includes("재고 0개"), false, html);
  });

  test("🔴 **재고 관리가 멈췄으면** 그 사실이 드러난다 — 「재고 0」이 아니다", () => {
    const html = renderPanel(
      faultPartSlice([{ displayName: "DWG-AA1001", matchKey: "dwgaa1001", count: 1 }]),
      { status: "unreachable", reason: "timeout" }
    );
    assert.ok(html.includes(faultPartInventoryUnreachableNotice("timeout")), html);
    assert.equal(html.includes("재고 0개"), false, html);
    assert.equal(html.includes(FAULT_PART_INVENTORY_NOT_FOUND), false, "「없습니다」로 적었다");
  });

  test("🔴 **품번이 없는 줄**도 빈 칸을 남기지 않는다", () => {
    const html = renderPanel(faultPartSlice([{ displayName: "", matchKey: "", count: 2 }]), {
      status: "ok",
      rowsByKey: {},
    });
    assert.ok(html.includes(FAULT_PART_INVENTORY_NO_KEY), html);
  });

  test("🔴 **기타 조각**은 접힌 부품을 **저마다 제목을 달아** 펼친다", () => {
    const html = renderPanel(
      faultPartSlice(
        [
          { displayName: "종단 증폭 기판 (DWG-AA1001)", matchKey: "dwgaa1001", count: 2 },
          { displayName: "DWG-ZZ9999", matchKey: "dwgzz9999", count: 1 },
        ],
        { sliceKind: "OTHER", label: "기타", key: "OTHER:기타", foldedGroupCount: 2, count: 3 }
      )
    );
    // 🔵 범례와 같은 글자로 제목을 단다 — `기타(2종)`.
    assert.ok(html.includes("기타(2종)"), html);
    assert.ok(html.includes("종단 증폭 기판 (DWG-AA1001) · 2개"), "접힌 부품의 제목이 없다");
    assert.ok(html.includes("DWG-ZZ9999 · 1개"), "둘째 부품의 제목이 없다");
    // 🔴 접힌 부품마다 제 줄(또는 제 안내)을 갖는다.
    assert.ok(html.includes("재고 153개(불러온 때 기준)"), "첫 부품의 줄이 없다");
    assert.ok(html.includes(FAULT_PART_INVENTORY_NOT_FOUND), "둘째 부품의 안내가 없다");
  });

  test("🔵 부품이 하나뿐인 조각은 제목을 **두 번 적지 않는다**", () => {
    const html = renderPanel(slice);
    assert.equal(
      html.split("종단 증폭 기판 (DWG-AA1001)").length - 1,
      1,
      "조각 제목과 부품 제목이 같은 글자로 두 줄 적혔다"
    );
  });
});

describe("[고장 부품] 펼친 자리 — 카드까지 연결돼 있는가", () => {
  test("🔴 펼침이 붙은 카드가 **[고장 부품] 하나**다 — 다른 그래프에 붙으면 엉뚱한 곳이 열린다", () => {
    // 🔵 **선언 한 번 · 쓰임 한 번**이다(스스로 닫는 태그라 쓰임도 한 글자다). 셋이 되면
    //    다른 카드에도 붙은 것이고, 하나면 선언만 남고 아무 데도 안 걸린 것이다.
    assert.equal(
      code.split("FaultPartInventoryPanel").length - 1,
      2,
      "펼침 컴포넌트가 선언 한 번 · 쓰임 한 번이 아니다"
    );
    assert.equal(code.split("<FaultPartInventoryPanel").length - 1, 1, "그려지는 자리가 하나가 아니다");
    const partCardAt = code.indexOf("title={CHART_LABELS.PART}");
    const panelAt = code.indexOf("<FaultPartInventoryPanel");
    const endUserCardAt = code.indexOf("title={CHART_LABELS.END_USER}");
    assert.ok(partCardAt > 0 && panelAt > partCardAt, "펼침이 [고장 부품] 카드 밖에 있다");
    assert.ok(panelAt < endUserCardAt, "펼침이 다음 카드로 밀려 있다");
  });

  test("🔴 [고장 증상] 의 기존 펼침은 **그대로** 있다 — 더한 것이지 갈아 끼운 것이 아니다", () => {
    assert.ok(
      flat(code).includes("detail={(slice) => <IntakeInspectionDetailPanel slice={slice} />}"),
      "고장 증상 카드의 펼침이 사라졌다"
    );
  });

  test("🔴 **기간을 바꾸면 펼친 조각이 접힌다** — 네 그래프를 함께 지우는 그 줄이 남아 있다", () => {
    // 🔵 다른 기간에서 고른 조각이 펼쳐진 채 남으면 제목과 내용이 어긋난다.
    assert.equal(
      code.split("setSelection({});").length - 1,
      2,
      "연도·월을 바꿀 때 고른 조각을 지우는 줄이 둘이 아니다"
    );
    const changeYearAt = code.indexOf("const changeYear");
    const changeMonthAt = code.indexOf("const changeMonth");
    assert.ok(changeYearAt > 0 && changeMonthAt > changeYearAt, "기간 바꾸는 함수를 못 찾았다");
    assert.ok(
      code.indexOf("setSelection({});", changeYearAt) < changeMonthAt,
      "연도를 바꿀 때 고른 조각이 안 지워진다"
    );
    assert.ok(
      code.indexOf("setSelection({});", changeMonthAt) > changeMonthAt,
      "월을 바꿀 때 고른 조각이 안 지워진다"
    );
  });

  test("🔵 설명 줄이 **누르면 펼쳐진다**는 것을 말한다 — 적지 않으면 누를 수 있는 줄 모른다", () => {
    const note = /note="([^"]+)"[\s\S]{0,200}?warning=\{faultPartWarning\}/.exec(code);
    assert.ok(note, "[고장 부품] 카드의 설명 줄을 못 찾았다");
    assert.ok(note[1].includes("조각을 누르면"), note[1]);
  });

  /**
   * 🔴 **세는 자가 바뀌면 설명 줄도 바뀌어야 한다** (2026-10-29 사용자 요청). 같은 날
   * 오전까지 이 줄은 「반출 부품은 실제로 나간 **줄만** 셉니다」라고 적고 있었고, 그래프가
   * 수량을 세게 되면서 **틀린 말**이 되었다. 🔵 화면에서 수가 갑자기 네 배가 되는 변화라,
   * 설명 줄이 그 사실을 말하지 않으면 사람이 그래프를 안 믿게 된다.
   * 🔴 이 카드는 처음에 꺼져 있어 그려 볼 수 없다 — 그래서 **글자로** 읽는다(파일 머리말).
   */
  test("🔴 설명 줄이 **개수는 실제 수량**이라고 말한다 — 「나간 줄만」은 이제 틀린 말이다", () => {
    const note = /note="([^"]+)"[\s\S]{0,200}?warning=\{faultPartWarning\}/.exec(code);
    assert.ok(note, "[고장 부품] 카드의 설명 줄을 못 찾았다");
    assert.ok(note[1].includes("실제 수량"), `수량으로 센다는 말이 없다: ${note[1]}`);
    assert.equal(
      note[1].includes("나간 줄만"),
      false,
      `줄을 센다고 적혀 있다 — 2026-10-29 뒤로 틀린 말이다: ${note[1]}`
    );
    // 🔵 기존에 적혀 있던 말 둘은 **그대로** 있어야 한다 — 더한 것이지 갈아 끼운 것이 아니다.
    assert.ok(note[1].includes("취소·반려"), note[1]);
    assert.ok(note[1].includes("접수 건수와 합이 다릅니다"), note[1]);
  });

  test("🔴 낭독기에 읽히는 글자도 **수량 비율**이다 — 「요청 비율」이 아니다", () => {
    const aria = /ariaLabel=\{`([^`]+)`\}/.exec(partCardCode());
    assert.ok(aria, "[고장 부품] 카드의 ariaLabel 을 못 찾았다");
    assert.ok(aria[1].includes("수량 비율"), aria[1]);
    assert.equal(aria[1].includes("요청 비율"), false, aria[1]);
  });

  /**
   * 🔴 **두 수가 서로 다른 자로 세어진다** — 앞은 수량, 뒤는 건수다. 한 건에서 18개가
   * 나갔으면 「부품 18개 · 부품 기록이 있는 1건」이 맞다. 🔵 이상해 보이는 짝이라
   * 누군가 「맞추려고」 뒤엣것을 수량으로 바꾸기 쉬워서 글자로 못 박아 둔다.
   */
  test("🔴 머리의 두 수는 **수량 + 건수**다 — 뒤엣것을 수량으로 맞추면 「건」이 거짓말이 된다", () => {
    const meta = /meta=\{`([^`]+)`\}/.exec(partCardCode());
    assert.ok(meta, "[고장 부품] 카드의 meta 를 못 찾았다");
    assert.ok(meta[1].includes("부품 ${faultPart.total}개"), meta[1]);
    assert.ok(
      meta[1].includes("부품 기록이 있는 ${faultPart.caseWithPartRecordCount}건"),
      meta[1]
    );
  });
});

/** 접수 건 한 줄. 🔴 고객사명·L/N·S/N 은 **전부 가짜**다. */
function fakeCase(id: string): ResolvedRepairCase {
  return {
    id,
    version: 1,
    source: "DATABASE",
    productId: "prod-A",
    intakeNumber: `D1000${id.slice(-2)}`,
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "WAITING_INTAKE_INSPECTION",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "intake_inspection",
    receivedAt: "2026-01-01",
    customerRequestedDueDate: null,
    domesticOrderDueDates: [],
    internalTargetInspectionCompletionDate: null,
    internalTargetShipmentDate: null,
    actualShipmentDate: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    isOverdue: false,
    productCategory: "유상 매처",
    paidOrWarranty: "유상",
    billingType: "PAID",
    modelName: "TG-100",
    lotNumber: "LOT-1",
    serialNumber: "SN-1",
    partNumber: null,
    customerId: "cust-1",
    customerName: "가나다전자(주)",
    endUserId: null,
    endUserName: null,
    assignedEngineerId: null,
    engineerName: null,
    reportedSymptom: "출력 저하",
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

describe("[고장 부품] 펼친 자리 — 안 켠 카드로는 새지 않는다", () => {
  test("🔴 처음 화면(고장 증상만 켜짐)에는 재고가 한 글자도 안 뜬다", () => {
    const html = renderToStaticMarkup(
      createElement(ProductModelHistoryBreakdown, {
        resolved: [fakeCase("case-01")],
        faultParts: [
          { repairCaseId: "case-01", quantity: 1, displayName: "종단 증폭 기판 (DWG-AA1001)", matchKey: "dwgaa1001" },
        ],
        faultPartIssuedLookup: { uncountedCaseCount: 0, timedOutCaseCount: 0, timeBudgetMs: 5000 },
        faultPartInventory: INDEX,
      })
    );
    assert.ok(html.includes("고장 부품"), "이 시험의 전제가 깨졌다 — 그래프 고르는 단추가 없다");
    assert.equal(html.includes("재고 153개"), false, "안 켠 카드의 재고가 화면에 떠 있다");
    assert.equal(html.includes("불러온 때 기준"), false, html.slice(0, 400));
  });
});
