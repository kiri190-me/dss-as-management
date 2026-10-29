import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProductModelHistoryBreakdown from "./ProductModelHistoryBreakdown";
import { faultPartIssuedWarning } from "@/lib/domain/product-model-breakdown";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * ============================================================================
 * 🔴 **못 센 건이 있다는 말이 [고장 부품] 카드에 실제로 실리는가** (2026-10-29)
 * ============================================================================
 * 반출 확인된 부품은 수리 건마다 재고 관리에 한 번씩 물어 모은다. 일부만 받아 온 날
 * 그 사실을 안 적으면 사람은 적은 수를 보고 **「이 모델은 이 부품이 적게 고장난다」**는
 * 틀린 결론을 낸다. 문장과 수는 `product-model-breakdown.test.ts` 가 값으로 재고,
 * 여기서 재는 것은 **그 문장이 화면까지 연결돼 있는가**다.
 *
 * ── 🔴 왜 글자로 읽는가 — **그려서는 못 보는 카드다** ───────────────────
 * [고장 부품] 그래프는 **처음에 꺼져 있다**(`INITIAL_OPEN_CHARTS` 가 고장 증상 하나).
 * 사람이 단추를 눌러야 카드가 선다. 이 환경에는 눌러 볼 도구가 없어
 * (`renderToStaticMarkup` 뿐이다 — 이웃 part-picker.test.tsx 와 같은 형편) 카드 자체를
 * 그려 볼 수 없다. 🔵 **그 사실 자체는 결함이 아니다** — 그래프를 열지 않은 사람은
 * 틀린 수를 볼 일도 없다. 안내가 카드 안에 사는 까닭이 그것이다.
 *
 * 🔴 **그래서 주석을 먼저 걷어 낸다.** 이 저장소에서 소스를 글자로 재는 검사가
 *    주석 때문에 헛통과한 적이 있다(「있어야 한다」 쪽은 주석만으로 영영 통과한다).
 *    아래 `code` 는 블록 주석과 줄 주석을 떼어 낸 **코드만**이다.
 * ============================================================================
 */

const source = readFileSync(
  new URL("./ProductModelHistoryBreakdown.tsx", import.meta.url),
  "utf8"
);

/** 🔴 주석을 걷어 낸 코드. JSX 주석(`{/* … *\/}`)은 빈 `{}` 로 남는다(해롭지 않다). */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** 빈칸을 하나로 눌러 줄바꿈된 JSX 도 한 글자로 견준다. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

/**
 * 접수 건 한 줄. 🔴 **화면이 읽는 칸만 뜻이 있다**(id · 신고증상 · 인수점검 결과 ·
 * End-User · 유무상). 나머지는 타입을 채우는 값이고, 접수 건 목록은 기본으로 접혀 있어
 * 그리지도 않는다. 🔴 고객사명·L/N·S/N 은 **전부 가짜**다.
 */
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

describe("[고장 부품] 안내 — 카드까지 연결돼 있는가", () => {
  test("🔴 못 센 수를 받아 **그 카드에** 넘긴다 — 중간에서 끊기면 아무 말도 안 뜬다", () => {
    assert.ok(
      flat(code).includes("const faultPartWarning = faultPartIssuedWarning(faultPartIssuedLookup);"),
      "서버가 센 수를 문장으로 바꾸는 줄이 없다"
    );
    // 🔴 `warning=` 이 선 ChartCard 는 **하나**여야 한다 — 다른 그래프에 붙으면
    //    고장 증상 카드에 「반출을 못 셌습니다」가 뜬다.
    assert.equal(
      code.split("warning={faultPartWarning}").length - 1,
      1,
      "안내가 붙은 카드가 하나가 아니다"
    );
    const partCardAt = code.indexOf('title={CHART_LABELS.PART}');
    const warningAt = code.indexOf("warning={faultPartWarning}");
    const endUserCardAt = code.indexOf("title={CHART_LABELS.END_USER}");
    assert.ok(partCardAt > 0 && warningAt > partCardAt, "안내가 [고장 부품] 카드 밖에 있다");
    assert.ok(warningAt < endUserCardAt, "안내가 다음 카드로 밀려 있다");
  });

  test("🔴 조각이 하나도 없을 때도 그린다 — 「부품 기록이 없습니다」가 바로 그 거짓말이다", () => {
    // 셋째 입력을 통째로 못 받아 온 모델은 빈 그래프가 된다. 안내를 빈 갈래 **안**에
    // 넣으면 정작 필요한 자리에서 안 뜬다 — 그래서 `slices.length === 0` 보다 **위**다.
    const warningAt = code.indexOf("{warning ? (");
    const emptyBranchAt = code.indexOf("slices.length === 0 ?");
    assert.ok(warningAt > 0, "안내를 그리는 자리가 없다");
    assert.ok(emptyBranchAt > 0, "빈 갈래가 사라졌다 — 이 시험의 전제가 깨졌다");
    assert.ok(
      warningAt < emptyBranchAt,
      "안내가 빈 갈래 뒤에 있다 — 그래프가 통째로 빈 날 아무 말도 안 뜬다"
    );
  });

  /**
   * 🔴 **낱말 하나를 고쳤다**(2026-10-29 오후). 같은 날 오전까지 아래 목록에는
   * 「**실제로 나간 줄**」이 있었다 — 그때는 반출 입력이 **줄 수**로 세어졌기 때문이다.
   * 사용자가 「실제로 사용된 부품의 수를 표시해줘」로 정하면서 세는 자가 수량으로 바뀌었고,
   * 그 낱말은 **틀린 말**이 되었다(설명 줄도 함께 고쳤다 — `ProductModelHistoryBreakdown`).
   * 🔵 제목과 나머지 넷은 그대로다 — 세 입력을 말하고 자가 둘이라는 것은 여전히 참이다.
   */
  test("🔴 설명 줄이 **세 입력과 자 둘**을 말한다 — 수가 늘어난 까닭이 화면에 있어야 한다", () => {
    const note = /note="([^"]+)"[\s\S]{0,200}?warning=\{faultPartWarning\}/.exec(code);
    assert.ok(note, "[고장 부품] 카드의 설명 줄을 못 찾았다");
    for (const word of ["부품 요청", "사용 부품", "반출 확인된 부품", "취소·반려", "실제로 나간 수"]) {
      assert.ok(note[1].includes(word), `설명 줄에 「${word}」이(가) 없다: ${note[1]}`);
    }
  });
});

describe("[고장 부품] 안내 — 그려 보는 쪽", () => {
  /**
   * 🔵 여기서 그려 보는 것은 **기본 화면**이다(고장 증상 하나만 켜져 있다). 카드를 여는
   *    일은 못 하지만, 새 프롭이 들어와 화면이 터지지 않는지와 **안 켠 카드의 안내가
   *    새어 나오지 않는지**는 여기서만 잡힌다.
   */
  const resolved = [fakeCase("case-01"), fakeCase("case-02")];

  test("새 프롭을 받아도 A/S 이력 구역이 그대로 뜬다", () => {
    const html = renderToStaticMarkup(
      createElement(ProductModelHistoryBreakdown, {
        resolved,
        faultParts: [],
        faultPartIssuedLookup: { uncountedCaseCount: 0, timedOutCaseCount: 0, timeBudgetMs: 5000 },
        // 🔴 2026-10-29 에 생긴 프롭 — 조각을 누르면 펼칠 재고 관리 줄. 여기서는 부품 줄이
        //    아예 없어 쓰이지 않지만 없으면 화면이 안 뜬다.
        faultPartInventory: { status: "ok", rowsByKey: {} },
      })
    );
    assert.ok(html.includes("고장 부품"), "그래프 고르는 단추가 사라졌다");
    assert.ok(html.includes("접수 건 목록 보기 (2건)"), html.slice(0, 400));
  });

  test("🔴 안 켠 카드의 안내가 화면으로 새지 않는다 — 고장 증상만 켜져 있다", () => {
    const lookup = { uncountedCaseCount: 3, timedOutCaseCount: 0, timeBudgetMs: 5000 };
    const warning = faultPartIssuedWarning(lookup);
    assert.ok(warning, "이 시험의 표본이 비었다 — 경고가 생기는 입력이어야 한다");

    const html = renderToStaticMarkup(
      createElement(ProductModelHistoryBreakdown, {
        resolved,
        faultParts: [],
        faultPartIssuedLookup: lookup,
        faultPartInventory: { status: "ok", rowsByKey: {} },
      })
    );
    assert.equal(
      html.includes(warning),
      false,
      "🔴 [고장 부품] 을 켜지도 않았는데 그 카드의 안내가 떠 있다"
    );
  });
});
