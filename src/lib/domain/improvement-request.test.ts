import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  arrangeImprovementRequestList,
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  countImprovementRequestBodyChars,
  IMPROVEMENT_REQUEST_LIST_STATUS_ORDER,
  IMPROVEMENT_REQUEST_STATUS_LABELS,
  IMPROVEMENT_REQUEST_STATUSES,
  isImprovementRequestStatus,
  planImprovementRequestStatusChange,
  type ImprovementRequestProgressFields,
  type ImprovementRequestStatus,
} from "./improvement-request";
import { improvementRequestStatusEnum } from "@/lib/db/schema/improvement-requests";

/**
 * 이 파일이 지키는 것은 셋이다.
 *
 *  1. **도메인 목록과 표의 enum 이 같다** — 스키마는 도메인을 가져오지 않으므로
 *     두 벌이고, 갈라지면 여기서 걸린다.
 *  2. **상태 옮기기 결과가 언제나 DB CHECK 를 지킨다** — 세 상태 × 세 상태 아홉
 *     가지 전부. 아래 satisfiesCheck 는 스키마의 `improvement_requests_*_pair` ·
 *     `improvement_requests_status_columns` 를 그대로 옮긴 것이다.
 *  3. **작성자는 접수 상태인 자기 글만 고치고 지운다** — 관리 권한은 지우기만 넓힌다.
 */

const ACTOR = randomUUID();
const EARLIER_ACTOR = randomUUID();
const NOW = new Date("2026-09-13T05:00:00.000Z");
const EARLIER = new Date("2026-09-10T01:00:00.000Z");

/** 스키마 CHECK 의 JS 사본. 쌍은 함께 있고, 상태와 칸이 맞는다. */
function satisfiesCheck(status: ImprovementRequestStatus, f: ImprovementRequestProgressFields): boolean {
  const inProgressPair = (f.inProgressBy === null) === (f.inProgressAt === null);
  const resolvedPair = (f.resolvedBy === null) === (f.resolvedAt === null);
  if (!inProgressPair || !resolvedPair) return false;
  switch (status) {
    case "OPEN":
      return f.inProgressBy === null && f.resolvedBy === null;
    case "IN_PROGRESS":
      return f.inProgressBy !== null && f.resolvedBy === null;
    case "RESOLVED":
      return f.resolvedBy !== null;
  }
}

/**
 * 그 상태로 DB 에 있을 수 있는 네 칸. 해결은 두 모양이 다 있을 수 있다 —
 * 진행중을 거쳐 왔거나(in_progress 쌍 있음) 접수에서 곧바로 왔거나(없음).
 */
function storedShapes(status: ImprovementRequestStatus): ImprovementRequestProgressFields[] {
  const empty = { inProgressBy: null, inProgressAt: null, resolvedBy: null, resolvedAt: null };
  switch (status) {
    case "OPEN":
      return [empty];
    case "IN_PROGRESS":
      return [{ ...empty, inProgressBy: EARLIER_ACTOR, inProgressAt: EARLIER }];
    case "RESOLVED":
      return [
        { inProgressBy: EARLIER_ACTOR, inProgressAt: EARLIER, resolvedBy: EARLIER_ACTOR, resolvedAt: EARLIER },
        { ...empty, resolvedBy: EARLIER_ACTOR, resolvedAt: EARLIER },
      ];
  }
}

describe("상태 목록", () => {
  test("도메인 목록과 improvement_request_status 가 글자 그대로 같다", () => {
    assert.deepEqual([...improvementRequestStatusEnum.enumValues], [...IMPROVEMENT_REQUEST_STATUSES]);
  });

  test("한글 이름표는 접수 · 진행중 · 해결이다", () => {
    assert.deepEqual(
      IMPROVEMENT_REQUEST_STATUSES.map((s) => IMPROVEMENT_REQUEST_STATUS_LABELS[s]),
      ["접수", "진행중", "해결"]
    );
  });

  test("상태 값 판별", () => {
    for (const s of IMPROVEMENT_REQUEST_STATUSES) assert.equal(isImprovementRequestStatus(s), true);
    for (const bad of ["open", "DONE", "", null, undefined, 1]) {
      assert.equal(isImprovementRequestStatus(bad), false, String(bad));
    }
  });

  test("시험이 쓰는 저장 모양이 스스로 CHECK 를 지킨다", () => {
    for (const s of IMPROVEMENT_REQUEST_STATUSES) {
      for (const shape of storedShapes(s)) assert.equal(satisfiesCheck(s, shape), true, s);
    }
  });
});

describe("상태 옮기기 — 세 상태 × 세 상태", () => {
  const cases: Array<[ImprovementRequestStatus, ImprovementRequestStatus]> = [];
  for (const from of IMPROVEMENT_REQUEST_STATUSES) {
    for (const to of IMPROVEMENT_REQUEST_STATUSES) cases.push([from, to]);
  }

  test("아홉 가지를 모두 다룬다", () => {
    assert.equal(cases.length, 9);
  });

  for (const [from, to] of cases) {
    test(`${from} → ${to}`, () => {
      for (const current of storedShapes(from)) {
        const plan = planImprovementRequestStatusChange({ from, to, current, actorUserId: ACTOR, now: NOW });

        if (from === to) {
          assert.deepEqual(plan, { kind: "unchanged" }, "같은 상태로는 바뀐 것이 없다");
          continue;
        }

        assert.equal(plan.kind, "changed");
        if (plan.kind !== "changed") return;
        assert.equal(plan.status, to);
        assert.equal(satisfiesCheck(to, plan.fields), true, "결과가 DB CHECK 를 어긴다");

        switch (to) {
          case "OPEN":
            assert.deepEqual(plan.fields, {
              inProgressBy: null,
              inProgressAt: null,
              resolvedBy: null,
              resolvedAt: null,
            });
            break;
          case "IN_PROGRESS":
            assert.deepEqual(plan.fields, {
              inProgressBy: ACTOR,
              inProgressAt: NOW,
              resolvedBy: null,
              resolvedAt: null,
            });
            break;
          case "RESOLVED":
            // in_progress 쌍은 그대로 둔다 — 거쳐 왔으면 남고, 곧바로 왔으면 비어 있다.
            assert.deepEqual(plan.fields, {
              inProgressBy: current.inProgressBy,
              inProgressAt: current.inProgressAt,
              resolvedBy: ACTOR,
              resolvedAt: NOW,
            });
            break;
        }
      }
    });
  }

  test("접수에서 곧바로 해결로 가면 in_progress 쌍은 비어 있다", () => {
    const [open] = storedShapes("OPEN");
    const plan = planImprovementRequestStatusChange({
      from: "OPEN",
      to: "RESOLVED",
      current: open,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, null);
    assert.equal(plan.fields.inProgressAt, null);
  });

  test("진행중을 거쳐 해결되면 맡았던 사람이 남는다", () => {
    const [inProgress] = storedShapes("IN_PROGRESS");
    const plan = planImprovementRequestStatusChange({
      from: "IN_PROGRESS",
      to: "RESOLVED",
      current: inProgress,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, EARLIER_ACTOR);
    assert.equal(plan.fields.inProgressAt, EARLIER);
  });

  test("해결에서 진행중으로 되돌리면 지금 옮긴 사람이 새로 맡는다", () => {
    const [resolved] = storedShapes("RESOLVED");
    const plan = planImprovementRequestStatusChange({
      from: "RESOLVED",
      to: "IN_PROGRESS",
      current: resolved,
      actorUserId: ACTOR,
      now: NOW,
    });
    assert.equal(plan.kind, "changed");
    if (plan.kind !== "changed") return;
    assert.equal(plan.fields.inProgressBy, ACTOR);
    assert.equal(plan.fields.inProgressAt, NOW);
  });
});

describe("누가 무엇을", () => {
  const AUTHOR = randomUUID();
  const OTHER = randomUUID();

  test("내용 고치기 — 접수 상태인 자기 글만", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      assert.equal(
        canEditImprovementRequestBody({ status, createdBy: AUTHOR, actorUserId: AUTHOR }),
        status === "OPEN",
        `작성자 · ${status}`
      );
      assert.equal(
        canEditImprovementRequestBody({ status, createdBy: AUTHOR, actorUserId: OTHER }),
        false,
        `남 · ${status}`
      );
    }
  });

  test("지우기 — 관리 권한이 있으면 어느 글이든", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      for (const actorUserId of [AUTHOR, OTHER]) {
        assert.equal(
          canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId, canManage: true }),
          true,
          status
        );
      }
    }
  });

  test("지우기 — 관리 권한이 없으면 접수 상태인 자기 글만", () => {
    for (const status of IMPROVEMENT_REQUEST_STATUSES) {
      assert.equal(
        canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId: AUTHOR, canManage: false }),
        status === "OPEN",
        `작성자 · ${status}`
      );
      assert.equal(
        canDeleteImprovementRequest({ status, createdBy: AUTHOR, actorUserId: OTHER, canManage: false }),
        false,
        `남 · ${status}`
      );
    }
  });
});

describe("글자 수", () => {
  test("코드 포인트로 센다 — DB 의 char_length 와 같다", () => {
    assert.equal(countImprovementRequestBodyChars("가나다"), 3);
    assert.equal(countImprovementRequestBodyChars("😀"), 1, "이모지 하나는 한 글자다");
    assert.equal(countImprovementRequestBodyChars(""), 0);
  });
});

describe("목록 차례", () => {
  type Row = { id: string; status: ImprovementRequestStatus; createdAt: string };
  const row = (id: string, status: ImprovementRequestStatus, createdAt: string): Row => ({ id, status, createdAt });

  // 조회가 돌려주는 차례(최근 글부터)와 일부러 다르게 섞어 둔다.
  const ITEMS: Row[] = [
    row("a", "RESOLVED", "2026-09-12T00:00:00.000Z"),
    row("b", "OPEN", "2026-09-10T00:00:00.000Z"),
    row("c", "IN_PROGRESS", "2026-09-01T00:00:00.000Z"),
    row("d", "OPEN", "2026-09-11T00:00:00.000Z"),
    row("e", "IN_PROGRESS", "2026-09-05T00:00:00.000Z"),
    row("f", "RESOLVED", "2026-08-30T00:00:00.000Z"),
  ];

  test("차례 목록은 세 상태를 한 번씩 담는다", () => {
    assert.deepEqual([...IMPROVEMENT_REQUEST_LIST_STATUS_ORDER].sort(), [...IMPROVEMENT_REQUEST_STATUSES].sort());
    assert.deepEqual(IMPROVEMENT_REQUEST_LIST_STATUS_ORDER, ["IN_PROGRESS", "OPEN", "RESOLVED"]);
  });

  test("진행중 → 접수 → 해결, 같은 상태 안에서는 최신순", () => {
    const { rows } = arrangeImprovementRequestList(ITEMS, { showResolved: true });
    assert.deepEqual(
      rows.map((r) => r.id),
      ["e", "c", "d", "b", "a", "f"]
    );
  });

  test("해결된 것은 기본으로 감추고, 감춘 수를 알린다", () => {
    const hidden = arrangeImprovementRequestList(ITEMS, { showResolved: false });
    assert.deepEqual(
      hidden.rows.map((r) => r.id),
      ["e", "c", "d", "b"]
    );
    assert.equal(hidden.resolvedCount, 2);
    assert.equal(hidden.hiddenResolvedCount, 2);

    const shown = arrangeImprovementRequestList(ITEMS, { showResolved: true });
    assert.equal(shown.resolvedCount, 2);
    assert.equal(shown.hiddenResolvedCount, 0, "켜 두면 감춘 것이 없다");
  });

  test("같은 시각이면 id 내림차순 — 조회의 동점 규칙과 같다", () => {
    const at = "2026-09-13T05:00:00.000Z";
    const { rows } = arrangeImprovementRequestList(
      [row("11", "OPEN", at), row("33", "OPEN", at), row("22", "OPEN", at)],
      { showResolved: false }
    );
    assert.deepEqual(
      rows.map((r) => r.id),
      ["33", "22", "11"]
    );
  });

  test("받은 배열을 건드리지 않는다 — 서버가 넘긴 props 다", () => {
    const before = ITEMS.map((r) => r.id);
    arrangeImprovementRequestList(ITEMS, { showResolved: false });
    assert.deepEqual(
      ITEMS.map((r) => r.id),
      before
    );
  });

  test("빈 목록", () => {
    assert.deepEqual(arrangeImprovementRequestList([], { showResolved: false }), {
      rows: [],
      resolvedCount: 0,
      hiddenResolvedCount: 0,
    });
  });
});
