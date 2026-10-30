import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DUE_DATE_INVERSION_NOTE,
  DUE_DATE_INVERSION_NOTE_CLASS,
} from "@/lib/domain/due-date-inversion";

/**
 * ============================================================================
 * 수리 건 상세 「인수 정보」 — 납기 역전이면 날짜가 붉어지고 메모가 붙는다 (2026-10-29)
 * ============================================================================
 * 사용자 요구: 「사내 목표 출하일이 고객 요청 납기일보다 늦으면 그 날짜를 빨간
 * 볼드로, 옆에 『납기 요청일 협의가 필요합니다.』 라는 메모가 뜨도록」. 판정 자체는
 * domain/due-date-inversion.test.ts 가 값으로 재고, 여기서는 **그 판정이 화면까지
 * 닿는 사슬**을 본다.
 *
 * ── 🔴 왜 렌더하지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 그려 볼 수 없다. IntakeInfoSection 은 편집 폼을 함께 물고 있고, 그 폼이 서버
 * 액션 → acting-user → `server-only` 로 이어져 **react-server 조건 없이 도는
 * test:components 에서는 import 자체가 던진다**(실제로 확인했다: "This module
 * cannot be imported from a Client Component module"). 한편 unit 쪽은 그 조건을
 * 켜는 대신 react-dom/server 가 막혀 렌더가 안 된다. 이웃 둘이 같은 자리에서 같은
 * 방법을 쓴다(domestic-order-dates-section.test.ts · detail-header-placement.test.ts).
 *
 * 🔴 **주석을 걷어 낸 코드만 본다.** 이 조각들은 주석에 규칙을 글자로 적어 두므로
 * 날것으로 찾으면 **화면에서 사라져도 주석에 걸려 통과한다**(이 저장소가 실제로 겪은
 * 함정 — source-text 검사가 주석을 먼저 세던 일).
 *
 * 🔴 못 박는 것 여섯
 *  ① 메모 글자를 화면이 **새로 짓지 않는다** — 도메인 상수 하나를 가져다 쓴다.
 *    네 자리(상세 · A/S 내자 · PO 내자 · 알림)가 같은 말을 해야 한다.
 *  ② 🔴 **겹침** — 강조가 `isDueDateNear || isDueDateInverted` 다. 역전이 임박을
 *    덮지도, 임박이 역전을 가리지도 않는다(2026-10-29 사용자 결정: 둘 다 보인다).
 *  ③ 메모는 **역전일 때만** 붙는다 — 늘 켜져 있는 경보는 아무도 안 본다.
 *  ④ 메모가 붙는 칸은 **「고객 요청 납기일」 하나**다. 「사내 목표 출하일」 칸은
 *    이번 요구에 없고, 평소 옷 그대로다.
 *  ⑤ 읽는 차례 — 날짜 → 어디서 온 값인가(빌려 온 표시) → 그래서 무엇을 해야 하는가.
 *  ⑥ 🔴 **판정은 서버가 한다.** 화면이 날짜를 다시 견주면, 빌려 오기까지 얽힌 규칙이
 *    두 벌이 되어 네 화면이 서로 다른 날로 잰다. 서버 쪽은 빌려 오기 재료
 *    (domesticOrderDueDates)까지 넘겨야 한다 — 빠뜨리면 자기 칸이 빈 건에서 경보가
 *    **조용히** 꺼진다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);

/** 주석을 걷어 낸 원본. 블록 주석과 줄 주석을 둘 다 뗀다. */
function codeOf(path: string): string {
  const raw = readFileSync(new URL(path, repoUrl), "utf8").replace(/\r\n/g, "\n");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 줄바꿈·들여쓰기 차이로 깨지지 않도록 공백을 한 칸으로 접는다. */
function flatten(code: string): string {
  return code.replace(/\s+/g, " ");
}

const sectionCode = flatten(codeOf("src/components/repair-cases/detail/IntakeInfoSection.tsx"));
const viewCode = flatten(codeOf("src/components/repair-cases/detail/RepairCaseDetailView.tsx"));
const pageCode = flatten(codeOf("src/app/(app)/repair-cases/[id]/page.tsx"));

/**
 * 그 이름표를 단 `<Field …/>` 한 덩어리. 🔴 파일 전체에서 글자를 찾으면 **다른 칸의
 * 설정에 걸려도 통과한다** — 어느 칸에 붙었는가가 이번 요구의 절반이라 칸을 떼어 낸다.
 */
function fieldCall(label: string): string {
  const start = sectionCode.indexOf(`label="${label}"`);
  assert.notEqual(start, -1, `「${label}」 칸을 찾지 못했다 — 시험이 빈 표본을 재고 있다`);
  const end = sectionCode.indexOf("/>", start);
  assert.notEqual(end, -1, `「${label}」 칸이 닫히지 않았다`);
  return sectionCode.slice(start, end);
}

describe("인수 정보 — 납기 역전 메모가 화면까지 닿는 사슬", () => {
  test("표본 확인 — 주석을 걷어 낸 코드에서 그 칸과 조각이 실제로 잡힌다", () => {
    // 아래 단언들이 빈 글자를 뒤지다 전부 초록색이 되는 일을 막는다.
    assert.ok(sectionCode.includes("function Field("), "인수 정보의 칸 조각을 못 찾았다");
    assert.ok(fieldCall("고객 요청 납기일").length > 0);
    assert.ok(fieldCall("사내 목표 출하일").length > 0);
    assert.ok(pageCode.includes("<RepairCaseDetailView"), "상세 페이지에서 화면을 못 찾았다");
  });

  test("🔴 메모 글자를 화면이 새로 짓지 않는다 — 도메인 상수 하나를 쓴다", () => {
    assert.ok(
      sectionCode.includes('from "@/lib/domain/due-date-inversion"'),
      "메모 글자를 도메인에서 가져오지 않는다 — 네 화면이 다른 말을 하게 된다"
    );
    assert.ok(
      !sectionCode.includes(DUE_DATE_INVERSION_NOTE),
      `메모 글자가 화면에 박혔다("${DUE_DATE_INVERSION_NOTE}") — 상수를 쓸 것`
    );
    assert.ok(
      sectionCode.includes("className={DUE_DATE_INVERSION_NOTE_CLASS}"),
      "메모가 도메인이 정한 옷을 안 입는다"
    );
    assert.ok(
      !sectionCode.includes(DUE_DATE_INVERSION_NOTE_CLASS),
      "클래스 글자가 화면에 다시 적혔다 — 한쪽만 고쳐지는 날이 온다"
    );
  });

  test("🔴 강조는 둘을 **더한다** — 역전이 임박을 덮지 않는다(겹치면 둘 다 보인다)", () => {
    const field = fieldCall("고객 요청 납기일");
    assert.ok(
      field.includes("emphasized={isDueDateNear || isDueDateInverted}"),
      `강조 조건이 둘을 더하지 않는다: ${field}`
    );
    // 임박 쪽 판정과 모양은 이번에 건드리지 않는다 — 날짜가 입는 옷도 그대로다.
    assert.ok(
      sectionCode.includes("`text-sm ${DUE_DATE_NEAR_TEXT_CLASS}`"),
      "날짜가 입던 굵은 붉은색 한 벌이 바뀌었다 — 임박의 모양은 그대로 두기로 했다"
    );
  });

  test("🔴 메모는 역전일 때만 붙는다", () => {
    const field = fieldCall("고객 요청 납기일");
    assert.ok(
      field.includes("note={isDueDateInverted ? DUE_DATE_INVERSION_NOTE : undefined}"),
      `메모가 역전 여부와 묶여 있지 않다: ${field}`
    );
    assert.ok(
      sectionCode.includes("{note && ("),
      "메모 줄이 조건 없이 그려진다 — 빈 줄이 늘 자리를 차지한다"
    );
  });

  test("🔴 메모가 붙는 칸은 「고객 요청 납기일」 하나다", () => {
    const shipment = fieldCall("사내 목표 출하일");
    assert.ok(
      !shipment.includes("note=") && !shipment.includes("emphasized="),
      `사내 목표 출하일 칸까지 함께 바뀌었다 — 이번 요구는 고객 요청 납기일 칸이다: ${shipment}`
    );
    // 이 구역의 칸 열하나가 같은 조각을 쓴다 — 켜는 자리가 하나뿐이어야 한다.
    assert.equal(
      sectionCode.split("note={").length - 1,
      1,
      "메모를 켜는 자리가 둘 이상이다"
    );
  });

  test("🔴 읽는 차례 — 날짜 → 어디서 온 값인가 → 그래서 무엇을 해야 하는가", () => {
    const borrowed = sectionCode.indexOf("{borrowedLabel && (");
    const note = sectionCode.indexOf("{note && (");
    assert.ok(borrowed > 0 && note > 0, "두 줄 중 하나를 못 찾았다");
    assert.ok(
      borrowed < note,
      "경보가 출처 표시보다 앞에 끼어들었다 — 그 표시는 바로 위 날짜에 붙어 있어야 한다"
    );
  });

  test("🔴 판정은 서버가 한다 — 화면은 날짜를 다시 견주지 않는다", () => {
    for (const [name, code] of [
      ["IntakeInfoSection", sectionCode],
      ["RepairCaseDetailView", viewCode],
    ] as const) {
      assert.ok(
        !code.includes("isRepairCaseDueDateInverted"),
        `${name} 가 스스로 판정한다 — 빌려 오기까지 얽힌 규칙이 두 벌이 된다`
      );
      assert.ok(
        !/internalTargetShipmentDate\s*[<>]/.test(code),
        `${name} 가 두 날짜를 직접 견준다`
      );
    }
    assert.ok(
      viewCode.includes("isDueDateInverted={isDueDateInverted}"),
      "화면이 받은 판정을 인수 정보까지 넘기지 않는다"
    );
  });

  test("🔴 서버가 빌려 오기 재료까지 넘긴다 — 빠지면 자기 칸이 빈 건에서 조용히 꺼진다", () => {
    assert.ok(
      pageCode.includes('from "@/lib/domain/due-date-inversion"'),
      "상세 페이지가 공용 판정을 가져오지 않는다"
    );
    const start = pageCode.indexOf("isRepairCaseDueDateInverted({");
    assert.notEqual(start, -1, "상세 페이지가 공용 판정 함수를 부르지 않는다");
    const call = pageCode.slice(start, pageCode.indexOf("});", start));
    for (const field of [
      "internalTargetShipmentDate",
      "customerRequestedDueDate",
      "domesticOrderDueDates",
    ]) {
      assert.ok(call.includes(field), `판정에 ${field} 를 안 넘긴다: ${call}`);
    }
    // 🔵 역전은 「오늘」을 보지 않는다 — 이것이 납기 임박과 가르는 선이다.
    assert.ok(!call.includes("new Date("), `역전 판정에 「오늘」을 넘긴다: ${call}`);
    // 🔴 이미 나간 건을 빼는 재료(2026-10-30 사용자 결정). 빠뜨리면 지난 건을 열
    // 때마다 붉은 글이 떠서 정작 살아 있는 경고가 묻힌다.
    for (const field of ["status", "actualShipmentDate"]) {
      assert.ok(call.includes(field), `출하 여부를 재는 ${field} 를 안 넘긴다: ${call}`);
    }
    assert.ok(
      pageCode.includes("isDueDateInverted={isDueDateInverted}"),
      "재 놓고 화면에 안 넘긴다"
    );
    // 임박을 지우고 바꿔 끼운 것이 아니다 — 둘이 나란히 산다.
    assert.ok(
      pageCode.includes("isRepairCaseDueDateNear(") &&
        pageCode.includes("isDueDateNear={isDueDateNear}"),
      "납기 임박 판정이 사라졌다 — 역전은 그것을 대신하는 것이 아니다"
    );
  });

  test("🔴 두 경보가 「끝난 건」을 **같은 두 칸**으로 가른다", () => {
    // 2026-10-30 사용자 결정으로 역전도 이미 나간 건에는 안 뜬다. 임박이 보는 칸과
    // 다른 칸을 넘기면 같은 건을 두고 한쪽만 꺼지는 날이 온다 — 그 어긋남은 화면에
    // 오류로 드러나지 않는다.
    const nearStart = pageCode.indexOf("isRepairCaseDueDateNear(");
    const invertedStart = pageCode.indexOf("isRepairCaseDueDateInverted({");
    assert.ok(nearStart > 0 && invertedStart > 0, "두 판정 호출 중 하나를 못 찾았다");

    const nearCall = pageCode.slice(nearStart, pageCode.indexOf("new Date()", nearStart));
    const invertedCall = pageCode.slice(invertedStart, pageCode.indexOf("});", invertedStart));
    for (const field of ["status: resolved.status", "actualShipmentDate: resolved.actualShipmentDate"]) {
      assert.ok(nearCall.includes(field), `임박 쪽 표본이 비었다 — ${field} 를 못 찾았다`);
      assert.ok(invertedCall.includes(field), `역전이 임박과 다른 칸을 본다: ${field}`);
    }
  });
});
