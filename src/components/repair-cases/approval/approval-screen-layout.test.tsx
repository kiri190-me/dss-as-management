import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import DatabaseApprovalEventTimeline from "./DatabaseApprovalEventTimeline";
import DatabaseApprovalCard from "./DatabaseApprovalCard";
import ApprovalActionDialog from "./ApprovalActionDialog";
import { standsInForAssignedApprover } from "@/lib/auth/approval-assignment";
import type { ApprovalRecordRow } from "@/lib/db/queries/repair-case-approvals";
import type { ShipmentApprovalRouteStepList } from "@/lib/db/queries/shipment-approval-routes";

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
const approvalScreenSource = read("src/components/repair-cases/approval/DatabaseApprovalScreen.tsx");
const dialogSource = read("src/components/repair-cases/approval/ApprovalActionDialog.tsx");

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

/** 판 하나 — 단계 순서는 이름 순서대로 1부터 매긴다. */
function route(routeId: string, approverNames: string[]): ShipmentApprovalRouteStepList {
  return {
    routeId,
    steps: approverNames.map((approverName, index) => ({
      stepOrder: index + 1,
      approverUserId: `approver-${index + 1}`,
      approverName,
    })),
  };
}

/** 결재선을 타는 이력 한 줄 — 판·단계·지정이 함께 있어야 결재선이다. */
function routeRecord(overrides: Partial<ApprovalRecordRow> = {}): ApprovalRecordRow {
  return approvalRecord({
    approvalType: "FINAL_SHIPMENT",
    routeId: "route-a",
    routeStepOrder: 2,
    assignedApproverUserId: "approver-2",
    assignedApproverName: "김도윤",
    ...overrides,
  });
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
    // 판정 셋 다 공용 관문(approval-assignment.ts)에서 온다 — 서버·알림 조회·
    // 승인 이력이 보는 것과 **같은 함수**여야 한다. 이름만 확인하고 줄바꿈에는
    // 걸리지 않게 둔다(하나가 늘 때마다 이 시험이 깨지면 덫이 잡음이 된다).
    for (const shared of ["approvalFollowsRoute", "mayDecideAssignedApproval", "standsInForAssignedApprover"]) {
      assert.match(
        flat(shipmentCardSource),
        new RegExp(`import \\{[^}]*\\b${shared}\\b[^}]*\\} from "@/lib/auth/approval-assignment"`),
        `서버가 보는 것과 같은 함수를 봐야 한다: ${shared}`
      );
    }
    assert.ok(
      !/routeId !== null/.test(shipmentCardSource),
      "「결재선을 타는가」 판정을 카드가 한 벌 더 적었다 — 언젠가 한쪽만 고쳐진다"
    );
    assert.ok(
      !/assignedApproverUserId !== actingUser\.id/.test(shipmentCardSource),
      "「지정된 사람 대신 서 있는가」 판정을 카드가 한 벌 더 적었다"
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

/**
 * ============================================================================
 * 🔴 승인 이력 — 단계와 「대신 처리」가 줄에 남는다
 * ============================================================================
 * 이 화면은 결재 기록이다. 「이 건 누가 승인했지」를 되짚을 때, **비상구로 남의
 * 단계를 대신 처리한 건**과 **지정된 사람이 자기 차례에 처리한 건**이 구분되지
 * 않는 것이 이번에 고친 결함이다 — 위임에는 배지가 남는데 비상구에는 아무 표시도
 * 없었다.
 *
 * 이력 부품은 순수해서 그대로 렌더해 검사한다(위 머리말 참조).
 * ============================================================================
 */
describe("🔴 승인 이력 — 결재선 단계", () => {
  test("결재선을 탄 줄에는 「결재선 2/3단계」가 나온다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[routeRecord()]}
        routeSteps={[route("route-a", ["박서준", "김도윤", "이서연"])]}
      />
    );
    assert.match(flat(html), /결재선 2\/3단계/);
  });

  test("🔴 결재선을 타지 않은 줄에는 단계 표시가 아예 없다", () => {
    // 이 칸이 생기기 전의 모든 행이 여기다 — 지난 이력 전부에 뭔가 붙으면 안 된다.
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[approvalRecord()]}
        routeSteps={[route("route-a", ["박서준", "김도윤", "이서연"])]}
      />
    );
    assert.ok(!/결재선/.test(html), "결재선을 안 탄 줄에 단계 표시가 붙었다");
  });

  test("🔴 판만 적히고 지정이 빈 줄도 결재선으로 보지 않는다 — 공용 판정을 그대로 쓴다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[routeRecord({ assignedApproverUserId: null, assignedApproverName: null })]}
        routeSteps={[route("route-a", ["박서준", "김도윤", "이서연"])]}
      />
    );
    assert.ok(!/결재선/.test(html));
  });

  test("판을 못 찾으면 앞자리만 적는다 — 「2/」 같은 반쪽짜리를 보여 주지 않는다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[routeRecord()]} routeSteps={[]} />);
    assert.match(flat(html), /결재선 2단계/);
    assert.ok(!/2\//.test(html), "뒷자리를 모르는데 빗금이 남았다");
  });

  test("🔴 단계 수는 **그 줄에 적힌 판**으로 센다 — 옛 판을 탄 줄이 섞여 있다", () => {
    // 관리자가 절차를 바꾸면 새 판이 얹히고, 그때 진행 중이던 건은 옛 판을 끝까지
    // 따라간다. 현재 판(4단계)으로 세면 이미 끝난 옛 줄이 「2/4단계」로 보여 아직
    // 두 사람이 더 남은 것처럼 읽힌다.
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[
          routeRecord({ id: "new", routeId: "route-new", routeStepOrder: 1 }),
          routeRecord({ id: "old", routeId: "route-old", routeStepOrder: 2 }),
        ]}
        routeSteps={[
          route("route-new", ["가", "나", "다", "라"]),
          route("route-old", ["가", "나"]),
        ]}
      />
    );
    assert.match(flat(html), /결재선 1\/4단계/, "새 판을 탄 줄이 자기 판으로 세어지지 않았다");
    assert.match(flat(html), /결재선 2\/2단계/, "옛 판을 탄 줄이 현재 판으로 세어졌다");
  });
});

describe("🔴 승인 이력 — 지정과 「지정자 대신 처리」", () => {
  test("「지정: ○○○」이 지정이 있는 줄에 나온다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[routeRecord()]} routeSteps={[]} />);
    assert.match(flat(html), /지정: 김도윤/);
  });

  test("🔴 검수 승인의 지정에도 똑같이 나온다 — 결재선 전용이 아니다", () => {
    // 검수 승인은 요청할 때 「누구에게 보낼까요」를 고를 수 있고 판은 없다.
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[approvalRecord({ assignedApproverUserId: "u-9", assignedApproverName: "이서연" })]}
        routeSteps={[]}
      />
    );
    assert.match(flat(html), /수리 검수 승인/);
    assert.match(flat(html), /지정: 이서연/);
  });

  test("지정이 없는 줄에는 「지정:」이 나오지 않는다", () => {
    const html = renderToStaticMarkup(<DatabaseApprovalEventTimeline records={[approvalRecord()]} routeSteps={[]} />);
    assert.ok(!/지정:/.test(html));
  });

  test("🔴 지정된 사람과 처리한 사람이 다르면 배지가 뜬다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[
          routeRecord({
            status: "APPROVED",
            decidedByUserId: "super-admin",
            decidedByName: "최희만",
            decidedAt: "2026-09-02T01:00:00.000Z",
          }),
        ]}
        routeSteps={[route("route-a", ["박서준", "김도윤", "이서연"])]}
      />
    );
    assert.match(flat(html), /지정자 대신 처리/);
    // 누구 차례였는지·누가 처리했는지가 같은 줄에 함께 남아야 되짚을 수 있다.
    assert.match(flat(html), /처리자: 최희만/);
    assert.match(flat(html), /지정: 김도윤/);
  });

  test("🔴 지정된 사람이 자기 차례에 처리했으면 배지가 뜨지 않는다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[
          routeRecord({
            status: "APPROVED",
            decidedByUserId: "approver-2",
            decidedByName: "김도윤",
            decidedAt: "2026-09-02T01:00:00.000Z",
          }),
        ]}
        routeSteps={[route("route-a", ["박서준", "김도윤", "이서연"])]}
      />
    );
    assert.ok(!/지정자 대신 처리/.test(html), "자기 차례에 승인한 건까지 대신 처리로 남는다");
  });

  test("🔴 아직 처리되지 않은 줄에도 배지가 뜨지 않는다", () => {
    // 요청만 해 둔 줄은 처리자가 없다. 여기서 배지가 뜨면 「승인 요청」 줄마다
    // 대신 처리했다고 적히게 된다.
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline records={[routeRecord()]} routeSteps={[route("route-a", ["가", "나"])]} />
    );
    assert.ok(!/지정자 대신 처리/.test(html));
  });

  test("기존 「위임 승인 처리」 배지는 그대로다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[
          approvalRecord({
            approvalType: "FINAL_SHIPMENT",
            status: "APPROVED",
            decidedByUserId: "u-2",
            decidedByName: "이서연",
            delegatedFromUserId: "u-3",
            delegatedFromName: "박서준",
          }),
        ]}
        routeSteps={[]}
      />
    );
    assert.match(flat(html), /위임 승인 처리/);
    // 위임 행은 지정이 NULL 이라 둘이 함께 뜨는 일은 없다.
    assert.ok(!/지정자 대신 처리/.test(html));
  });

  test("두 배지는 같은 모양(둥근 알약)이고 색만 다르다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalEventTimeline
        records={[
          routeRecord({
            status: "APPROVED",
            decidedByUserId: "super-admin",
            decidedByName: "최희만",
            delegatedFromUserId: "u-3",
            delegatedFromName: "박서준",
          }),
        ]}
        routeSteps={[]}
      />
    );
    // 겹칠 일은 없지만 겹쳐도 깨지지 않아야 한다 — 둘 다 그려진다.
    assert.match(flat(html), /rounded-full[^"]*"[^>]*>\s*위임 승인 처리/);
    assert.match(flat(html), /rounded-full[^"]*"[^>]*>\s*지정자 대신 처리/);
    assert.match(flat(html), /bg-amber-50[^"]*"[^>]*>\s*지정자 대신 처리/, "주의 계열 색이 아니다");
  });
});

/**
 * ============================================================================
 * 🔴 최종 출하 승인 카드 — 진행 미리보기와 비상구 안내
 * ============================================================================
 * 카드 부품은 렌더하지 못한다(서버 액션 → server-only). 그래서 원본을 잘라
 * 확인하고, 새 문구가 실제로 **그려지는 자리**인지는 껍데기를 렌더해 확인한다.
 * ============================================================================
 */
describe("🔴 최종 출하 승인 카드 — 진행 미리보기", () => {
  const extraBlock = sliceBetween(shipmentCardSource, "const extra = (", "return (");

  test("결재선을 타는 요청에서만 그린다", () => {
    const previewSteps = sliceBetween(shipmentCardSource, "const previewSteps =", "const extra = (");
    assert.match(flat(previewSteps), /followsRoute \?/, "결재선 판정을 보지 않고 그린다");
    assert.match(flat(extraBlock), /previewSteps\.length > 0 &&/, "단계가 없을 때도 빈 상자를 그린다");
  });

  test("🔴 가로로 길어져도 그 상자 안에서만 밀린다", () => {
    // 카드 바깥이 밀리면 옆 카드까지 못 쓰게 된다 — 관리자 화면의 미리보기가
    // 같은 이유로 같은 처리를 하고 있다.
    assert.match(flat(extraBlock), /className="mt-2 overflow-x-auto pb-1"/);
    assert.match(flat(extraBlock), /className="flex min-w-max items-start gap-2"/);
  });

  test("상자들 사이에 ▶ 가 있고 상자 아래에 「n단계」가 있다 — 관리자 화면과 같은 모양", () => {
    assert.match(flat(extraBlock), /index > 0 &&/, "첫 칸 앞에도 화살표가 붙는다");
    assert.match(flat(extraBlock), /▶/);
    assert.match(flat(extraBlock), /\{step\.stepOrder\}단계 · \{step\.stateLabel\}/);
    assert.match(flat(extraBlock), /\{step\.approverName\}/);
  });

  test("🔴 색만으로 상태를 구분하지 않는다 — 칸마다 글자가 함께 붙는다", () => {
    // UI_GUIDELINE 7절(색약 사용자). 상태 이름은 판정 함수 한 곳에서 색과 함께 나온다.
    for (const label of ["완료", "대기", "지금 차례", "반려", "재승인 필요"]) {
      assert.ok(shipmentCardSource.includes(`stateLabel: "${label}"`), `상태 글자가 없다: ${label}`);
    }
  });

  test("🔴 끝난 단계 / 지금 차례 / 아직 안 온 단계가 갈린다", () => {
    const mark = sliceBetween(shipmentCardSource, "function markForRouteStep(", "const extra = (");
    assert.match(flat(mark), /stepOrder < currentStepOrder\) return DONE_MARK/, "앞 단계가 완료로 안 보인다");
    assert.match(flat(mark), /stepOrder > currentStepOrder\) return UPCOMING_MARK/, "뒷 단계가 대기로 안 보인다");
    // 이미 처리된 단계가 「지금 차례」라고 말하면 안 된다.
    assert.match(flat(mark), /displayStatus === "APPROVED"\) return DONE_MARK/);
  });

  test("🔴 그래프 라이브러리를 쓰지 않는다 — 일렬이라 상자와 화살표 글자로 충분하다", () => {
    assert.ok(!/reactflow|d3|mermaid/i.test(shipmentCardSource));
  });

  test("🔴 미리보기도 카드 <section> **안**에 들어간다", () => {
    // extra 는 껍데기가 카드 안에 그린다. 밖으로 나가면 2열 격자의 칸을 먹는다.
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="최종 출하 승인"
        record={null}
        displayStatus="REQUESTED"
        actions={[]}
        extra={<span>박서준 ▶ 김도윤 ▶ 이서연</span>}
      />
    );
    const preview = html.indexOf("박서준 ▶ 김도윤 ▶ 이서연");
    assert.ok(preview >= 0, "미리보기가 아예 그려지지 않았다");
    assert.ok(preview < html.indexOf("</section>"), "카드 밖으로 나가면 옆 카드가 밀린다");
  });
});

describe("🔴 최종 출하 승인 카드 — 비상구 안내", () => {
  const decideBranch = sliceBetween(
    shipmentCardSource,
    '} else if (displayStatus === "REQUESTED") {',
    '} else if (displayStatus === "APPROVED") {'
  );

  test("🔴 안내가 blockedNotice 로 나간다 — disabledReason 이 아니다", () => {
    // disabledReason 은 껍데기가 **단추가 하나도 없을 때만** 그린다. 비상구는
    // 단추가 **있는** 상황이므로 거기 넣으면 아무 데도 보이지 않는다.
    assert.match(flat(decideBranch), /if \(standingInForAssignee\) \{ blockedNotice =/);
    const notice = decideBranch.indexOf("최고관리자 권한으로 대신 처리합니다.");
    assert.ok(notice >= 0, "안내 문구가 없다");
    assert.ok(
      decideBranch.lastIndexOf("disabledReason =", notice) < decideBranch.indexOf("} else {"),
      "안내가 disabledReason 으로 나가면 화면에 나타나지 않는다"
    );
  });

  test("🔴 안내는 단추가 열리는 갈래에서만 나온다 — 내 차례면 나오지 않는다", () => {
    // 지정 관문(!assignedGateOpen)에서 걸러진 사람은 단추 자체가 없고 지정된
    // 사람의 이름만 본다. 그 뒤 갈래에 있어야 「단추는 열렸는데 남의 차례」다.
    const gate = decideBranch.indexOf("!assignedGateOpen");
    const notice = decideBranch.indexOf("최고관리자 권한으로 대신 처리합니다.");
    const approve = decideBranch.indexOf('key: "approve"');
    assert.ok(notice > gate, "지정 관문보다 앞에서 안내를 만든다 — 남의 차례에도 뜬다");
    assert.ok(notice < approve, "단추를 만든 뒤에 안내를 정하면 갈래가 어긋나기 쉽다");
    // 내 차례면 판정 자체가 거짓이라 문구가 만들어지지 않는다(그 대조는
    // approval-assignment.test.ts 가 함수 수준에서 못 박는다).
    assert.match(flat(decideBranch), /if \(standingInForAssignee\) \{/);
  });

  test("🔴 그 안내는 단추와 **함께** 그려진다 — 껍데기가 실제로 그렇게 그린다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="최종 출하 승인"
        record={null}
        displayStatus="REQUESTED"
        blockedNotice="지금 차례는 김도윤 님입니다. 최고관리자 권한으로 대신 처리합니다."
        disabledReason="이 문구는 단추가 있으면 그려지지 않는다."
        actions={[
          { key: "approve", label: "출하 승인", onClick: () => {} },
          { key: "reject", label: "출하 반려", onClick: () => {}, tone: "danger" },
        ]}
      />
    );
    const notice = html.indexOf("최고관리자 권한으로 대신 처리합니다.");
    assert.ok(notice >= 0, "🔴 안내가 아예 그려지지 않았다 — 자리를 잘못 골랐다");
    assert.ok(notice < html.indexOf("</section>"), "안내가 카드 밖으로 나갔다");
    assert.match(html, /출하 승인<\/button>/, "단추가 함께 있어야 하는 상황이다");
    assert.ok(
      !/이 문구는 단추가 있으면 그려지지 않는다\./.test(html),
      "disabledReason 이 단추와 함께 그려졌다 — 이 시험의 전제가 사라졌다"
    );
  });

  test("결재선을 안 쓰는 요청에는 안내가 나올 수 없다 — 지정이 언제나 NULL 이다", () => {
    // 판정의 첫 줄이 그것을 보장한다(지정 NULL → 거짓). 여기서는 카드가 그
    // 값을 그대로 넘기는지만 본다.
    assert.match(
      flat(shipmentCardSource),
      /standsInForAssignedApprover\( record\?\.assignedApproverUserId \?\? null, actingUser\.id \)/,
      "지정 칸이 아니라 다른 값을 보고 있다"
    );
  });
});

/**
 * ============================================================================
 * 🔴 수리 검수 승인 카드 — 비상구 안내
 * ============================================================================
 * 검수 승인도 요청할 때 「누구에게 보낼까요」로 처리할 사람을 지정할 수 있고,
 * 지정이 걸린 요청을 최고관리자가 대신 처리하는 길(비상구)이 열려 있다. 출하
 * 카드에는 그 사실을 말해 주는 안내가 있는데 검수 카드에는 없어서, 같은 상황에
 * 한쪽은 말하고 한쪽은 말없이 단추만 보여 주고 있었다.
 *
 * 위 머리말과 같은 이유로 카드 부품은 렌더하지 못한다(서버 액션 → server-only).
 * 그래서 갈래를 원본에서 잘라 확인하고, 그 문구가 **실제로 그려지는 자리**인지는
 * 껍데기(DatabaseApprovalCard)를 렌더해 확인한다.
 * ============================================================================
 */
describe("🔴 수리 검수 승인 카드 — 비상구 안내", () => {
  const decideBranch = sliceBetween(
    inspectionCardSource,
    '} else if (displayStatus === "REQUESTED") {',
    '} else if (displayStatus === "APPROVED") {'
  );

  /**
   * 두 카드가 **글자 그대로 같은 말**을 하는지 한 벌의 정규식으로 양쪽에 건다 —
   * 이름을 못 찾을 때의 대비 문구("다른 승인자")까지 포함이다. 같은 상황에 두
   * 가지 말이 생기면 사람은 어느 쪽이 맞는지 알 수 없다.
   */
  const NOTICE_SOURCE =
    /지금 차례는 \$\{\s*record\?\.assignedApproverName \?\? "다른 승인자"\s*\} 님입니다\. 최고관리자 권한으로 대신 처리합니다\./;

  test("판정을 카드가 새로 적지 않고 공용 함수를 부른다", () => {
    for (const shared of ["mayDecideAssignedApproval", "standsInForAssignedApprover"]) {
      assert.match(
        flat(inspectionCardSource),
        new RegExp(`import \\{[^}]*\\b${shared}\\b[^}]*\\} from "@/lib/auth/approval-assignment"`),
        `서버가 보는 것과 같은 함수를 봐야 한다: ${shared}`
      );
    }
    assert.ok(
      !/assignedApproverUserId !== actingUser\.id/.test(inspectionCardSource),
      "「지정된 사람 대신 서 있는가」 판정을 카드가 한 벌 더 적었다 — 언젠가 한쪽만 고쳐진다"
    );
    assert.match(
      flat(inspectionCardSource),
      /standsInForAssignedApprover\( record\?\.assignedApproverUserId \?\? null, actingUser\.id \)/,
      "지정 칸이 아니라 다른 값을 보고 있다"
    );
  });

  test("🔴 안내가 blockedNotice 로 나간다 — disabledReason 이 아니다", () => {
    // disabledReason 은 껍데기가 **단추가 하나도 없을 때만** 그린다. 비상구는
    // 단추가 **있는** 상황이므로 거기 넣으면 아무 데도 보이지 않는다.
    assert.match(flat(decideBranch), /if \(standingInForAssignee\) \{ blockedNotice =/);
    const notice = decideBranch.indexOf("최고관리자 권한으로 대신 처리합니다.");
    assert.ok(notice >= 0, "안내 문구가 없다");
    assert.ok(
      decideBranch.lastIndexOf("disabledReason =", notice) < decideBranch.indexOf("} else {"),
      "안내가 disabledReason 으로 나가면 화면에 나타나지 않는다"
    );
  });

  test("🔴 그 값을 카드에 실제로 넘긴다 — 프롭이 빠지면 코드는 멀쩡한데 한 글자도 안 나온다", () => {
    assert.match(
      flat(renderBlock(inspectionCardSource)),
      /blockedNotice=\{blockedNotice\}/,
      "검수 카드는 원래 이 프롭을 넘기지 않았다 — 새로 넘기지 않으면 안내가 사라진다"
    );
  });

  test("🔴 안내는 단추가 열리는 갈래에서만 나온다 — 남의 차례면 단추도 안내도 아니다", () => {
    // 지정 관문(!assignedGateOpen)에서 걸러진 사람은 단추 자체가 없고 지정된
    // 사람의 이름만 본다. 그 뒤 갈래에 있어야 「단추는 열렸는데 남의 차례」다.
    const gate = decideBranch.indexOf("!assignedGateOpen");
    const notice = decideBranch.indexOf("최고관리자 권한으로 대신 처리합니다.");
    const approve = decideBranch.indexOf('key: "approve"');
    assert.ok(gate >= 0, "지정 관문이 아예 없다");
    assert.ok(notice > gate, "지정 관문보다 앞에서 안내를 만든다 — 남의 차례에도 뜬다");
    assert.ok(notice < approve, "단추를 만든 뒤에 안내를 정하면 갈래가 어긋나기 쉽다");
  });

  test("🔴 문구가 출하 카드와 글자 그대로 같다 — 대비 문구까지", () => {
    assert.match(flat(decideBranch), NOTICE_SOURCE);
    assert.match(flat(shipmentCardSource), NOTICE_SOURCE, "출하 카드 쪽 문구가 바뀌어 둘이 갈라졌다");
  });

  test("🔴 지정된 본인이거나 지정이 없으면(NULL) 안내가 만들어지지 않는다", () => {
    // 카드 부품은 렌더하지 못하므로(머리말 참조), 카드가 부르는 **그 함수**를
    // 여기서 그대로 불러 갈림을 못 박는다. 지정 칸이 생기기 전의 모든 요청이
    // 셋째 경우다 — 여기서 참이 나오면 예전 화면에 없던 문구가 끼어든다.
    assert.equal(standsInForAssignedApprover("approver-2", "super-admin"), true);
    assert.equal(standsInForAssignedApprover("approver-2", "approver-2"), false);
    assert.equal(standsInForAssignedApprover(null, "super-admin"), false);
  });

  test("🔴 그 안내는 단추와 **함께**, 카드 <section> 안에 그려진다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={approvalRecord({ assignedApproverUserId: "approver-2", assignedApproverName: "김도윤" })}
        displayStatus="REQUESTED"
        blockedNotice="지금 차례는 김도윤 님입니다. 최고관리자 권한으로 대신 처리합니다."
        actions={[
          { key: "approve", label: "검수 승인", onClick: () => {} },
          { key: "reject", label: "반려", onClick: () => {}, tone: "danger" },
        ]}
      />
    );
    const notice = html.indexOf("최고관리자 권한으로 대신 처리합니다.");
    assert.ok(notice >= 0, "🔴 안내가 아예 그려지지 않았다 — 자리를 잘못 골랐다");
    assert.ok(notice < html.indexOf("</section>"), "안내가 카드 밖으로 나가면 2열 격자의 칸을 먹는다");
    assert.match(html, /검수 승인<\/button>/, "단추가 함께 있어야 하는 상황이다");
    assert.match(html, /반려<\/button>/);
  });

  test("🔴 자격이 없어 단추가 없을 때는 예전 문구 그대로다 — 안내가 끼어들지 않는다", () => {
    // 그 갈래는 blockedNotice 를 만들지 않는다(원본), 그리고 껍데기는 단추가
    // 없을 때 disabledReason 을 그린다(렌더) — 두 가지를 함께 못 박는다.
    const blockedBranch = sliceBetween(decideBranch, "} else if (!assignedGateOpen) {", "} else {");
    assert.ok(
      !/blockedNotice/.test(blockedBranch),
      "차례가 아닌 사람에게도 「대신 처리합니다」가 뜬다"
    );
    assert.match(flat(blockedBranch), /이 요청은 \$\{record\.assignedApproverName\} 님에게 지정되어 있습니다\./);

    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={approvalRecord({ assignedApproverUserId: "approver-2", assignedApproverName: "김도윤" })}
        displayStatus="REQUESTED"
        actions={[]}
        disabledReason="이 요청은 김도윤 님에게 지정되어 있습니다."
      />
    );
    assert.match(html, /이 요청은 김도윤 님에게 지정되어 있습니다\./);
    assert.ok(!/대신 처리합니다/.test(html), "단추가 없는데 비상구 안내가 나왔다");
  });
});

/**
 * ============================================================================
 * 🔴 확인 창 — 사내 목표 출하일은 **읽기 전용**으로 보인다
 * ============================================================================
 * 출하 승인은 「언제까지 내보내야 하는가」를 보고 판단하는 일이다. 그 날짜가
 * repair_cases 에 이미 있는데 승인 창에는 없어서, 요청하는 사람도 결재하는
 * 사람도 다른 화면을 열어 봐야 했다.
 *
 * 🔴 값의 편집 경로는 「접수 정보 편집」 하나뿐이다(IntakeInfoEditForm.tsx
 * 머리말). 그래서 이 창은 **읽기만** 한다 — 입력칸을 만들지 않는다는 것을
 * 아래에서 렌더 결과로 붙잡는다.
 *
 * 확인 창(ApprovalActionDialog)은 순수해서(react 말고 물고 있는 것이 없다)
 * 카드와 달리 그대로 렌더해 검사한다.
 * ============================================================================
 */
describe("🔴 승인 확인 창 — 사내 목표 출하일", () => {
  const baseDialogProps = {
    isOpen: true,
    title: "출하 승인 요청",
    requireComment: false,
    isSubmitting: false,
    onConfirm: () => {},
    onCancel: () => {},
  };

  test("값이 있으면 날짜가 이름표와 함께 나온다", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog {...baseDialogProps} internalTargetShipmentDate="2026-09-20" />
    );
    assert.match(flat(html), /사내 목표 출하일/);
    assert.match(flat(html), /2026-09-20/);
  });

  test("🔴 요청·승인·반려 셋 다 같은 창이라 세 경우에 모두 나온다", () => {
    // 요청은 사유가 선택, 반려는 필수다 — 그 차이와 무관하게 날짜는 늘 있다.
    for (const [title, requireComment] of [
      ["출하 승인 요청", false],
      ["출하 승인", false],
      ["출하 반려", true],
    ] as Array<[string, boolean]>) {
      const html = renderToStaticMarkup(
        <ApprovalActionDialog
          {...baseDialogProps}
          title={title}
          requireComment={requireComment}
          internalTargetShipmentDate="2026-09-20"
        />
      );
      assert.match(flat(html), /사내 목표 출하일/, `${title} 창에 날짜가 없다`);
      assert.match(flat(html), /2026-09-20/, `${title} 창에 날짜가 없다`);
    }
  });

  test("🔴 값이 없으면 「아직 정해지지 않았다 + 접수 정보에서 입력」이 나온다", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog {...baseDialogProps} internalTargetShipmentDate={null} />
    );
    assert.match(flat(html), /아직 정해지지 않았습니다\./);
    assert.match(flat(html), /접수 정보에서 입력합니다\./, "어디서 고치는지를 말해 주지 않는다");
    assert.ok(!/>-</.test(html), "「-」 한 글자만 보여 주면 사람은 어디서 고치는지 모른다");
  });

  test("🔴 프롭을 주지 않으면 그 자리를 아예 그리지 않는다 — 검수 승인 창이 그 경우다", () => {
    const html = renderToStaticMarkup(<ApprovalActionDialog {...baseDialogProps} title="검수 승인 요청" />);
    assert.ok(!/사내 목표 출하일/.test(html), "검수 승인 창에까지 날짜가 끼어들었다");
    assert.ok(!/아직 정해지지 않았습니다/.test(html), "주지 않았는데 빈 값 안내가 나왔다");
  });

  test("🔴 고칠 수 있는 입력칸이 아니다 — 그 자리에 <input>·<select> 가 생기지 않는다", () => {
    for (const value of ["2026-09-20", null]) {
      const html = renderToStaticMarkup(
        <ApprovalActionDialog {...baseDialogProps} internalTargetShipmentDate={value} />
      );
      assert.ok(!/<input/.test(html), `입력칸처럼 생기면 사람이 여기서 고치려 든다 (값: ${value})`);
      assert.ok(!/<select/.test(html), `고르는 자리를 만들면 안 된다 (값: ${value})`);
    }
  });

  test("읽기 전용이라는 것이 글자로도 보인다", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog {...baseDialogProps} internalTargetShipmentDate="2026-09-20" />
    );
    assert.match(flat(html), /읽기 전용/, "고칠 수 없다는 것이 눈에 보여야 한다");
  });

  test("🔴 창이 그 값을 서버로 돌려보내지 않는다 — 확인 콜백의 모양이 그대로다", () => {
    // 날짜가 onConfirm 에 얹히는 순간 이 창은 읽기 전용이 아니게 된다.
    assert.match(
      flat(dialogSource),
      /onConfirm: \(comment: string \| null, assignedApproverUserId: string \| null\) => void;/,
      "확인 콜백에 값이 하나 더 붙었다 — 읽기 전용 약속이 깨진다"
    );
  });

  test("「처리할 사람」 고르는 자리는 그대로다 (요청일 때만 나오는 것 포함)", () => {
    const html = renderToStaticMarkup(
      <ApprovalActionDialog
        {...baseDialogProps}
        title="검수 승인 요청"
        assigneeOptions={[{ id: "u-1", name: "김도윤", roleLabel: "관리자" }]}
      />
    );
    assert.match(html, /<select id="approval-action-assignee"/);
    assert.match(flat(html), /지정하지 않음/);
    assert.match(flat(html), /김도윤 \(관리자\)/);
    assert.match(flat(html), /지정하면 그 사람만 처리할 수 있습니다\./);
    assert.ok(!/사내 목표 출하일/.test(html), "검수 요청 창에 날짜가 끼어들었다");

    // 검수 카드가 그 자리를 요청에만 여는 조건도 그대로다.
    assert.match(
      flat(inspectionCardSource),
      /assigneeOptions=\{dialogState === "REQUEST" \? assigneeCandidates : undefined\}/,
      "고르는 자리가 승인·반려 창에까지 열렸다"
    );
  });

  test("코멘트 칸도 그대로다 — 필수일 때 * 가 붙는 것까지", () => {
    const optional = renderToStaticMarkup(
      <ApprovalActionDialog {...baseDialogProps} internalTargetShipmentDate="2026-09-20" />
    );
    assert.match(flat(optional), /<textarea id="approval-action-comment"/);
    assert.match(flat(optional), /결정 코멘트 \(선택\)/);

    const required = renderToStaticMarkup(
      <ApprovalActionDialog {...baseDialogProps} requireComment internalTargetShipmentDate={null} />
    );
    assert.match(flat(required), /결정 코멘트 \*/);
  });
});

describe("🔴 사내 목표 출하일 — 출하 카드만 창에 넘기고, 읽기만 한다", () => {
  test("출하 카드가 확인 창에 그 값을 넘긴다 — 프롭이 빠지면 코드는 멀쩡한데 한 글자도 안 나온다", () => {
    assert.match(
      flat(renderBlock(shipmentCardSource)),
      /internalTargetShipmentDate=\{internalTargetShipmentDate\}/,
      "창까지 가지 않으면 카드만 값을 들고 있게 된다"
    );
  });

  test("🔴 검수 카드는 그 값을 아예 다루지 않는다 — 검수 승인 창에는 나오면 안 된다", () => {
    assert.ok(
      !/internalTargetShipmentDate/.test(inspectionCardSource),
      "검수 카드가 날짜를 넘기면 검수 승인 창에도 나온다"
    );
  });

  test("화면에 이미 와 있는 값을 그대로 내려보낸다 — 서버·조회를 새로 부르지 않는다", () => {
    assert.match(
      flat(approvalScreenSource),
      /internalTargetShipmentDate=\{resolved\.internalTargetShipmentDate\}/,
      "resolved 에 이미 들어 있는 값이다"
    );
  });

  test("🔴 읽기뿐이다 — 승인 요청·결정 payload 에 날짜가 실리지 않는다", () => {
    // 편집 경로는 「접수 정보 편집」 하나뿐이다(IntakeInfoEditForm.tsx 머리말).
    // 승인 창이 쓰기를 시작하면 그 약속이 조용히 깨진다.
    const submitBlock = sliceBetween(shipmentCardSource, "async function handleConfirm(", "const routeProgress =");
    assert.ok(
      !/internalTargetShipmentDate/.test(submitBlock),
      "승인 요청·결정이 날짜를 서버로 보낸다 — 이 창은 읽기 전용이다"
    );
  });
});

/**
 * ============================================================================
 * 🔴 수리 검수 승인 카드 — 무효가 된 승인의 안내
 * ============================================================================
 * STALE(승인 뒤 접수 건이 바뀌어 무효가 된 상태)에서 검수 카드는 「재요청」
 * 단추를 밀어 넣은 **뒤** 그 이유를 disabledReason 으로 냈다. 껍데기는 그 문구를
 * **단추가 하나도 없을 때만** 그리므로, 사람은 왜 무효가 됐는지 모른 채 단추만
 * 보고 있었다 — 한 글자도 나오지 않았다.
 *
 * 출하 카드는 같은 상황을 blockedNotice 로 내고 있어 정상적으로 보인다. 검수
 * 카드도 같은 자리로 옮겼고, **문구는 그대로**다.
 * ============================================================================
 */
describe("🔴 수리 검수 승인 카드 — 무효가 된 승인의 안내", () => {
  const STALE_NOTICE =
    "승인 이후 접수 건이 변경되어(단계 진행 포함) 이 승인은 더 이상 유효하지 않습니다. 다시 요청해 주세요.";

  /**
   * 요청을 다시 열어 주는 갈래 하나만 잘라낸다. 끝 표시가 `} else if` 라는 것
   * 자체가 **두 안내가 같은 사슬의 다른 가지**임을 보장한다 — 따로 떨어진 if 로
   * 갈라 놓으면 여기서 찾지 못해 시험이 멈춘다.
   */
  const requestBranch = sliceBetween(
    inspectionCardSource,
    'if (displayStatus === "NOT_REQUESTED"',
    '} else if (displayStatus === "REQUESTED") {'
  );
  const decideBranch = sliceBetween(
    inspectionCardSource,
    '} else if (displayStatus === "REQUESTED") {',
    '} else if (displayStatus === "APPROVED") {'
  );

  test("🔴 안내가 blockedNotice 로 나간다 — 단추가 있는 자리라 disabledReason 은 그려지지 않는다", () => {
    const stale = requestBranch.indexOf('if (displayStatus === "STALE")');
    const assignment = requestBranch.indexOf(`blockedNotice = "${STALE_NOTICE}"`);
    const button = requestBranch.indexOf('key: "request"');
    assert.ok(stale >= 0, "STALE 갈래가 아예 없다");
    assert.ok(assignment > stale, "안내가 STALE 갈래 안에 있지 않다");
    assert.ok(button >= 0 && button < assignment, "단추를 밀어 넣기 전이면 blockedNotice 가 맞는 자리가 아니다");
    assert.ok(
      !requestBranch.includes(`disabledReason = "${STALE_NOTICE}"`),
      "옛 자리로 돌아갔다 — 그러면 화면에 한 글자도 나오지 않는다"
    );
  });

  test("문구는 바뀌지 않았고, 출하 카드와도 여전히 같은 말이다", () => {
    assert.ok(inspectionCardSource.includes(STALE_NOTICE), "문구가 바뀌었다 — 자리만 옮기기로 했다");
    assert.ok(shipmentCardSource.includes(STALE_NOTICE), "출하 카드 쪽 문구가 갈라졌다");
  });

  test("🔴 자격이 없어 단추가 없을 때의 문구는 그대로 disabledReason 이다", () => {
    // 그쪽은 단추가 없어 지금도 제대로 그려지고 있다 — 건드리지 않는다.
    assert.ok(
      requestBranch.includes('disabledReason = "최고관리자·관리자·A/S 엔지니어만 요청할 수 있습니다."'),
      "자격 안내까지 옮기면 단추가 없는 자리에서 안내가 사라진다"
    );

    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={null}
        displayStatus="NOT_REQUESTED"
        actions={[]}
        disabledReason="최고관리자·관리자·A/S 엔지니어만 요청할 수 있습니다."
      />
    );
    assert.match(html, /최고관리자·관리자·A\/S 엔지니어만 요청할 수 있습니다\./);
  });

  test("🔴 재요청 단추와 **함께** 실제로 그려진다 — 껍데기가 그렇게 그린다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={approvalRecord({ status: "APPROVED", repairCaseVersionAtRequest: 2 })}
        displayStatus="STALE"
        blockedNotice={STALE_NOTICE}
        actions={[{ key: "request", label: "재요청", onClick: () => {} }]}
      />
    );
    const notice = html.indexOf("다시 요청해 주세요.");
    assert.ok(notice >= 0, "🔴 안내가 아예 그려지지 않았다 — 자리를 잘못 골랐다");
    assert.ok(notice < html.indexOf("</section>"), "안내가 카드 밖으로 나가면 2열 격자의 칸을 먹는다");
    assert.match(html, /재요청<\/button>/, "단추가 함께 있어야 하는 상황이다");
  });

  test("🔴 옛 자리(disabledReason)였다면 한 글자도 안 나왔다 — 그것이 이번 결함이다", () => {
    const html = renderToStaticMarkup(
      <DatabaseApprovalCard
        title="수리 검수 승인"
        record={null}
        displayStatus="STALE"
        actions={[{ key: "request", label: "재요청", onClick: () => {} }]}
        disabledReason={STALE_NOTICE}
      />
    );
    assert.match(html, /재요청<\/button>/);
    assert.ok(
      !/다시 요청해 주세요\./.test(html),
      "껍데기가 규칙을 바꿨다 — 이 시험(과 이번 수정)의 전제가 사라졌다"
    );
  });

  test("🔴 앞 커밋의 비상구 안내와 서로 덮어쓰지 않는다 — 서로 다른 상태에서만 나온다", () => {
    // 무효 안내는 「요청을 다시 열어 주는」 갈래, 비상구 안내는 「요청 대기」
    // 갈래다. 같은 if/else 사슬의 다른 가지라 한 번에 둘 다 정해지는 일이 없다
    // (사슬이라는 것은 위 requestBranch 의 끝 표시 `} else if` 가 보장한다).
    assert.ok(
      !requestBranch.includes("최고관리자 권한으로 대신 처리합니다."),
      "무효 갈래에까지 비상구 안내가 들어왔다 — 둘 중 하나가 지워진다"
    );
    assert.ok(
      !decideBranch.includes("다시 요청해 주세요."),
      "요청 대기 갈래에까지 무효 안내가 들어왔다 — 둘 중 하나가 지워진다"
    );
    // 두 안내가 같은 상태에서 겹칠 수 없다는 것은 상태 자체로도 갈린다:
    // STALE 과 REQUESTED 는 동시에 참이 될 수 없다.
    assert.ok(decideBranch.includes("최고관리자 권한으로 대신 처리합니다."), "비상구 안내가 사라졌다");
  });
});
