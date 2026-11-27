import "server-only";

import type { ProcedureTemplateCategory } from "@/lib/domain/procedure-template-types";
import { hasPermission, type PermissionActor } from "./permission-resolver";
import { actorMay } from "./developer-promotion";
import {
  canEditProcedureTemplateDraft,
  canPublishProcedureTemplates,
  canCreateProcedureTemplateDraft,
  canViewAllProcedureTemplateStatuses,
  canViewPublishedProcedureTemplates,
} from "./procedure-template-authorization";

/**
 * ============================================================================
 * 절차 템플릿 권한 — 카테고리에 따라 다른 정책으로 갈린다
 * ============================================================================
 * 이 영역에는 4단계 사다리로 표현되지 않는 차원이 하나 더 있다: 템플릿의
 * **카테고리**다. TECHNICAL_TASK는 '기술 작업 절차' 메뉴의 소관이지만,
 * FULL_SERVICE와 REFERENCE는 애초에 다른 정책 파일(procedure-template-
 * authorization.ts)이 지배한다. 같은 "편집" 조작인데 어느 정책을 따를지가
 * 카테고리로 갈리는 것이다.
 *
 * 그래서 이 영역의 전환은 **TECHNICAL_TASK 가지만** 설정으로 옮긴다. 나머지
 * 가지를 함께 옮기면 '기술 작업 절차' 노드가 자기 메뉴가 아닌 템플릿까지
 * 지배하게 되고, 관리자는 기술 절차를 열어 준 줄 알았는데 전체 서비스 절차가
 * 함께 열리는 일이 생긴다.
 *
 * 분기 규칙을 여기 한 번만 적는 이유도 같다 — 호출부마다 삼항 연산자를
 * 되풀이하면 한 곳만 고쳐지는 날이 오고, 권한에서 그런 어긋남은 조용히 뚫리는
 * 쪽으로 기운다.
 *
 * ── 개발자 승격 ─────────────────────────────────────────────────────────
 * TECHNICAL_TASK 가지는 hasPermission 이 승격을 이미 처리한다(해석기가 더한다).
 * 나머지 가지는 역할 고정 함수를 부르므로 여기서 actorMay 로 더한다 — 두 가지가
 * 서로 다르게 승격되면 「기술 절차는 되는데 전체 서비스 절차는 안 되는」
 * 개발자가 만들어진다.
 * ============================================================================
 */

/**
 * 새 기술 작업 절차를 만들 수 있는가 (2026-11-27).
 *
 * 카테고리 인자가 없다. 만들기는 **만들어질 행의 분류가 이미 정해져 있는**
 * 조작이라서다 — createManualTechnicalProcedureTemplate 이 category 를
 * "TECHNICAL_TASK" 로 **박아서** 넣는다(호출부가 넘기는 값이 아니다). 다른
 * 분류의 템플릿을 만드는 길은 Excel 들여오기 하나뿐이고 그것은 별도 정책
 * (canImportProcedureTemplates, 최고관리자 전용)이 지배한다.
 *
 * 그래서 여기에 분류 분기를 두면 **영영 안 타는 가지**가 된다 — 이 파일 머리말의
 * 「분기 규칙을 여기 한 번만 적는다」와 같은 까닭으로, 없는 분기를 흉내 내지 않는다.
 */
export async function mayCreateTechnicalTemplate(actor: PermissionActor): Promise<boolean> {
  return hasPermission(actor, "technicalProcedures.create", "WRITE");
}

/**
 * ============================================================================
 * 🔴 절차를 **볼 수 있는가** — route 의 첫 관문 (2026-11-27, 마무리 조각)
 * ============================================================================
 * 운영 화면이 이 메뉴에 대고 「설정이 최종 판정이라, 넓히면 실제로 그 조작이
 * 열립니다」라고 적고 있었는데, 조회만은 그 말이 거짓이었다 — 목록은 설정을
 * 보는데 상세·편집기 route 의 첫 관문이 역할 고정(canViewPublishedProcedureTemplates)
 * 이라, 설정에서 조회를 넓혀 줘도 **목록만 열리고 한 줄도 못 열었다.**
 *
 * 🔴 **공용 함수는 한 글자도 안 고친다.** 그 함수는 분류를 가리지 않는
 * procedure-template-authorization.ts 의 정책이고, `/procedures/[id]` 에는
 * FULL_SERVICE·REFERENCE 행도 주소로 들어온다(아래 mayViewEveryTemplateStatusOfCategory
 * 의 주석에 그 근거). 넓히면 허락받지 않은 분류까지 함께 열린다.
 *
 * 🔵 **거친 것과 잘은 것을 나눈 까닭.** route 의 첫 관문은 템플릿 행을 읽기 **전**에
 * 돈다(없는 id 로 찔러 보는 사람에게 행의 존재가 안 새어 나가게). 그 자리에서는
 * 분류를 모르므로 「둘 중 하나라도 가능성이 있으면 통과」여야 하고, 행을 읽은
 * 뒤에 분류별 관문이 다시 본다 — 이 파일의 다른 짝들과 같은 모양이다.
 * ============================================================================
 */
export async function mayViewSomeTemplate(actor: PermissionActor): Promise<boolean> {
  return (
    (await hasPermission(actor, "technicalProcedures.view", "READ")) ||
    actorMay(actor, canViewPublishedProcedureTemplates)
  );
}

/** 이 분류의 절차를 볼 수 있는가. TECHNICAL_TASK만 설정이 판정한다. */
export async function mayViewTemplateOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(actor, "technicalProcedures.view", "READ")
    : actorMay(actor, canViewPublishedProcedureTemplates);
}

/**
 * 검증에서 걸린 항목을 **처리할 수 있는가** (해소 · 보류 · 되돌리기 · 다시 열기).
 *
 * 🔴 **분류 인자가 없다.** 흉내 내지 않은 것이 아니라, 이 통로의 mutation 넷이
 * 처음부터 분류를 안 가르기 때문이다(mutations/procedure-validation-resolutions.ts
 * 의 네 자리가 `technicalProcedures.validation` 하나만 본다). 여기에만 분류를
 * 더하면 **액션이 mutation 보다 좁아져** 거기서 걸린 사람은 진짜 관문에 닿지도
 * 못한 채 FORBIDDEN 을 받는다 — 이 파일이 피하려는 바로 그 모양이다.
 *
 * 🔵 수준이 WRITE 인 까닭: 이 관문을 쓰는 액션 넷이 전부 **쓰는** 조작이다
 * (연결선 잇기 · 그래프 변경 없이 해소/보류 · 되돌리기 · 다시 열기). 보기만 하는
 * 길은 페이지 쪽이 `…"validation", "READ"` 로 따로 본다.
 */
export async function mayResolveValidationIssues(actor: PermissionActor): Promise<boolean> {
  return hasPermission(actor, "technicalProcedures.validation", "WRITE");
}

/**
 * 이 절차를 지우거나 되살릴 수 있는가 (휴지통 · 복원 · 완전삭제).
 *
 * 🔴 **분류 조건을 잃으면 안 된다.** 종전 canDeleteTechnicalTemplates 가
 * `category === "TECHNICAL_TASK" && …` 였고, 그 분류 조건은 「나중에 누가 역할만
 * 넓혀도 전체 서비스 절차에는 삭제가 열리지 않는다」는 울타리다(그 함수의 주석).
 * 설정으로 옮기면서도 **분류가 먼저**다 — 설정을 아무리 넓혀도 전체 서비스·참고용
 * 절차는 열리지 않는다. 위 mayManageTemplateGraph 와 글자 그대로 같은 모양이다.
 */
export async function mayDeleteTemplateOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  if (category !== "TECHNICAL_TASK") return false;
  return hasPermission(actor, "technicalProcedures.lifecycle", "MANAGE");
}

/**
 * ============================================================================
 * 🔴 초안·만료본까지 **보이는가** (2026-11-27, ㄱ안)
 * ============================================================================
 * 「만들 수는 있는데 만든 것을 한 번도 열 수 없다」를 없애는 자리다. 그 전까지
 * 목록·상세·편집기 route 가 **서로 다른 것**을 보고 있었다:
 *   · 목록(/procedures/technical) — 설정(초안 편집)
 *   · 상세(/procedures/[id]) · 편집기(/edit) — 역할 고정 canViewAllProcedureTemplateStatuses
 * 그래서 목록에는 뜨는데 누르면 notFound() 가 되는 줄이 생겼다. 세 자리가 같은
 * 식을 보게 하는 것이 이 함수의 존재 이유다.
 *
 * 🔴 **「초안 편집 **또는** 만들기」인 까닭.** 둘은 기본값이 같지만 설정으로 따로
 * 움직일 수 있다. 만들기만 켜 준 역할에게 목록이 게시본만 보이면 방금 만든 초안이
 * 눈앞에서 사라지고, 고치기만 켜 준 역할은 고칠 대상을 못 본다 — 어느 쪽이든
 * 「아무 일도 안 일어난 것처럼 보이는」 화면이다.
 *
 * 🔵 **보이기만 한다.** 고치기·발행·삭제는 각자의 잎이 따로 판정하므로, 이 함수가
 * 참이어도 할 수 있는 일이 늘지는 않는다 — 조회 범위만 넓힌다.
 * ============================================================================
 */
export async function mayViewEveryTechnicalTemplateStatus(actor: PermissionActor): Promise<boolean> {
  return (
    (await hasPermission(actor, "technicalProcedures.editDraft", "WRITE")) ||
    (await hasPermission(actor, "technicalProcedures.create", "WRITE"))
  );
}

/**
 * 분류까지 보고 같은 물음에 답한다 — `/procedures/[id]` 와 `/edit` 이 쓴다.
 *
 * 🔴 **그 두 route 는 기술 절차 전용이 아니다**(2026-11-27 실측). 모든 분류를
 * 한 줄로 보여 주던 목록 `/procedures` 는 `/procedures/technical` 로 **리다이렉트만**
 * 하도록 바뀌었지만, 그때 「공용 `/procedures/[id]` 상세·편집·검증 route 는 건드리지
 * 않는다」고 분명히 적어 두었다(그 파일의 머리말) — 즉 FULL_SERVICE·REFERENCE 행은
 * 주소를 직접 치면 **지금도 그 route 로 들어온다.**
 *
 * 🔴 그래서 `canViewAllProcedureTemplateStatuses` **자체는 한 글자도 안 고쳤다.**
 * 그 함수는 분류를 가리지 않는 공용 정책(procedure-template-authorization.ts)이라,
 * 넓히면 기술 절차를 열어 주려다 전체 서비스·참고용 절차의 초안까지 함께 열린다 —
 * 사용자가 허락한 적 없는 변화다. 분류로 먼저 가르고, 기술 가지에서만 설정을 본다.
 */
export async function mayViewEveryTemplateStatusOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? mayViewEveryTechnicalTemplateStatus(actor)
    : actorMay(actor, canViewAllProcedureTemplateStatuses);
}

/** 이 템플릿을 편집할 수 있는가. TECHNICAL_TASK만 설정이 판정한다. */
export async function mayEditTemplateOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(actor, "technicalProcedures.editDraft", "WRITE")
    : actorMay(actor, canEditProcedureTemplateDraft);
}

/** 이 템플릿을 발행할 수 있는가. */
export async function mayPublishTemplateOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(actor, "technicalProcedures.publish", "MANAGE")
    : actorMay(actor, canPublishProcedureTemplates);
}

/**
 * 분류를 알기 전 단계의 게시 문지기 — 게시 통로 진입 자체를 거른다 (2026-11-27).
 *
 * 🔴 **둘을 OR 로 묶는 까닭**: 이 자리는 템플릿 행을 읽기 전이라 분류를 모른다.
 * 그런데 분류에 따라 **지배하는 정책 자체가 다르다**(위 mayPublishTemplateOfCategory).
 * 한쪽만 보면 반대쪽 분류가 통째로 막힌다 — 설정에서 기술 절차 게시를 좁혔더니
 * 최고관리자가 **전체 서비스 절차까지** 못 올리게 되는 식이다. 거친 관문은 「둘 중
 * 하나라도 가능성이 있으면 통과」여야 하고, 진짜 판정은 행을 읽은 뒤 분류별 관문이 한다.
 *
 * 종전 관문(canManageTechnicalTemplates = 최고관리자·관리자)이 최고관리자 전용인
 * canPublishProcedureTemplates 를 이미 품고 있어서 한 함수로 족했는데, 기술 쪽이
 * 설정으로 넘어가면서 더 이상 품지 못한다 — 그래서 둘을 나란히 적는다.
 */
export async function mayPublishSomeTemplate(actor: PermissionActor): Promise<boolean> {
  return (
    (await hasPermission(actor, "technicalProcedures.publish", "MANAGE")) ||
    actorMay(actor, canPublishProcedureTemplates)
  );
}

/** 이 템플릿의 새 초안 버전을 만들 수 있는가. */
export async function mayCreateDraftVersionOfCategory(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  return category === "TECHNICAL_TASK"
    ? hasPermission(actor, "technicalProcedures.editDraft", "WRITE")
    : actorMay(actor, canCreateProcedureTemplateDraft);
}

/**
 * 분류를 알기 전 단계의 「새 초안 버전」 문지기 (2026-11-27).
 *
 * 위 mayPublishSomeTemplate 과 같은 모양·같은 까닭이다 — 거친 관문이 분류별 관문의
 * **두 가지 중 어느 쪽보다도 좁으면 안 된다.** 좁으면 거기서 걸린 사람은 분류별
 * 관문에 닿지도 못한 채 FORBIDDEN 을 받고, 그 까닭은 어느 화면에도 안 남는다.
 */
export async function mayCreateSomeDraftVersion(actor: PermissionActor): Promise<boolean> {
  return (
    (await hasPermission(actor, "technicalProcedures.editDraft", "WRITE")) ||
    actorMay(actor, canCreateProcedureTemplateDraft)
  );
}

/**
 * 노드·연결선의 구조 편집(생성·삭제)을 할 수 있는가.
 *
 * 원래부터 TECHNICAL_TASK 전용이다 — FULL_SERVICE/REFERENCE에는 어느 역할에도
 * 열어 주지 않는 것이 이 기능의 요구사항이었고(technical-procedure-template-
 * authorization.ts의 canActorManageTechnicalTemplateGraph 주석), 설정으로
 * 옮기면서도 그 성질은 그대로 둔다. 카테고리 조건이 먼저이고 설정은 그다음이다.
 */
export async function mayManageTemplateGraph(
  actor: PermissionActor,
  category: ProcedureTemplateCategory
): Promise<boolean> {
  if (category !== "TECHNICAL_TASK") return false;
  return hasPermission(actor, "technicalProcedures.editDraft", "WRITE");
}

/**
 * 카테고리를 알기 전 단계의 문지기 — 편집기 진입 자체를 거른다.
 *
 * 템플릿 행을 읽기 전이라 카테고리를 모르므로, 여기서는 '기술 작업 절차'의
 * 초안 편집 권한만 본다. 카테고리별 정밀 판정은 행을 읽은 뒤 위의 함수들이
 * 다시 한다 — 종전 구조(canManageTechnicalTemplates로 먼저 거르고
 * assertEditableDraft가 다시 보는 것)와 같은 두 겹이다.
 */
export async function mayEnterTemplateEditor(actor: PermissionActor): Promise<boolean> {
  return hasPermission(actor, "technicalProcedures.editDraft", "WRITE");
}
