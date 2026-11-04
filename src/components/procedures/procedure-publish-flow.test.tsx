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

/**
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 저장소는 주석 속 낱말 때문에 소스 글자
 * 검사가 틀린 적이 여러 번 있다 — "있어야 한다" 쪽은 주석만으로 영영 통과하고,
 * "없어야 한다" 쪽은 설명문 때문에 멀쩡한 코드가 깨진다. 2026-11-04 에 게시
 * 단추 앞에 그 판정의 까닭을 적은 JSX 주석이 생기면서 실제로 필요해졌다.
 *
 * 🔵 **없어야 한다** 쪽(옛 이름이 남지 않았는가)은 일부러 **날것**으로 잰다 —
 * 주석에 옛 이름이 남아 있으면 그것도 찾을 수 있어야 한다.
 * 같은 함수가 이웃 시험(procedure-series-and-version-list.test.tsx)에도 있다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ") // JSX 주석 {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");

/**
 * 원본에서 **함수 하나의 본문만** 잘라낸다.
 *
 * 같은 관문(예: `actorMay(actor, canManageTechnicalTemplates)`)이 이웃 함수에도
 * 있으므로, 시작점부터 파일 끝까지 자르면 정작 이 함수의 관문이 사라져도 이웃
 * 것에 걸려 시험이 통과해 버린다. 그래서 다음 함수 앞에서 끊는다.
 */
const sliceFunction = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const detailScreen = read("src/components/procedures/ProcedureTemplateDetailScreen.tsx");
/** 판정 구조를 재는 자리는 전부 이쪽을 쓴다(위 stripComments 의 까닭). */
const detailScreenCode = stripComments(detailScreen);
const publishButton = read("src/components/procedures/editor/PublishTemplateButton.tsx");
const publishButtonCode = stripComments(publishButton);
const detailPage = read("src/app/(app)/procedures/[id]/page.tsx");
const templateActions = read("src/lib/server/actions/procedure-templates.ts");
const templateMutations = read("src/lib/db/mutations/procedure-templates.ts");
const executionStartCard = read("src/components/procedures/execution/ExecutionStartCard.tsx");
const executionQueries = read("src/lib/db/queries/procedure-case-execution.ts");

describe("절차 상세 — [게시] 단추가 보이는 조건", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 실제로 일을 한다", () => {
    // 2026-11-04 에 게시 단추 앞에 판정의 까닭을 적은 JSX 주석이 생겼다. 그
    // 주석에만 있는 글자로 잰다 — 걷어내기가 멈추면 아래 구조 단언들이 주석을
    // 함께 세기 시작하고, 그 순간 시험이 조용히 느슨해진다.
    assert.ok(detailScreen.includes("눌린 것이 안 먹혔다고 읽는다"), "그 주석이 원본에 있어야 한다");
    assert.ok(!detailScreenCode.includes("눌린 것이 안 먹혔다고 읽는다"), "걷어낸 쪽에는 없어야 한다");
  });

  test("게시 단추는 **이 화면 안에** 딱 한 자리에만 있다", () => {
    // 🔴 2026-11-03(줄기 B-④)에 게시하는 길이 **편집기에도** 생겼다. 그래서
    // "앱 전체에 한 자리"는 더 이상 참이 아니다 — 참인 것은 "한 화면 안에 한
    // 자리"다. 같은 화면 안에 둘이면 한쪽만 고쳐지는 날이 오고, 화면이 다르면
    // 조건식도 각자 가져야 한다. 편집기 쪽의 같은 불변식은
    // procedure-editor-publish-and-issue-row.test.ts 가 잰다.
    //
    // 🔵 2026-11-04 — 만료본에서의 [다시 게시]도 **이 한 자리**로 간다. 새
    // 단추를 만들었다면 이 수가 2 가 되어 여기서 걸린다.
    const occurrences = detailScreenCode.match(/<PublishTemplateButton\b/g) ?? [];
    assert.equal(occurrences.length, 1, "한 화면에 게시 자리가 둘이면 한쪽만 고쳐지는 날이 온다");
  });

  test("🔴 올릴 수 있는 상태이고 권한(canPublish)이 있을 때에만 그린다", () => {
    assert.match(
      flat(detailScreenCode),
      /\{canPublishFromProcedureStatus\(template\.status\) && canPublish && \( <PublishTemplateButton/,
      "게시 단추의 조건은 '올릴 수 있는 상태이고 권한이 있을 때'여야 한다"
    );
  });

  test("🔴 상태 목록을 화면이 제 손으로 적지 않는다 — 서버가 쓰는 **같은 함수**를 부른다", () => {
    // 2026-11-04 전에는 여기에 `template.status === "DRAFT"` 라고 **적혀 있었다.**
    // 만료본 재게시가 생기면서 올릴 수 있는 상태가 둘이 되었는데, 그 목록을
    // 화면에도 적으면 서버와 어긋나는 날이 온다(화면이 느슨하면 누를 때마다
    // 실패하는 단추, 빡빡하면 서버는 되는데 길이 없는 기능).
    const guard = flat(detailScreenCode).match(/\{([^{}]*?) && canPublish && \( <PublishTemplateButton/);
    assert.ok(guard, "게시 단추 앞의 상태 조건을 찾지 못했다");
    assert.equal(guard[1].trim(), "canPublishFromProcedureStatus(template.status)");
    assert.ok(
      detailScreenCode.includes('from "@/lib/domain/procedure-template-publish-policy"'),
      "그 함수는 서버(mutation)와 같은 모듈에서 와야 한다"
    );
  });

  test("🔴 이미 게시된(PUBLISHED) 절차에는 여전히 조건이 성립하지 않는다", () => {
    // 이 줄은 **결정이 뒤집히지 않은 부분**이다. 만료본은 올릴 수 있게 됐지만
    // 게시본은 아니다 — 판정 함수를 값으로 재는 쪽은 unit 목록의
    // procedure-template-publish-policy.test.ts 가 들고 있고, 여기서는 화면이
    // 정말 그 함수에 맡겼는지만 본다(위 단언). 화면이 제 손으로 다시 적는 순간
    // 이 불변식은 두 곳이 된다.
    assert.ok(
      !flat(detailScreenCode).includes('template.status !== "PUBLISHED" && canPublish'),
      "배제형으로 바뀌면 새 상태가 생길 때마다 조용히 게시가 열린다"
    );
  });

  test("🔴 만료본에서 열 때는 [다시 게시]로, 내려갈 판 번호를 창에 넘긴다", () => {
    const painted = flat(detailScreenCode);
    assert.match(painted, /isRepublish=\{template\.status === "ARCHIVED"\}/);
    assert.match(painted, /expiringPublishedVersions=\{expiringPublishedVersions\}/);
    assert.match(
      painted,
      /const expiringPublishedVersions = pickPublishedSiblingsToExpire\(versions, template\.id\)\.map\( \(row\) => row\.version \);/,
      "내려갈 판을 고르는 규칙도 서버와 같은 함수여야 한다 — 창에 적힌 판과 실제로 내려가는 판이 달라지면 안 된다"
    );
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

describe("🔴 확인 창이 '옛 게시본이 내려간다'고 말한다", () => {
  test("🔵 먼저 표본 — 주석 걷어내기가 이 파일에서도 일을 한다", () => {
    assert.ok(publishButton.includes("달라지는 것은 **글자뿐**이다"), "그 주석이 원본에 있어야 한다");
    assert.ok(!publishButtonCode.includes("달라지는 것은 **글자뿐**이다"), "걷어낸 쪽에는 없어야 한다");
  });

  test("🔴 판 번호를 **몰라도** 규칙 자체는 늘 적는다", () => {
    // 편집기 호출부는 계열의 다른 판을 읽지 않아 expiringPublishedVersions 가
    // 빈 배열이다. 그때 아무 말도 안 하면 사람은 옛 게시본이 그대로 남는 줄
    // 안다 — 2026-11-04 전까지 실제로 그랬다. 그래서 이 문장은 조건 바깥에 있다.
    const painted = flat(publishButtonCode);
    assert.match(painted, /한 절차에 게시본은 하나입니다/);
    assert.match(painted, /게시와 동시에\{" "\} <span className="font-medium">\[만료됨\]<\/span>으로 내려갑니다\./);
    const ruleAt = painted.indexOf("한 절차에 게시본은 하나입니다");
    const conditionAt = painted.indexOf("expiringPublishedVersions.length > 0 &&");
    assert.ok(ruleAt >= 0 && conditionAt > ruleAt, "규칙 문장이 조건 안으로 들어가면 모를 때 아무 말도 안 하게 된다");
  });

  test("알 때는 내려갈 판 번호를 함께 적는다", () => {
    const painted = flat(publishButtonCode);
    assert.match(painted, /expiringPublishedVersions\.map\(\(version\) => `v\$\{version\}`\)\.join\(" · "\)/);
  });

  test("🔴 만료본에서 열면 단추와 창의 글자가 [다시 게시]로 바뀐다 — 길은 그대로다", () => {
    const painted = flat(publishButtonCode);
    assert.match(painted, /\{isRepublish \? "다시 게시" : "게시"\}/, "단추 글자");
    assert.match(painted, /\{isRepublish \? "다시 " : ""\}게시합니다/, "창의 첫 줄");
    assert.match(painted, /이 판은 지금 <span className="font-medium">\[만료됨\]<\/span> 상태입니다\./);
    // 🔴 서버로 가는 길은 초안 게시와 **같은 액션 하나**여야 한다. 둘이 되면
    // 검증·확인 창 가운데 한쪽만 고쳐지는 날이 온다.
    assert.equal(
      (publishButtonCode.match(/publishProcedureTemplateAction\(/g) ?? []).length,
      1,
      "다시 게시가 제 길을 따로 내면 여기서 걸린다"
    );
  });

  test("🔴 기본값은 '예전 그대로' — 프롭을 안 넘기는 호출부(편집기)가 달라지지 않는다", () => {
    const painted = flat(publishButtonCode);
    assert.match(painted, /isRepublish = false,/);
    assert.match(painted, /expiringPublishedVersions = \[\],/);
  });
});

describe("🔴 게시와 만료는 **한 트랜잭션**이다", () => {
  const publishBody = sliceFunction(
    stripComments(templateMutations),
    "export async function publishProcedureTemplate",
    "export async function archiveProcedureTemplate"
  );

  test("🔵 먼저 표본 — 잘라낸 본문에 두 쓰기가 다 들어 있다", () => {
    assert.ok(publishBody.length > 500, "본문을 못 잘랐으면 아래가 전부 공짜로 통과한다");
    assert.match(publishBody, /status: "ARCHIVED"/, "내리는 쓰기");
    assert.match(publishBody, /status: "PUBLISHED"/, "올리는 쓰기");
  });

  test("🔴 두 쓰기가 전부 트랜잭션 핸들(tx)로 간다 — 최상위 db 로 새는 것이 없다", () => {
    assert.equal((publishBody.match(/db\.transaction\(/g) ?? []).length, 1, "트랜잭션은 하나다");
    const writes = publishBody.match(/\b(?:tx|db)\n?\s*\.update\(procedureTemplates\)/g) ?? [];
    assert.equal(writes.length, 2, "쓰기는 둘(내리기·올리기)이다");
    for (const write of writes) {
      assert.ok(write.startsWith("tx"), `트랜잭션 밖으로 새는 쓰기가 있다: ${write}`);
    }
    // 🔵 `await db.transaction(` 하나는 당연히 최상위 db 다 — 그것만 빼고 센다.
    //    빼지 않으면 이 단언은 **언제나 실패**해서 아무것도 못 지킨다.
    const topLevelDbUses = (publishBody.match(/\bdb\.\w+\(/g) ?? []).filter((use) => use !== "db.transaction(");
    assert.deepEqual(topLevelDbUses, [], "본문 안에서 최상위 db 를 쓰면 롤백이 반만 듣는다");
  });

  test("🔴 내리는 쪽이 0행이면 **던진다** — 조용히 지나가면 게시본이 둘로 남는다", () => {
    assert.match(
      flat(publishBody),
      /if \(expired\.length === 0\) \{ fail\("CONFLICT"/,
      "fail 은 throw 라서 뒤따르는 게시 UPDATE 까지 함께 사라진다"
    );
    assert.match(flat(publishBody), /if \(published\.length === 0\) \{ fail\("CONFLICT"/);
  });

  test("🔴 계열을 통째로 잠근다 — id 하나만 잠그면 동시 게시를 못 막는다", () => {
    const painted = flat(publishBody);
    assert.match(painted, /eq\(procedureTemplates\.code, lineage\.code\)/, "잠그는 범위가 계열이다");
    assert.match(painted, /\.orderBy\(procedureTemplates\.version\) \.for\("update"\)/, "두 트랜잭션이 같은 차례로 잠가야 교착이 없다");
  });

  test("🔴 내려간 판마다 감사 이력이 남고, 사람이 누른 것과 구분되는 표시가 붙는다", () => {
    const painted = flat(publishBody);
    assert.match(painted, /actionType: "STATUS_CHANGE"/, "enum 을 늘리지 않고 기존 값을 쓴다");
    assert.match(painted, /\.\.\.PROCEDURE_EXPIRED_BY_PUBLISH_MARKER,/, "표시가 없으면 손으로 내린 것과 영영 못 가른다");
    assert.match(painted, /reason: PROCEDURE_EXPIRED_BY_PUBLISH_REASON,/);
    assert.match(painted, /publishedTemplateId: templateId,/, "무엇에 딸려 내려갔는지가 없으면 까닭을 복원할 수 없다");
    // 이력 쓰기가 내리는 쓰기와 같은 반복문 안이어야 한다 — 밖으로 나가면
    // 판이 둘일 때 한 줄만 남는다.
    assert.ok(
      painted.indexOf("insertAuditLog(tx") > painted.indexOf('status: "ARCHIVED"'),
      "이력은 내린 뒤에 적는다"
    );
    assert.ok(
      painted.indexOf("insertAuditLog(tx") < painted.indexOf('status: "PUBLISHED",'),
      "이력이 올리는 쓰기 뒤로 가면 내린 판이 둘일 때 반복문 밖으로 나간 것이다"
    );
  });

  test("🔴 게시 전 검증은 상태와 무관하게 **먼저** 돈다 — 만료본 재게시에도 같은 잣대", () => {
    const painted = flat(publishBody);
    const unresolvedAt = painted.indexOf('fail("HAS_UNRESOLVED_ERRORS"');
    const structuralAt = painted.indexOf('fail("HAS_STRUCTURAL_ERRORS"');
    const firstWriteAt = painted.indexOf('status: "ARCHIVED"');
    assert.ok(unresolvedAt > 0 && structuralAt > 0 && firstWriteAt > 0, "셋 다 본문에 있어야 한다");
    assert.ok(unresolvedAt < firstWriteAt, "미해결 오류 검사가 쓰기보다 앞이다");
    assert.ok(structuralAt < firstWriteAt, "구조 검사가 쓰기보다 앞이다");
    // 검사가 "DRAFT 일 때만" 같은 가지 안에 들어가면 재게시가 샛길을 탄다.
    assert.ok(
      !/if \(template\.status === "DRAFT"\)/.test(painted),
      "상태로 가른 가지 안에 검증이 들어가면 만료본 재게시가 검증을 건너뛴다"
    );
  });
});

describe("🔴 화면 판정과 서버 판정이 같은 것을 본다", () => {
  test("게시 단추의 노출 판정은 publishProcedureTemplate 이 실제로 보는 두 함수를 그대로 쓴다", () => {
    const canPublishExpr = detailPage.slice(detailPage.indexOf("const canPublish ="), detailPage.lastIndexOf("return ("));
    assert.ok(canPublishExpr.length > 0, "page.tsx 에서 canPublish 계산부를 찾지 못했다");
    // 「개발자 표시」가 들어오면서 판정이 `actorMay(행위자, 정책함수)` 로 감싸였다.
    // 감싼 모양을 통째로 못 박는다 — 정책 함수 이름만 찾으면 **누구를 판정하는지**가
    // 빠져나가서, 화면과 서버가 서로 다른 사람을 봐도 시험이 통과한다.
    assert.match(
      flat(canPublishExpr),
      /actorMay\(actingUser, canManageTechnicalTemplates\)/,
      "서버의 거친 관문과 같은 함수 — 승격 창구(actorMay)를 거쳐 actingUser 로 판정한다"
    );
    assert.match(
      flat(canPublishExpr),
      /actorMay\(actingUser, \(role\) => canActorPublishTemplateOfCategory\(role, template\.category\)\)/,
      "서버의 분류별 관문과 같은 함수"
    );
    assert.match(detailPage, /canPublish=\{canPublish\}/, "계산한 값을 화면에 넘겨야 한다");
  });

  test("그 두 함수가 정말 서버(mutation)가 보는 것과 같은 함수다", () => {
    const publishBody = sliceFunction(
      templateMutations,
      "export async function publishProcedureTemplate",
      "export async function archiveProcedureTemplate"
    );
    assert.match(flat(publishBody), /actorMay\(actor, canManageTechnicalTemplates\)/);
    assert.match(
      flat(publishBody),
      /actorMay\(actor, \(role\) => canActorPublishTemplateOfCategory\(role, template\.category\)\)/
    );
  });

  test("게시 서버 액션의 사전 검사도 mutation 의 거친 관문과 같은 함수다", () => {
    const body = sliceFunction(
      templateActions,
      "export async function publishProcedureTemplateAction",
      "export async function createManualTechnicalProcedureTemplateAction"
    );
    // 사전 검사의 판정 대상은 세션에 개발자 표시만 얹은 행위자다
    // (sessionActorWithDeveloperFlag — 역할은 여전히 토큰 값이다).
    assert.match(
      flat(body),
      /actorMay\(await sessionActorWithDeveloperFlag\(session\), canManageTechnicalTemplates\)/,
      "권한 없는 사람은 여기서 먼저 걸린다"
    );
    assert.match(
      flat(body),
      /if \(!actorMay\(await sessionActorWithDeveloperFlag\(session\), canManageTechnicalTemplates\)\) \{ return \{ ok: false, code: "FORBIDDEN"/
    );
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
