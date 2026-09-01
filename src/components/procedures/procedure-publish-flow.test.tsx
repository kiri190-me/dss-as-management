import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * 만들어 둔 기술 절차를 A/S 접수 건에서 실제로 불러올 수 있게 하는 길 —
 * 두 끝을 함께 못 박는다.
 *
 *  1) 절차 상세 화면의 [게시] 단추: 초안(DRAFT)이고 권한이 있을 때에만 보인다.
 *  2) A/S 접수 건의 [+ 기술 절차 불러오기] 창: 이름과, 목록이 비었을 때의
 *     안내(왜 비었고 어디서 채우는가).
 *
 * 이 둘은 한 기능의 앞뒤라 한 파일에 둔다 — 게시하는 길이 없으면 불러오기
 * 목록은 영원히 비어 있고(실제로 그랬다: 절차 6개가 전부 DRAFT였다), 반대로
 * 불러오기 쪽 문구가 게시 자리를 가리키지 않으면 사람이 왜 비었는지 알 수 없다.
 *
 * ── 왜 렌더가 아니라 원본을 읽는가 ──────────────────────────────────────
 * 이 화면들은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**다
 * (ProcedureTemplateDetailScreen → CreateDraftVersionButton →
 * @/lib/server/actions/..., ExecutionStartCard → startProcedureExecutionAction).
 * 그 사슬 끝에 `server-only` 가 있어서, react-server 조건 없이 도는
 * test:components 에서는 import 자체가 던진다(그리고 ProcedureFlowGraph 는
 * @xyflow/react 의 .css 까지 끌고 온다). 그래서 여기서는 이웃 시험
 * (DatabaseWorkHistoryScreen.test.tsx)이 자기 🔴 불변식에 쓴 것과 같은
 * 방법으로, 판정이 적혀 있는 자리를 원본에서 직접 확인한다.
 *
 * 서버 쪽 거절(FORBIDDEN)은 이미 통합 시험이 덮는다 —
 * procedure-templates.integration.test.ts 의 27·28·29번이
 * publishProcedureTemplate 의 거친 관문과 분류별 관문을 각각 확인한다.
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const detailScreen = read("src/components/procedures/ProcedureTemplateDetailScreen.tsx");
const publishButton = read("src/components/procedures/editor/PublishTemplateButton.tsx");
const detailPage = read("src/app/(app)/procedures/[id]/page.tsx");
const templateActions = read("src/lib/server/actions/procedure-templates.ts");
const templateMutations = read("src/lib/db/mutations/procedure-templates.ts");
const executionStartCard = read("src/components/procedures/execution/ExecutionStartCard.tsx");
const executionQueries = read("src/lib/db/queries/procedure-case-execution.ts");

describe("절차 상세 — [게시] 단추가 보이는 조건", () => {
  test("게시 단추는 화면에 딱 한 자리에만 있다", () => {
    const occurrences = detailScreen.match(/<PublishTemplateButton\b/g) ?? [];
    assert.equal(occurrences.length, 1, "게시 자리가 둘이면 한쪽만 고쳐지는 날이 온다");
  });

  test("🔴 초안(DRAFT)이고 권한(canPublish)이 있을 때에만 그린다", () => {
    assert.match(
      flat(detailScreen),
      /\{template\.status === "DRAFT" && canPublish && \( <PublishTemplateButton/,
      "게시 단추의 조건은 'DRAFT 이고 권한이 있을 때'여야 한다"
    );
  });

  test("🔴 이미 게시된(PUBLISHED)·보관된(ARCHIVED) 절차에는 조건이 성립하지 않는다", () => {
    // 조건이 상태를 DRAFT 로 **동등 비교**하므로 PUBLISHED/ARCHIVED 는 구조적으로
    // 걸러진다. 조건이 `!== "ARCHIVED"` 같은 배제형으로 바뀌면(그러면 PUBLISHED 에
    // 또 뜬다) 여기서 깨진다.
    const guard = flat(detailScreen).match(/\{(template\.status[^&]*) && canPublish &&/);
    assert.ok(guard, "게시 단추 앞의 상태 조건을 찾지 못했다");
    assert.equal(guard[1].trim(), 'template.status === "DRAFT"');
  });

  test("🔴 canPublish 의 기본값은 false — 넘기는 것을 잊은 호출부는 단추가 없다", () => {
    assert.match(flat(detailScreen), /canPublish = false,/, "권한은 fail-closed 여야 한다");
    assert.match(flat(detailScreen), /canPublish\?: boolean;/);
  });

  test("확인은 브라우저 기본 창이 아니라 화면 안의 <dialog> 로 한다", () => {
    assert.match(publishButton, /<dialog/, "되돌리기 어려운 조작이라 확인 창을 둔다");
    assert.match(publishButton, /기술 절차 게시/, "확인 창 제목");
    assert.match(publishButton, /되돌릴 수 없/, "무엇이 되돌릴 수 없는지 말해 준다");
    assert.ok(
      !/(^|[^.\w])(confirm|alert|prompt)\s*\(/m.test(publishButton),
      "window.confirm / alert / prompt 를 쓰지 않는다"
    );
  });

  test("서버가 준 실패 이유를 그대로 화면에 보인다 (권한·미해결 오류·구조 오류가 구분돼야 한다)", () => {
    assert.match(flat(publishButton), /if \(!result\.ok\) \{[^}]*setErrorMessage\(result\.message\);/);
  });
});

describe("🔴 화면 판정과 서버 판정이 같은 것을 본다", () => {
  test("게시 단추의 노출 판정은 publishProcedureTemplate 이 실제로 보는 두 함수를 그대로 쓴다", () => {
    const canPublishExpr = detailPage.slice(detailPage.indexOf("const canPublish ="), detailPage.lastIndexOf("return ("));
    assert.ok(canPublishExpr.length > 0, "page.tsx 에서 canPublish 계산부를 찾지 못했다");
    assert.match(canPublishExpr, /canManageTechnicalTemplates\(actingUser\.role\)/, "서버의 거친 관문과 같은 함수");
    assert.match(
      canPublishExpr,
      /canActorPublishTemplateOfCategory\(actingUser\.role, template\.category\)/,
      "서버의 분류별 관문과 같은 함수"
    );
    assert.match(detailPage, /canPublish=\{canPublish\}/, "계산한 값을 화면에 넘겨야 한다");
  });

  test("그 두 함수가 정말 서버(mutation)가 보는 것과 같은 함수다", () => {
    const publishBody = templateMutations.slice(templateMutations.indexOf("export async function publishProcedureTemplate"));
    assert.match(publishBody, /canManageTechnicalTemplates\(actor\.role\)/);
    assert.match(publishBody, /canActorPublishTemplateOfCategory\(actor\.role, template\.category\)/);
  });

  test("게시 서버 액션의 사전 검사도 mutation 의 거친 관문과 같은 함수다", () => {
    const body = templateActions.slice(templateActions.indexOf("export async function publishProcedureTemplateAction"));
    assert.ok(body.length > 0, "게시 서버 액션을 찾지 못했다");
    assert.match(body, /canManageTechnicalTemplates\(session\.role\)/, "권한 없는 사람은 여기서 먼저 걸린다");
    assert.match(flat(body), /canManageTechnicalTemplates\(session\.role\)\) \{ return \{ ok: false, code: "FORBIDDEN"/);
  });

  test("🔴 액션은 mutation 의 실패 결과를 고치지 않고 그대로 돌려준다 (FORBIDDEN 이 화면까지 온다)", () => {
    const body = templateActions.slice(templateActions.indexOf("export async function publishProcedureTemplateAction"));
    assert.match(
      body,
      /return await publishProcedureTemplate\(input\.templateId, session\.userId\);/,
      "결과를 가공하면 왜 게시가 안 되는지가 사람에게 닿지 않는다"
    );
  });
});

describe("A/S 접수 건 — [+ 기술 절차 불러오기]", () => {
  test("단추와 창 제목이 모두 '기술 절차 불러오기' 다", () => {
    assert.match(executionStartCard, /\+ 기술 절차 불러오기/, "단추 글자");
    assert.match(
      flat(executionStartCard),
      /id="execution-start-dialog-title"[^>]*> 기술 절차 불러오기 </,
      "창 제목"
    );
  });

  test("🔴 옛 이름 '표준 기술 절차 불러오기' 는 어디에도 남지 않는다", () => {
    assert.ok(!/표준 기술 절차 불러오기/.test(executionStartCard));
    assert.ok(!/표준 기술 절차 불러오기/.test(detailScreen));
  });

  test("🔴 목록이 비면 왜 비었는지와 어디서 게시하는지를 함께 알려 준다", () => {
    const flatCard = flat(executionStartCard);
    assert.match(flatCard, /불러올 수 있는 기술 절차가 없습니다\./);
    assert.match(flatCard, /게시된<\/span> 절차만 나타납니다/, "왜 비었는가");
    assert.match(flatCard, /기술\/지원\] &gt; 기술 작업 절차/, "어디서 채우는가");
    assert.match(flatCard, /초안\(DRAFT\) 상태이거나 참고용/, "게시해도 안 뜨는 경우까지 말해 준다");
    assert.ok(
      !/실행 가능한 게시된 절차 템플릿이 없습니다/.test(executionStartCard),
      "설명 없는 옛 문구는 남기지 않는다 — 사람이 고장으로 읽는다"
    );
  });
});

describe("🔴 불러오기 목록의 조건은 느슨해지지 않았다", () => {
  test("PUBLISHED · 참고용 아님 · 휴지통 아님 셋 다 그대로다", () => {
    const fn = executionQueries.slice(executionQueries.indexOf("export async function getExecutableTemplateOptions"));
    const body = fn.slice(0, fn.indexOf("export async function getActiveExecutionForCase"));
    assert.match(body, /eq\(procedureTemplates\.status, "PUBLISHED"\)/, "검증 안 된 초안이 현장에 나가면 안 된다");
    assert.match(body, /eq\(procedureTemplates\.isReferenceOnly, false\)/, "참고 문서가 실행 목록에 섞이면 안 된다");
    assert.match(body, /eq\(procedureTemplates\.isDeleted, false\)/);
  });
});
