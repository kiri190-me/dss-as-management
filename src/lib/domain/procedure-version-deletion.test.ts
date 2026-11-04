import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  PROCEDURE_DELETABLE_VERSION_STATUSES,
  canDeleteProcedureVersionStatus,
  resolveProcedureVersionDeleteBlock,
} from "./procedure-version-deletion";
import { PROCEDURE_TEMPLATE_STATUS_CODES } from "./procedure-template-types";

/**
 * ============================================================================
 * [버전 목록]의 [삭제] — **무엇을 지울 수 있고, 못 지우면 뭐라고 적는가**
 * ============================================================================
 * 사용자가 말한 것(2026-11-04): "[버전 목록]에 [삭제]버튼도 만들어줘."
 *
 * 여기서는 규칙만 값으로 잰다. 진짜 행이 그렇게 막히는지는 db 목록의
 * procedure-templates.integration.test.ts 가, 화면에 그 글이 나오는지는
 * components 목록의 procedure-series-and-version-list.test.tsx 가 잰다.
 * ============================================================================
 */

describe("버전 삭제 — ① 지울 수 있는 상태", () => {
  test("🔵 먼저 표본 — 재려는 상태 셋이 그 enum 의 전부다", () => {
    assert.deepEqual([...PROCEDURE_TEMPLATE_STATUS_CODES], ["DRAFT", "PUBLISHED", "ARCHIVED"]);
  });

  test("초안은 지울 수 있다 — 편집기의 [초안 버리기]가 하던 일이다", () => {
    assert.equal(canDeleteProcedureVersionStatus("DRAFT"), true);
  });

  test("만료본도 지울 수 있다 — 더 이상 쓰이지 않는 판이다", () => {
    assert.equal(canDeleteProcedureVersionStatus("ARCHIVED"), true);
  });

  test("🔴 게시본은 못 지운다 — 지금 현장에서 쓰이는 절차다", () => {
    assert.equal(canDeleteProcedureVersionStatus("PUBLISHED"), false);
  });

  test("목록과 판정이 어긋나지 않는다", () => {
    const allowed = PROCEDURE_TEMPLATE_STATUS_CODES.filter((s) => canDeleteProcedureVersionStatus(s));
    assert.deepEqual([...allowed], [...PROCEDURE_DELETABLE_VERSION_STATUSES]);
    assert.equal(allowed.length, 2);
  });
});

describe("버전 삭제 — ② 못 지우는 까닭이 둘로 갈린다", () => {
  test("🔴 게시 중 — 까닭과 **풀리는 길**을 함께 적는다", () => {
    const block = resolveProcedureVersionDeleteBlock({ status: "PUBLISHED", isReferenced: false });
    assert.ok(block, "게시본이 지워지면 현장에서 그 절차가 사라진다");
    assert.match(block.reason, /게시됨 상태라 삭제할 수 없습니다/);
    assert.match(block.detail, /다른 판을 게시하면/, "무엇을 하면 풀리는지가 없으면 사람은 고장으로 읽는다");
    assert.match(block.detail, /\[만료됨\]/);
  });

  test("🔴 쓰이고 있음 — **다른 글**이다. 할 일이 다르기 때문이다", () => {
    const block = resolveProcedureVersionDeleteBlock({ status: "ARCHIVED", isReferenced: true });
    assert.ok(block);
    assert.match(block.reason, /수행 기록·후속 버전이 있어 삭제할 수 없습니다/);
    assert.match(block.detail, /지난 수리의 근거/);

    // 🔴 두 까닭이 같은 글이면 사람은 할 일을 못 고른다 — 앞은 다른 판을
    //    게시하면 풀리고, 뒤는 영영 안 풀린다.
    const published = resolveProcedureVersionDeleteBlock({ status: "PUBLISHED", isReferenced: false });
    assert.notEqual(block.reason, published?.reason);
    assert.notEqual(block.detail, published?.detail);
  });

  test("🔴 둘 다일 때는 **상태가 이긴다** — 서버와 같은 차례여야 한다", () => {
    // 서버(softDeleteProcedureTemplate)는 상태를 먼저 보고 참조를 나중에 센다.
    // 뒤집히면 화면은 "수행 기록"이라 적고 서버는 "게시 중"이라 답한다.
    const both = resolveProcedureVersionDeleteBlock({ status: "PUBLISHED", isReferenced: true });
    assert.ok(both);
    assert.match(both.reason, /게시됨 상태라/);
  });

  test("초안·만료본이 아무것도 안 물고 있으면 막지 않는다 (null)", () => {
    assert.equal(resolveProcedureVersionDeleteBlock({ status: "DRAFT", isReferenced: false }), null);
    assert.equal(resolveProcedureVersionDeleteBlock({ status: "ARCHIVED", isReferenced: false }), null);
  });

  test("🔴 초안도 쓰이고 있으면 막힌다 — 후속 버전이 이어받았을 수 있다", () => {
    const block = resolveProcedureVersionDeleteBlock({ status: "DRAFT", isReferenced: true });
    assert.ok(block, "상태만 보고 통과시키면 15일 뒤 완전삭제가 DB 에서 거부된다");
    assert.match(block.reason, /수행 기록·후속 버전/);
  });

  test("🔵 막는 글은 어느 상태에서도 빈 글자가 아니다", () => {
    for (const status of PROCEDURE_TEMPLATE_STATUS_CODES) {
      for (const isReferenced of [true, false]) {
        const block = resolveProcedureVersionDeleteBlock({ status, isReferenced });
        if (block === null) continue;
        assert.ok(block.reason.length > 5, `${status}/${isReferenced} 의 짧은 글이 비었다`);
        assert.ok(block.detail.length > 20, `${status}/${isReferenced} 의 긴 글이 비었다`);
      }
    }
  });
});
