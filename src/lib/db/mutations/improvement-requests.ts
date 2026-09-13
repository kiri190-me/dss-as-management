import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "../client";
import { improvementRequests } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  canDeleteImprovementRequest,
  canEditImprovementRequestBody,
  planImprovementRequestStatusChange,
  type ImprovementRequestStatus,
} from "@/lib/domain/improvement-request";
import {
  validateImprovementRequestFields,
  validateImprovementRequestMenuKey,
} from "@/lib/validation/improvement-request-input";

/**
 * ============================================================================
 * 개선 요청 — 적기 · 고치기 · 상태 옮기기 · 지우기
 * ============================================================================
 * 본보기는 mutations/weekly-report-goals.ts 다 — 순서가 곧 규칙인 것도 같다:
 *  1. 트랜잭션을 열고 대상 행을 `.for("update")` 로 잠근다. ⚠️ id 로만 좁힌다.
 *  2. 없는 행이면 NOT_FOUND.
 *  3. version 이 어긋나면 CONFLICT — **한 글자도 바꾸지 않고** 돌아간다.
 *  4. 글 한 건에 대한 판정(아래)이 거짓이면 FORBIDDEN.
 *  5. 값과 함께 version + 1 · updated_by · updated_at 을 쓰고, 조건부 UPDATE/DELETE
 *     로 version 을 한 번 더 본다(0행이면 CONFLICT — 마지막 안전망).
 *  6. 같은 트랜잭션에서 감사 로그를 남긴다.
 *
 * ── 글 한 건에 대한 판정은 여기서 한다 ──────────────────────────────────
 * 「접수 상태인 자기 글인가」는 **잠근 행**을 봐야 답할 수 있다. 서버 액션이 먼저
 * 읽고 판정하면, 판정과 저장 사이에 관리자가 상태를 옮겨 「진행중이 된 글은
 * 작성자도 못 고친다」가 뚫린다. 그래서 잠근 뒤 도메인 함수
 * (domain/improvement-request.ts)를 부른다 — 화면도 같은 함수를 부른다.
 *
 * **역할·관리자 설정은 여기서 보지 않는다.** 「관리 권한이 있는가」는 서버 액션이
 * hasPermission 으로 계산해 `canManage` 로 넘긴다(도메인 파일 헤더의 '권한은
 * 여기서 계산하지 않는다'). 통합 시험이 세션 없이 규칙을 그대로 검증할 수 있는
 * 이유이기도 하다.
 *
 * CONFLICT 를 FORBIDDEN 보다 먼저 보는 이유: 낡은 화면에서 누른 저장이 거절될 때,
 * 그 사이 상태가 옮겨졌다면 「권한 없음」보다 「다시 불러오라」가 맞는 말이다.
 * 다시 불러온 화면은 고치기 단추를 그리지 않는다.
 *
 * ── 감사 로그는 같은 트랜잭션에서 ─────────────────────────────────────
 * 저장은 됐는데 감사가 빠지는(또는 그 반대) 일이 없도록 insertAuditLog 를 같은
 * tx 로 부른다. target_entity 는 "improvement_requests".
 *  · 적기      CREATE        newValue: { body, menuKey, status }
 *  · 고치기    UPDATE        previousValue: { body, menuKey }  newValue: { body, menuKey }
 *  · 상태      STATUS_CHANGE previousValue: { status } newValue: { status }
 *  · 지우기    PURGE         previousValue: 지우기 직전 행 전체(menuKey 포함, 시각은 ISO)
 * 지우기는 휴지통 없이 바로 지우므로(schema 헤더) 무엇이 사라졌는지는 PURGE 줄만
 * 안다. 같은 상태로의 변경은 아무것도 바꾸지 않았으므로 저장도 감사도 없다.
 * 고치기는 메뉴가 그대로여도 이전·새 메뉴를 함께 적는다 — 줄 하나만 읽어도 「고친
 * 뒤 이 글이 어느 메뉴였는가」가 보이게. 옛 글(메뉴 NULL)을 고치면 이전 값이 null 이다.
 *
 * ── 「지금」은 트랜잭션마다 한 번 ───────────────────────────────────────
 * created_at 과 updated_at, 또는 in_progress_at/resolved_at 과 updated_at 이 같은
 * 시각이 되게 한다. 두 번 만들면 한 저장 안에서 밀리초가 어긋난다.
 *
 * ── 본문과 메뉴는 여기서 한 번 더 검증한다 ─────────────────────────────
 * 서버 액션이 이미 검증하지만, 이 함수를 직접 부르는 길(시험 · 나중의 다른 호출)
 * 에서도 빈 글이 DB CHECK(23514)로 떨어져 「일시적 오류」가 되지 않도록 같은
 * 함수(validateImprovementRequestFields)를 트랜잭션 **전에** 부른다. 정규화는
 * 멱등이라 두 번 거쳐도 값이 바뀌지 않는다.
 * 메뉴(validateImprovementRequestMenuKey)도 같은 자리에서 본다 — menu_key 에는 DB
 * CHECK 가 없어서(schema 헤더) 검증을 건너뛴 길로는 아무 글자나 저장된다. 메뉴는
 * 필수이고 **전체 메뉴 목록**으로 판정한다(보는 사람의 사이드바 목록이 아니다 —
 * domain 의 listSidebarImprovementRequestMenuOptions 주석). 두 오류는 함께 돌려준다. DB 오류를 잡아 결과로 바꾸는 자리가
 * 없으므로 세이브포인트도 두지 않는다 — 생기면 intake-master-resolution.ts 처럼
 * `tx.transaction` 안에서 잡을 것(postgres-js 는 잡힌 오류도 콜백 뒤에 다시 던진다).
 *
 * ── PII ─────────────────────────────────────────────────────────────────
 * 본문은 자유 입력이다. 결과 메시지에 싣지 않고, 이 파일은 아무것도 로그하지
 * 않는다. 감사 로그에 본문이 들어가는 것은 DB 안의 기록이라서다 — 무엇이
 * 바뀌었는가가 곧 감사다.
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ImprovementRequestRow = typeof improvementRequests.$inferSelect;

/** 감사 로그의 target_entity. 표 이름 그대로다. */
const TARGET_ENTITY = "improvement_requests";

export type ImprovementRequestMutationResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "VALIDATION_ERROR";

export type ImprovementRequestMutationResult =
  | { ok: true; id: string; version: number }
  | {
      ok: false;
      code: ImprovementRequestMutationResultCode;
      fieldErrors?: Record<string, string>;
      message: string;
    };

const NOT_FOUND_MESSAGE = "해당 개선 요청을 찾을 수 없습니다.";
const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 이 개선 요청을 먼저 바꿨습니다. 최신 정보를 다시 불러온 뒤 시도해 주세요.";
const VALIDATION_MESSAGE = "입력값을 확인해 주세요.";
const EDIT_FORBIDDEN_MESSAGE = "접수 상태인 자기 글만 고칠 수 있습니다.";
const STATUS_FORBIDDEN_MESSAGE = "상태를 바꿀 권한이 없습니다.";
const DELETE_FORBIDDEN_MESSAGE = "접수 상태인 자기 글만 지울 수 있습니다.";

function notFound(): ImprovementRequestMutationResult {
  return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE };
}

function conflict(): ImprovementRequestMutationResult {
  return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
}

function forbidden(message: string): ImprovementRequestMutationResult {
  return { ok: false, code: "FORBIDDEN", message };
}

function invalid(fieldErrors: Record<string, string>): ImprovementRequestMutationResult {
  return { ok: false, code: "VALIDATION_ERROR", fieldErrors, message: VALIDATION_MESSAGE };
}

/** 대상 행을 잠그고 읽는다. ⚠️ id 로만 좁힌다 — 다른 조건으로 좁히면 남의 글까지 잠근다. */
async function lockImprovementRequest(tx: Tx, id: string): Promise<ImprovementRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(improvementRequests)
    .where(eq(improvementRequests.id, id))
    .for("update");
  return row;
}

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** PURGE 감사에 남기는 지우기 직전의 행 전체. 시각은 ISO 문자열로 적는다. */
function toAuditSnapshot(row: ImprovementRequestRow) {
  return {
    id: row.id,
    body: row.body,
    menuKey: row.menuKey,
    status: row.status,
    inProgressBy: row.inProgressBy,
    inProgressAt: toIsoOrNull(row.inProgressAt),
    resolvedBy: row.resolvedBy,
    resolvedAt: toIsoOrNull(row.resolvedAt),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/**
 * 본문과 메뉴를 함께 검증한다 — 파일 헤더의 '본문과 메뉴는 여기서 한 번 더
 * 검증한다'. 둘 다 틀렸으면 두 칸의 오류를 함께 돌려준다.
 */
function validateBodyAndMenu(params: {
  body: string;
  menuKey: string;
}): { ok: true; body: string; menuKey: string } | { ok: false; fieldErrors: Record<string, string> } {
  const body = validateImprovementRequestFields({ body: params.body });
  const menu = validateImprovementRequestMenuKey({ menuKey: params.menuKey });
  if (body.ok && menu.ok) return { ok: true, body: body.data.body, menuKey: menu.data.menuKey };
  return {
    ok: false,
    fieldErrors: { ...(body.ok ? {} : body.fieldErrors), ...(menu.ok ? {} : menu.fieldErrors) },
  };
}

/** 새 글 하나. 접수 상태 · version 1 로 시작한다. 메뉴는 필수다. */
export async function createImprovementRequest(params: {
  body: string;
  menuKey: string;
  actorUserId: string;
}): Promise<ImprovementRequestMutationResult> {
  const validation = validateBodyAndMenu(params);
  if (!validation.ok) return invalid(validation.fieldErrors);
  const { body, menuKey } = validation;

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const [inserted] = await tx
      .insert(improvementRequests)
      .values({
        body,
        menuKey,
        status: "OPEN",
        createdBy: params.actorUserId,
        createdAt: now,
        // 만든 사람이 곧 마지막으로 손댄 사람이다 — 첫 수정 전까지 빈칸으로 두지
        // 않는다(weekly-report-goals.ts 와 같은 판단).
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .returning({ id: improvementRequests.id, version: improvementRequests.version });

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "CREATE",
      targetEntity: TARGET_ENTITY,
      targetRecordId: inserted.id,
      newValue: { body, menuKey, status: "OPEN" },
    });

    return { ok: true, id: inserted.id, version: inserted.version };
  });
}

/**
 * 글의 내용(본문과 메뉴)을 고친다 — 접수 상태인 자기 글만(canEditImprovementRequestBody).
 * 관리 권한이 있어도 남의 글 내용은 고칠 수 없으므로 `canManage` 를 받지 않는다.
 *
 * 메뉴는 필수다 — 메뉴 없이 적힌 옛 글도 고칠 때는 메뉴를 골라야 저장된다. 판정은
 * 전체 메뉴 목록이라, 권한이 좁혀진 작성자도 그 글의 메뉴를 그대로 둘 수 있다.
 */
export async function updateImprovementRequestBody(params: {
  id: string;
  expectedVersion: number;
  body: string;
  menuKey: string;
  actorUserId: string;
}): Promise<ImprovementRequestMutationResult> {
  const validation = validateBodyAndMenu(params);
  if (!validation.ok) return invalid(validation.fieldErrors);
  const { body, menuKey } = validation;

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const current = await lockImprovementRequest(tx, params.id);
    if (!current) return notFound();
    if (current.version !== params.expectedVersion) return conflict();
    if (
      !canEditImprovementRequestBody({
        status: current.status,
        createdBy: current.createdBy,
        actorUserId: params.actorUserId,
      })
    ) {
      return forbidden(EDIT_FORBIDDEN_MESSAGE);
    }

    const [updated] = await tx
      .update(improvementRequests)
      .set({
        body,
        menuKey,
        version: sql`${improvementRequests.version} + 1`,
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!updated) return conflict();

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: TARGET_ENTITY,
      targetRecordId: updated.id,
      previousValue: { body: current.body, menuKey: current.menuKey },
      newValue: { body, menuKey },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 상태를 옮긴다 — 관리 권한(`canManage`)이 있을 때만, 어느 방향으로든.
 *
 * 네 칸(in_progress_by/at · resolved_by/at)은 planImprovementRequestStatusChange 가
 * 계산한 그대로 SET 한다 — 그 함수가 DB CHECK 와 같은 규칙을 지킨다. 같은 상태로의
 * 변경(`unchanged`)은 저장도 감사도 없이 지금 version 을 그대로 돌려준다.
 */
export async function changeImprovementRequestStatus(params: {
  id: string;
  expectedVersion: number;
  to: ImprovementRequestStatus;
  actorUserId: string;
  canManage: boolean;
}): Promise<ImprovementRequestMutationResult> {
  // 행과 상관없는 판정이라 잠그기 전에 본다 — 권한 없는 요청이 잠금을 잡지 않게.
  if (!params.canManage) return forbidden(STATUS_FORBIDDEN_MESSAGE);

  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const now = new Date();

    const current = await lockImprovementRequest(tx, params.id);
    if (!current) return notFound();
    if (current.version !== params.expectedVersion) return conflict();

    const plan = planImprovementRequestStatusChange({
      from: current.status,
      to: params.to,
      current: {
        inProgressBy: current.inProgressBy,
        inProgressAt: current.inProgressAt,
        resolvedBy: current.resolvedBy,
        resolvedAt: current.resolvedAt,
      },
      actorUserId: params.actorUserId,
      now,
    });
    if (plan.kind === "unchanged") {
      return { ok: true, id: current.id, version: current.version };
    }

    const [updated] = await tx
      .update(improvementRequests)
      .set({
        status: plan.status,
        ...plan.fields,
        version: sql`${improvementRequests.version} + 1`,
        updatedBy: params.actorUserId,
        updatedAt: now,
      })
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!updated) return conflict();

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "STATUS_CHANGE",
      targetEntity: TARGET_ENTITY,
      targetRecordId: updated.id,
      previousValue: { status: current.status },
      newValue: { status: plan.status },
    });

    return { ok: true, id: updated.id, version: updated.version };
  });
}

/**
 * 글을 **바로 지운다**(휴지통 없음). 관리 권한이 있으면 어느 글이든, 없으면 접수
 * 상태인 자기 글만(canDeleteImprovementRequest).
 *
 * version 을 그래도 대조하는 이유는 weekly-report-goals.ts 의 삭제와 같다 — 낡은
 * 화면에서 누른 '삭제'가 그 사이 바뀐 글을 지우면, 되돌릴 수 없는 이 조작에서는
 * 그것이 곧 자료 손실이다.
 */
export async function deleteImprovementRequest(params: {
  id: string;
  expectedVersion: number;
  actorUserId: string;
  canManage: boolean;
}): Promise<ImprovementRequestMutationResult> {
  return db.transaction(async (tx): Promise<ImprovementRequestMutationResult> => {
    const current = await lockImprovementRequest(tx, params.id);
    if (!current) return notFound();
    if (current.version !== params.expectedVersion) return conflict();
    if (
      !canDeleteImprovementRequest({
        status: current.status,
        createdBy: current.createdBy,
        actorUserId: params.actorUserId,
        canManage: params.canManage,
      })
    ) {
      return forbidden(DELETE_FORBIDDEN_MESSAGE);
    }

    const [deleted] = await tx
      .delete(improvementRequests)
      .where(
        and(
          eq(improvementRequests.id, params.id),
          eq(improvementRequests.version, params.expectedVersion)
        )
      )
      .returning({ id: improvementRequests.id, version: improvementRequests.version });
    if (!deleted) return conflict();

    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "PURGE",
      targetEntity: TARGET_ENTITY,
      targetRecordId: deleted.id,
      previousValue: toAuditSnapshot(current),
    });

    // 지워진 글의 version 을 그대로 돌려준다 — 화면이 「무엇이 사라졌는가」를
    // 방금 들고 있던 값과 맞춰 볼 수 있게.
    return { ok: true, id: deleted.id, version: deleted.version };
  });
}
