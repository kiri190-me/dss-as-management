import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { resolveProcedureListLink } from "./procedure-list-navigation";
import { PROCEDURE_TEMPLATE_CATEGORY_CODES } from "./procedure-template-types";

/**
 * ============================================================================
 * [절차 상세]에서 목록으로 나가는 길 — 어디로 보내는가 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것: "[절차 상세]에서 목록으로 빠져나올 수 있는 버튼도 만들어줘."
 *
 * 상세는 분류 셋(TECHNICAL_TASK · FULL_SERVICE · REFERENCE)에 다 쓰인다. 그런데
 * **목록 라우트는 지금 하나뿐이다** — 그 사실을 여기서 값으로 못 박는다. 목록이
 * 둘이 되는 날 "목록은 지금 하나뿐이다"가 먼저 깨져서, 분류별로 어디로 보낼지를
 * 아무도 안 정한 채 지나가지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const routeExists = (relativePath: string) => existsSync(new URL(relativePath, repoUrl));

describe("절차 목록으로 나가는 길 — ① 먼저 표본 확인", () => {
  test("🔵 재려는 분류 셋이 실제로 그 enum 의 전부다", () => {
    assert.deepEqual(
      [...PROCEDURE_TEMPLATE_CATEGORY_CODES],
      ["FULL_SERVICE", "TECHNICAL_TASK", "REFERENCE"],
      "분류가 넷이 되면 '어디로 보낼지'를 한 번 더 정해야 한다"
    );
  });

  test("🔴 보내는 주소가 **실재하는 라우트**다 — 없는 곳으로 보내면 404 다", () => {
    for (const category of PROCEDURE_TEMPLATE_CATEGORY_CODES) {
      const { href } = resolveProcedureListLink(category);
      const routeFile = `src/app/(app)${href}/page.tsx`;
      assert.ok(routeExists(routeFile), `${category} → ${href} : ${routeFile} 가 없다`);
    }
  });
});

describe("절차 목록으로 나가는 길 — ② 분류가 정한다", () => {
  test("기술 작업 절차는 제 목록으로 간다", () => {
    const link = resolveProcedureListLink("TECHNICAL_TASK");
    assert.equal(link.href, "/procedures/technical");
    assert.equal(link.label, "기술 작업 절차 목록");
  });

  test("🔴 **목록은 지금 하나뿐이다** — 분류 셋이 전부 같은 곳으로 간다", () => {
    // 🔴 이 단언은 "지금 그렇다"를 적어 둔 것이지 설계 목표가 아니다.
    //    FULL_SERVICE·REFERENCE 는 어느 목록에도 뜨지 않는다 — 분류 전체 목록은
    //    IA 정리 때 사용자 입구에서 내려갔고(/procedures 는 redirect 한 줄),
    //    남은 목록은 category='TECHNICAL_TASK' 로 거른다.
    //    전용 목록이 생기는 날 여기가 먼저 깨지고, 그때 분류별로 다시 정한다.
    const destinations = new Set(
      PROCEDURE_TEMPLATE_CATEGORY_CODES.map((category) => resolveProcedureListLink(category).href)
    );
    assert.equal(destinations.size, 1, "목록이 둘이 되면 분류별 갈림을 다시 정해야 한다");
    assert.deepEqual([...destinations], ["/procedures/technical"]);
  });

  test("🔴 글자가 **가는 곳의 이름**이다 — 어디에 떨어지는지 누르기 전에 알린다", () => {
    // 제 목록이 없는 분류를 열었을 때 "목록으로"라고만 적으면, 기술 작업 절차
    // 목록에 떨어진 사람이 엉뚱한 곳으로 갔다고 읽는다.
    for (const category of PROCEDURE_TEMPLATE_CATEGORY_CODES) {
      const link = resolveProcedureListLink(category);
      assert.ok(link.label.includes("목록"), `${category} 의 글자가 목록이라고 말하지 않는다`);
      assert.notEqual(link.label, "목록", "어느 목록인지가 빠지면 가는 곳을 알 수 없다");
    }
  });

  test("같은 분류는 늘 같은 답 — 부르는 자리마다 다른 곳으로 가면 안 된다", () => {
    assert.deepEqual(resolveProcedureListLink("REFERENCE"), resolveProcedureListLink("REFERENCE"));
  });
});
