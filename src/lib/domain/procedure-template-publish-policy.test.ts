import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE_PUBLISHABLE_STATUSES,
  canPublishFromProcedureStatus,
  pickPublishedSiblingsToExpire,
  type ProcedureSeriesMemberForPublish,
} from "./procedure-template-publish-policy";
import {
  PROCEDURE_TEMPLATE_STATUS_CODES,
  procedureTemplateStatusLabels,
} from "./procedure-template-types";

/**
 * ============================================================================
 * 한 계열에 게시본은 하나 — **규칙 쪽**을 값으로 잰다 (2026-11-04)
 * ============================================================================
 * 사용자가 말한 것: "지금 게시된 것이 있다면 그 다른 버전은 [만료됨]이 되고,
 * 만료됨 에도 [게시]를 둬서 다시 게시할 수 있도록 … 한 제목 안에서 한개의
 * 버전만 게시상태로."
 *
 * 여기서 재는 것은 **고르는 규칙**이다. 그 규칙이 진짜 DB 행에 걸리는지는
 * db 목록의 procedure-templates.integration.test.ts 가, 화면에 그려지는지는
 * components 목록의 procedure-publish-flow.test.tsx 가 각각 잰다.
 * ============================================================================
 */

function member(
  id: string,
  version: number,
  status: ProcedureSeriesMemberForPublish["status"]
): ProcedureSeriesMemberForPublish {
  return { id, version, status };
}

describe("게시 가능한 상태 — ① 먼저 표본 확인", () => {
  test("🔵 재려는 상태 셋이 실제로 그 enum 의 전부다", () => {
    // 상태가 넷이 되는 날 이 단언이 먼저 깨진다 — 그래야 "새 상태는 게시할 수
    // 있는가"를 아무도 안 정한 채 지나가지 않는다.
    assert.deepEqual([...PROCEDURE_TEMPLATE_STATUS_CODES], ["DRAFT", "PUBLISHED", "ARCHIVED"]);
  });

  test("🔴 [만료됨]은 새 상태가 아니라 ARCHIVED 의 화면 글자다", () => {
    assert.equal(procedureTemplateStatusLabels.ARCHIVED, "만료됨");
    assert.ok(
      !(PROCEDURE_TEMPLATE_STATUS_CODES as readonly string[]).includes("EXPIRED"),
      "enum 에 값을 늘렸다면 마이그레이션이 있어야 하고, 뜻이 겹치는 상태가 둘이 된다"
    );
  });
});

describe("게시 가능한 상태 — ② DRAFT 와 ARCHIVED 둘뿐", () => {
  test("🔴 초안은 올릴 수 있다", () => {
    assert.equal(canPublishFromProcedureStatus("DRAFT"), true);
  });

  test("🔴 만료본(ARCHIVED)도 올릴 수 있다 — 사용자가 요청한 [다시 게시]의 자리", () => {
    assert.equal(canPublishFromProcedureStatus("ARCHIVED"), true);
  });

  test("🔴 이미 게시된 판은 못 올린다 — 눌러도 아무 일이 안 일어나는 단추를 만들지 않는다", () => {
    assert.equal(canPublishFromProcedureStatus("PUBLISHED"), false);
  });

  test("목록과 판정이 어긋나지 않는다 — 셋 전부를 목록으로 다시 세어 본다", () => {
    const allowed = PROCEDURE_TEMPLATE_STATUS_CODES.filter((status) =>
      canPublishFromProcedureStatus(status)
    );
    assert.deepEqual([...allowed], [...PROCEDURE_PUBLISHABLE_STATUSES]);
    assert.equal(allowed.length, 2, "하나로 줄거나 셋으로 늘면 여기서 걸린다");
  });
});

describe("내려갈 판 고르기 — ③ 게시본만, 자기 자신은 빼고", () => {
  /** 개발 DB 의 code "7" 그대로 — v1·v2 가 둘 다 PUBLISHED 이고 v3 가 초안이다. */
  const LEGACY_SERIES = [
    member("t1", 1, "PUBLISHED"),
    member("t2", 2, "PUBLISHED"),
    member("t3", 3, "DRAFT"),
  ];

  test("🔵 먼저 표본 — 이 계열에 게시본이 정말 둘이다", () => {
    assert.equal(LEGACY_SERIES.filter((m) => m.status === "PUBLISHED").length, 2);
  });

  test("🔴 초안을 올리면 게시본 **둘 다** 내려간다 — 한 판만 내리면 게시본이 둘로 남는다", () => {
    const expiring = pickPublishedSiblingsToExpire(LEGACY_SERIES, "t3");
    assert.deepEqual(
      expiring.map((m) => m.id),
      ["t1", "t2"]
    );
  });

  test("🔴 자기 자신은 절대 안 고른다", () => {
    // 만료본을 다시 올리는 길에서는 자기가 PUBLISHED 가 아니라 걸릴 일이 없어
    // 보이지만, 게시본에서의 재게시를 허용하는 날 자기를 내리는 사고가 된다.
    const republishing = pickPublishedSiblingsToExpire(LEGACY_SERIES, "t1");
    assert.deepEqual(
      republishing.map((m) => m.id),
      ["t2"]
    );
    const self = pickPublishedSiblingsToExpire([member("only", 1, "PUBLISHED")], "only");
    assert.deepEqual(self, []);
  });

  test("초안·만료본은 안 건드린다 — 내려갈 것은 지금 떠 있는 게시본뿐이다", () => {
    const mixed = [
      member("a", 1, "ARCHIVED"),
      member("b", 2, "DRAFT"),
      member("c", 3, "PUBLISHED"),
      member("d", 4, "ARCHIVED"),
    ];
    assert.deepEqual(
      pickPublishedSiblingsToExpire(mixed, "b").map((m) => m.id),
      ["c"]
    );
  });

  test("게시본이 하나도 없으면 빈 목록 — 처음 올리는 줄기에서 내려갈 것은 없다", () => {
    assert.deepEqual(pickPublishedSiblingsToExpire([member("x", 1, "DRAFT")], "x"), []);
    assert.deepEqual(pickPublishedSiblingsToExpire([], "x"), []);
  });

  test("받은 배열을 손대지 않는다 — 부르는 쪽이 같은 배열을 다시 쓴다", () => {
    const rows = [...LEGACY_SERIES];
    const snapshot = rows.map((m) => `${m.id}:${m.status}`);
    pickPublishedSiblingsToExpire(rows, "t3");
    assert.deepEqual(
      rows.map((m) => `${m.id}:${m.status}`),
      snapshot
    );
  });

  test("차례는 받은 그대로다 — 부르는 쪽이 판 번호 오름차순으로 잠가서 넘긴다", () => {
    const reversed = [member("t2", 2, "PUBLISHED"), member("t1", 1, "PUBLISHED")];
    assert.deepEqual(
      pickPublishedSiblingsToExpire(reversed, "none").map((m) => m.version),
      [2, 1],
      "여기서 다시 정렬하면 잠금 차례와 쓰기 차례가 어긋난다"
    );
  });
});
