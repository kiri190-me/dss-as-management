"use server";

import { readSession } from "@/lib/auth/session";
import { sessionActorWithDeveloperFlag } from "@/lib/auth/acting-user";
import { actorMay } from "@/lib/auth/developer-promotion";
import { getAuthSource } from "@/lib/config/auth-source";
import { canEditProcedureTemplateDraft } from "@/lib/auth/procedure-template-authorization";
import { canEditTechnicalTemplateDraft, canManageTechnicalTemplates } from "@/lib/auth/technical-procedure-template-authorization";
import {
  updateProcedureTemplateNode,
  changeProcedureTemplateNodeType,
  saveProcedureTemplateLayout,
  updateProcedureTemplateEdge,
  retargetProcedureTemplateEdge,
  createProcedureTemplateEdge,
  validateProcedureTemplate,
  createProcedureTemplateNode,
  deleteProcedureTemplateNode,
  deleteProcedureTemplateEdge,
  insertProcedureTemplateNodeOnEdge,
  adoptFieldAddedStep,
  type AdoptFieldStepResult,
  type UpdateNodePatch,
  type UpdateEdgePatch,
  type LayoutPosition,
  type EdgeRouteInput,
  type NodeMutationResult,
  type ChangeNodeTypeResult,
  type SaveLayoutResult,
  type EdgeMutationResult,
  type RetargetEdgeResult,
  type CreateEdgeResult,
  type ValidateTemplateResult,
  type CreateNodeResult,
  type DeleteNodeResult,
  type DeleteEdgeResult,
  type InsertNodeOnEdgeResult,
} from "@/lib/db/mutations/procedure-template-editor";
import { isValidUuid, validateOptionalNote } from "@/lib/validation/procedure-validation-resolution-input";
// 🔴 노드가 가리킬 파일 경로의 검사는 **진단 Flowchart 와 같은 한 벌**이다(두 표의 DB
//    CHECK 식이 글자까지 같다 — 마이그레이션 0132). 베끼지 않는다.
import { validateNodeShareDocRelativePath } from "@/lib/validation/flowchart-node-share-doc-path";
// 🔴 「그 자리에 실제로 있는가」를 묻는 길도 **이미 있는 한 벌**이다 — 제품 모델 가리킴 ·
//    진단 Flowchart 가 쓰는 그 모듈 그대로다(깊이 · 기다리기 상한과 거르는 규칙이 거기
//    한 곳에 있다).
import { resolveRepairDocsArchiveRoot } from "@/lib/storage/repair-docs-archive";
import { findRepairDocsEntry } from "@/lib/storage/repair-docs-entries";
import {
  PROCEDURE_BRANCH_TYPE_CODES,
  PROCEDURE_NODE_TYPE_CODES,
  MANUAL_TECHNICAL_NODE_TYPE_CODES,
  type ProcedureBranchType,
  type ProcedureNodeType,
  type ManualTechnicalNodeType,
} from "@/lib/domain/procedure-template-types";
import { isValidRoutePoint } from "@/lib/graph-editor-core/routing";

/**
 * Server Actions for the Phase 4A controlled editor — same layering as
 * procedure-validation-resolutions.ts's actions: resolve the session,
 * short-circuit on the obviously-unauthorized case (a UX speed-up only —
 * every mutation in procedure-template-editor.ts re-checks the actor
 * against the live DB regardless of what happens here), validate input
 * shape, delegate, redact unexpected DB errors.
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

/**
 * 공유폴더 쪽 거절(설정 없음 · 못 읽음 · 그 자리에 없음 · 폴더였음) — 🔴 글자 모양이
 * 틀린 것과 **코드를 가른다.** 둘 다 「저장 실패」 한 줄로 보이지만, 이쪽은 **사람이
 * 적은 값이 아니라 그 서버의 형편**이라 다음에 볼 곳이 다르다(진단 Flowchart 쪽 액션이
 * 같은 이름의 코드를 쓴다 — 두 화면의 실패가 같은 말로 읽혀야 한다).
 */
type ShareFolderUnavailable = { ok: false; code: "SHARE_FOLDER_UNAVAILABLE"; message: string };

function shareFolderError(message: string): ShareFolderUnavailable {
  return { ok: false, code: "SHARE_FOLDER_UNAVAILABLE", message };
}

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  // Phase 5C-5B — this fast pre-check is a UX short-circuit only, run
  // before any template row (and therefore its category) is known; it must
  // admit anyone who could possibly be authorized for EITHER category
  // (FULL_SERVICE's existing SUPER_ADMIN-only function OR TECHNICAL_TASK's
  // ADMIN+SUPER_ADMIN function). The mutation layer's category-aware check
  // (procedure-template-editor.ts's assertEditableDraft /
  // validateProcedureTemplate) remains the sole authoritative boundary.
  const actor = await sessionActorWithDeveloperFlag(session);
  if (!actorMay(actor, canEditProcedureTemplateDraft) && !actorMay(actor, canEditTechnicalTemplateDraft)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "편집 권한이 없습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

async function withErrorRedaction<T extends { ok: boolean }>(label: string, run: () => Promise<T>): Promise<T | Forbidden> {
  try {
    return await run();
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error(`${label}: unexpected DB error`, { code });
    return { ok: false, code: "FORBIDDEN", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

/**
 * ============================================================================
 * 🔴 노드가 가리키는 **공유폴더 속 파일**도 이 액션이 받는다 (2026-11-25, 조각 E2)
 * ============================================================================
 * 칸 하나가 늘었을 뿐 통로는 그대로다 — 화면의 [저장]이 NODE_FIELDS 한 걸음에 제목 ·
 * 설명 · 작업 지시 요약 · 정렬 · 활성 · 다음 절차와 **함께** 싣는다.
 *
 * ── 🔴 담기 전에 **그 자리에 실제로 있는지** 본다 ─────────────────────────
 * 진단 Flowchart 쪽 액션(server/actions/repair-case-flowchart-graph.ts)이 세운 차례를
 * 글자 그대로 따른다: ① 글자 규칙 + 열 수 있는 확장자(validateNodeShareDocRelativePath
 * → 두 화면이 함께 쓰는 검사) → ② 공유폴더 루트 → ③ 그 자리에 **파일이** 서 있는가
 * (findRepairDocsEntry). 🔴 ③에서 폴더가 서 있으면 거절한다 — 이 칸에는 「파일인가
 * 폴더인가」를 담을 자리가 없어(노드 표에 경로 한 칸뿐이다) 나중에 **무엇으로 열지**를
 * 가를 수 없다.
 *
 * ── 🔴 설정이 비어 있으면 **멈춘다**(읽기와 일부러 다르다) ─────────────────
 * 고르기 창이 읽는 통로(api/procedure-templates/[id]/share-folder/entries)는
 * `REPAIR_DOCS_ARCHIVE_DIR` 가 비면 `{status:"disabled"}` 로 **조용히 꺼진다**. 쓰는
 * 쪽은 반대로 **거절한다** — 가리킴은 「확인된 자리」라는 약속이고, 확인할 수 없을 때
 * 그냥 담으면 아무도 본 적 없는 경로가 표에 남는다.
 * 🔴 **값으로 치르는 값이 있다**: 그 노드가 **이미 가리키고 있는 채로** 제목만 고치는
 * 저장도 이 검사를 지난다(화면은 칸 여섯을 늘 한 묶음으로 보낸다). 그래서 설정이
 * 빠졌거나 공유폴더를 못 읽는 서버에서는 **가리킨 노드의 칸 수정이 통째로 막힌다.**
 * 진단 쪽이 2026-11-25 에 그 값을 알고도 **막히는 쪽**을 골랐고(운영에서 공유폴더와 DB 가
 * 같은 NAS 에 있어 「DB 는 되는데 폴더만 못 읽는」 상태가 드물다고 보았다), 여기서 반대로
 * 고르면 같은 기능이 두 화면에서 다르게 움직인다. 🔵 **지우는 쪽(null)은 이 검사를 한
 * 줄도 안 지난다** — 설정이 빠진 서버에서도 가리킴을 **풀 수는** 있다.
 * 🔵 칸을 **안 실으면**(undefined) 검사도 안 지난다 — 이 patch 를 쓰는 다른 호출부가
 * 생기더라도 그쪽은 이 비용을 치르지 않는다.
 *
 * ── 🔴 거절 사유에 경로가 한 글자도 안 들어간다 ───────────────────────────
 * 이 서류함의 폴더 이름에는 고객사명이 섞여 있다. 아래 문장은 전부 붙박이이고, 저장소
 * 모듈이 만드는 실패 사유(`found.reason`)도 경로 없는 짧은 문장임이 그쪽에서 못 박혀 있다.
 *
 * ── 🔴 **게시된 절차에는 못 담는다** ──────────────────────────────────────
 * 여기서 따로 막지 않는다 — mutation 의 assertEditableDraft 가 `status !== "DRAFT"` 를
 * NOT_DRAFT 로 거절한다(이 모듈의 다른 칸들과 똑같은 관문이다). 🔴 그 울타리를 이 칸
 * 때문에 느슨하게 하지 않는다: 사람은 새 초안 → 담기 → 재게시로 쓴다.
 * ============================================================================
 */
export async function updateProcedureTemplateNodeAction(input: {
  nodeId: string;
  patch: UpdateNodePatch;
  expectedTemplateUpdatedAt: string;
  reason?: string | null;
}): Promise<NodeMutationResult | Forbidden | ShareFolderUnavailable> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  // 🔴 「다음 절차」는 id 아니면 null 이다(줄기 B ④ 조각 ②). 모양을 여기서 먼저
  //    본다 — 안 보면 빈 글자나 쓰레기 값이 FK 까지 가서 DB 오류로 터지고,
  //    사람에게는 뜻을 알 수 없는 글이 뜬다.
  if (
    input.patch.nextProcedureTemplateId !== undefined &&
    input.patch.nextProcedureTemplateId !== null &&
    !isValidUuid(input.patch.nextProcedureTemplateId)
  ) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  // ── ① 글자 규칙 · 열 수 있는 확장자 — 디스크를 보기 전이다 ──────────────
  //    🔴 거절 문장은 **그대로 사람에게 간다**(FORBIDDEN 의 뭉뚱그린 말이 아니다) —
  //       「400자를 넘었다」 · 「앞뒤 공백」처럼 고칠 수 있는 까닭이기 때문이다.
  const shareDocValidation = validateNodeShareDocRelativePath(input.patch.shareDocRelativePath);
  if (!shareDocValidation.ok) return { ok: false, code: "INVALID_INPUT", message: shareDocValidation.error };

  // ── ②③ 그 자리에 **파일이** 실제로 있는가 — 가리킬 때만 묻는다 ──────────
  //    🔵 `null` 은 여기서 둘을 함께 뜻한다: **칸을 안 실었거나**(undefined) **가리킴을
  //       지우거나**(null). 어느 쪽이든 디스크를 볼 일이 없어 한 갈래로 둔다.
  //    🔴 아래로 내려보내는 patch 는 **`input.patch` 그대로**다(여기서 만든 값이 아니다) —
  //       안 실은 칸이 null 로 바뀌어 내려가면 그 노드의 가리킴이 조용히 지워진다.
  const shareDocRelativePath = shareDocValidation.shareDocRelativePath;
  if (shareDocRelativePath !== null) {
    const archiveRoot = resolveRepairDocsArchiveRoot();
    if (archiveRoot === null) {
      // 🔴 읽기는 조용히 꺼지지만 쓰기는 멈춘다 — 머리말 참조.
      return shareFolderError("공유폴더 위치가 설정되지 않아 자리를 확인할 수 없습니다(관리자에게 알려 주세요).");
    }
    const found = await findRepairDocsEntry({ root: archiveRoot, relativePath: shareDocRelativePath });
    if (found.status === "failed") {
      // 사유는 저장소 모듈이 만든 **경로 없는** 짧은 문장이다.
      return shareFolderError(found.reason);
    }
    if (found.status === "not-found") {
      return shareFolderError("공유폴더에서 그 파일을 찾을 수 없습니다.");
    }
    if (found.isDirectory) {
      return shareFolderError("그 자리에 있는 것은 폴더입니다 — 파일을 고르세요.");
    }
  }

  return withErrorRedaction("updateProcedureTemplateNodeAction", () =>
    updateProcedureTemplateNode(input.nodeId, actorCheck.userId, input.patch, input.expectedTemplateUpdatedAt, input.reason?.trim() || null)
  );
}

export async function changeProcedureTemplateNodeTypeAction(input: {
  nodeId: string;
  newNodeType: ProcedureNodeType;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<ChangeNodeTypeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(PROCEDURE_NODE_TYPE_CODES as readonly string[]).includes(input.newNodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  // Phase 5C-5B usability — a reason is optional here at the fast-check
  // layer for BOTH categories; the mutation itself is what enforces
  // "mandatory unless TECHNICAL_TASK" once the template's category is
  // known, so this layer must never reject a blank reason on FULL_SERVICE's
  // behalf pre-emptively either — that would just surface as a confusing
  // generic FORBIDDEN instead of the mutation's own precise INVALID_INPUT.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("changeProcedureTemplateNodeTypeAction", () =>
    changeProcedureTemplateNodeType(input.nodeId, actorCheck.userId, input.newNodeType, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

/** Phase 4B — combined save (node positions + manual edge routes) behind the editor's single "저장" button. Route-point shape gets a shallow sanity check here (every array entry looks like a route point); the mutation layer's sanitizeRoutePoints is still the authoritative, unconditional gate. */
export async function saveProcedureTemplateLayoutAction(input: {
  templateId: string;
  positions: LayoutPosition[];
  edgeRoutes: EdgeRouteInput[];
  expectedTemplateUpdatedAt: string;
  reason?: string | null;
}): Promise<SaveLayoutResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || input.positions.some((p) => !isValidUuid(p.nodeId))) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (input.edgeRoutes.some((er) => !isValidUuid(er.edgeId) || (er.points !== null && !er.points.every(isValidRoutePoint)))) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("saveProcedureTemplateLayoutAction", () =>
    saveProcedureTemplateLayout(input.templateId, actorCheck.userId, input.positions, input.edgeRoutes, input.expectedTemplateUpdatedAt, input.reason?.trim() || null)
  );
}

export async function updateProcedureTemplateEdgeAction(input: {
  edgeId: string;
  patch: UpdateEdgePatch;
  expectedTemplateUpdatedAt: string;
  note?: string | null;
}): Promise<EdgeMutationResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (input.patch.branchType && !(PROCEDURE_BRANCH_TYPE_CODES as readonly string[]).includes(input.patch.branchType)) {
    return { ok: false, code: "FORBIDDEN", message: "분기 유형을 확인할 수 없습니다." };
  }

  return withErrorRedaction("updateProcedureTemplateEdgeAction", () =>
    updateProcedureTemplateEdge(input.edgeId, actorCheck.userId, input.patch, input.expectedTemplateUpdatedAt, input.note?.trim() || null)
  );
}

export async function retargetProcedureTemplateEdgeAction(input: {
  edgeId: string;
  newFromNodeId: string;
  newToNodeId: string;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<RetargetEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId) || !isValidUuid(input.newFromNodeId) || !isValidUuid(input.newToNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  // Phase 5C-5B usability — see changeProcedureTemplateNodeTypeAction's own note.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("retargetProcedureTemplateEdgeAction", () =>
    retargetProcedureTemplateEdge(input.edgeId, actorCheck.userId, input.newFromNodeId, input.newToNodeId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function createProcedureTemplateEdgeAction(input: {
  templateId: string;
  fromNodeId: string;
  toNodeId: string;
  branchType: ProcedureBranchType;
  branchLabel?: string | null;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<CreateEdgeResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || !isValidUuid(input.fromNodeId) || !isValidUuid(input.toNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }
  if (!(PROCEDURE_BRANCH_TYPE_CODES as readonly string[]).includes(input.branchType)) {
    return { ok: false, code: "FORBIDDEN", message: "분기 유형을 확인할 수 없습니다." };
  }
  // Phase 5C-5B usability — see changeProcedureTemplateNodeTypeAction's own note.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("createProcedureTemplateEdgeAction", () =>
    createProcedureTemplateEdge(
      input.templateId,
      actorCheck.userId,
      { fromNodeId: input.fromNodeId, toNodeId: input.toNodeId, branchType: input.branchType, branchLabel: input.branchLabel?.trim() || null, reason: reasonValidation.note },
      input.expectedTemplateUpdatedAt
    )
  );
}

export async function validateProcedureTemplateAction(input: { templateId: string }): Promise<ValidateTemplateResult | Forbidden> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };

  return withErrorRedaction("validateProcedureTemplateAction", () => validateProcedureTemplate(input.templateId, actorCheck.userId));
}

/**
 * Phase 5C-5B-1 — fast pre-check for the NEW node/edge structural-CRUD
 * actions below. Deliberately separate from resolveAuthorizedActorId
 * (which admits either category's property-edit policy): the new
 * capability is TECHNICAL_TASK-only for every role, so
 * canManageTechnicalTemplates is the correct (and only) coarse gate here.
 * The mutation layer's assertTechnicalGraphEditable/
 * canActorManageTechnicalTemplateGraph remains the sole authoritative
 * boundary — this is a UX short-circuit only.
 *
 * Exported for reuse by procedure-template-undo-redo.ts and
 * procedure-template-restore.ts's own actions (Phase 5C-5C) — Undo/Redo/
 * Restore share this exact TECHNICAL_TASK-only gate, never a looser copy.
 */
export async function resolveTechnicalGraphActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  if (!actorMay(await sessionActorWithDeveloperFlag(session), canManageTechnicalTemplates)) {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "권한이 없습니다." } };
  }
  return { ok: true, userId: session.userId };
}

export async function createProcedureTemplateNodeAction(input: {
  templateId: string;
  nodeType: ManualTechnicalNodeType;
  title: string;
  /** Phase 5C-5B usability — "directly below the selected node, center-aligned", computed client-side (see CreateNodePanel). Omitted when no node is selected — the mutation then falls back to its own default stacking. */
  position?: { x: number; y: number } | null;
  expectedTemplateUpdatedAt: string;
}): Promise<CreateNodeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  if (input.position && (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y))) {
    return { ok: false, code: "FORBIDDEN", message: "노드 위치를 확인할 수 없습니다." };
  }

  return withErrorRedaction("createProcedureTemplateNodeAction", () =>
    createProcedureTemplateNode(input.templateId, actorCheck.userId, { nodeType: input.nodeType, title: input.title, position: input.position }, input.expectedTemplateUpdatedAt)
  );
}

export async function deleteProcedureTemplateNodeAction(input: {
  nodeId: string;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<DeleteNodeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.nodeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  // Phase 5C-5B usability — this capability is already TECHNICAL_TASK-only, so a reason is never mandatory.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("deleteProcedureTemplateNodeAction", () =>
    deleteProcedureTemplateNode(input.nodeId, actorCheck.userId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function deleteProcedureTemplateEdgeAction(input: {
  edgeId: string;
  reason?: string | null;
  expectedTemplateUpdatedAt: string;
}): Promise<DeleteEdgeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  // Phase 5C-5B usability — this capability is already TECHNICAL_TASK-only, so a reason is never mandatory.
  const reasonValidation = validateOptionalNote(input.reason);
  if (!reasonValidation.ok) return { ok: false, code: "FORBIDDEN", message: reasonValidation.error };

  return withErrorRedaction("deleteProcedureTemplateEdgeAction", () =>
    deleteProcedureTemplateEdge(input.edgeId, actorCheck.userId, reasonValidation.note, input.expectedTemplateUpdatedAt)
  );
}

export async function insertProcedureTemplateNodeOnEdgeAction(input: {
  edgeId: string;
  nodeType: ManualTechnicalNodeType;
  title: string;
  position: { x: number; y: number };
  expectedTemplateUpdatedAt: string;
}): Promise<InsertNodeOnEdgeResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.edgeId)) return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  if (!(MANUAL_TECHNICAL_NODE_TYPE_CODES as readonly string[]).includes(input.nodeType)) {
    return { ok: false, code: "FORBIDDEN", message: "지원되지 않는 노드 유형입니다." };
  }
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)) {
    return { ok: false, code: "FORBIDDEN", message: "노드 위치를 확인할 수 없습니다." };
  }

  return withErrorRedaction("insertProcedureTemplateNodeOnEdgeAction", () =>
    insertProcedureTemplateNodeOnEdge(input.edgeId, actorCheck.userId, { nodeType: input.nodeType, title: input.title, position: input.position }, input.expectedTemplateUpdatedAt)
  );
}

/**
 * 현장에서 더한 단계 하나를 이 초안에 넣는다 (2026-11-03, 줄기 B-⑧).
 *
 * 🔴 **넘어오는 것이 id 둘과 토큰뿐**이다 — 제목도 갈래도 자리도 안 받는다.
 * 그 값들은 전부 실행 쪽 행에 적혀 있고, 뮤테이션이 제 손으로 읽는다. 화면이
 * 보낸 제목을 쓰면 「현장이 적은 것」이 아니라 「누군가 화면에서 고쳐 보낸 것」이
 * 절차에 들어간다 — 그 둘은 같아 보여도 전혀 다른 일이다.
 *
 * 🔵 관문은 노드 만들기와 **같은 것**(resolveTechnicalGraphActorId)이다. 이
 * 조작이 하는 일이 결국 「기술 절차 초안에 노드·간선을 더하는 것」이라, 다른
 * 잣대를 쓰면 「노드 추가는 되는데 현장 단계 넣기는 안 되는」(또는 그 반대의)
 * 사람이 생긴다.
 */
export async function adoptFieldAddedStepAction(input: {
  templateId: string;
  executionNodeId: string;
  expectedTemplateUpdatedAt: string;
}): Promise<AdoptFieldStepResult | Forbidden> {
  const actorCheck = await resolveTechnicalGraphActorId();
  if (!actorCheck.ok) return actorCheck.result;
  if (!isValidUuid(input.templateId) || !isValidUuid(input.executionNodeId)) {
    return { ok: false, code: "FORBIDDEN", message: "요청 정보를 확인할 수 없습니다." };
  }

  return withErrorRedaction("adoptFieldAddedStepAction", () =>
    adoptFieldAddedStep(input.templateId, actorCheck.userId, input.executionNodeId, input.expectedTemplateUpdatedAt)
  );
}
