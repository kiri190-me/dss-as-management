import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  NEXT_PROCEDURE_LINK_NODE_TYPES,
  findMisplacedNextProcedureLinks,
  isNextProcedureLinkAllowedOn,
  resolveNextProcedureTarget,
  validateNextProcedureLinks,
  type NextProcedureLinkValidationContext,
  type NextProcedureTargetInfo,
  type ProcedureSeriesCandidate,
} from "./procedure-next-procedure-link";
import { PROCEDURE_NODE_TYPE_CODES, type ProcedureNodeType } from "./procedure-template-types";

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

/**
 * ============================================================================
 * 검증 (조각 ③) — **무엇이 게시를 막고 무엇이 알리기만 하는가**
 * ============================================================================
 * 🔴 여기서 가장 비싼 오답은 「게시본이 있어야 한다」와 「고리」를 ERROR 로
 * 올리는 것이다. A↔B 가 서로를 가리킨 채 둘 다 초안이면 **어느 쪽도 먼저 게시할
 * 수 없어** 영영 막힌다. 그래서 갈림 자체를 값으로 잰다.
 * ============================================================================
 */

function 검증노드(over: Partial<{ id: string; nodeType: ProcedureNodeType; nextProcedureTemplateId: string | null }> = {}) {
  return { id: "node-1", nodeType: "END" as ProcedureNodeType, nextProcedureTemplateId: null, ...over };
}

function 대상(over: Partial<NextProcedureTargetInfo> = {}): NextProcedureTargetInfo {
  return { code: "mb-repair", name: "(MB) 수리", hasPublishedVersion: true, ...over };
}

function 맥락(over: Partial<NextProcedureLinkValidationContext> = {}): NextProcedureLinkValidationContext {
  return {
    thisCode: "power-check",
    targets: new Map([["t-9", 대상()]]),
    seriesLinks: [],
    ...over,
  };
}

describe("이어가기 검증 — ④ 게시를 막는 것(ERROR)", () => {
  test("🔴 END 가 아닌 노드에 지정이 남아 있으면 막는다 — 화면에 고칠 칸이 없는 상태다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nodeType: "TASK", nextProcedureTemplateId: "t-9" })],
      맥락()
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "ERROR");
    assert.match(issues[0].message, /\[종료\] 노드에만/);
  });

  test("🔴 가리킨 판이 사라졌으면 막는다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "없는-id" })],
      맥락()
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "ERROR");
  });

  test("🔴 자기 계열을 가리키면 막는다 — 끝나자마자 같은 절차가 다시 열린다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({ targets: new Map([["t-9", 대상({ code: "power-check" })]]) })
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "ERROR");
    assert.match(issues[0].message, /이 절차 자신/);
  });
});

describe("이어가기 검증 — ⑤ 알리되 막지 않는 것(WARNING)", () => {
  test("🔴 가리킨 계열에 게시본이 없으면 **WARNING 이다** — ERROR 면 서로 가리킨 둘이 영영 못 나간다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({ targets: new Map([["t-9", 대상({ hasPublishedVersion: false })]]) })
    );
    assert.equal(issues.length, 1);
    assert.equal(
      issues[0].severity,
      "WARNING",
      "ERROR 로 올리면 A→B · B→A 가 둘 다 초안일 때 어느 쪽도 먼저 게시할 수 없다"
    );
    assert.match(issues[0].message, /게시본이 없습니다/);
  });

  test("🔴 돌아오는 고리도 **WARNING 이다** — 서버가 무한 반복에 빠지는 종류가 아니다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({ seriesLinks: [{ fromCode: "mb-repair", toCode: "power-check" }] })
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "WARNING");
    assert.match(issues[0].message, /되돌아옵니다/);
  });

  test("🔴 한 다리 건너 돌아오는 것도 찾는다 (A→B→C→A)", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({
        seriesLinks: [
          { fromCode: "mb-repair", toCode: "cleaning" },
          { fromCode: "cleaning", toCode: "power-check" },
        ],
      })
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "WARNING");
  });

  test("🔵 남의 고리는 내 문제가 아니다 — B↔C 가 돌아도 나로 안 오면 조용하다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({
        seriesLinks: [
          { fromCode: "mb-repair", toCode: "cleaning" },
          { fromCode: "cleaning", toCode: "mb-repair" },
        ],
      })
    );
    assert.deepEqual(issues, [], "남의 고리까지 내 절차의 경고로 적으면 고칠 수 없는 경고가 쌓인다");
  });

  test("🔵 고리를 따라가다 **멈춘다** — 멈추지 않으면 이 시험이 끝나지 않는다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({
        seriesLinks: [
          { fromCode: "mb-repair", toCode: "cleaning" },
          { fromCode: "cleaning", toCode: "mb-repair" },
          { fromCode: "mb-repair", toCode: "mb-repair" },
        ],
      })
    );
    assert.deepEqual(issues, []);
  });
});

describe("이어가기 검증 — ⑥ 조용해야 할 때 조용하다", () => {
  test("🔵 지정이 없으면 아무 말도 안 한다 — 지금 운영의 END 전부가 이 자리다", () => {
    assert.deepEqual(validateNextProcedureLinks([검증노드()], 맥락()), []);
  });

  test("🔵 제대로 지정한 END 는 조용하다 — 늘 뭔가 뱉는 것이 아닌지 확인한다", () => {
    assert.deepEqual(validateNextProcedureLinks([검증노드({ nextProcedureTemplateId: "t-9" })], 맥락()), []);
  });

  test("🔴 한 노드가 두 가지에 걸리면 **둘 다** 적는다 — 게시본도 없고 고리도 있다", () => {
    const issues = validateNextProcedureLinks(
      [검증노드({ nextProcedureTemplateId: "t-9" })],
      맥락({
        targets: new Map([["t-9", 대상({ hasPublishedVersion: false })]]),
        seriesLinks: [{ fromCode: "mb-repair", toCode: "power-check" }],
      })
    );
    assert.equal(issues.length, 2, "하나만 적으면 고친 뒤에야 나머지를 알게 된다");
    assert.deepEqual(new Set(issues.map((i) => i.severity)), new Set(["WARNING"]));
  });

  test("🔵 사람이 읽는 글에 꾸밈 글자(별표)가 안 섞인다 — 화면에 그대로 찍힌다", () => {
    const all = [
      ...validateNextProcedureLinks([검증노드({ nodeType: "TASK", nextProcedureTemplateId: "t-9" })], 맥락()),
      ...validateNextProcedureLinks([검증노드({ nextProcedureTemplateId: "없는-id" })], 맥락()),
      ...validateNextProcedureLinks(
        [검증노드({ nextProcedureTemplateId: "t-9" })],
        맥락({ targets: new Map([["t-9", 대상({ hasPublishedVersion: false })]]) })
      ),
      ...validateNextProcedureLinks(
        [검증노드({ nextProcedureTemplateId: "t-9" })],
        맥락({ seriesLinks: [{ fromCode: "mb-repair", toCode: "power-check" }] })
      ),
    ];
    assert.equal(all.length, 4);
    for (const issue of all) assert.ok(!issue.message.includes("**"), `별표가 섞였다: ${issue.message}`);
  });
});
