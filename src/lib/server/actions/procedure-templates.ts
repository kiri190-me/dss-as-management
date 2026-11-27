"use server";

import { readSession } from "@/lib/auth/session";
import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
/**
 * 🔴 2026-11-27 — 이 파일의 사전 검사 넷이 역할 고정 함수에서 **설정**으로 넘어왔다.
 * 사전 검사는 판정이 아니라 **빠른 되돌림**이므로(아래 각 함수의 주석), 지켜야 할
 * 성질은 하나다: **mutation 의 관문보다 좁으면 안 된다.** 좁으면 거기서 걸린 사람은
 * 진짜 관문에 닿지도 못한 채 FORBIDDEN 을 받고, 왜 막혔는지가 어느 화면에도 안 남는다.
 * 그래서 mutation 이 부르는 **같은 함수**를 그대로 부른다.
 */
import {
  mayCreateTechnicalTemplate,
  mayCreateSomeDraftVersion,
  mayEnterTemplateEditor,
  mayPublishSomeTemplate,
} from "@/lib/auth/technical-procedure-capabilities";
import {
  createNewDraftVersion,
  createManualTechnicalProcedureTemplate,
  renameTechnicalProcedureTemplate,
  publishProcedureTemplate,
  type ProcedureTemplateResult,
  type CreateManualTechnicalTemplateInput,
  type RenameTechnicalTemplateResult,
} from "@/lib/db/mutations/procedure-templates";
import { isValidUuid } from "@/lib/validation/procedure-validation-resolution-input";
import { PROCEDURE_EQUIPMENT_TYPE_CODES } from "@/lib/domain/procedure-template-types";

/**
 * "새 DRAFT 버전 만들기" from a PUBLISHED template's edit-route landing
 * page — same session/role short-circuit pattern as every other Server
 * Action in this codebase; createNewDraftVersion re-checks the actor and
 * the template's PUBLISHED status against the live DB regardless.
 */
export async function createNewDraftVersionAction(input: { templateId: string }): Promise<ProcedureTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  // Phase 5C-5B — fast pre-check broadened to admit either category's
  // permission (FULL_SERVICE's existing function OR TECHNICAL_TASK's);
  // createNewDraftVersion's own category-aware check remains authoritative.
  // 🔵 그 "둘 중 하나" 가 mayCreateSomeDraftVersion 안에 그대로 들어 있다 —
  //    mutation 의 거친 관문과 **같은 함수**다.
  if (!(await mayCreateSomeDraftVersion(await sessionActorWithDeveloperFlag(session)))) {
    return { ok: false, code: "FORBIDDEN", message: "새 버전 작성 권한이 없습니다." };
  }
  if (!isValidUuid(input.templateId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    return await createNewDraftVersion(input.templateId, session.userId);
  } catch (err) {
    console.error("createNewDraftVersionAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * 절차 상세 화면의 [게시] — 초안(DRAFT)을 게시해 A/S 접수 건의 "기술 절차
 * 불러오기" 목록에 올린다.
 *
 * 여기의 검사는 **빠른 되돌림**일 뿐 판정이 아니다. 실제 판정은
 * publishProcedureTemplate 이 트랜잭션 안에서 다시 한다 — 거친 관문
 * (mayPublishSomeTemplate)과 분류별 관문(mayPublishTemplateOfCategory),
 * 그리고 해결되지 않은 오류·그래프 구조 오류 검사까지. 그래서 여기서는
 * mutation 의 거친 관문과 **같은 함수**만 미리 부른다. 다른 함수를 쓰면 화면과
 * 서버가 어긋나고, 그건 이 저장소가 이미 한 번 겪은 사고다(커밋 af6da9b·1a75ac7).
 *
 * 🔴 2026-11-27 — 두 관문이 설정(`technicalProcedures.publish`)으로 넘어갔다.
 * 그 전에는 역할 고정이라, 관리자가 설정에서 게시를 넓혀도 여기서 막혔다.
 *
 * mutation 의 실패 결과(FORBIDDEN / CONFLICT / HAS_UNRESOLVED_ERRORS /
 * HAS_STRUCTURAL_ERRORS)는 손대지 않고 그대로 돌려준다 — 화면이 사람에게
 * "왜 게시가 안 되는지"를 그대로 보여줄 수 있어야 한다.
 */
export async function publishProcedureTemplateAction(input: { templateId: string }): Promise<ProcedureTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await mayPublishSomeTemplate(await sessionActorWithDeveloperFlag(session)))) {
    return { ok: false, code: "FORBIDDEN", message: "게시 권한이 없습니다." };
  }
  if (!isValidUuid(input.templateId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    return await publishProcedureTemplate(input.templateId, session.userId);
  } catch (err) {
    console.error("publishProcedureTemplateAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * Phase 5C-5B-1 — manual TECHNICAL_TASK template creation. Same
 * session/role short-circuit pattern as createNewDraftVersionAction;
 * category/isReferenceOnly/status/version/sourceType are all fixed inside
 * createManualTechnicalProcedureTemplate itself — this action only forwards
 * the four caller-supplied fields (code/name/equipmentType/description),
 * never a category or any other server-authoritative value.
 *
 * 🔴 2026-11-05 — `code` 는 **화면에서 안 온다.** 만들기 창에 코드 칸이 없어져
 * `input.code` 가 undefined 로 넘어오고, mutation 이 제 손으로 짓는다. 그 자리를
 * 여기서 대신 메우지 마라 — 지은 값이 부딪혔을 때 다시 지어 재시도하는 길이
 * mutation 안에 있고, 여기서 미리 지으면 그 길이 통째로 죽는다.
 */
export async function createManualTechnicalProcedureTemplateAction(
  input: CreateManualTechnicalTemplateInput
): Promise<ProcedureTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await mayCreateTechnicalTemplate(await sessionActorWithDeveloperFlag(session)))) {
    return { ok: false, code: "FORBIDDEN", message: "기술 절차 템플릿 생성 권한이 없습니다." };
  }
  if (!(PROCEDURE_EQUIPMENT_TYPE_CODES as readonly string[]).includes(input.equipmentType)) {
    return { ok: false, code: "INVALID_INPUT", message: "지원되지 않는 장비 유형입니다." };
  }

  try {
    return await createManualTechnicalProcedureTemplate(
      { code: input.code, name: input.name, equipmentType: input.equipmentType, description: input.description },
      session.userId
    );
  } catch (err) {
    console.error("createManualTechnicalProcedureTemplateAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * Phase 5C-5B usability item 5 — rename a TECHNICAL_TASK DRAFT's name from
 * the existing editor screen. Same session/role short-circuit pattern as
 * every other action here; renameTechnicalProcedureTemplate re-checks
 * category/status/role/optimistic-concurrency against the live DB
 * regardless of what this fast pre-check allows.
 */
export async function renameTechnicalProcedureTemplateAction(input: {
  templateId: string;
  name: string;
  expectedTemplateUpdatedAt: string;
}): Promise<RenameTechnicalTemplateResult> {
  if (getAuthSource() !== "database") {
    return { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." };
  }
  if (!(await mayEnterTemplateEditor(await sessionActorWithDeveloperFlag(session)))) {
    return { ok: false, code: "FORBIDDEN", message: "이름 변경 권한이 없습니다." };
  }
  if (!isValidUuid(input.templateId)) {
    return { ok: false, code: "NOT_FOUND", message: "요청 정보를 확인할 수 없습니다." };
  }

  try {
    return await renameTechnicalProcedureTemplate(
      input.templateId,
      session.userId,
      input.name,
      input.expectedTemplateUpdatedAt
    );
  } catch (err) {
    console.error("renameTechnicalProcedureTemplateAction: unexpected DB error", err);
    return { ok: false, code: "CONFLICT", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
