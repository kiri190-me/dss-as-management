import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL,
  DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL,
} from "@/lib/domain/repair-case-domestic-order-dates";

/**
 * ============================================================================
 * 「기본 정보」 내자 정리 발행일 구역 — 화면 쪽에서 못 박는 것
 * ============================================================================
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * 여기서 봐야 하는 것 절반이 **서버 컴포넌트**([id]/page.tsx)의 인가 판정이라
 * 렌더할 대상이 아니고, 그 파일은 `server-only` 모듈(auth/area-guard.ts ·
 * db/queries/*)을 물고 있어 react-server 조건 없이 도는 test:components 에서는
 * **import 자체가 던진다.** 이웃(product-info-history-disclosure.test.ts ·
 * weekly-report-intake-link.test.ts)이 같은 자리에서 쓰는 방법을 그대로 쓴다.
 *
 * ── 여기서 못 박는 것 ──────────────────────────────────────────────────────
 *  1. 🔴 **내자 자료를 볼 수 없는 사람에게는 구역이 아예 안 그려진다** — 판정은
 *     내자 정리 목록 화면이 스스로를 지키는 것과 같은 열쇠이고(설정 축),
 *     거짓이면 조회조차 돌지 않는다.
 *  2. 🔴 **역할 이름을 비교하지 않는다** — 내자 인가는 관리자가 설정한 값이
 *     최종 판정이다(permission-resolver.ts). 설정을 켜는 것만으로 열려야 한다.
 *  3. 조회를 한 번 더 왕복시키지 않는다 — 이미 있는 Promise.all 에 탄다.
 *  4. 이름표가 **주간보고 상세표와 같은 글자**다 — 같은 값이 두 화면에서 다른
 *     이름으로 불리면 사람이 다른 값으로 읽는다.
 *  5. 세 경우(0개·1개·N개)가 화면에서 실제로 갈린다.
 *  6. 🔴 화면이 제 손으로 고르지 않는다 — sort 도 filter 도 없다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);

/** 주석을 뺀 원본. 주석이 규칙을 **글자로** 적어 두고 있어 그냥 찾으면 거기 걸린다. */
function sourceOf(path: string): string {
  return readFileSync(new URL(path, repoUrl), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
function flatten(code: string): string {
  return code.replace(/\s+/g, " ");
}

const pageCode = sourceOf("src/app/(app)/repair-cases/[id]/page.tsx");
const pageFlat = flatten(pageCode);
const viewCode = sourceOf("src/components/repair-cases/detail/RepairCaseDetailView.tsx");
const viewFlat = flatten(viewCode);
const sectionCode = sourceOf("src/components/repair-cases/detail/DomesticOrderDatesSection.tsx");
const sectionFlat = flatten(sectionCode);

// ── ① 🔴 권한이 없으면 구역이 없다 ──────────────────────────────────────

describe("🔴 내자 자료를 볼 수 없는 사람에게는 구역이 안 그려진다", () => {
  test("열쇠는 내자 정리 목록 화면이 쓰는 것과 같다 — domesticOrders READ", () => {
    // (app)/domestic-orders/page.tsx 는 requireAreaAccessForCurrentUser
    // ("domesticOrders") 로 스스로를 지킨다. 여기서는 화면 한 조각만 감추면
    // 되므로 리다이렉트 없는 짝(hasAreaAccess)을 쓴다.
    assert.match(pageFlat, /import \{ hasAreaAccess \} from "@\/lib\/auth\/area-guard";/);
    assert.match(pageFlat, /await hasAreaAccess\("domesticOrders", actingUser\)/);
  });

  test("승인된 계정만 본다 — 목록 화면의 가드와 같은 조건이다", () => {
    assert.match(
      pageFlat,
      /const canReadDomesticOrders = resolved\.source === "DATABASE" && actingUser !== null && actingUser\.approvalStatus === "APPROVED" && \(await hasAreaAccess\("domesticOrders", actingUser\)\);/
    );
  });

  test("🔴 역할 이름을 비교하지 않는다 — 판정은 설정 축 하나다", () => {
    // 역할 이름을 새로 적으면 설정을 켜도 열리지 않는다(2026-08-28 부품 요청 칸이
    // 그 사고를 겪었고, 같은 파일 주석에 남아 있다).
    assert.ok(
      !/canViewDomesticOrders|domestic-order-authorization/.test(pageCode),
      "역할 기반 판정을 상세 페이지에 새로 끌어왔다"
    );
    assert.ok(!/actingUser\.role ===/.test(pageCode), "역할 이름 비교를 새로 적었다");
  });

  test("볼 수 없으면 조회조차 돌지 않는다 — 브라우저로 실어 보내지 않는다", () => {
    assert.match(
      pageFlat,
      /canReadDomesticOrders \? listDomesticOrderIssueDatesForRepairCase\(resolved\.id\) : null,/
    );
  });

  test("화면은 null 이면 구역을 통째로 그리지 않는다 — 빈 배열과 뜻이 다르다", () => {
    assert.match(
      viewFlat,
      /\{domesticOrderIssueDates && <DomesticOrderDatesSection rows=\{domesticOrderIssueDates\} \/>\}/
    );
    assert.match(viewFlat, /domesticOrderIssueDates: readonly RepairCaseDomesticOrderRow\[\] \| null;/);
  });
});

// ── ② 왕복을 하나 더 만들지 않는다 ──────────────────────────────────────

test("이미 있는 Promise.all 에 탄다 — 조회를 한 번 더 왕복시키지 않는다", () => {
  // 이 건 하나만 보는 작은 인덱스 조회라, 형제 조회들과 나란히 태운다.
  assert.equal(pageCode.match(/Promise\.all\(/g)?.length, 1, "Promise.all 이 둘이 됐다");
  assert.match(pageFlat, /domesticOrderDueDates, domesticOrderIssueDates,/);
});

// ── ③ 이름표가 주간보고와 같은 글자인가 ─────────────────────────────────

describe("🔴 같은 값이 두 화면에서 같은 이름으로 불린다", () => {
  const weeklyReportCode = sourceOf("src/components/dashboard/WeeklyReportScreen.tsx");

  test("견적서 발행일 — 주간보고 상세표의 머리말과 같은 글자다", () => {
    assert.ok(
      weeklyReportCode.includes(`>${DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL}</th>`),
      `주간보고 상세표에 '${DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL}' 머리말이 없다 — 두 화면의 이름이 갈렸다`
    );
  });

  test("PO 발행일 — 주간보고 상세표의 머리말과 같은 글자다", () => {
    // 칼럼은 date 라 시각이 없어 이름에서 `일시`를 뺐다(2026-09-29 사용자 결정).
    // 그때 두 화면을 같은 조각에서 함께 고쳤고, 이 대조가 앞으로도 둘을 묶는다.
    assert.ok(
      weeklyReportCode.includes(`>${DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL}</th>`),
      `주간보고 상세표에 '${DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL}' 머리말이 없다 — 두 화면의 이름이 갈렸다`
    );
  });

  test("구역은 글자를 박아 넣지 않고 그 상수를 쓴다", () => {
    assert.match(sectionFlat, /label=\{DOMESTIC_ORDER_QUOTE_ISSUED_DATE_LABEL\}/);
    assert.match(sectionFlat, /label=\{DOMESTIC_ORDER_PO_ISSUED_DATE_LABEL\}/);
    assert.ok(!sectionCode.includes("견적서 발행일"), "이름표를 글자로 박았다");
    assert.ok(!sectionCode.includes("PO 발행"), "이름표를 글자로 박았다");
  });
});

// ── ④ 세 경우가 화면에서 갈리는가 ───────────────────────────────────────

describe("0개·1개·N개가 화면에서 갈린다", () => {
  test("가르는 판정은 도메인이 낸 kind 하나다 — 화면이 줄 수를 다시 세지 않는다", () => {
    assert.match(sectionFlat, /const dates = resolveRepairCaseDomesticOrderDates\(rows\);/);
    assert.match(sectionFlat, /dates\.kind === "NONE"/);
    assert.match(sectionFlat, /dates\.kind === "MULTIPLE"/);
    assert.ok(!/rows\.length/.test(sectionCode), "화면이 줄 수를 제 손으로 셌다");
  });

  test("0개일 때만 「줄이 아직 없습니다」 안내가 붙는다", () => {
    assert.match(
      sectionFlat,
      /\{dates\.kind === "NONE" && \( <p[^>]*> \{DOMESTIC_ORDER_DATES_NONE_NOTE\}/
    );
  });

  test("N개일 때는 개수 안내와 내자 정리로 가는 링크가 함께 붙는다", () => {
    assert.match(sectionFlat, /\{formatMultipleDomesticOrderRowsNotice\(dates\.rowCount\)\}/);
    assert.match(sectionFlat, /<Link href=\{DOMESTIC_ORDER_LIST_HREF\}/);
    assert.match(sectionFlat, /\{DOMESTIC_ORDER_LIST_LINK_TEXT\}/);
  });

  test("1개일 때는 안내가 하나도 붙지 않는다 — 두 날짜만 보인다", () => {
    assert.ok(!/dates\.kind === "SINGLE"/.test(sectionCode), "1개에만 붙는 문구를 새로 만들었다");
  });

  test("빈 날짜는 기존 화면과 같은 '-' 로 그린다", () => {
    assert.match(sectionFlat, /\{value \?\? "-"\}/);
  });
});

// ── ⑤ 🔴 화면이 제 손으로 고르지 않는다 ─────────────────────────────────

test("🔴 구역에 sort/filter/slice 가 없다 — 고르는 일은 도메인 몫이다", () => {
  assert.ok(
    !/\.sort\(|\.filter\(|\.slice\(|\.reduce\(|\.map\(/.test(sectionCode),
    "화면이 줄을 골라 내고 있다 — 그러면 규칙이 두 벌이 된다"
  );
  assert.ok(
    !/quoteIssuedDate <|orderIssuedDate <|Math\.min/.test(sectionCode),
    "화면이 날짜를 직접 비교하고 있다"
  );
});

test("🔴 이 구역에 수정 단추가 없다 — 고치는 길은 다음 조각이다", () => {
  assert.ok(!sectionCode.includes("수정"), "수정 단추는 다음 조각의 일이다");
  assert.ok(!/onStartEdit|editableFields|editingSection/.test(sectionCode));
  // 부모도 이 구역에는 편집 관련 값을 한 개도 넘기지 않는다.
  assert.match(viewFlat, /<DomesticOrderDatesSection rows=\{domesticOrderIssueDates\} \/>/);
});
