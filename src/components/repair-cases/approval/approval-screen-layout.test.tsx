import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import DatabaseApprovalEventTimeline from "./DatabaseApprovalEventTimeline";
import DatabaseApprovalCard from "./DatabaseApprovalCard";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";

/**
 * [검수/승인] 탭의 **화면 배치**를 못 박는다. 두 가지다.
 *
 *  1) 「승인 이력」은 기본이 접힘이다 — 이 탭의 주인공은 두 승인 카드이고,
 *     이력은 지난 일의 기록이다.
 *  2) 조작 결과 한 줄("…요청했습니다", 그리고 **서버가 거절한 이유**)은 카드
 *     **안**에서 나타난다.
 *
 * 2번이 이번 결함의 본체다. 부모(DatabaseApprovalScreen)가 두 카드를 2열 격자에
 * 놓는데, 카드 부품이 Fragment 로 카드 말고도 형제를 내보내면 **그 형제가 격자의
 * 직계 자식이 된다.** 흐름 밖에 있는 것(sr-only 문단, 닫힌 <dialog>)은 칸을 안
 * 먹지만, 보이는 <p> 는 두 번째 칸을 먹어 옆 카드를 다음 줄로 밀어냈다. 그래서
 * 「카드 밖 형제로 보이는 <p> 가 없다」를 아래에서 구조로 붙잡는다.
 *
 * ── 왜 한쪽은 렌더하고 한쪽은 원본을 읽는가 ────────────────────────────────
 * DatabaseApprovalEventTimeline·DatabaseApprovalCard 는 순수해서(타입 말고
 * 실제로 물고 있는 것이 없다) 그대로 렌더해 검사한다. 반대로 두 카드 부품
 * (DatabaseRepairInspectionCard·DatabaseFinalShipmentCard)은 **서버 액션을 직접
 * import 하는 클라이언트 컴포넌트**라, 그 사슬 끝의 `server-only` 때문에
 * react-server 조건 없이 도는 test:components 에서는 import 자체가 던진다.
 * 그래서 이웃 시험(procedure-publish-flow.test.tsx)과 같은 방법으로 원본을
 * 글자로 읽어 확인한다.
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const inspectionCardSource = read("src/components/repair-cases/approval/DatabaseRepairInspectionCard.tsx");
const shipmentCardSource = read("src/components/repair-cases/approval/DatabaseFinalShipmentCard.tsx");

const CARD_PARTS: Array<[string, string]> = [
  ["수리 검수 승인 카드", inspectionCardSource],
  ["최종 출하 승인 카드", shipmentCardSource],
];

/**
 * 화면을 그리는 return 문만 잘라낸다 — handleConfirm 안의 이른 return 들은
 * `return (` 가 아니므로 걸리지 않는다.
 */
const renderBlock = (source: string) => source.slice(source.lastIndexOf("return ("));

function approvalRecord(overrides: Partial<ApprovalRecordRow> = {}): ApprovalRecordRow {
  return {
    id: "approval-1",
    approvalType: "REPAIR_INSPECTION",
    status: "REQUESTED",
    requestedByUserId: "user-1",
    requestedByName: "홍길동",
    requestedAt: "2026-09-01T01:00:00.000Z",
    requestReason: "검수 완료",
    // 지정 없음(NULL)이 기본값이다 — 자격 있는 사람 누구나 처리한다.
    assignedApproverUserId: null,
    assignedApproverName: null,
    decidedByUserId: null,
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    delegatedFromUserId: null,
    delegatedFromName: null,
    repairCaseVersionAtRequest: 3,
    ...overrides,
  };
}

describe("승인 이력 — 기본은 접혀 있다", () => {
  test("이력이 있어도 <details> 는 펼쳐진 채로 그려지지 않는다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[approvalRecord()]} />);
    assert.match(html, /<details/, "접힘은 브라우저 기본 기능으로 한다(자바스크립트 상태를 쓰지 않는다)");
    // open 속성이 붙는 순간 「기본 접힘」이 사라진다 — 그게 이 시험의 전부다.
    assert.ok(!/<details[^>]*\sopen/.test(html), "<details> 에 open 이 붙으면 기본 펼침이 된다");
  });

  test("이력이 0건이어도 마찬가지로 접혀 있다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[]} />);
    assert.match(html, /<details/);
    assert.ok(!/<details[^>]*\sopen/.test(html));
  });

  test("제목 「승인 이력」이 눌러서 펼치는 자리(<summary>)다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[]} />);
    assert.match(flat(html), /<summary[^>]*>승인 이력<\/summary>/);
    assert.match(flat(html), /<summary[^>]*class="[^"]*cursor-pointer/, "누를 수 있음이 보여야 한다");
  });

  test("🔴 0건일 때의 안내는 펼치면 그대로 나온다 (접으면서 지워지지 않았다)", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[]} />);
    assert.match(html, /아직 승인 관련 이력이 없습니다\./);
  });

  test("이력 한 줄의 내용은 그대로다 — 요청자·사유·시각", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline records={[approvalRecord({ requestReason: "검수 완료" })]} />
    );
    assert.match(flat(html), /수리 검수 승인 · 승인 요청/);
    assert.match(flat(html), /요청자: 홍길동/);
    assert.match(flat(html), /요청 사유: “검수 완료”/);
    assert.ok(!/아직 승인 관련 이력이 없습니다/.test(html), "이력이 있으면 0건 안내는 나오지 않는다");
  });

  test("바깥 카드 테두리(<section>)는 그대로 남아 있다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[]} />);
    assert.match(html, /^<section class="[^"]*rounded-lg[^"]*border/, "테두리는 접힘과 무관하게 유지한다");
  });
});

describe("조작 결과 한 줄은 카드 안에서 나타난다", () => {
  const baseProps = {
    title: "수리 검수 승인",
    record: null,
    displayStatus: "NOT_REQUESTED" as const,
    actions: [],
  };

  test("🔴 statusMessage 를 주면 그 문구가 카드 <section> **안**에 들어간다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard {...baseProps} statusMessage="검수 승인을 요청했습니다." />
    );
    const message = html.indexOf("검수 승인을 요청했습니다.");
    const sectionEnd = html.indexOf("</section>");
    assert.ok(message >= 0, "문구가 아예 그려지지 않았다");
    assert.ok(sectionEnd >= 0, "카드가 <section> 으로 끝나야 한다");
    // 카드 밖으로 나가는 순간 부모 격자의 칸 하나를 먹는다 — 그래서 안쪽인지를 본다.
    assert.ok(message < sectionEnd, "문구가 카드 밖으로 나갔다 — 격자가 다시 깨진다");
  });

  test("문구 서식은 전과 같다 (작은 회색 글씨)", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalCard {...baseProps} statusMessage="처리되었습니다." />);
    assert.match(html, /<p class="text-xs text-zinc-500 dark:text-zinc-400">처리되었습니다\.<\/p>/);
  });

  test("🔴 서버가 거절한 이유도 같은 자리로 온다 (성공 알림 전용이 아니다)", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard {...baseProps} statusMessage="이미 대기 중인 승인 요청이 있습니다." />
    );
    assert.match(html, /이미 대기 중인 승인 요청이 있습니다\./);
  });

  test("statusMessage 가 없으면 그 자리는 아예 그려지지 않는다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalCard {...baseProps} />);
    assert.ok(
      !/<p class="text-xs text-zinc-500 dark:text-zinc-400">/.test(html),
      "빈 문단이라도 남으면 카드 아래에 쓸데없는 여백이 생긴다"
    );
  });

  test("카드가 읽어 주기 통로를 스스로 만들지는 않는다 (호출부의 sr-only 문단과 겹치면 두 번 읽힌다)", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalCard {...baseProps} statusMessage="요청했습니다." />);
    assert.ok(!/role="status"/.test(html));
  });
});

describe("🔴 두 카드 부품 — 카드 밖 형제로 보이는 문단이 더는 없다", () => {
  for (const [name, source] of CARD_PARTS) {
    test(`${name}: 카드 밖에 남은 <p> 는 읽어 주기용 sr-only 하나뿐이다`, () => {
      const block = renderBlock(source);
      const paragraphs = block.match(/<p[\s>]/g) ?? [];
      assert.equal(
        paragraphs.length,
        1,
        "카드 밖에 보이는 <p> 가 하나라도 더 생기면 2열 격자의 칸을 먹어 옆 카드가 밀린다"
      );
      assert.ok(
        !/statusMessage && !dialogState && <p/.test(flat(source)),
        "격자를 깨뜨렸던 옛 문단이 되살아났다"
      );
    });

    test(`${name}: 읽어 주기 통로(role="status" aria-live="polite" sr-only)는 그대로 있다`, () => {
      assert.match(
        flat(source),
        /<p role="status" aria-live="polite" className="sr-only"> \{statusMessage \?\? ""\} <\/p>/,
        "값이 없을 때도 빈 문자열로 DOM 에 남아 있어야 내용이 바뀔 때 읽힌다"
      );
    });

    test(`${name}: 문구를 카드에 넘기되, 확인 창이 떠 있는 동안은 보이지 않는다`, () => {
      assert.match(
        flat(source),
        /statusMessage=\{dialogState \? null : statusMessage\}/,
        "표시 조건(statusMessage && !dialogState)이 카드로 옮겨간 모양 그대로여야 한다"
      );
    });
  }
});
