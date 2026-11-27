import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ROLE_CODES, type Role } from "@/lib/domain/types";
import { meetsPermissionLevel, type PermissionLevel } from "./permission-areas";
import { baselineLeafLevel } from "./permission-baseline";
import { featuresOfArea, isPermissionLeafKey, isSettingsEnforced } from "./permission-features";
import {
  canAuthorTechnicalTemplatesByDefault,
  canCreateTechnicalTemplateDraft,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
  canManageTechnicalTemplates,
  canDeleteTechnicalTemplates,
  canViewPublishedTechnicalTemplates,
} from "./technical-procedure-template-authorization";
import {
  canResolveProcedureValidationIssues,
  canViewProcedureValidationManagement,
} from "./procedure-template-authorization";

/**
 * ============================================================================
 * 기술 작업 절차 — 설정이 **실제로** 판정하는가, 그리고 누가 달라졌는가
 * ============================================================================
 * 사용자 요구(2026-11-27): 「[기술 작업 절차]의 권한중에 기술절차 생성은 없네.
 * 만들어주고 **실제로 권한을 넓힐 수 있는 설정**으로 만들어줘.」
 * 이어서: 「[절차 만들기]는 [최고 관리자/관리자/a/s엔지니어]는 [읽기+쓰기]를
 * 기본 권한으로 설정해줘.」
 *
 * 그날 두 가지가 한꺼번에 움직였다. 이 시험이 드는 것은 **둘을 갈라 놓는 일**이다:
 *
 *  ① 서버 관문이 역할 고정 함수에서 **설정**으로 넘어갔다(만들기·초안 편집·발행).
 *     🔴 이 전환은 **아무의 권한도 바꾸지 않아야** 한다 — 바꾸는 것은 ②뿐이다.
 *     전환은 조용히 틀린다: 관문이 보는 잎의 기본값이 종전 역할 함수보다 한 칸만
 *     넓어도, 아무도 설정 화면을 열지 않았는데 그날부터 권한이 넓어진다. 반대로
 *     좁으면 어제 되던 사람이 까닭 없이 막히는데 **그쪽은 아무도 신고하지 않는다.**
 *
 *  ② 「절차 만들기」의 기본값에 A/S 엔지니어가 **일부러** 들어왔다(사용자 결정).
 *     🔴 **이 한 잎만** 넓어져야 한다. 같은 날 손댄 editDraft·publish 가 함께
 *     움직이면 사용자가 허락한 적 없는 권한이 열린다.
 *
 * ── 🔵 「저장된 값이 없을 때」를 왜 baselineLeafLevel 로 재는가 ───────────────
 * 해석기가 그렇게 돈다 — 저장된 행이 없으면 **그 값이 그대로 답**이다
 * (permission-resolver.ts 의 `configured[leafKey] ?? baselineLeafLevel(...)`).
 * 아래 ④절이 그 한 줄을 **글자로** 확인한다. 개발 DB 의 role_permissions 에
 * `technicalProcedures%` 행이 0건이므로(2026-11-27 실측), 지금 운영·개발 양쪽에서
 * 실제로 답하는 것이 이 표다.
 * ============================================================================
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

/**
 * 주석을 걷어낸다. 🔴 이 조각은 주석에 옛 함수 이름을 **일부러 많이** 남겼다
 * (「무엇이 어디서 어디로 옮겨갔는가」를 적어야 다음 사람이 되돌리지 않는다).
 * 날것으로 세면 그 설명문이 「관문에 역할 함수가 남아 있다」로 읽혀 멀쩡한 코드가
 * 깨진다 — 이웃 시험(procedure-publish-flow.test.tsx)이 쓰는 그 함수와 같은 모양이다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

/** 함수 하나의 본문만 잘라낸다 — 이웃 함수의 관문에 걸려 통과하는 것을 막는다. */
const sliceFunction = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const CREATE = "technicalProcedures.create";
const EDIT_DRAFT = "technicalProcedures.editDraft";
const PUBLISH = "technicalProcedures.publish";

/** 저장된 값이 없을 때 이 역할이 그 조작을 할 수 있는가. */
const mayByDefault = (leafKey: string, role: Role, required: PermissionLevel) =>
  meetsPermissionLevel(baselineLeafLevel(leafKey, role), required);

describe("① 🔵 먼저 표본 — 이 시험이 정말 무언가를 가르는가", () => {
  test("새 잎이 **저장되는 키**다 — 아니면 아래 표 전부가 공짜로 통과한다", () => {
    assert.equal(isPermissionLeafKey(CREATE), true, `${CREATE} 가 저장되는 잎이 아니다`);
  });

  test("판정 함수가 실제로 가른다 — 쓰기는 통과, 접근 불가는 거절", () => {
    // meetsPermissionLevel 이 늘 true 를 돌려주면 아래 ②절의 ✗ 칸이 영영 안 걸린다.
    assert.equal(meetsPermissionLevel("WRITE", "WRITE"), true);
    assert.equal(meetsPermissionLevel("NONE", "WRITE"), false);
    assert.equal(meetsPermissionLevel("READ", "WRITE"), false);
    assert.equal(meetsPermissionLevel("MANAGE", "MANAGE"), true);
    assert.equal(meetsPermissionLevel("WRITE", "MANAGE"), false);
  });

  test("주석 걷어내기가 실제로 일을 한다 — ⑤절이 주석을 코드로 세면 안 된다", () => {
    const actions = read("src/lib/server/actions/procedure-templates.ts");
    // 이 글자는 **주석에만** 있다(그 파일 머리말). 걷어낸 쪽에 남아 있으면 멈춘다.
    assert.ok(actions.includes("빠른 되돌림"), "그 주석이 원본에 있어야 한다");
    assert.ok(!stripComments(actions).includes("빠른 되돌림"), "걷어낸 쪽에는 없어야 한다");
  });

  test("다섯 역할을 다 훑는다 — 역할이 늘면 여기서 먼저 걸린다", () => {
    assert.equal(ROLE_CODES.length, 5);
  });
});

describe("② 🔴 저장된 값이 없을 때 — 역할 × 조작", () => {
  /**
   * 🔴 손으로 적은 표다. 일부러 그렇게 한다 — 정책 함수를 불러 비교하면 「함수와
   * 기본값이 같다」만 말할 뿐, **사람이 무엇을 허락했는지**는 어디에도 안 남는다.
   * 함수와의 일치는 아래 ③절이 따로 든다.
   *
   * 차례는 ROLE_CODES 그대로: 최고관리자 · 관리자 · A/S 엔지니어 · 영업 · 자재.
   */
  const TABLE: Record<string, Record<Role, boolean>> = {
    // 🔴 아래 **둘**에서 A/S 엔지니어가 참이다 — 2026-11-27 사용자 결정 둘(만들기,
    //    그리고 ㄱ안의 초안 편집). 여기가 거짓으로 돌아가 있으면 결정이 되돌아간 것이다.
    //
    // 🔴 **둘은 함께 움직여야 한다.** 만들기만 열면 엔지니어가 만든 절차를 열지도
    //    고치지도 못한다 — 만들기 창이 이름·설비유형만 받고 내용은 편집기에서 채우는
    //    두 걸음이라, 둘째 걸음이 막히면 빈 껍데기만 쌓인다. 사용자가 그 상태를
    //    보고받고 ㄱ안을 골랐다.
    [CREATE]: { SUPER_ADMIN: true, ADMIN: true, AS_ENGINEER: true, SALES: false, INVENTORY_MANAGER: false },
    [EDIT_DRAFT]: { SUPER_ADMIN: true, ADMIN: true, AS_ENGINEER: true, SALES: false, INVENTORY_MANAGER: false },
    // 🔴 발행은 **전환 전 동작 그대로**다. 참이 하나라도 늘면 허락 없이 넓어진 것이다.
    //    이것이 엔지니어가 만든 초안의 **마지막 울타리**다 — 짓고 고칠 수는 있어도
    //    현장에 내보내는 것은 관리자가 한다.
    [PUBLISH]: { SUPER_ADMIN: true, ADMIN: true, AS_ENGINEER: false, SALES: false, INVENTORY_MANAGER: false },
  };

  const REQUIRED: Record<string, PermissionLevel> = {
    // 🔵 관문이 실제로 요구하는 수준 그대로다 — 화면·액션·mutation 이 쓰는 그 문자열.
    [CREATE]: "WRITE",
    [EDIT_DRAFT]: "WRITE",
    [PUBLISH]: "MANAGE",
  };

  for (const [leafKey, expected] of Object.entries(TABLE)) {
    test(`${leafKey} — 다섯 역할의 답이 표 그대로다`, () => {
      for (const role of ROLE_CODES) {
        assert.equal(
          mayByDefault(leafKey, role, REQUIRED[leafKey]),
          expected[role],
          `${leafKey} / ${role}: 저장된 값이 없을 때의 답이 달라졌다`
        );
      }
    });
  }

  test("🔴 넓어진 것은 **만들기와 초안 편집 둘**이다 — 엔지니어에게 열린 칸을 센다", () => {
    const openedForEngineer = Object.keys(TABLE).filter((leafKey) =>
      mayByDefault(leafKey, "AS_ENGINEER", REQUIRED[leafKey])
    );
    assert.deepEqual(openedForEngineer, [CREATE, EDIT_DRAFT], "엔지니어에게 열린 칸이 그 둘이 아니다");
    // 🔴 셋째가 늘어나는 것도, 둘이 하나로 줄어드는 것도 여기서 걸린다.
    assert.equal(mayByDefault(PUBLISH, "AS_ENGINEER", "MANAGE"), false, "발행까지 열렸다");
  });

  test("🔴 삭제·복원과 검증도 엔지니어에게 닫힌 채다 — 이 조각이 안 건드린 잎들", () => {
    // 🔵 TABLE 밖의 잎도 함께 센다. 표에 없는 잎이 조용히 열리면 위 시험은 통과한다.
    assert.equal(mayByDefault("technicalProcedures.lifecycle", "AS_ENGINEER", "MANAGE"), false);
    assert.equal(mayByDefault("technicalProcedures.validation", "AS_ENGINEER", "READ"), false);
    assert.equal(mayByDefault("technicalProcedures.validation", "AS_ENGINEER", "WRITE"), false);
  });

  test("🔴 영업·자재 담당자에게는 **한 칸도** 열리지 않았다", () => {
    for (const role of ["SALES", "INVENTORY_MANAGER"] as const) {
      for (const leafKey of Object.keys(TABLE)) {
        assert.equal(mayByDefault(leafKey, role, REQUIRED[leafKey]), false, `${role} 에게 ${leafKey} 가 열렸다`);
      }
    }
  });
});

describe("③ 🔴 기본값을 손으로 적지 않았다 — 정책 함수의 답과 역할마다 같다", () => {
  /**
   * ②절이 「사람이 무엇을 허락했는가」라면, 이 절은 「그 값이 어디서 오는가」다.
   * 둘을 함께 둬야, 정책 함수가 바뀌는 날 **둘 중 하나가 반드시 깨진다** — 한쪽만
   * 있으면 바뀐 정책이 조용히 기본값에 흘러들거나(③만 있을 때), 기본값이 정책과
   * 갈라진 채 굳는다(②만 있을 때).
   */
  test("만들기 — canCreateTechnicalTemplateDraft 와 역할마다 같다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(mayByDefault(CREATE, role, "WRITE"), canCreateTechnicalTemplateDraft(role), role);
    }
  });

  test("초안 편집 — canAuthorTechnicalTemplatesByDefault 와 역할마다 같다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(mayByDefault(EDIT_DRAFT, role, "WRITE"), canAuthorTechnicalTemplatesByDefault(role), role);
    }
  });

  test("🔴 만들기와 초안 편집의 기본값이 **같은 집합**이다", () => {
    // 사용자 결정이 「만들기와 같은 셋에게 고치기도」였다. 두 잎이 갈리면 2026-11-27
    // 전의 상태(만들었는데 못 고침)가 되살아난다.
    for (const role of ROLE_CODES) {
      assert.equal(
        mayByDefault(CREATE, role, "WRITE"),
        mayByDefault(EDIT_DRAFT, role, "WRITE"),
        `${role}: 만들기와 초안 편집의 기본값이 갈렸다`
      );
    }
  });

  test("🔴 `canEditTechnicalTemplateDraft` 는 **안 넓혔다** — 넓히면 둘이 딸려 온다", () => {
    // 그 함수의 호출부는 셋이고(기본값 · 메뉴 상한 case · canActorEditTemplateOfCategory),
    // 뒤의 둘은 사용자가 허락한 적 없는 자리다. 그래서 기본값만 따로 넓혔다.
    // 🔵 이 시험이 그 선택을 못 박는다 — 누가 나중에 그 함수를 넓히면 여기서 걸린다.
    assert.equal(canEditTechnicalTemplateDraft("AS_ENGINEER"), false, "역할 고정 함수가 넓어졌다");
    assert.equal(canAuthorTechnicalTemplatesByDefault("AS_ENGINEER"), true, "기본값이 안 넓어졌다");
  });

  test("발행 — canPublishTechnicalTemplates(‖ canManageTechnicalTemplates) 와 역할마다 같다", () => {
    for (const role of ROLE_CODES) {
      assert.equal(
        mayByDefault(PUBLISH, role, "MANAGE"),
        canPublishTechnicalTemplates(role) || canManageTechnicalTemplates(role),
        role
      );
    }
  });

  test("🔴 손대지 않은 잎 셋(조회·검증·삭제복원)도 정책 함수 그대로다", () => {
    // 이 조각은 이 셋을 **안 건드렸다.** 그 사실을 함께 못 박는다 — 권한을 만지는
    // 조각에서 가장 조용히 깨지는 것이 「건드리지 않은 쪽」이다.
    for (const role of ROLE_CODES) {
      assert.equal(
        mayByDefault("technicalProcedures.view", role, "READ"),
        canViewPublishedTechnicalTemplates(role),
        `view / ${role}`
      );
      assert.equal(
        mayByDefault("technicalProcedures.validation", role, "WRITE"),
        canResolveProcedureValidationIssues(role),
        `validation(쓰기) / ${role}`
      );
      assert.equal(
        mayByDefault("technicalProcedures.validation", role, "READ"),
        canViewProcedureValidationManagement(role),
        `validation(읽기) / ${role}`
      );
      assert.equal(
        mayByDefault("technicalProcedures.lifecycle", role, "MANAGE"),
        canDeleteTechnicalTemplates(role, "TECHNICAL_TASK"),
        `lifecycle / ${role}`
      );
    }
  });
});

describe("④ 🔴 저장된 값이 없으면 정말 기본값이 답한다", () => {
  test("해석기의 그 한 줄이 살아 있다", () => {
    // 이 줄이 바뀌면 ②·③절이 재는 것이 「실제로 누가 할 수 있는가」가 아니게 된다.
    const resolver = stripComments(read("src/lib/auth/permission-resolver.ts"));
    assert.ok(
      resolver.includes("configured[leafKey] ?? baselineLeafLevel(leafKey, role)"),
      "저장된 값이 없을 때 기본값으로 떨어지는 길이 사라졌다"
    );
  });
});

describe("⑤ 🔴 서버 관문이 정말 설정을 본다 — 역할 고정이 남아 있으면 넓혀도 안 열린다", () => {
  const actions = () => stripComments(read("src/lib/server/actions/procedure-templates.ts"));
  const editorActions = () => stripComments(read("src/lib/server/actions/procedure-template-editor.ts"));
  const mutations = () => stripComments(read("src/lib/db/mutations/procedure-templates.ts"));
  const listPage = () => stripComments(read("src/app/(app)/procedures/technical/page.tsx"));

  test("만들기 — 액션·mutation·화면이 같은 잎을 본다", () => {
    const actionBody = sliceFunction(
      actions(),
      "export async function createManualTechnicalProcedureTemplateAction",
      "export async function renameTechnicalProcedureTemplateAction"
    );
    assert.match(actionBody, /mayCreateTechnicalTemplate\(/, "액션의 사전 검사가 만들기 잎을 안 본다");

    const mutationBody = sliceFunction(
      mutations(),
      "export async function createManualTechnicalProcedureTemplate",
      "export type RenameTechnicalTemplateResult"
    );
    assert.match(mutationBody, /mayCreateTechnicalTemplate\(actor\)/, "mutation 의 관문이 만들기 잎을 안 본다");

    // 🔴 화면의 [+ 새 절차]도 같은 잎이다 — 다르면 단추와 서버가 어긋난다.
    assert.match(listPage(), /hasPermission\(actingUser, "technicalProcedures\.create", "WRITE"\)/);
    assert.match(listPage(), /canCreate=\{mayCreate\}/);

    // 🔵 그 잎을 묻는 함수가 정말 그 문자열을 본다.
    const capabilities = stripComments(read("src/lib/auth/technical-procedure-capabilities.ts"));
    assert.match(capabilities, /hasPermission\(actor, "technicalProcedures\.create", "WRITE"\)/);
  });

  test("발행 — 액션·mutation 의 두 관문이 모두 설정을 본다", () => {
    const actionBody = sliceFunction(
      actions(),
      "export async function publishProcedureTemplateAction",
      "export async function createManualTechnicalProcedureTemplateAction"
    );
    assert.match(actionBody, /mayPublishSomeTemplate\(/, "게시 액션의 사전 검사가 설정을 안 본다");

    const publishBody = sliceFunction(
      mutations(),
      "export async function publishProcedureTemplate",
      "export async function archiveProcedureTemplate"
    );
    assert.match(publishBody, /mayPublishSomeTemplate\(actor\)/, "거친 관문이 설정을 안 본다");
    assert.match(
      publishBody,
      /mayPublishTemplateOfCategory\(actor, template\.category\)/,
      "분류별 관문이 설정을 안 본다"
    );
  });

  test("초안 편집 — 편집기 입구 둘이 모두 설정을 본다", () => {
    // 🔴 여기가 역할 고정으로 남아 있으면 **설정을 넓혀도 아무것도 안 열린다.**
    //    mutation 은 이미 설정을 보는데(assertEditableDraft), 넓어진 사람이 이
    //    두 줄에서 먼저 걸려 그 관문에 닿지 못하기 때문이다 — 실제로 그랬다.
    const editorSource = editorActions();
    assert.match(editorSource, /mayEnterTemplateEditor\(actor\)/, "속성 편집 입구가 설정을 안 본다");
    const graphGate = sliceFunction(
      editorSource,
      "export async function resolveTechnicalGraphActorId",
      "export async function createProcedureTemplateNodeAction"
    );
    assert.match(graphGate, /mayEnterTemplateEditor\(/, "구조 편집 입구가 설정을 안 본다");
  });

  test("🔴 세 통로에 역할 고정 관문이 **한 줄도** 안 남았다", () => {
    // 「없어야 한다」 쪽이라 주석을 걷어낸 글자로 센다(①절의 표본이 그것을 지킨다).
    for (const [label, source] of [
      ["액션(절차)", actions()],
      ["액션(편집기)", editorActions()],
    ] as const) {
      assert.ok(
        !source.includes("canManageTechnicalTemplates"),
        `${label}: 역할 고정 관문이 아직 남아 있다 — 넓혀도 안 열린다`
      );
    }
    // mutation 쪽은 **만들기·편집·발행 함수 본문**만 본다. 같은 파일의 보관
    // (archiveProcedureTemplate, 최고관리자 전용)과 삭제·복원은 이 조각의 범위가
    // 아니라 역할 고정이 그대로 살아 있고, 그것이 맞다.
    const publishBody = sliceFunction(
      mutations(),
      "export async function publishProcedureTemplate",
      "export async function archiveProcedureTemplate"
    );
    assert.ok(!publishBody.includes("canManageTechnicalTemplates"), "게시 본문에 역할 고정이 남았다");
    assert.ok(
      !publishBody.includes("canActorPublishTemplateOfCategory"),
      "게시 본문의 분류별 관문이 아직 역할 고정이다"
    );
  });

  test("🔴 초안이 **보이는** 조건을 세 화면이 같은 함수로 묻는다 — 「목록엔 뜨는데 누르면 404」가 사라진 자리", () => {
    // 2026-11-27 전: 목록만 설정을 보고 상세·편집기는 역할 고정이었다. 그래서
    // 설정으로 열어 준 사람이 목록에서 제 초안을 보고 눌렀는데 notFound() 가 났다.
    assert.match(listPage(), /await mayViewEveryTechnicalTemplateStatus\(actingUser\)/);
    for (const file of ["src/app/(app)/procedures/[id]/page.tsx", "src/app/(app)/procedures/[id]/edit/page.tsx"]) {
      const source = stripComments(read(file));
      assert.match(
        source,
        /mayViewEveryTemplateStatusOfCategory\(actingUser, template\.category\)/,
        `${file}: 초안 보이기 판정이 목록과 다른 것을 본다`
      );
      // 🔴 역할 고정이 **판정 자리에** 다시 들어오지 않았는가. 주석을 걷어낸 글자로 센다.
      assert.ok(
        !source.includes("canViewAllProcedureTemplateStatuses"),
        `${file}: 역할 고정 판정이 돌아왔다 — 설정으로 열어 줘도 404 가 난다`
      );
    }

    // 🔵 그 함수가 정말 두 잎을 OR 로 묻고, **분류로 먼저 가르는가**.
    const capabilities = stripComments(read("src/lib/auth/technical-procedure-capabilities.ts"));
    assert.match(capabilities, /hasPermission\(actor, "technicalProcedures\.editDraft", "WRITE"\)\) \|\|/);
    assert.match(capabilities, /hasPermission\(actor, "technicalProcedures\.create", "WRITE"\)/);
    assert.match(
      capabilities,
      /category === "TECHNICAL_TASK"\s*\?\s*mayViewEveryTechnicalTemplateStatus\(actor\)\s*:\s*actorMay\(actor, canViewAllProcedureTemplateStatuses\)/,
      "분류로 안 가르면 전체 서비스·참고용 절차의 초안까지 함께 열린다"
    );
  });

  test("🔴 조회 — route 의 **첫 관문**이 설정을 본다(2026-11-27 저녁)", () => {
    // 그전에는 역할 고정 canViewPublishedProcedureTemplates 라, 설정에서 조회를
    // 넓혀 줘도 **목록만 열리고 한 줄도 못 열었다.**
    for (const file of ["src/app/(app)/procedures/[id]/page.tsx", "src/app/(app)/procedures/[id]/edit/page.tsx"]) {
      const source = stripComments(read(file));
      assert.match(source, /await mayViewSomeTemplate\(actingUser\)/, `${file}: 거친 관문이 설정을 안 본다`);
      assert.match(
        source,
        /await mayViewTemplateOfCategory\(actingUser, template\.category\)/,
        `${file}: 분류별 관문이 없다`
      );
      // 🔴 두 route 에 역할 고정 함수를 **직접 부르는 자리가 한 곳도 없다.**
      //    `actorMay(` 가 한 번이라도 보이면 어딘가에 역할 판정이 되살아난 것이다.
      assert.ok(!source.includes("actorMay("), `${file}: 역할 고정 판정이 되살아났다`);
    }
    const capabilities = stripComments(read("src/lib/auth/technical-procedure-capabilities.ts"));
    assert.match(capabilities, /hasPermission\(actor, "technicalProcedures\.view", "READ"\)/);
  });

  test("🔴 검증 이슈 처리 — 액션의 사전 검사가 설정을 본다(2026-11-27 저녁)", () => {
    // 🔴 이 **한 줄**이 「넓혀도 안 열린다」의 전부였다 — mutation 넷은 진작부터
    //    설정을 보고 있었는데 넓어진 사람이 액션에서 먼저 걸렸다.
    const actions = stripComments(read("src/lib/server/actions/procedure-validation-resolutions.ts"));
    assert.match(actions, /await mayResolveValidationIssues\(await sessionActorWithDeveloperFlag\(session\)\)/);
    assert.ok(!actions.includes("canResolveProcedureValidationIssues"), "역할 고정 관문이 남아 있다");
    // 🔵 그 액션이 가리키는 mutation 넷이 **같은 잎·같은 수준**을 본다.
    const mutations = stripComments(read("src/lib/db/mutations/procedure-validation-resolutions.ts"));
    assert.equal(
      mutations.split('hasPermission(actor, "technicalProcedures.validation", "WRITE")').length - 1,
      4,
      "mutation 넷이 같은 잎을 보고 있어야 액션과 짝이 맞는다"
    );
  });

  test("🔴 삭제·복원 — mutation 과 화면 둘이 같은 함수를 보고, **분류 조건이 살아 있다**", () => {
    const mutations = stripComments(read("src/lib/db/mutations/procedure-templates.ts"));
    assert.match(mutations, /await mayDeleteTemplateOfCategory\(actor, template\.category\)/);
    assert.ok(!mutations.includes("canDeleteTechnicalTemplates"), "삭제 관문이 역할 고정으로 돌아갔다");

    for (const file of ["src/app/(app)/procedures/[id]/page.tsx", "src/app/(app)/procedures/[id]/edit/page.tsx"]) {
      const source = stripComments(read(file));
      assert.match(
        source,
        /await mayDeleteTemplateOfCategory\(actingUser, template\.category\)/,
        `${file}: 삭제 단추가 서버와 다른 것을 본다`
      );
      // 🔴 AND 로 다시 묶지 마라 — 묶으면 설정으로 넓힌 사람이 화면에서만 막힌다.
      assert.ok(!source.includes("canDeleteTechnicalTemplates"), `${file}: 역할 고정이 다시 들어왔다`);
    }

    // 🔴 **분류 조건을 잃지 않았다** — 설정을 보기 **전에** TECHNICAL_TASK 를 묻는다.
    //    이 줄이 사라지면 설정을 넓힌 순간 전체 서비스 절차에 삭제가 열린다.
    const capabilities = stripComments(read("src/lib/auth/technical-procedure-capabilities.ts"));
    const deleteBody = sliceFunction(
      capabilities,
      "export async function mayDeleteTemplateOfCategory",
      "export async function mayViewEveryTechnicalTemplateStatus"
    );
    assert.match(deleteBody, /if \(category !== "TECHNICAL_TASK"\) return false;/, "분류 울타리가 사라졌다");
    const gateAt = deleteBody.indexOf('if (category !== "TECHNICAL_TASK") return false;');
    const settingAt = deleteBody.indexOf("hasPermission(");
    assert.ok(gateAt >= 0 && settingAt > gateAt, "분류를 설정보다 **먼저** 물어야 한다");
  });

  test("🔴 공용 정책 함수 자체는 **한 글자도** 안 고쳤다", () => {
    // `/procedures/[id]` 는 기술 절차 전용이 아니다 — 모든 분류를 보여 주던 목록만
    // 리다이렉트로 바뀌었고 공용 상세·편집 route 는 그대로다(그 파일의 머리말).
    // 그래서 이 함수를 넓히면 사용자가 허락한 적 없는 분류까지 함께 열린다.
    const shared = stripComments(read("src/lib/auth/procedure-template-authorization.ts"));
    assert.match(
      shared,
      /export function canViewAllProcedureTemplateStatuses\(role: Role\): boolean \{\s*return role === "SUPER_ADMIN" \|\| role === "ADMIN";\s*\}/,
      "공용 조회 정책이 바뀌었다 — 전체 서비스·참고용 절차까지 움직인다"
    );
    assert.match(
      shared,
      /export function canViewPublishedProcedureTemplates\(role: Role\): boolean \{\s*return role === "SUPER_ADMIN" \|\| role === "ADMIN" \|\| role === "AS_ENGINEER";\s*\}/,
      "공용 조회 정책이 바뀌었다"
    );
    assert.match(
      shared,
      /export function canResolveProcedureValidationIssues\(role: Role\): boolean \{\s*return role === "SUPER_ADMIN";\s*\}/,
      "검증 정책이 바뀌었다 — 그 함수는 기본값을 짓는 자리라 움직이면 기본값이 움직인다"
    );
    // 🔵 표본 — 그 route 가 정말 분류를 가리지 않는가(모든 분류 목록이 리다이렉트로 바뀔 때 적어 둔 말).
    const redirectPage = read("src/app/(app)/procedures/page.tsx");
    assert.ok(
      redirectPage.includes("nor the shared /procedures/[id] detail/edit/validation routes are touched"),
      "그 route 가 공용이라는 근거 문장이 사라졌다 — 분류 분기를 다시 판단해야 한다"
    );
  });

  test("🔴 화면의 [게시] 단추가 서버와 **같은 한 함수**를 본다", () => {
    // 2026-11-27 전에는 역할 고정 둘과 AND 로 묶여 있어서, 설정으로 넓혀도
    // 화면에서만 막혔다. 다시 끼워 넣으면 여기서 걸린다.
    for (const file of ["src/app/(app)/procedures/[id]/page.tsx", "src/app/(app)/procedures/[id]/edit/page.tsx"]) {
      const source = stripComments(read(file));
      assert.match(
        source,
        /const canPublish = await mayPublishTemplateOfCategory\(actingUser, template\.category\);/,
        `${file}: 게시 단추가 서버와 다른 것을 본다`
      );
      assert.ok(!source.includes("canActorPublishTemplateOfCategory"), `${file}: 역할 고정이 다시 들어왔다`);
      assert.ok(!source.includes("canManageTechnicalTemplates"), `${file}: 역할 고정이 다시 들어왔다`);
    }
  });
});

describe("⑥ 🔴 화면이 사실대로 말한다 — 메뉴 **전체**가 「설정이 최종 판정」이다", () => {
  /**
   * 🔴 2026-11-27 저녁 — 사용자가 **운영 화면**을 가져와 물었다. 운영에는 이 메뉴에
   * 「이 메뉴는 설정이 최종 판정이라, 넓히면 실제로 그 조작이 열립니다」라고 적혀
   * 있는데 **그 약속이 지켜지지 않고 있었다**(잎 여섯 중 다섯이 반쪽이었다).
   * 문구를 바꾸는 대신 약속을 참으로 만드는 쪽으로 갔고, 이 절이 그 결과를 지킨다.
   */
  test("잎 여섯이 **모두** 참", () => {
    for (const leafKey of [
      "technicalProcedures.view",
      CREATE,
      EDIT_DRAFT,
      PUBLISH,
      "technicalProcedures.validation",
      "technicalProcedures.lifecycle",
    ]) {
      assert.equal(isSettingsEnforced(leafKey), true, `${leafKey}: 넓혀도 안 열린다고 화면이 말하게 된다`);
    }
  });

  test("🔴 메뉴 키 하나로 말한다 — 잎 목록에는 적지 않는다", () => {
    assert.equal(isSettingsEnforced("technicalProcedures"), true, "메뉴가 아직 전환 중으로 보인다");
    // 🔵 잎이 아닌 키와 잎이 같은 물음에 각자 답하면 두 답이 갈릴 자리가 생긴다.
    //    메뉴 쪽에 적었으면 잎 목록에는 한 줄도 없어야 한다.
    const features = stripComments(read("src/lib/auth/permission-features.ts"));
    const leafListStart = features.indexOf("const SETTINGS_ENFORCED_LEAVES");
    assert.ok(leafListStart > 0, "잎 목록을 찾지 못했다");
    const leafList = features.slice(leafListStart, features.indexOf("]);", leafListStart));
    assert.ok(!leafList.includes("technicalProcedures."), "메뉴와 잎에 두 번 적혔다");
  });

  test("🔵 표본 — 이 집합이 정말 무언가를 가른다(전부 참을 돌려주지 않는다)", () => {
    // '전체 A/S 현황'은 지금도 전환 중이다(repairCases.edit 이 코드 판정).
    assert.equal(isSettingsEnforced("repairCases"), false, "집합이 아무것도 안 가른다");
  });

  test("🔵 표본 — 이 메뉴의 잎이 여섯이고 차례가 만들기 → 고치기 → 발행이다", () => {
    assert.deepEqual(
      featuresOfArea("technicalProcedures").map((feature) => feature.key),
      [
        "technicalProcedures.view",
        CREATE,
        EDIT_DRAFT,
        PUBLISH,
        "technicalProcedures.validation",
        "technicalProcedures.lifecycle",
      ]
    );
  });
});
