import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  groupProcedureTemplatesByCode,
  type ProcedureTemplateSeriesMember,
} from "./procedure-template-series";

/**
 * ============================================================================
 * 절차 목록을 **계열(code)당 한 줄**로 접는 규칙 (2026-11-04)
 * ============================================================================
 * 사용자 신고: "[기술 작업 절차]의 목록에 같은 이름의 절차들이 버전만 다르게
 * 있으면 오히려 버전 관리가 어려워진다."
 *
 * ── 표본은 꾸며 낸 것이 아니다 ──────────────────────────────────────────
 * 개발 DB 의 TECHNICAL_TASK 를 code 별로 세어 보고 모양을 그대로 옮겼다
 * (2026-11-04, 읽기 전용 SELECT · 3줄기):
 *
 *   줄기 A — 게시 2 · 초안 1   🔴 **게시본이 둘인 줄기가 실재한다**
 *   줄기 B — 게시 0 · 초안 1   🔴 **게시본이 하나도 없는 줄기가 실재한다**
 *   줄기 C — 게시 1 · 초안 1   (가장 흔한 모습)
 *
 * 그래서 "게시본은 하나"를 전제로 짜면 틀린다. 세 경우를 전부 여기서 못 박는다.
 *
 * ── 🔴 권한은 입력으로 들어온다 ─────────────────────────────────────────
 * 초안을 볼 수 없는 역할에게는 조회가 초안 행을 **아예 안 준다**. 그 모습을
 * 그대로 흉내 낸 표본(초안을 뺀 배열)으로, 접은 결과에 초안의 흔적이 한 톨도
 * 남지 않는지를 잰다 — 접기가 권한을 뚫는 길이 되면 안 된다.
 * ============================================================================
 */

type Row = ProcedureTemplateSeriesMember & { name: string };

function row(code: string, version: number, status: Row["status"], name = code): Row {
  return { id: `${code}-v${version}`, code, version, status, name };
}

/**
 * 조회가 내보내는 차례(생성일 내림차순)를 흉내 낸 표본. 같은 줄기의 판이 서로
 * **떨어져** 있다 — 붙어 있는 입력만 시험하면 "이웃끼리만 묶는" 구현이 통과한다.
 */
const LIST_ROWS: Row[] = [
  row("tech-power-check", 4, "DRAFT"),
  row("tech-restore-check", 3, "DRAFT"),
  row("tech-power-check", 1, "PUBLISHED"),
  row("tech-restore-check", 2, "PUBLISHED"),
  row("tech-draft-only", 1, "DRAFT"),
  row("tech-restore-check", 1, "PUBLISHED"),
];

describe("계열 접기 — ① 먼저 표본을 센다", () => {
  test("🔵 표본이 세 경우를 전부 담고 있다", () => {
    // 표본이 한 모양뿐이면 아래 단언들이 '공짜로' 통과한다. 세어서 못 박는다.
    assert.equal(LIST_ROWS.length, 6);
    assert.equal(new Set(LIST_ROWS.map((r) => r.code)).size, 3, "줄기가 셋이어야 한다");
    const published = (code: string) =>
      LIST_ROWS.filter((r) => r.code === code && r.status === "PUBLISHED").length;
    assert.equal(published("tech-restore-check"), 2, "🔴 게시본이 둘인 줄기");
    assert.equal(published("tech-draft-only"), 0, "🔴 게시본이 없는 줄기");
    assert.equal(published("tech-power-check"), 1, "게시본이 하나인 줄기");
  });
});

describe("계열 접기 — ② 같은 code 는 한 줄", () => {
  const series = groupProcedureTemplatesByCode(LIST_ROWS);

  test("🔴 여섯 행이 세 줄로 접힌다 — 같은 이름이 여러 줄로 서지 않는다", () => {
    assert.equal(series.length, 3);
    assert.deepEqual(
      series.map((s) => s.code),
      ["tech-power-check", "tech-restore-check", "tech-draft-only"],
      "줄기의 차례는 **들어온 차례**를 따른다(서버가 정한 정렬을 뒤집지 않는다)"
    );
  });

  test("🔴 떨어져 있던 판도 같은 줄기로 들어온다", () => {
    const restore = series.find((s) => s.code === "tech-restore-check");
    assert.ok(restore);
    assert.equal(restore.members.length, 3);
    assert.deepEqual(restore.members.map((m) => m.version), [3, 2, 1], "판 번호 내림차순");
  });

  test("넘긴 배열을 손대지 않는다 — 삭제 모드가 같은 배열을 판 단위로 다시 쓴다", () => {
    const input = [...LIST_ROWS];
    groupProcedureTemplatesByCode(input);
    assert.deepEqual(input.map((r) => r.id), LIST_ROWS.map((r) => r.id));
  });
});

describe("계열 접기 — ③ 대표는 무엇인가 (세 경우)", () => {
  const byCode = new Map(groupProcedureTemplatesByCode(LIST_ROWS).map((s) => [s.code, s]));

  test("게시본 하나 + 초안 하나 → 대표는 **게시본**", () => {
    const s = byCode.get("tech-power-check");
    assert.ok(s);
    assert.equal(s.representative.status, "PUBLISHED");
    assert.equal(s.representative.version, 1);
    assert.equal(s.publishedMember?.version, 1);
    assert.equal(s.draftMember?.version, 4, "진행 중 초안은 따로 들고 있다");
    assert.equal(s.publishedCount, 1);
    assert.equal(s.draftCount, 1);
    assert.equal(s.archivedCount, 0);
  });

  test("🔴 게시본이 **둘**이면 — 대표는 판 번호가 큰 게시본, 그리고 둘이라는 사실을 들고 있다", () => {
    const s = byCode.get("tech-restore-check");
    assert.ok(s);
    assert.equal(s.representative.status, "PUBLISHED");
    assert.equal(s.representative.version, 2, "v1 과 v2 가 함께 게시돼 있으면 v2 가 대표다");
    assert.equal(s.publishedCount, 2, "둘이라는 것을 세어 둬야 화면이 표시할 수 있다");
    assert.equal(s.publishedMember?.version, 2);
    assert.equal(s.draftMember?.version, 3);
  });

  test("🔴 게시본이 **하나도 없으면** — 줄기가 사라지지 않고 초안이 대표가 된다", () => {
    const s = byCode.get("tech-draft-only");
    assert.ok(s, "게시본만 대표로 삼는 규칙이면 이 줄기가 목록에서 통째로 사라진다");
    assert.equal(s.representative.status, "DRAFT");
    assert.equal(s.publishedMember, null);
    assert.equal(s.publishedCount, 0);
    assert.equal(s.draftMember?.version, 1);
  });

  test("보관본만 남은 줄기 → 대표는 보관본", () => {
    const [s] = groupProcedureTemplatesByCode([row("tech-old", 2, "ARCHIVED"), row("tech-old", 1, "ARCHIVED")]);
    assert.equal(s.representative.status, "ARCHIVED");
    assert.equal(s.representative.version, 2);
    assert.equal(s.archivedCount, 2);
  });

  test("🔴 보관본과 초안이 함께면 **초안**이 대표다 — 판 번호가 더 낮아도", () => {
    // 차례가 '판 번호'만이었다면 v9 보관본이 대표가 된다. 보관은 "이제 안 씀"
    // 이므로, 살아 있는 초안이 있으면 그쪽이 사람이 찾는 것이다.
    const [s] = groupProcedureTemplatesByCode([row("tech-old", 9, "ARCHIVED"), row("tech-old", 10, "DRAFT")]);
    assert.equal(s.representative.status, "DRAFT");
    assert.equal(s.representative.version, 10);

    const [lower] = groupProcedureTemplatesByCode([row("t", 9, "ARCHIVED"), row("t", 3, "DRAFT")]);
    assert.equal(lower.representative.status, "DRAFT");
    assert.equal(lower.representative.version, 3, "상태가 판 번호보다 먼저다");
  });
});

describe("계열 접기 — ④ 🔴 초안을 못 보는 역할에게는 초안이 안 샌다", () => {
  /** 조회가 includeAllStatuses=false 로 읽었을 때의 모습 — 게시본만 온다. */
  const PUBLISHED_ONLY = LIST_ROWS.filter((r) => r.status === "PUBLISHED");

  test("🔵 먼저 표본 — 거른 쪽에는 초안이 한 줄도 없다", () => {
    assert.equal(PUBLISHED_ONLY.length, 3);
    assert.equal(PUBLISHED_ONLY.filter((r) => r.status === "DRAFT").length, 0);
  });

  test("🔴 초안이 없는 입력에서는 초안의 흔적이 한 톨도 안 남는다", () => {
    const series = groupProcedureTemplatesByCode(PUBLISHED_ONLY);
    for (const s of series) {
      assert.equal(s.draftMember, null, `${s.code} 에 초안이 새어 나왔다`);
      assert.equal(s.draftCount, 0);
      assert.ok(
        s.members.every((m) => m.status === "PUBLISHED"),
        "받지 않은 행을 접는 함수가 만들어 낼 수는 없다"
      );
    }
    // 초안만 있던 줄기는 **줄 자체가 없다** — "이름은 보이는데 판이 없다"가
    // 되면 그것만으로 초안의 존재가 드러난다.
    assert.deepEqual(series.map((s) => s.code), ["tech-power-check", "tech-restore-check"]);
  });

  test("🔵 견줄 쪽 — 같은 함수가 초안을 받으면 그때는 들고 있다(위 단언이 공짜가 아니다)", () => {
    const series = groupProcedureTemplatesByCode(LIST_ROWS);
    assert.ok(series.some((s) => s.draftMember !== null));
    assert.equal(series.length, 3, "초안만 있는 줄기가 그때는 보인다");
  });
});
