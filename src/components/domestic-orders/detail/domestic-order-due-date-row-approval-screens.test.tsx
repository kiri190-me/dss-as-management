import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import DomesticOrderApprovalDialog from "./DomesticOrderApprovalDialog";
import DomesticOrderApprovalHistory from "./DomesticOrderApprovalHistory";
import type { DomesticOrderApprovalRecordRow } from "@/lib/db/queries/domestic-order-approvals";
import {
  domesticOrderDueDateRowLabel,
  domesticOrderDueDateUnits,
  DUE_DATE_ROW_NO_DATE_LABEL,
  DUE_DATE_ROW_WHOLE_LINE_LABEL,
} from "@/lib/domain/domestic-order-due-date-label";
import {
  domesticOrderApprovalUnitCount,
  foldDomesticOrderApprovalStates,
  isDomesticOrderApprovalUnit,
} from "@/lib/domain/domestic-order-approval-rules";

/**
 * ============================================================================
 * 🔴 **회차마다 승인 · 회차마다 완료** — 화면 쪽 (2026-11-08)
 * ============================================================================
 * 사용자 결정 12: 「납기요청일이 한번이면 괜찮지만 **복수로 있다면 출하승인요청을 할
 * 때, 드롭다운으로 어느 납기 요청일에 관한 출하승인 요청인지 선택**하도록」.
 * 사용자 결정 7: 「납품일이 여러개라면 **각각에 [완료처리]버튼**을 만들어줘」.
 *
 * ── 여기서 재는 것 ──────────────────────────────────────────────────────
 *  ㉠ 🔴 **드롭다운은 회차가 둘 이상일 때만 뜬다** — 🔴 **둘 다 잰다.** 「뜬다」만
 *     재면 언제나 그리는 코드도 통과하고, 그러면 회차 하나짜리 기타건(개발 DB 실측
 *     15건 중 13건)의 창이 어제와 달라진다.
 *  ㉡ 🔴 **고르는 값이 서버로 그대로 나간다** — 창이 `onConfirm` 에 회차를 실어 준다.
 *  ㉢ 🔴 **회차를 부르는 말이 한 곳에서 나온다** — 드롭다운 · 카드 머리 · 완료 단추 ·
 *     거절 문장이 **같은 글자**여야 사람이 같은 회차인지 안다.
 *  ㉣ 🔴 **패널이 회차마다 카드를 그리고, 하나뿐이면 머리를 안 세운다**(글자로 읽는다
 *     — 패널은 서버 액션을 물어 그려 볼 수 없다).
 *  ㉤ 🔴 **목록 화면이 회차별 완료 단추를 그린다** — 그리고 **수리 건이 붙은 줄은
 *     그 길로 가지 않는다**(「수리 건 붙은 줄은 지금과 똑같다」가 완료 기준이다).
 *  ㉥ 🔴 **이력 줄에 회차가 적힌다** — 1차와 2차가 섞여 쌓이므로, 없으면 차례를 읽을
 *     수 없다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적어 두고 그 글에 함수 이름이 그대로 들어 있다. 걷어내지 않으면 「드롭다운을 둘일
 * 때만 그린다」가 **주석만으로 통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

const flat = (source: string) => source.replace(/\s+/g, " ");

const panel = flat(
  stripComments(read("src/components/domestic-orders/detail/DomesticOrderApprovalPanel.tsx"))
);
const dialogSource = flat(
  stripComments(read("src/components/domestic-orders/detail/DomesticOrderApprovalDialog.tsx"))
);
const listScreen = flat(
  stripComments(read("src/components/domestic-orders/DomesticOrderListScreen.tsx"))
);
const deliveriesCell = flat(
  stripComments(read("src/components/domestic-orders/DomesticOrderDeliveriesCell.tsx"))
);

const TWO_ROWS = [
  { dueDate: "2096-01-20", note: "1차분" },
  { dueDate: "2096-02-15", note: "2차분" },
];

/* ───────────────────────────────────────── ㉠ · ㉡ 드롭다운 */

describe("㉠ 회차 드롭다운 — 둘 이상일 때만", () => {
  test("🔴 회차가 둘이면 고르개가 서고, 회차 이름이 그대로 들어간다", () => {
    const options = domesticOrderDueDateUnits(TWO_ROWS);
    // 🔵 못 — 재려는 표본이 정말 둘인가.
    assert.equal(options.length, 2, "표본이 둘이 아니다 — 이 시험이 아무것도 못 잰다");

    const html = renderToStaticMarkup(
      <DomesticOrderApprovalDialog
        isOpen
        title="기타건 출하 승인 요청"
        requireReason={false}
        isSubmitting={false}
        rowOptions={options}
        defaultRowOrder={2}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.match(html, /<select/, "고르개가 서지 않았다");
    assert.ok(html.includes("납기요청일 회차"), "고르개에 이름표가 없다");
    for (const option of options) {
      assert.ok(html.includes(option.label), `고르개에 「${option.label}」 이 없다`);
    }
  });

  test("🔴 회차가 하나뿐이면 고르개를 **그리지 않는다** — 어제와 같은 창이어야 한다", () => {
    const options = domesticOrderDueDateUnits([{ dueDate: "2096-01-20", note: null }]);
    assert.equal(options.length, 1, "표본이 하나가 아니다");

    const html = renderToStaticMarkup(
      <DomesticOrderApprovalDialog
        isOpen
        title="기타건 출하 승인 요청"
        requireReason={false}
        isSubmitting={false}
        rowOptions={options}
        defaultRowOrder={1}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.doesNotMatch(html, /<select/, "회차가 하나인데 고르개가 섰다");
    assert.ok(!html.includes("납기요청일 회차"), "회차가 하나인데 이름표가 섰다");
    // 🔵 그래도 창 자체는 그대로다 — 사유 칸과 두 단추.
    assert.ok(html.includes("사유"), "사유 칸까지 사라졌다");
    assert.ok(html.includes("확인"), "확인 단추까지 사라졌다");
  });

  test("🔴 승인·반려 창에는 고르개가 없다 — 고를 것이 없는 자리다", () => {
    const html = renderToStaticMarkup(
      <DomesticOrderApprovalDialog
        isOpen
        title="기타건 출하 승인"
        requireReason={false}
        isSubmitting={false}
        rowOptions={[]}
        defaultRowOrder={2}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    assert.doesNotMatch(html, /<select/);
  });
});

describe("㉡ 고른 회차가 서버로 그대로 나간다", () => {
  test("🔴 창은 `onConfirm` 에 회차를 함께 돌려준다 — 부모가 그 값을 액션에 싣는다", () => {
    // 창이 상태를 쥐므로(머리말) 렌더만으로는 클릭을 흉내 낼 수 없다. 대신 **글자로**
    // 두 자리를 함께 못 박는다: 창이 돌려주고, 패널이 그대로 싣는가.
    assert.match(
      dialogSource,
      /onConfirm\(trimmed \|\| null, rowOrder\)/,
      "창이 고른 회차를 안 돌려준다"
    );
    assert.match(
      panel,
      /requestDomesticOrderApprovalAction\(\{ domesticOrderId, reason, dueDateRowOrder, \}\)/,
      "요청 액션에 창이 돌려준 회차가 안 실린다"
    );
    // 🔴 승인·반려는 **누른 카드의 회차**다 — 창이 고르게 하지 않는다.
    assert.match(
      panel,
      /decision: dialog\.kind, reason, dueDateRowOrder: dialog\.rowOrder,/,
      "결재 액션에 누른 카드의 회차가 안 실린다"
    );
  });

  test("🔴 창을 열 때마다 고른 값이 **부모가 준 기본값으로** 돌아간다", () => {
    // 지난 선택이 남으면 사유 칸과 달리 **눈에 보이지 않는 채로** 묻어간다.
    assert.match(dialogSource, /setRowOrder\(defaultRowOrder\);/, "열 때 되돌리지 않는다");
    assert.match(dialogSource, /\}, \[isOpen, defaultRowOrder\]\);/, "기본값 변화를 안 본다");
  });
});

/* ───────────────────────────────────────── ㉢ 회차를 부르는 말 */

describe("㉢ 회차 이름은 한 곳에서 나온다", () => {
  test("🔴 「1차 · 납기 2096-01-20 (1차분)」 — 번호 · 날짜 · 비고", () => {
    assert.equal(
      domesticOrderDueDateRowLabel(1, { dueDate: "2096-01-20", note: "1차분" }),
      "1차 · 납기 2096-01-20 (1차분)"
    );
    // 비고가 없으면 괄호도 없다.
    assert.equal(
      domesticOrderDueDateRowLabel(2, { dueDate: "2096-02-15", note: null }),
      "2차 · 납기 2096-02-15"
    );
    // 🔴 편집 중에는 날짜가 비어 있을 수 있다 — 「1차 · 납기 」로 끝나면 글이 잘린 것처럼 보인다.
    assert.equal(
      domesticOrderDueDateRowLabel(1, { dueDate: "", note: "" }),
      `1차 · 납기 ${DUE_DATE_ROW_NO_DATE_LABEL}`
    );
  });

  test("🔴 회차 0개인 기타건에도 단위가 하나 있다 — 11건이 그 모양이다", () => {
    const units = domesticOrderDueDateUnits([]);
    assert.deepEqual(units, [{ rowOrder: 1, label: DUE_DATE_ROW_WHOLE_LINE_LABEL }]);
    assert.equal(domesticOrderApprovalUnitCount(0), 1);
    assert.equal(domesticOrderApprovalUnitCount(2), 2);
    // 🔴 그 줄에서도 1차는 올릴 수 있고 2차는 없다.
    assert.equal(isDomesticOrderApprovalUnit(1, 0), true);
    assert.equal(isDomesticOrderApprovalUnit(2, 0), false);
    // 🔴 소수·0·음수는 회차가 아니다 — SQL 비교가 조용히 아무 행도 못 찾는다.
    assert.equal(isDomesticOrderApprovalUnit(0, 2), false);
    assert.equal(isDomesticOrderApprovalUnit(1.5, 2), false);
    assert.equal(isDomesticOrderApprovalUnit(-1, 2), false);
  });

  test("🔴 네 화면이 **그 함수**를 부른다 — 글자를 따로 짓지 않는다", () => {
    for (const [name, source] of [
      ["납품 편집칸", deliveriesCell],
      ["목록 화면의 회차 완료 단추", listScreen],
    ] as const) {
      assert.match(
        source,
        /domesticOrderDueDateRowLabel\(/,
        `${name} 이 회차 이름을 제 손으로 짓는다`
      );
    }
    // 🔴 패널은 **서버가 만들어 준 이름**을 그대로 그린다(units[].label).
    assert.match(panel, /\{unit\.label\}/, "패널이 회차 이름을 안 그린다");
    // 🔴 납품 편집칸이 옛 글자를 **다시 짓지 않는다** — 2026-11-08 에 옮긴 자리다.
    assert.ok(
      !/\$\{index \+ 1\}차 · 납기/.test(deliveriesCell),
      "납품 편집칸에 옛 글자 만들기가 되살아났다"
    );
  });

  test("🔴 줄 하나로 접는 규칙 — 전부 승인이어야 승인이다", () => {
    assert.equal(foldDomesticOrderApprovalStates(["APPROVED", "APPROVED"]), "APPROVED");
    // 차례대로 보고 **처음 걸린 것**을 돌려준다(가장 나쁜 상태가 아니다).
    assert.equal(foldDomesticOrderApprovalStates(["NOT_REQUESTED", "REJECTED"]), "NOT_REQUESTED");
    assert.equal(foldDomesticOrderApprovalStates(["APPROVED", "PENDING"]), "PENDING");
    assert.equal(foldDomesticOrderApprovalStates([]), "NOT_REQUESTED");
  });
});

/* ───────────────────────────────────────── ㉣ 패널 */

describe("㉣ 패널은 회차마다 카드를 그린다", () => {
  test("🔴 units 를 돌며 카드를 세우고, **둘 이상일 때만** 회차 머리를 붙인다", () => {
    assert.match(panel, /units\.map\(\(unit\) => \( <UnitCard/, "회차마다 카드를 세우지 않는다");
    assert.match(
      panel,
      /const showRowHeadings = units\.length > 1;/,
      "회차 머리를 언제 세우는지가 사라졌다"
    );
    assert.match(panel, /\{showHeading && \(/, "머리를 조건 없이 세운다");
  });

  test("🔴 올릴 수 있는 회차만 드롭다운에 세운다 — 단추를 여는 **그 함수**로 가린다", () => {
    assert.match(
      panel,
      /units \.filter\(\(unit\) => isDomesticOrderApprovalRequestable\(unit\.state\)\)/,
      "드롭다운이 진행 중·승인된 회차까지 세운다"
    );
  });

  test("🔴 거절 문구는 **누른 카드 밑에만** 뜬다 — 카드가 여럿이면 남의 밑에 붙는다", () => {
    assert.match(panel, /status\?\.rowOrder === unit\.rowOrder/, "말이 어느 회차의 것인지 모른다");
  });

  test("🔵 이력은 **한 벌**이다 — 회차로 쪼개지 않는다", () => {
    assert.match(panel, /<DomesticOrderApprovalHistory records=\{history\}/);
    // 🔴 **한 번만 그린다.** 회차 카드 안으로 들어가면 같은 이력이 회차 수만큼 되풀이
    //    되고, 1차와 2차가 번갈아 일어난 차례를 읽을 수 없게 된다.
    assert.equal(
      panel.match(/<DomesticOrderApprovalHistory/g)?.length,
      1,
      "이력이 한 번이 아니다 — 회차마다 쪼개졌을 수 있다"
    );
    // 그리고 그 자리는 **회차 카드 바깥**이다(카드를 그리는 조각에는 없다).
    const unitCard = panel.slice(panel.indexOf("function UnitCard("));
    assert.ok(
      !unitCard.includes("DomesticOrderApprovalHistory"),
      "회차 카드 안에서 이력을 그린다"
    );
  });
});

/* ───────────────────────────────────────── ㉤ 목록 화면의 회차별 완료 */

describe("㉤ 목록 화면 — 회차별 [완료 처리]", () => {
  test("🔴 기타건이고 회차가 둘 이상일 때만 회차 단추로 갈라진다", () => {
    assert.match(
      listScreen,
      /if \(row\.repairCaseId === null && row\.dueDates\.length >= 2\) \{ return \( <DueDateRowCompletionToggles/,
      "회차 단추로 갈라지는 조건이 사라졌다"
    );
  });

  test("🔴 회차마다 단추를 하나씩 그리고, 긴 이름은 title 에 둔다", () => {
    assert.match(listScreen, /row\.dueDates\.map\(\(dueDate, index\) => \{/, "회차마다 안 그린다");
    assert.match(listScreen, /\{rowOrder\}차 \{completed \? "해제" : "완료"\}/, "단추 글자가 바뀌었다");
    assert.match(listScreen, /title=\{`\$\{label\} — \$\{completed \? "완료 해제" : "완료 처리"\}`\}/);
  });

  test("🔴 막히면 **읽고 닫는 알림**으로 올린다 — 줄 위 빨간 글씨로 줄이지 않는다", () => {
    assert.match(
      listScreen,
      /if \(result\.code === "APPROVAL_REQUIRED"\) \{ onApprovalBlocked\(result\.message\); return; \}/,
      "회차 완료가 막혔을 때 까닭을 안 띄운다"
    );
  });

  test("🔴 보내는 것은 **그 회차 번호**와 줄의 version 이다", () => {
    assert.match(
      listScreen,
      /setDomesticOrderDueDateRowCompletionAction\(\{ id: row\.id, expectedVersion: row\.version, dueDateRowOrder: rowOrder, completed, \}\)/,
      "회차 완료가 보내는 값이 바뀌었다"
    );
  });
});

/* ───────────────────────────────────────── ㉥ 이력 */

describe("㉥ 이력 줄에 회차가 적힌다", () => {
  function record(
    overrides: Partial<DomesticOrderApprovalRecordRow> = {}
  ): DomesticOrderApprovalRecordRow {
    return {
      id: "approval-1",
      status: "REQUESTED",
      requestedByUserId: "user-requester",
      // 🔴 가짜 이름만 쓴다 — 이 저장소는 공개다.
      requestedByName: "요청한사람",
      requestedAt: "2096-03-10T01:00:00.000Z",
      requestReason: null,
      assignedApproverUserId: "user-step-a",
      assignedApproverName: "일단계",
      routeId: "route-1",
      routeStepOrder: 1,
      decidedByUserId: null,
      decidedByName: null,
      decidedAt: null,
      decisionReason: null,
      delegatedFromUserId: null,
      delegatedFromName: null,
      versionAtRequest: 3,
      dueDateRowOrder: 2,
      ...overrides,
    };
  }

  test("🔴 「2차」가 줄에 보인다 — 없으면 1차와 2차가 섞여 차례를 못 읽는다", () => {
    const html = renderToStaticMarkup(
      <DomesticOrderApprovalHistory
        records={[record(), record({ id: "approval-2", dueDateRowOrder: 1 })]}
        routeSteps={[]}
      />
    );
    assert.ok(html.includes("2차"), "이력에 회차가 없다");
    assert.ok(html.includes("1차"), "이력에 다른 회차가 없다");
  });

  test("🔵 회차가 비어 있는 옛 줄에는 아무것도 안 붙인다", () => {
    const html = renderToStaticMarkup(
      <DomesticOrderApprovalHistory records={[record({ dueDateRowOrder: null })]} routeSteps={[]} />
    );
    assert.ok(!html.includes("차</span>"), "비어 있는 회차에 글자가 붙었다");
  });
});
