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

/**
 * 원본에서 **한 갈래만** 잘라낸다. 파일 전체에 정규식을 걸면 이웃 갈래의 같은
 * 문구에 걸려, 정작 이 갈래의 관문이 사라져도 시험이 통과해 버린다
 * (procedure-publish-flow.test.tsx 의 sliceFunction 과 같은 이유·같은 모양).
 */
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

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
    // 결재선을 타지 않음(NULL)이 기본값이다 — 대표·위임 방식 그대로다.
    routeId: null,
    routeStepOrder: null,
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

/**
 * ============================================================================
 * 최종 출하 승인 카드 — 결재선(순차 출하 승인)
 * ============================================================================
 * 서버는 이미 결재선을 탄다(mutations/repair-case-approvals-route.integration
 * .test.ts 가 그 인가를 실제 DB 로 못 박는다). 여기서 지키는 것은 **화면이 같은
 * 규칙으로 단추를 그리는가**다 — 어긋나면 「단추는 보이는데 누르면 거절」이나
 * 그 반대가 되고, 후자는 화면에 아무 표시도 남기지 않아 더 나쁘다.
 *
 * 위 머리말과 같은 이유로 카드 부품은 렌더하지 못한다(서버 액션 → server-only).
 * 그래서 판정이 적힌 갈래를 **원본에서 잘라** 확인하고, 새 문구가 카드 **안**에
 * 들어가는지는 껍데기(DatabaseApprovalCard)를 실제로 렌더해 확인한다.
 * ============================================================================
 */
describe("🔴 최종 출하 승인 카드 — 결재선 행에서는 절차가 대표를 대신한다", () => {
  /** 요청 대기(REQUESTED) 갈래 하나만 — 이웃 갈래의 같은 문구에 걸리지 않게. */
  const decideBranch = sliceBetween(
    shipmentCardSource,
    '} else if (displayStatus === "REQUESTED") {',
    '} else if (displayStatus === "APPROVED") {'
  );

  test("판정을 카드가 새로 적지 않고 공용 함수를 부른다", () => {
    assert.match(
      flat(shipmentCardSource),
      /import \{ approvalFollowsRoute, mayDecideAssignedApproval \} from "@\/lib\/auth\/approval-assignment"/,
      "서버가 보는 것과 같은 함수를 봐야 한다"
    );
    assert.ok(
      !/routeId !== null/.test(shipmentCardSource),
      "「결재선을 타는가」 판정을 카드가 한 벌 더 적었다 — 언젠가 한쪽만 고쳐진다"
    );
  });

  test("🔴 결재선 행에는 대표·위임을 요구하지 않는다 — 단계 승인자가 대표가 아니어도 단추가 나온다", () => {
    // 옛 모양(`if (decideAuthorization.allowed)`)이 되살아나면 절차에 올라간
    // 사람이 대표가 아니라는 이유로 자기 단계를 결재하지 못한다.
    assert.match(
      flat(decideBranch),
      /if \(!followsRoute && !decideAuthorization\.allowed\)/,
      "대표·위임 관문이 결재선 행에까지 걸린다"
    );
    assert.ok(
      !/if \(decideAuthorization\.allowed\)/.test(flat(decideBranch)),
      "결재선을 보지 않는 옛 관문이 되살아났다"
    );
    assert.equal(
      (decideBranch.match(/대표로 지정된 계정 또는 유효한 위임/g) ?? []).length,
      1,
      "대표·위임 안내가 두 자리에 적히면 한쪽만 고쳐지는 날이 온다"
    );
  });

  test("🔴 차례가 아니면 단추 대신 지정된 사람의 이름이 나온다", () => {
    assert.match(flat(decideBranch), /else if \(!assignedGateOpen\)/);
    assert.match(
      flat(decideBranch),
      /이 요청은 \$\{record\.assignedApproverName\} 님에게 지정되어 있습니다\./,
      "검수 카드와 같은 문구여야 한다 — 이름이 없으면 사람은 무엇을 해야 할지 모른다"
    );
    assert.match(
      flat(decideBranch),
      /이 요청은 지정된 승인자만 처리할 수 있습니다\./,
      "이름을 못 찾을 때의 대비 문구가 없다"
    );
  });

  test("🔴 승인·반려 단추는 두 관문을 **다 지난 뒤에만** 밀어 넣는다", () => {
    const gate = decideBranch.indexOf("!assignedGateOpen");
    const approve = decideBranch.indexOf('key: "approve"');
    const reject = decideBranch.indexOf('key: "reject"');
    assert.ok(gate >= 0, "지정 관문이 아예 없다");
    assert.ok(approve > gate, "지정 관문보다 먼저 승인 단추를 만든다 — 남의 차례에도 눌린다");
    assert.ok(reject > gate, "지정 관문보다 먼저 반려 단추를 만든다");
  });

  test("🔴 결재선을 안 쓰는 요청의 자격 문구는 예전 그대로다", () => {
    const extraBlock = sliceBetween(shipmentCardSource, "const extra = (", "return (");
    assert.match(
      flat(extraBlock),
      /routeProgress \?\? \(decideAuthorization\.allowed && decideAuthorization\.mode === "DIRECT"/,
      "결재선을 타지 않으면 예전 문구로 돌아가는 갈래가 사라졌다"
    );
    for (const text of [
      "대표로 지정된 계정입니다.",
      "의 위임을 받아 처리할 수 있습니다.",
      "대표로 지정된 계정도, 유효한 위임을 받은 대리 승인자도 아닙니다.",
    ]) {
      assert.ok(extraBlock.includes(text), `예전 문구가 사라졌다: ${text}`);
    }
  });

  test("🔴 진행 표시는 「n/m단계 · 지금 차례: ○○○」이고, 전체 단계 수는 서버가 준 값이다", () => {
    const progressBlock = sliceBetween(shipmentCardSource, "const routeProgress =", "const extra = (");
    assert.match(flat(progressBlock), /followsRoute &&/, "결재선 행에서만 그려야 한다");
    assert.match(flat(progressBlock), /결재선 \$\{record\.routeStepOrder\}/, "앞자리는 이 행의 단계다");
    assert.match(flat(progressBlock), /\/\$\{routeTotalSteps\}/, "뒷자리는 서버가 센 전체 단계 수다");
    assert.match(flat(progressBlock), /· 지금 차례: \$\{record\.assignedApproverName/);
    // 이미 처리된 단계에 「지금 차례」가 남으면 끝난 칸이 남의 차례를 말한다.
    assert.match(
      flat(progressBlock),
      /displayStatus === "REQUESTED" \? ` · 지금 차례: /,
      "「지금 차례」가 대기 중일 때로 묶여 있지 않다"
    );
    // 「현재 판」을 화면에서 세지 않는다 — 진행 중인 건은 옛 판을 따라간다.
    assert.ok(
      !/getCurrentShipmentApprovalRoute/.test(shipmentCardSource),
      "카드가 현재 판을 읽으려 한다 — 「2/2단계」가 「2/4단계」로 보인다"
    );
  });
});

describe("결재선 — 새 문구도 카드 밖으로 나가지 않는다", () => {
  const baseProps = {
    title: "최종 출하 승인",
    record: null,
    displayStatus: "REQUESTED" as const,
    actions: [],
  };

  test("🔴 「2/3단계 · 지금 차례: ○○○」이 카드 <section> **안**에 나온다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard {...baseProps} extra={<span>결재선 2/3단계 · 지금 차례: 김도윤</span>} />
    );
    const progress = html.indexOf("결재선 2/3단계 · 지금 차례: 김도윤");
    const sectionEnd = html.indexOf("</section>");
    assert.ok(progress >= 0, "진행 표시가 아예 그려지지 않았다");
    assert.ok(progress < sectionEnd, "카드 밖으로 나가면 2열 격자의 칸을 먹어 옆 카드가 밀린다");
  });

  test("🔴 차례가 아닐 때의 이유도 카드 <section> **안**에 나온다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard {...baseProps} disabledReason="이 요청은 김도윤 님에게 지정되어 있습니다." />
    );
    const reason = html.indexOf("이 요청은 김도윤 님에게 지정되어 있습니다.");
    const sectionEnd = html.indexOf("</section>");
    assert.ok(reason >= 0, "이유가 아예 그려지지 않았다");
    assert.ok(reason < sectionEnd);
  });

  test("내 차례면 단추가 나오고 이유 문단은 나오지 않는다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        {...baseProps}
        actions={[
          { key: "approve", label: "출하 승인", onClick: () => {} },
          { key: "reject", label: "출하 반려", onClick: () => {}, tone: "danger" },
        ]}
        disabledReason="이 요청은 김도윤 님에게 지정되어 있습니다."
      />
    );
    assert.match(html, /출하 승인<\/button>/);
    assert.match(html, /출하 반려<\/button>/);
    assert.ok(!/김도윤/.test(html), "단추와 이유가 함께 나오면 사람이 어느 쪽을 믿을지 모른다");
  });
});
