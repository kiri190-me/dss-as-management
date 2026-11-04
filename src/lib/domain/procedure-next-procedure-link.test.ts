import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  NEXT_PROCEDURE_LINK_NODE_TYPES,
  findMisplacedNextProcedureLinks,
  isNextProcedureLinkAllowedOn,
  resolveNextProcedureTarget,
  type ProcedureSeriesCandidate,
} from "./procedure-next-procedure-link";
import { PROCEDURE_NODE_TYPE_CODES } from "./procedure-template-types";

/**
 * ============================================================================
 * END 에서 다른 절차로 이어가기 — **가리키는 규칙과 푸는 규칙**
 * ============================================================================
 * 줄기 B ④ 조각 ①(스키마만). 여기서는 규칙만 값으로 잰다 — 칸이 실제로 생겼는지는
 * db 목록의 통합 시험이, 화면에서 고를 수 있는지는 조각 ② 가 잰다.
 *
 * 🔴 이 파일이 지키는 결정(2026-11-04 사용자): **「계열을 따라간다」.** 칸에는
 * 판의 id 가 들어가지만 실행은 그 판의 code 로 **지금 게시본**을 연다.
 * 결정이 뒤집히면 이 시험들이 먼저 깨져서 알려 줘야 한다 — 통과하는 시험 이름에
 * 틀린 설계가 적혀 있는 일을 막으려면, 이름이 아니라 **값**이 그 결정을 재야 한다.
 * ============================================================================
 */

const 기본판: ProcedureSeriesCandidate = {
  id: "t-1",
  code: "mb-repair",
  version: 1,
  status: "ARCHIVED",
};

function 판(over: Partial<ProcedureSeriesCandidate>): ProcedureSeriesCandidate {
  return { ...기본판, ...over };
}

describe("이어가기 — ① 어느 노드에 달 수 있나", () => {
  test("🔵 먼저 표본 — 재려는 노드 종류 아홉이 그 enum 의 전부다", () => {
    assert.equal(PROCEDURE_NODE_TYPE_CODES.length, 9);
  });

  test("🔴 END 하나뿐이다 — 중간 노드에 달면 실행 순서가 달라진다", () => {
    assert.deepEqual([...NEXT_PROCEDURE_LINK_NODE_TYPES], ["END"]);
    assert.equal(isNextProcedureLinkAllowedOn("END"), true);
  });

  test("🔴 나머지 여덟은 전부 막힌다 — 하나씩 세어 본다", () => {
    const 막힌것 = PROCEDURE_NODE_TYPE_CODES.filter((t) => !isNextProcedureLinkAllowedOn(t));
    assert.equal(막힌것.length, 8);
    assert.equal(막힌것.includes("START"), true);
    assert.equal(막힌것.includes("DECISION"), true);
  });

  test("END 가 아닌데 값이 든 노드를 집어낸다 — 빈 배열이 정상이다", () => {
    const 정상 = findMisplacedNextProcedureLinks([
      { nodeCode: "n1", nodeType: "END", nextProcedureTemplateId: "t-1" },
      { nodeCode: "n2", nodeType: "TASK", nextProcedureTemplateId: null },
    ]);
    assert.deepEqual(정상, []);

    const 잘못 = findMisplacedNextProcedureLinks([
      { nodeCode: "n3", nodeType: "TASK", nextProcedureTemplateId: "t-1" },
    ]);
    assert.equal(잘못.length, 1);
    assert.equal(잘못[0].nodeCode, "n3");
  });
});

describe("이어가기 — ② 계열을 따라간다 (사용자 결정)", () => {
  test("🔴 가리킨 판이 만료본이어도 **지금 게시본**이 열린다 — 이것이 결정의 알맹이다", () => {
    const 결과 = resolveNextProcedureTarget({
      pointedTemplate: 판({ id: "t-1", version: 1, status: "ARCHIVED" }),
      candidates: [
        판({ id: "t-1", version: 1, status: "ARCHIVED" }),
        판({ id: "t-3", version: 3, status: "PUBLISHED" }),
      ],
    });
    assert.deepEqual(결과, { ok: true, templateId: "t-3", version: 3 });
  });

  test("🔴 개정되어도 END 를 다시 지정하지 않는다 — 같은 칸 값이 새 판을 연다", () => {
    const 가리킨값 = 판({ id: "t-1", version: 1, status: "ARCHIVED" });
    const 오늘 = resolveNextProcedureTarget({
      pointedTemplate: 가리킨값,
      candidates: [가리킨값, 판({ id: "t-2", version: 2, status: "PUBLISHED" })],
    });
    const 개정후 = resolveNextProcedureTarget({
      pointedTemplate: 가리킨값,
      candidates: [
        가리킨값,
        판({ id: "t-2", version: 2, status: "ARCHIVED" }),
        판({ id: "t-4", version: 4, status: "PUBLISHED" }),
      ],
    });
    assert.equal(오늘.ok && 오늘.templateId, "t-2");
    assert.equal(개정후.ok && 개정후.templateId, "t-4");
  });

  test("🔴 남의 계열은 섞이지 않는다 — code 가 다른 게시본은 후보가 아니다", () => {
    const 결과 = resolveNextProcedureTarget({
      pointedTemplate: 판({ id: "t-1", code: "mb-repair" }),
      candidates: [
        판({ id: "t-1", code: "mb-repair", version: 1, status: "ARCHIVED" }),
        판({ id: "x-9", code: "rf-inspection", version: 9, status: "PUBLISHED" }),
      ],
    });
    assert.equal(결과.ok, false);
  });
});

describe("이어가기 — ③ 열 수 없을 때 조용히 넘어가지 않는다", () => {
  test("🔴 게시본이 0개면 막고 **까닭을 돌려준다** — 「원래 없음」과 구별돼야 한다", () => {
    const 결과 = resolveNextProcedureTarget({
      pointedTemplate: 판({ status: "DRAFT" }),
      candidates: [판({ status: "DRAFT" })],
    });
    assert.equal(결과.ok, false);
    assert.equal(결과.ok === false && 결과.reason.includes("게시본이 없습니다"), true);
  });

  test("가리킨 판이 사라졌을 때도 까닭이 있다 — 빈 글자가 아니다", () => {
    const 결과 = resolveNextProcedureTarget({ pointedTemplate: null, candidates: [] });
    assert.equal(결과.ok, false);
    assert.equal(결과.ok === false && 결과.reason.length > 0, true);
  });

  test("🔵 게시본이 둘 남은 옛 줄기는 **판 번호가 큰 쪽** — 화면이 말하는 「최신 판」과 같다", () => {
    const 결과 = resolveNextProcedureTarget({
      pointedTemplate: 판({ id: "t-1" }),
      candidates: [
        판({ id: "t-2", version: 2, status: "PUBLISHED" }),
        판({ id: "t-5", version: 5, status: "PUBLISHED" }),
      ],
    });
    assert.deepEqual(결과, { ok: true, templateId: "t-5", version: 5 });
  });
});
