"use server";

import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  createRepairCaseFlowchart,
  updateRepairCaseFlowchartMetadata,
  softDeleteRepairCaseFlowchart,
  restoreRepairCaseFlowchart,
  permanentlyDeleteRepairCaseFlowchart,
} from "@/lib/db/mutations/repair-case-flowcharts";
import { createRepairCaseFlowchartWithGraph } from "@/lib/db/mutations/repair-case-flowchart-graph";
import { getWorkRecordHistoryForCase } from "@/lib/db/queries/repair-case-work-records";
import {
  buildWorkRecordFlowchart,
  listWorkRecordIdsInFlowchart,
  workRecordFlowchartMatchesSeenRecords,
  WORK_RECORD_FLOWCHART_MAX_RECORDS,
} from "@/lib/domain/work-record-flowchart";
import { formatServiceReportKstDateTime } from "@/lib/domain/service-report-draft";
import {
  isValidRepairCaseId,
  isValidUuid,
  isValidFlowchartId,
  isValidExpectedUpdatedAt,
  validateFlowchartTitle,
  validateFlowchartDescription,
  validateFlowchartDeleteReason,
  validatePermanentDeleteReason,
  type CreateRepairCaseFlowchartActionResult,
  type UpdateRepairCaseFlowchartMetadataActionResult,
  type SoftDeleteRepairCaseFlowchartActionResult,
  type RestoreRepairCaseFlowchartActionResult,
  type PermanentlyDeleteRepairCaseFlowchartActionResult,
} from "@/lib/validation/repair-case-flowchart-input";

/**
 * Server Actions for Phase 5C-6B flowchart-object management. Same layering
 * as repair-case-work-records.ts's actions: resolve the session, validate
 * input shape, delegate to the mutation layer, redact unexpected DB errors.
 * Role/assignment/lock authorization is entirely re-checked inside the
 * mutation layer — this file only confirms a valid, approved session
 * exists. Node/edge graph actions do not exist yet (5C-6C+).
 */

type Forbidden = { ok: false; code: "FORBIDDEN"; message: string };

async function resolveAuthorizedActorId(): Promise<{ ok: true; userId: string } | { ok: false; result: Forbidden }> {
  if (getAuthSource() !== "database") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "데이터베이스 저장 모드가 아닙니다." } };
  }
  const session = await readSession();
  if (!session) return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "로그인이 필요합니다." } };
  if (session.approvalStatus !== "APPROVED") {
    return { ok: false, result: { ok: false, code: "FORBIDDEN", message: "계정이 아직 승인되지 않았습니다." } };
  }
  return { ok: true, userId: session.userId };
}

function isPgErrorLike(err: unknown): err is { code?: string } {
  return typeof err === "object" && err !== null && "code" in err;
}

export async function createRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  title: string;
  description?: string | null;
}): Promise<CreateRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  const titleValidation = validateFlowchartTitle(input.title);
  if (!titleValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: titleValidation.error };
  const descriptionValidation = validateFlowchartDescription(input.description);
  if (!descriptionValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: descriptionValidation.error };

  try {
    const result = await createRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

// ---- 「작업 기록 흐름도」를 그때 모습 그대로 진짜 흐름도로 저장 ----

type CreateWorkRecordFlowchartSnapshotActionResult =
  | { ok: true; flowchartId: string }
  | {
      ok: false;
      code:
        | "VALIDATION_ERROR"
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "CASE_LOCKED"
        | "INVALID_INPUT"
        | "SELF_EDGE"
        | "DUPLICATE_EDGE"
        | "CROSS_FLOWCHART"
        | "STALE_REVISION"
        | "BILLING_DECISION_REQUIRED"
        // 화면이 본 작업 기록과 지금 DB 의 작업 기록이 어긋난다 — 사람이 새로
        // 고치고 다시 보아야 하는 상황이라, 권한·입력 오류와 섞이지 않게
        // 이 저장만의 코드를 따로 둔다.
        | "WORK_RECORDS_CHANGED"
        | "DATABASE_UNAVAILABLE";
      message: string;
    };

/**
 * 「작업 기록 흐름도」(열 때마다 다시 그리는 보기 전용 그림)를 **그때 보인 그
 * 모습 그대로** 평범한 흐름도 한 장으로 저장한다.
 *
 * 🔴 내용은 화면이 아니라 DB 에서 온다. 화면은 **자기가 본 작업 기록의 id
 * 목록만** 보내고(칸 제목도 분류도 위치도 보내지 않는다), 서버가 작업 기록을
 * 다시 읽어 buildWorkRecordFlowchart 로 다시 그린 뒤, 그 결과가 가리키는 기록
 * 목록이 화면이 보낸 것과 같은지 견준다. 왜 이렇게 하는지는
 * work-record-flowchart.ts 의 workRecordFlowchartMatchesSeenRecords 머리말에
 * 적어 두었다(요약: 화면이 보낸 칸을 그대로 저장하면 서버가 화면 말을 믿게
 * 되고, 서버가 그냥 다시 그려 저장하면 「내가 본 그것」이라는 약속이 깨진다.
 * id 목록만 대조하면 둘 다 지킨다).
 *
 * 저장된 뒤에는 **평범한 흐름도**다 — 작업 기록이 늘어도 다시 그려 주지 않고,
 * 따라 바뀌지도 않는다. 자동으로 그려 주는 쪽은 그대로 남아 있으므로 두 가지가
 * 함께 존재한다: 늘 최신인 「자동」 그림 하나, 그때를 붙잡아 둔 저장본 여럿.
 *
 * 인가는 여기서 판정하지 않는다 — 세션이 살아 있고 승인된 계정인지만 보고,
 * 역할·유·무상 확정 여부는 mutation 이 접수 건 행을 잠근 채 다시 확인한다.
 */
export async function createWorkRecordFlowchartSnapshotAction(input: {
  repairCaseId: string;
  /** 화면에 실제로 그려져 있던 작업 기록 id 목록 — 그려진 차례 그대로. */
  seenWorkRecordIds: string[];
}): Promise<CreateWorkRecordFlowchartSnapshotActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (
    !Array.isArray(input.seenWorkRecordIds) ||
    input.seenWorkRecordIds.length === 0 ||
    input.seenWorkRecordIds.length > WORK_RECORD_FLOWCHART_MAX_RECORDS ||
    !input.seenWorkRecordIds.every(isValidUuid)
  ) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }

  try {
    // 화면이 그렸던 것과 같은 조회·같은 상한·같은 순수 함수. 다른 상한을 쓰면
    // 잘리는 자리가 달라져 멀쩡한 저장이 「바뀌었다」로 거절된다.
    const { rows } = await getWorkRecordHistoryForCase(input.repairCaseId, { limit: WORK_RECORD_FLOWCHART_MAX_RECORDS, offset: 0 });
    const { nodes, edges } = buildWorkRecordFlowchart(rows);
    if (nodes.length === 0) {
      return { ok: false, code: "WORK_RECORDS_CHANGED", message: "그릴 작업 기록이 없습니다. 새로 고친 뒤 다시 확인해 주세요." };
    }
    if (!workRecordFlowchartMatchesSeenRecords(nodes, input.seenWorkRecordIds)) {
      return {
        ok: false,
        code: "WORK_RECORDS_CHANGED",
        message: "그 사이에 작업 기록이 바뀌었습니다. 새로 고친 뒤 다시 저장해 주세요.",
      };
    }

    // 제목·설명은 이 흐름도만 따로 보아도 「그때 자동으로 뽑아 둔 것」임을 알 수
    // 있어야 한다. 시각은 이 저장소가 이미 쓰는 KST 서식을 그대로 쓴다(기기
    // 시간대에 따라 달라지지 않는다). 읽을 수 없는 시각이면 지어내지 않고
    // 시각 없이 적는다.
    const savedAt = formatServiceReportKstDateTime(new Date());
    const recordCount = listWorkRecordIdsInFlowchart(nodes).length;
    const title = savedAt === null ? "작업 기록 흐름도" : `작업 기록 흐름도 (${savedAt})`;
    const description =
      savedAt === null
        ? `작업 기록 ${recordCount}건을 그대로 옮겨 만든 흐름도입니다. 이후 작업 기록이 늘어도 이 흐름도는 바뀌지 않습니다.`
        : `${savedAt} 기준 작업 기록 ${recordCount}건을 그대로 옮겨 만든 흐름도입니다. 이후 작업 기록이 늘어도 이 흐름도는 바뀌지 않습니다.`;

    const result = await createRepairCaseFlowchartWithGraph({
      repairCaseId: input.repairCaseId,
      actorUserId: actorCheck.userId,
      title,
      description,
      // 임시 key 는 순수 함수가 지은 칸 id 를 그대로 쓴다 — 연결선이 이미 그
      // id 로 칸을 가리키고 있으므로 따로 이름을 붙일 필요가 없다.
      nodes: nodes.map((node) => ({
        key: node.id,
        nodeType: node.nodeType,
        title: node.title,
        description: node.description,
        instructions: node.instructions,
        positionX: node.positionX,
        positionY: node.positionY,
      })),
      edges: edges.map((edge) => ({
        fromKey: edge.fromNodeId,
        toKey: edge.toNodeId,
        branchType: edge.branchType,
        branchLabel: edge.branchLabel,
      })),
    });
    if (!result.ok) return result;
    return { ok: true, flowchartId: result.flowchartId };
  } catch (err) {
    // 메모 내용은 절대 로그에 담지 않는다 — 고객사 장비의 진단 내용이 섞인다.
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("createWorkRecordFlowchartSnapshotAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function updateRepairCaseFlowchartMetadataAction(input: {
  repairCaseId: string;
  flowchartId: string;
  title: string;
  description?: string | null;
  expectedUpdatedAt: string;
}): Promise<UpdateRepairCaseFlowchartMetadataActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }
  const titleValidation = validateFlowchartTitle(input.title);
  if (!titleValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: titleValidation.error };
  const descriptionValidation = validateFlowchartDescription(input.description);
  if (!descriptionValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: descriptionValidation.error };

  try {
    const result = await updateRepairCaseFlowchartMetadata({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      title: titleValidation.title,
      description: descriptionValidation.description,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("updateRepairCaseFlowchartMetadataAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function softDeleteRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  flowchartId: string;
  deleteReason?: string | null;
  expectedUpdatedAt: string;
}): Promise<SoftDeleteRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }
  const reasonValidation = validateFlowchartDeleteReason(input.deleteReason);
  if (!reasonValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };

  try {
    const result = await softDeleteRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      deleteReason: reasonValidation.reason,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("softDeleteRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function restoreRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  flowchartId: string;
  expectedUpdatedAt: string;
}): Promise<RestoreRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }

  try {
    const result = await restoreRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("restoreRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}

export async function permanentlyDeleteRepairCaseFlowchartAction(input: {
  repairCaseId: string;
  flowchartId: string;
  deleteReason: string;
  expectedUpdatedAt: string;
}): Promise<PermanentlyDeleteRepairCaseFlowchartActionResult> {
  const actorCheck = await resolveAuthorizedActorId();
  if (!actorCheck.ok) return { ok: false, code: "UNAUTHORIZED", message: actorCheck.result.message };

  if (!isValidRepairCaseId(input.repairCaseId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "접수 건을 확인할 수 없습니다." };
  }
  if (!isValidFlowchartId(input.flowchartId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "해당 Flowchart를 확인할 수 없습니다." };
  }
  if (!isValidExpectedUpdatedAt(input.expectedUpdatedAt)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "요청이 올바르지 않습니다. 새로고침 후 다시 시도하세요." };
  }
  const reasonValidation = validatePermanentDeleteReason(input.deleteReason);
  if (!reasonValidation.ok) return { ok: false, code: "VALIDATION_ERROR", message: reasonValidation.error };

  try {
    const result = await permanentlyDeleteRepairCaseFlowchart({
      repairCaseId: input.repairCaseId,
      flowchartId: input.flowchartId,
      actorUserId: actorCheck.userId,
      deleteReason: reasonValidation.reason,
      expectedUpdatedAt: input.expectedUpdatedAt,
    });
    return result;
  } catch (err) {
    const code = isPgErrorLike(err) ? err.code : undefined;
    console.error("permanentlyDeleteRepairCaseFlowchartAction: unexpected DB error", { code });
    return { ok: false, code: "DATABASE_UNAVAILABLE", message: "일시적으로 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." };
  }
}
