import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ProductModelHistoryBreakdown from "./ProductModelHistoryBreakdown";
import ProductModelRepairCaseHistory from "./ProductModelRepairCaseHistory";
import type { ResolvedRepairCase } from "@/lib/domain/local/resolved-repair-case";

/**
 * ============================================================================
 * 🔴 [제품 모델 상세] · [A/S 이력] 의 **년/월 드롭다운 둘** (2026-10-29 사용자 요청)
 * ============================================================================
 * 사용자 말: 「[제품 모델 상세]에 있는 [a/s 이력]에서 **[대시보드]의 [신고 증상별
 * 현황]처럼** 년/월을 선택해서 확인할 수 있도록 해줘.」
 *
 * ── 🔴 값으로 잴 것과 글자로밖에 못 잴 것을 갈라 둔다 ───────────────────
 * 이 환경에는 **눌러 볼 도구가 없다**(renderToStaticMarkup 뿐이다 — 이웃
 * `product-model-fault-part-warning.test.tsx` 와 같은 형편이고, 저장소에 DOM 시험
 * 도구가 한 벌도 없다). 그래서 **고른 뒤의 숫자**는 여기서 못 잰다 — 그쪽은 unit
 * 목록의 `lib/domain/product-model-period-filter.test.ts` 가 **값으로** 못 박았다
 * (연도만 → 그 해 전체 · 연도+월 → 그 달만 · 전체 → 다 · 네 그래프가 한 기간).
 *
 * 여기서 재는 것은 둘이다:
 *   ㉠ **처음 화면에 실제로 그려지는 것** — 연도 선택지가 자료에 있는 해만인가 ·
 *      월 칸이 잠겨 있는가 · 월 선택지는 1~12 고정인가 · 기간을 안 걸었을 때의 글자가
 *      예전 그대로인가.
 *   ㉡ **배선** — 네 그래프가 다 걸러진 배열을 받는가 · 기간을 바꾸면 펼친 조각이
 *      초기화되는가 · 🔴 주황 띠만 기간을 안 타는가 · 🔴 거르는 자를 여기서 **다시
 *      짓지 않았는가**(대시보드 것을 그대로 쓴다).
 *
 * 🔴 **㉡ 은 주석을 걷어 낸 코드로 읽는다.** 이 저장소에서 소스를 글자로 재는 검사가
 *    주석 때문에 헛통과한 적이 있다(「있어야 한다」 쪽은 주석만으로 영영 통과한다).
 *
 * 🔴 고객사명·모델명·L/N·S/N·부품 이름은 **전부 가짜**다.
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
 * 이름 붙은 함수 한 덩이의 **몸통**. 들여쓰기 두 칸짜리 닫는 괄호(또는 다음 선언)에서
 * 끊는다 — 「어딘가에 setSelection({}) 이 있다」가 아니라 「**그 손잡이 안에** 있다」를
 * 재야 뜻이 있다.
 */
function bodyOf(name: string): string {
  const start = code.indexOf(`const ${name} = (`);
  assert.ok(start > 0, `${name} 을(를) 못 찾았다 — 이 시험의 전제가 깨졌다`);
  const rest = code.slice(start);
  const end = rest.search(/\n {2}(const|return|function|if|\})/);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * 접수 건 한 줄. 🔴 **화면이 읽는 칸만 뜻이 있다**(id · 인수일 · 신고증상 · 인수점검
 * 결과 · End-User · 유무상). 나머지는 타입을 채우는 값이다.
 */
function fakeCase(id: string, receivedAt: string): ResolvedRepairCase {
  return {
    id,
    version: 1,
    source: "DATABASE",
    productId: "prod-A",
    intakeNumber: `D9000${id.slice(-2)}`,
    legacyReportNumber: null,
    workflowType: "PAID_MATCHER",
    status: "WAITING_INTAKE_INSPECTION",
    priority: "NORMAL",
    exceptionStatus: null,
    currentWorkflowStepKey: "intake_inspection",
    receivedAt,
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
    modelName: "AAA-000",
    lotNumber: "LOT-0",
    serialNumber: "SN-0",
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

/** 2024년 하나 · 2025년 둘. 연도 선택지가 **자료에서** 나오는지 보려면 해가 둘이어야 한다. */
const RESOLVED = [
  fakeCase("case-01", "2024-11-05"),
  fakeCase("case-02", "2025-03-02"),
  fakeCase("case-03", "2025-07-09"),
];

function render(resolved: ResolvedRepairCase[] = RESOLVED): string {
  return renderToStaticMarkup(
    createElement(ProductModelHistoryBreakdown, {
      resolved,
      faultParts: [
        { repairCaseId: "case-02", displayName: "가 부품 (DWG-001)", matchKey: "dwg001" },
      ],
      faultPartIssuedLookup: { uncountedCaseCount: 0, timedOutCaseCount: 0, timeBudgetMs: 5000 },
      /* 🔴 2026-10-29 에 생긴 프롭. [고장 부품] 카드는 처음에 꺼져 있어 이 파일이 재는
         기간 거르기와는 상관이 없지만, **없으면 화면이 아예 안 뜬다** — 빈 지도를 넘긴다.
         펼친 자리가 무엇을 그리는지는 product-model-fault-part-detail.test.tsx 가 본다. */
      faultPartInventory: { status: "ok", rowsByKey: {} },
    })
  );
}

describe("A/S 이력 년/월 — 처음 화면에 그려지는 것", () => {
  test("🔴 드롭다운이 **둘**이고 둘 다 「전체」를 갖는다", () => {
    const html = render();
    assert.ok(html.includes('aria-label="A/S 이력 연도"'), "연도 드롭다운이 없다");
    assert.ok(html.includes('aria-label="A/S 이력 월"'), "월 드롭다운이 없다");
    assert.equal(
      html.split('<option value="" selected="">전체</option>').length - 1,
      2,
      "두 칸 모두에 「전체」 선택지가 있어야 한다 — 기본값이 전체 기간이다"
    );
  });

  test("🔴 연도 선택지는 **자료에 있는 해만**, 최근 해가 위로", () => {
    const html = render();
    const at2025 = html.indexOf('<option value="2025">2025년</option>');
    const at2024 = html.indexOf('<option value="2024">2024년</option>');
    assert.ok(at2025 > 0, "자료에 있는 2025년이 선택지에 없다");
    assert.ok(at2024 > 0, "자료에 있는 2024년이 선택지에 없다");
    assert.ok(at2025 < at2024, "최근 해가 위로 와야 한다");
    // 🔵 표본 검사 — 고정 목록이었다면 자료에 없는 해도 떴을 것이다.
    assert.ok(!html.includes(">2023년<"), "자료에 한 건도 없는 해가 선택지에 있다");
    assert.ok(!html.includes(">2026년<"), "자료에 한 건도 없는 해가 선택지에 있다");
  });

  test("🔴 연도가 「전체」면 월 칸이 **잠긴다** — 그리고 까닭이 글로 적혀 있다", () => {
    const html = render();
    const monthAt = html.indexOf('aria-label="A/S 이력 월"');
    assert.ok(monthAt > 0, "월 드롭다운이 없다");
    // React 는 `<select disabled="" aria-label=…>` 로 그린다. 같은 <select> 안인지
    // 보려고 그 앞 120 글자만 본다.
    assert.ok(
      html.slice(Math.max(0, monthAt - 120), monthAt).includes('disabled=""'),
      "연도가 전체인데 월 칸이 안 잠겼다"
    );
    assert.ok(
      html.includes("연도를 먼저 고르면 월을 고를 수 있습니다."),
      "왜 못 고르는지 글이 없다 — 회색으로 잠가 두기만 하면 알 수 없다"
    );
  });

  test("🔴 월 선택지는 **1~12 고정**이다 — 「그 달에 0건」과 「고를 수조차 없음」은 다른 말이다", () => {
    const html = render();
    for (let month = 1; month <= 12; month += 1) {
      assert.ok(
        html.includes(`<option value="${month}">${month}월</option>`),
        `${month}월 선택지가 없다`
      );
    }
    // 자료에는 11월·3월·7월뿐인데 열두 달이 다 보여야 한다.
    assert.ok(html.includes('<option value="5">5월</option>'), "건이 없는 달이 빠졌다");
  });

  test("🔴 기본값은 **전체 기간**이고, 그때 화면의 글자는 예전 그대로다", () => {
    const html = render();
    assert.ok(html.includes("전체 기간 · 접수 3건"), "걸린 기간을 말하는 줄이 없다");
    assert.ok(html.includes("총 3건"), "고장 증상 카드가 세 건을 다 세지 않았다");
    assert.ok(
      html.includes("접수 건 목록 보기 (3건)"),
      "기간을 안 걸었는데 접수 건 목록 단추 글자가 바뀌었다"
    );
    // 기간을 안 걸었으면 기준을 설명하는 줄도 안 뜬다 — 늘 떠 있는 안내는 아무도 안 읽는다.
    assert.ok(
      !html.includes("기간은 인수일 기준이라"),
      "기간을 걸지도 않았는데 기준 설명이 떠 있다"
    );
  });

  test("🔴 원의 **낭독기 이름표에 걸린 기간이 실린다** — 칸은 저 위에 따로 있다", () => {
    const html = render();
    assert.ok(
      html.includes('aria-label="고장 증상별 건수 비율, 전체 기간 총 3건"'),
      "그려진 원의 이름표에 기간이 없다"
    );
    // 🔵 넷 다 같은 자를 쓴다. 켜져 있는 것은 고장 증상 하나뿐이라 그려진 것으로는
    //    하나밖에 못 보고, 나머지 셋은 원본 글자로 센다.
    assert.equal(
      code.split("${periodLabel} 총 ").length - 1 + code.split("${periodLabel} 부품 ").length - 1,
      4,
      "네 원 모두가 이름표에 기간을 싣지는 않는다"
    );
  });

  test("접수 건이 한 건도 없는 모델은 기간 칸도 안 그린다 — 고를 연도가 없다", () => {
    const html = render([]);
    assert.ok(html.includes("이 모델과 연결된 A/S 접수 건이 없습니다."), html.slice(0, 300));
    assert.ok(!html.includes('aria-label="A/S 이력 연도"'), "고를 것이 없는데 칸이 떠 있다");
  });
});

describe("A/S 이력 년/월 — 배선", () => {
  test("🔴 거르는 자를 **여기서 다시 짓지 않았다** — 대시보드의 것을 그대로 쓴다", () => {
    const importBlock = /import \{([\s\S]*?)\} from "@\/lib\/domain\/fault-symptom-breakdown";/.exec(
      code
    );
    assert.ok(importBlock, "대시보드 기간 함수를 불러오는 import 가 없다");
    for (const name of [
      "selectFaultSymptomPeriodCases",
      "listFaultSymptomYears",
      "formatFaultSymptomPeriodLabel",
      "FAULT_SYMPTOM_ALL_PERIOD",
      "FAULT_SYMPTOM_PERIOD_MONTHS",
      "FaultSymptomPeriod",
    ]) {
      assert.ok(importBlock[1].includes(name), `${name} 을(를) 공용 자리에서 안 가져온다`);
    }
    // 🔴 **같은 말을 두 벌로 적으면 한쪽만 고쳐지는 날이 온다.** 월 목록을 손으로 적거나
    //    인수일을 여기서 다시 파싱하면 대시보드와 갈린다.
    assert.ok(
      !/\[\s*1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8,\s*9,\s*10,\s*11,\s*12\s*\]/.test(code),
      "월 목록을 이 파일에 다시 적었다"
    );
    assert.ok(!code.includes("\\d{4}"), "인수일 읽는 규칙을 이 파일에 다시 적었다");
    assert.ok(!code.includes("getFullYear"), "인수일 읽는 규칙을 이 파일에 다시 적었다");
  });

  test("🔴 **네 그래프가 다 걸린다** — 앞의 셋은 거른 뒤에 매핑, 고장 부품은 id 집합", () => {
    // ㉠ 거르고 나서 매핑한다. 거꾸로 하면 인수일이 이미 떨어져 나간 뒤라 걸 수가 없다.
    assert.ok(
      flat(code).includes("selectFaultSymptomPeriodCases(resolved, period)"),
      "접수 건을 기간으로 거르는 줄이 없다"
    );
    assert.ok(flat(code).includes("periodResolved.map((row) => ({"), "거른 배열을 매핑하지 않는다");
    assert.ok(
      !flat(code).includes("resolved.map((row) => ({"),
      "🔴 원본 배열을 그대로 매핑한다 — 기간이 앞의 셋에 안 걸린다"
    );

    // ㉡ 앞의 셋은 걸러진 cases 를 받는다.
    for (const builder of [
      "buildSymptomBreakdown(cases)",
      "buildEndUserBreakdown(cases)",
      "buildBillingBreakdown(cases)",
    ]) {
      assert.ok(flat(code).includes(builder), `${builder} 가 걸러진 배열을 안 받는다`);
    }

    // ㉢ 🔴 고장 부품만 id 집합으로 따로 건다 — 그 줄에는 날짜 칸이 없다.
    assert.ok(
      flat(code).includes("selectProductModelPeriodFaultParts(faultParts, period, cases)"),
      "부품 줄을 id 집합으로 거르는 줄이 없다"
    );
    assert.ok(
      flat(code).includes("buildFaultPartBreakdown(periodFaultParts)"),
      "[고장 부품] 그래프가 걸러진 줄을 안 받는다"
    );
    assert.ok(
      !flat(code).includes("buildFaultPartBreakdown(faultParts)"),
      "🔴 [고장 부품] 만 기간에 안 걸린다 — 앞의 셋과 수가 어긋난다"
    );
  });

  test("🔴 기간을 바꾸면 **펼친 조각이 초기화**된다 — 두 손잡이 모두에서", () => {
    assert.equal(
      code.split("setSelection({})").length - 1,
      2,
      "펼친 조각을 접는 자리가 둘(연도·월)이어야 한다"
    );
    assert.ok(
      bodyOf("changeYear").includes("setSelection({})"),
      "연도를 바꿔도 다른 기간에서 고른 조각이 펼쳐진 채 남는다"
    );
    assert.ok(
      bodyOf("changeMonth").includes("setSelection({})"),
      "월을 바꿔도 다른 기간에서 고른 조각이 펼쳐진 채 남는다"
    );
  });

  test("🔴 연도를 바꾸면 월은 **언제나 전체**로 되돌아간다", () => {
    const body = flat(bodyOf("changeYear"));
    assert.ok(body.includes("month: null"), "연도를 옮겨도 지난 달이 남아 있다");
    assert.ok(
      body.includes("FAULT_SYMPTOM_ALL_PERIOD"),
      "연도를 「전체」로 되돌리는 길이 없다"
    );
    // 월 칸이 잠기는 근거는 **연도가 전체인가** 하나뿐이다.
    assert.ok(
      flat(code).includes("disabled={!isPeriodFiltered}"),
      "월 칸을 잠그는 조건이 사라졌다"
    );
  });

  test("🔴 **주황 띠(못 센 건 안내)만 기간을 안 탄다** — 좁혔다고 사라지면 안 된다", () => {
    // 재고 관리에 못 물어본 것은 어느 달을 보든 못 물어본 것이다. 게다가 서버가 주는
    // 것은 수뿐이라(어느 건이 빠졌는지 모른다) 기간에 맞춰 줄이면 「이 달은 다 셌다」는
    // 거짓말이 된다.
    assert.ok(
      flat(code).includes("const faultPartWarning = faultPartIssuedWarning(faultPartIssuedLookup);"),
      "안내를 만드는 줄이 바뀌었다"
    );
    assert.equal(
      code.split("faultPartIssuedWarning(").length - 1,
      1,
      "안내를 만드는 자리가 하나가 아니다"
    );
    assert.ok(
      !/faultPartWarning[^\n]*(isPeriodFiltered|period)/.test(code),
      "🔴 안내가 기간에 묶였다"
    );
    assert.ok(
      !/(isPeriodFiltered|period)[^\n]*faultPartWarning/.test(code),
      "🔴 안내가 기간에 묶였다"
    );
  });

  /**
   * 🔴 **설계가 뒤집힌 자리다**(2026-10-29). 이 시험은 처음에 「아래 접수 건 목록은
   * **안 걸린다**는 사실이 화면에 적힌다」였고, 단언이 맞았으므로 영영 통과했을 것이다.
   * 사용자가 「목록도 거른다」로 정하면서 **시험 이름에 적힌 설계부터 틀린 말**이 되었다 —
   * 지우지 않고 **새 동작을 지키도록** 고쳐 적는다.
   */
  test("🔴 **아래 접수 건 목록도 같은 기간에 걸린다** — 단추의 수도 그 수다", () => {
    // ㉠ 펼치는 목록은 걸러진 배열을 받는다.
    assert.ok(
      flat(code).includes("<ProductModelRepairCaseHistory resolved={periodResolved}"),
      "🔴 접수 건 목록이 아직 원본 배열을 받는다 — 기간이 목록에 안 걸린다"
    );
    // ㉡ 🔴 **단추에 적히는 수가 열면 보일 수와 같아야** 한다. 원본 수를 적으면 단추와
    //    펼친 목록이 서로 다른 수를 말한다.
    assert.ok(
      flat(code).includes("접수 건 목록 보기 (${periodResolved.length}건)"),
      "단추가 걸러진 수를 말하지 않는다"
    );
    assert.ok(
      !flat(code).includes("접수 건 목록 보기 (${resolved.length}건)"),
      "🔴 단추가 아직 전체 수를 말한다"
    );
    // ㉢ 🔴 **접수 건이 아예 없는 모델**은 그 앞에서 돌려보낸다 — 거기만 원본 배열이고,
    //    「이 모델에 아예 없다」라서 목록의 예전 글자가 그대로 맞는 말이다.
    assert.ok(
      flat(code).includes("<ProductModelRepairCaseHistory resolved={resolved} />"),
      "접수 건이 하나도 없을 때 돌려보내는 갈래가 사라졌다"
    );
    // ㉣ 안내 줄이 **사실**을 말한다. 뒤집기 전의 말이 남아 있으면 안 된다.
    assert.ok(
      flat(code).includes("네 그래프와 아래 접수 건 목록이 모두 이 기간에 걸립니다"),
      "무엇이 걸리는지 적은 줄이 없다"
    );
    assert.ok(
      !code.includes("기간과 무관하게 전체를 보여 줍니다"),
      "🔴 뒤집히기 전의 안내 문구가 그대로 남아 있다 — 이제 거짓말이다"
    );
  });

  test("🔴 기간 때문에 0건인 것과 원래 없는 것을 **다른 말**로 적는다", () => {
    assert.ok(flat(code).includes("const emptyCaseMessage = isPeriodFiltered"), "접수 건 쪽 빈 글자가 기간을 안 본다");
    assert.ok(flat(code).includes("const emptyPartMessage = isPeriodFiltered"), "부품 쪽 빈 글자가 기간을 안 본다");
    // 넷 다 그 글자를 쓴다 — 하나라도 글자를 박아 두면 그 카드만 「접수 건이 없습니다」로 남는다.
    assert.equal(
      code.split("emptyMessage={emptyCaseMessage}").length - 1,
      3,
      "접수 건을 세는 카드 셋이 같은 빈 글자를 쓰지 않는다"
    );
    assert.equal(
      code.split("emptyMessage={emptyPartMessage}").length - 1,
      1,
      "[고장 부품] 카드가 제 빈 글자를 쓰지 않는다"
    );
    // 🔴 목록도 **같은 문장**을 쓴다 — 한 화면에서 같은 뜻을 두 가지 말로 하면 안 된다.
    assert.ok(
      flat(code).includes("emptyMessage={isPeriodFiltered ? emptyCaseMessage : undefined}"),
      "목록이 그래프 넷과 다른 말을 하거나, 기간을 안 걸었을 때도 글자를 덮어쓴다"
    );
  });
});

/**
 * 🔴 목록이 **기간 때문에 비었을 때** 무슨 말을 하는가. 펼친 목록은 기본으로 접혀 있어
 * (`isListOpen` 이 false) 위 화면에서는 그려 볼 수 없다 — 그래서 목록 컴포넌트를 **직접**
 * 그려 본다. 위에서 글자로 읽은 「그 글자가 넘어가는가」와 짝이고, 여기서 재는 것은
 * **넘어간 글자가 실제로 화면에 뜨는가**다.
 */
describe("접수 건 목록 — 비었을 때 하는 말", () => {
  test("🔴 기간 때문에 비면 **그 기간 때문**이라고 말한다", () => {
    const html = renderToStaticMarkup(
      createElement(ProductModelRepairCaseHistory, {
        resolved: [],
        emptyMessage: "2025년 3월에 인수된 접수 건이 없습니다.",
      })
    );
    assert.ok(html.includes("2025년 3월에 인수된 접수 건이 없습니다."), html.slice(0, 300));
    assert.ok(
      !html.includes("이 모델과 연결된 A/S 접수 건이 없습니다."),
      "🔴 기간 때문에 비었는데 「연결된 건이 없다」고 말한다"
    );
  });

  test("🔴 안 넘기면 **예전 글자 그대로**다 — 이 모델에 아예 없을 때의 말이다", () => {
    const html = renderToStaticMarkup(
      createElement(ProductModelRepairCaseHistory, { resolved: [] })
    );
    assert.ok(html.includes("이 모델과 연결된 A/S 접수 건이 없습니다."), html.slice(0, 300));
  });

  test("🔵 줄이 있으면 빈 글자는 어느 쪽도 안 뜬다 — 표본이 비어 공짜로 통과하지 않게", () => {
    const html = renderToStaticMarkup(
      createElement(ProductModelRepairCaseHistory, {
        resolved: [fakeCase("case-02", "2025-03-02")],
        emptyMessage: "2025년 3월에 인수된 접수 건이 없습니다.",
      })
    );
    assert.ok(!html.includes("없습니다."), "줄이 있는데 빈 글자가 떴다");
    assert.ok(html.includes("D900002"), html.slice(0, 300));
  });
});
