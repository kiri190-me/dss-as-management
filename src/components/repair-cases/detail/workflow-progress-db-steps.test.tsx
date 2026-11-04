import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import WorkflowProgress from "./WorkflowProgress";
import type { WorkflowProgressStep } from "@/lib/domain/workflow-progress";

/**
 * ============================================================================
 * 「워크플로 진행」이 DB 의 단계 목록을 그린다 (2026-11-04)
 * ============================================================================
 * 사용자 신고: 「[워크플로 관리]에서 수정한 내용이 [기본정보] 탭의 [워크플로 진행]에
 * 반영이 안 된다」. 까닭은 이 부품이 mock-data.ts 의 `workflowSteps` 를 **직접
 * import** 하고 있었기 때문이다 — 코드에 박힌 표라 DB 를 아무리 고쳐도 한 글자도
 * 안 바뀐다. 판정이 아니라 그림만 틀린 결함이라 **오류가 한 번도 안 났다.**
 *
 * 그래서 여기서 못 박는 것은 넷이다.
 *   1. 🔴 **알맹이** — 넘긴 목록의 라벨과 차례가 그대로 화면에 나온다. 표본은
 *      mock 표와 **일부러 다른 라벨**이고, 그 글자가 화면에 있다는 것과 mock 라벨이
 *      화면에 **없다**는 것을 함께 잰다.
 *   2. 🔴 **빈 목록**과 **null** 에서 무엇이 보이는가. 빈 상자는 사람이 "고장"으로
 *      읽는데 무엇이 고장인지는 안 알려 준다.
 *   3. 🔴 **원본 글자**로 — 이 파일이 mock-data 를 더는 안 읽는가. 🔵 **주석을
 *      걷어낸 뒤** 센다. 이 저장소는 주석에 낱말이 적혀 있다는 이유로 셈이 틀린 적이
 *      여러 번 있고, 바로 위 머리말에도 `mock-data` 와 `workflowSteps` 가 적혀 있다.
 *   4. 🔴 **내려주는 길** — 서버 페이지가 그 건의 판본으로 목록을 읽어 화면까지
 *      흘려보내는가. 페이지는 `server-only` 사슬이라 import 할 수 없어 글자로 읽는다.
 * ============================================================================
 */

function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 라벨을 일부러 mock 표와 다르게 적는다 — 같으면 "DB 목록을 그렸는지"를 화면
 * 글자로 가릴 수 없다. key 는 실제로 쓰이는 것이라, 코드 표를 읽는 구현이면
 * 그 표의 **옛 라벨**이 그려진다.
 */
const DB_LIKE_STEPS: WorkflowProgressStep[] = [
  { key: "product_intake", label: "제품 받기(현장 이름)", order: 1 },
  { key: "intake_inspection", label: "입고 점검(현장 이름)", order: 2 },
  { key: "parts_supply", label: "부품 확보(현장 이름)", order: 3 },
  { key: "extra_field_check", label: "현장에서 더한 점검", order: 4 },
  { key: "shipment_completed", label: "내보냄(현장 이름)", order: 5 },
];

/** mock 표의 옛 라벨 — 화면에 이 글자가 보이면 코드 표를 읽고 있다는 뜻이다. */
const MOCK_LABELS = ["제품 인수", "인수점검", "부품 수급", "출하 완료"];

const liCount = (html: string) => (html.match(/<li\b/g) ?? []).length;

describe("WorkflowProgress — 받은 목록을 그린다", () => {
  test("🔴 넘긴 라벨이 차례대로 보이고, mock 표의 옛 라벨은 한 글자도 안 보인다", () => {
    const html = renderToStaticMarkup(
      <WorkflowProgress steps={DB_LIKE_STEPS} currentWorkflowStepKey="parts_supply" />
    );
    assert.equal(liCount(html), 5);
    for (const step of DB_LIKE_STEPS) {
      assert.ok(html.includes(step.label), `${step.label} 이 화면에 없다`);
      assert.ok(html.includes(`${step.order}. ${step.label}`), `${step.key} 의 차례 번호가 라벨 앞에 없다`);
    }
    // 🔵 비교 상대가 비면 아래 단언이 공짜로 통과한다 — 먼저 표본을 센다.
    assert.equal(MOCK_LABELS.length, 4);
    for (const old of MOCK_LABELS) {
      assert.equal(html.includes(old), false, `mock 표의 옛 라벨 "${old}" 이 화면에 그려졌다`);
    }
  });

  test("🔴 mock 표에 아예 없는 단계도 그린다 — [워크플로 관리]에서 더한 단계가 이 모양이다", () => {
    const html = renderToStaticMarkup(
      <WorkflowProgress steps={DB_LIKE_STEPS} currentWorkflowStepKey="extra_field_check" />
    );
    assert.ok(html.includes("4. 현장에서 더한 점검"));
    // 그 단계가 "현재 단계"로 잡혀야 한다 — 코드 표를 읽으면 없는 key 라
    // "존재하지 않습니다" 경고가 뜬다.
    assert.equal(html.includes("데이터 정합성을 확인해 주세요"), false);
    assert.ok(html.includes("현재 단계"));
  });

  test("진행도 셈이 화면에 그대로 나온다 — 완료 둘 · 현재 하나 · 예정 둘", () => {
    const html = renderToStaticMarkup(
      <WorkflowProgress steps={DB_LIKE_STEPS} currentWorkflowStepKey="parts_supply" />
    );
    assert.equal((html.match(/>완료</g) ?? []).length, 2);
    assert.equal((html.match(/>현재 단계</g) ?? []).length, 1);
    assert.equal((html.match(/>예정</g) ?? []).length, 2);
  });

  test("🔵 단계가 둘뿐인 워크플로(추후결정 갈래의 모양)도 그대로 그린다", () => {
    const html = renderToStaticMarkup(
      <WorkflowProgress
        steps={[
          { key: "product_intake", label: "제품 받기(현장 이름)", order: 1 },
          { key: "intake_inspection", label: "입고 점검(현장 이름)", order: 2 },
        ]}
        currentWorkflowStepKey="intake_inspection"
      />
    );
    assert.equal(liCount(html), 2);
    // 목록의 끝자리라 전체 완료 — "현재 단계" 딱지는 없다.
    assert.equal((html.match(/>완료</g) ?? []).length, 2);
    assert.equal(html.includes(">현재 단계<"), false);
  });
});

describe("WorkflowProgress — 그릴 것이 없을 때", () => {
  test("🔴 빈 목록이면 빈 상자가 아니라 까닭을 적은 글이 보인다", () => {
    const html = renderToStaticMarkup(<WorkflowProgress steps={[]} currentWorkflowStepKey="intake_inspection" />);
    assert.equal(liCount(html), 0);
    assert.ok(html.includes("표시할 단계가 없습니다"));
    assert.ok(html.includes("워크플로 관리"), "어디를 봐야 하는지를 글에 적는다");
    // 🔴 "단계 키가 틀렸다"는 글이 대신 뜨면 사람을 엉뚱한 곳으로 보낸다.
    assert.equal(html.includes("데이터 정합성을 확인해 주세요"), false);
  });

  test("🔴 null 이면 '판본을 읽지 못했다'고 말한다 — 빈 목록과 다른 글이다", () => {
    const html = renderToStaticMarkup(<WorkflowProgress steps={null} currentWorkflowStepKey="intake_inspection" />);
    assert.equal(liCount(html), 0);
    assert.ok(html.includes("워크플로 판본을 읽지 못했습니다"));
    assert.equal(html.includes("표시할 단계가 없습니다"), false);
  });

  test("목록에 없는 단계 키면 예전처럼 정합성 경고가 뜬다(그리고 단계는 그대로 보인다)", () => {
    const html = renderToStaticMarkup(
      <WorkflowProgress steps={DB_LIKE_STEPS} currentWorkflowStepKey="no_such_step" />
    );
    assert.ok(html.includes("no_such_step"));
    assert.ok(html.includes("데이터 정합성을 확인해 주세요"));
    assert.equal(liCount(html), 5);
  });
});

describe("🔴 내려주는 길 — 원본 글자로(주석은 걷어낸다)", () => {
  const progressSource = stripComments(readFileSync("src/components/repair-cases/detail/WorkflowProgress.tsx", "utf8"));
  const viewSource = stripComments(
    readFileSync("src/components/repair-cases/detail/RepairCaseDetailView.tsx", "utf8")
  );
  const pageSource = stripComments(readFileSync("src/app/(app)/repair-cases/[id]/page.tsx", "utf8"));

  test("🔵 표본 점검 — 세 파일을 실제로 읽었고 주석 걷어내기가 듣는다", () => {
    assert.ok(progressSource.length > 200);
    assert.ok(viewSource.length > 200);
    assert.ok(pageSource.length > 200);
    // 머리말에는 `mock-data` 가 적혀 있다. 걷어낸 뒤에도 남아 있으면 아래 단언이
    // 주석을 세고 있다는 뜻이라, 여기서 먼저 깨져야 한다.
    assert.equal(
      readFileSync("src/components/repair-cases/detail/WorkflowProgress.tsx", "utf8").includes("mock-data"),
      true,
      "머리말에서 mock-data 를 빼면 이 표본 점검의 뜻이 사라진다 — 그때는 이 줄을 고친다"
    );
    assert.equal(progressSource.includes("mock-data"), false);
  });

  test("🔴 이 부품은 mock-data 도 workflowSteps 도 import 하지 않는다", () => {
    assert.equal(/import[^;]*mock-data/.test(progressSource), false);
    assert.equal(progressSource.includes("workflowSteps"), false);
  });

  test("🔴 서버 페이지가 그 건의 판본으로 단계를 읽어 화면까지 넘긴다", () => {
    // 새 조회를 만들지 않고 작업내용 탭이 쓰는 그 함수를 쓴다 — 두 벌이 되면
    // 같은 건의 단계 목록이 탭마다 달라질 수 있다.
    assert.ok(pageSource.includes("loadWorkflowRulesForCase"));
    assert.ok(flat(pageSource).includes("workflowProgressSteps={workflowProgressSteps}"));
    // 🔵 그리는 세 칸만 내려보낸다 — 규칙의 나머지(전이 목록 · 허용 역할)는 이 칸이
    // 안 그리므로 브라우저로 보내지 않는다.
    assert.ok(flat(pageSource).includes("key: step.key, label: step.label, order: step.order"));
  });

  test("🔴 화면은 그 prop 을 그대로 칸에 넘긴다(중간에서 빈 배열로 바꾸지 않는다)", () => {
    assert.ok(flat(viewSource).includes("<WorkflowProgress steps={workflowProgressSteps}"));
    // 예전 prop(workflowType)을 넘기던 자리가 남아 있으면 둘이 섞여 있다는 뜻이다.
    assert.equal(/<WorkflowProgress[^>]*workflowType=/.test(flat(viewSource)), false);
    // null 을 ?? [] 로 접으면 "판본을 못 읽었다"가 "단계가 없다"로 둔갑한다.
    assert.equal(/workflowProgressSteps\s*\?\?\s*\[\]/.test(flat(viewSource)), false);
  });
});
