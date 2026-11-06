import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DOMESTIC_ORDER_NO_MODEL_LINK_LABEL,
  resolveDomesticOrderModelLink,
} from "./domestic-order-detail-link";
import {
  domesticOrderDetailHrefs,
  resolveActiveTabHref,
} from "./domestic-order-detail-tabs";
import { resolveActiveTabHref as repairCaseResolveActiveTabHref } from "./repair-case-detail-tabs";

/**
 * ============================================================================
 * 내자 정리 [형식] → 「기타건 상세」 — 주소와 링크 규칙을 **값으로** 잰다 (2026-11-06)
 * ============================================================================
 * 재는 것 넷:
 *  ① 🔴 수리 건이 **안 붙은** 줄의 형식이 링크다.
 *  ② 🔴 **붙은 줄은 링크가 아니다** — 그 줄은 인수번호가 이미 수리 건으로 간다.
 *  ③ 🔴 견적서 없이 손으로 더한 줄(형식이 빈 줄)에서도 **누를 것이 선다**.
 *  ④ 🔴 첫 화면이 기본정보다 — 루트 주소가 곧 기본정보이고, 나머지 셋이 그 아래다.
 *
 * 🔵 **표본이 한쪽으로 쏠려 공짜로 통과하지 않게** 못을 먼저 박는다 — 아래 표본에서
 * LINK 와 TEXT 가 **둘 다** 나오는지 세고 시작한다. 한 갈래만 들어 있으면
 * 「전부 링크」도 「전부 글자」도 같은 모양으로 통과한다.
 * ============================================================================
 */

const ID = "11111111-2222-3333-4444-555555555555";

/** 표본 넷 — 두 갈래(붙음/안 붙음) × 두 경우(형식 있음/없음). */
const SAMPLES = [
  { name: "안 붙음 · 형식 있음", row: { id: ID, repairCaseId: null, modelName: "CMK300M-JS2" } },
  { name: "안 붙음 · 형식 없음", row: { id: ID, repairCaseId: null, modelName: null } },
  { name: "붙음 · 형식 있음", row: { id: ID, repairCaseId: "aaaa", modelName: "CMK300M-JS2" } },
  { name: "붙음 · 형식 없음", row: { id: ID, repairCaseId: "aaaa", modelName: null } },
] as const;

test("🔵 못 — 표본에 두 갈래가 다 들어 있다(한쪽만이면 아래가 전부 공짜로 통과한다)", () => {
  const kinds = SAMPLES.map((sample) => resolveDomesticOrderModelLink(sample.row).kind);
  assert.equal(kinds.filter((kind) => kind === "LINK").length, 2, kinds.join(","));
  assert.equal(kinds.filter((kind) => kind === "TEXT").length, 2, kinds.join(","));
});

describe("① 수리 건이 안 붙은 줄 — 형식이 링크다", () => {
  test("형식 글자가 그대로 링크 글자이고, 가는 곳은 그 줄의 기타건 상세다", () => {
    const link = resolveDomesticOrderModelLink(SAMPLES[0].row);
    assert.equal(link.kind, "LINK");
    assert.equal(link.kind === "LINK" && link.label, "CMK300M-JS2");
    assert.equal(link.kind === "LINK" && link.href, `/domestic-orders/${ID}`);
  });

  test("🔴 주소를 글자로 짓지 않는다 — 탭 헬퍼의 루트와 **같은 값**이다", () => {
    const link = resolveDomesticOrderModelLink(SAMPLES[0].row);
    assert.equal(link.kind === "LINK" && link.href, domesticOrderDetailHrefs(ID).root);
  });
});

describe("② 수리 건이 붙은 줄 — 링크가 아니다", () => {
  // 🔴 이 줄은 인수번호가 이미 수리 건 상세로 가는 링크다. 둘이 서로 다른 곳으로
  //    가면 사람은 어느 쪽이 「이 줄」인지 알 수 없다.
  test("형식이 있어도 글자다 — 글자는 예전과 한 글자도 같다", () => {
    const link = resolveDomesticOrderModelLink(SAMPLES[2].row);
    assert.equal(link.kind, "TEXT");
    assert.equal(link.label, "CMK300M-JS2");
  });

  test("🔴 형식이 비어도 글자다 — `(형식 없음)` 으로 바뀌지 않는다", () => {
    const link = resolveDomesticOrderModelLink(SAMPLES[3].row);
    assert.equal(link.kind, "TEXT");
    // 빈 값의 글자는 목록이 쓰던 그대로 "-" 다. 붙은 줄에는 누를 것이 필요 없다.
    assert.equal(link.label, "-");
    assert.notEqual(link.label, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
  });
});

describe("③ 형식이 빈 줄에서도 누를 것이 선다", () => {
  test("🔴 `(형식 없음)` 이 링크 글자가 된다 — 없으면 그 줄은 상세로 갈 길이 없다", () => {
    const link = resolveDomesticOrderModelLink(SAMPLES[1].row);
    assert.equal(link.kind, "LINK");
    assert.equal(link.kind === "LINK" && link.label, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
    // "-" 를 링크로 만들지 않는다 — 그 글자는 이 저장소의 모든 화면이 빈 값에 쓴다.
    assert.notEqual(link.kind === "LINK" && link.label, "-");
  });

  test("공백만 적힌 형식도 「없음」이다 — 보이지 않는 한 칸짜리 링크가 생기지 않게", () => {
    const link = resolveDomesticOrderModelLink({ id: ID, repairCaseId: null, modelName: "   " });
    assert.equal(link.kind === "LINK" && link.label, DOMESTIC_ORDER_NO_MODEL_LINK_LABEL);
  });

  test("🔴 앞뒤 공백은 떼고 글자는 살린다", () => {
    const link = resolveDomesticOrderModelLink({ id: ID, repairCaseId: null, modelName: " RFG-7 " });
    assert.equal(link.kind === "LINK" && link.label, "RFG-7");
  });
});

describe("④ 주소 넷 — 기본정보가 첫 화면이다", () => {
  const hrefs = domesticOrderDetailHrefs(ID);

  test("루트가 곧 기본정보이고, 나머지 셋이 그 아래다", () => {
    assert.equal(hrefs.root, `/domestic-orders/${ID}`);
    assert.equal(hrefs.quotes, `/domestic-orders/${ID}/quotes`);
    assert.equal(hrefs.purchaseOrders, `/domestic-orders/${ID}/purchase-orders`);
    assert.equal(hrefs.approval, `/domestic-orders/${ID}/approval`);
    for (const href of [hrefs.quotes, hrefs.purchaseOrders, hrefs.approval]) {
      assert.ok(href.startsWith(`${hrefs.root}/`), href);
    }
  });

  test("🔴 활성 판정은 **가장 긴 앞가지**다 — 루트 탭이 모든 주소에서 켜지지 않는다", () => {
    const all = [hrefs.root, hrefs.quotes, hrefs.purchaseOrders, hrefs.approval];
    assert.equal(resolveActiveTabHref(hrefs.root, all), hrefs.root);
    assert.equal(resolveActiveTabHref(hrefs.quotes, all), hrefs.quotes);
    assert.equal(resolveActiveTabHref(hrefs.purchaseOrders, all), hrefs.purchaseOrders);
    assert.equal(resolveActiveTabHref(hrefs.approval, all), hrefs.approval);
    // 아래 탭의 하위 주소에서도 그 탭이 켜진다(루트가 아니다).
    assert.equal(resolveActiveTabHref(`${hrefs.quotes}/1`, all), hrefs.quotes);
  });

  test("🔴 그 판정을 베끼지 않았다 — 수리 건 상세의 **그 함수 그대로**다", () => {
    assert.equal(resolveActiveTabHref, repairCaseResolveActiveTabHref);
  });
});
