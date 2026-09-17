import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../client";
import { parts, repairCases, repairCaseUsedParts } from "../schema";
import { insertAuditLog } from "./audit-logs";
import {
  hasLivePartRequest,
  isImportedFromKyosanIntake,
} from "../queries/repair-case-used-parts";
import { resolveUsedPartsWriteGate } from "@/lib/auth/repair-case-used-parts-authorization";
import { hasPermission, type PermissionActor } from "@/lib/auth/permission-resolver";
import type { UsedPartLineInput } from "@/lib/validation/repair-case-used-parts-input";

/**
 * ============================================================================
 * 「사용 부품」 줄을 저장한다 (B-2)
 * ============================================================================
 * 이 표가 왜 있는지는 schema/repair-case-used-parts.ts 머리말에, 누가 적을 수
 * 있는지는 auth/repair-case-used-parts-authorization.ts 머리말에 있다. 여기에는
 * **저장하는 방식**만 적는다.
 *
 * ── 🔴 화면이 이미 확인했다고 믿지 않는다 ───────────────────────────────────
 * 조회(getRepairCaseUsedPartsView)가 화면에 「적을 수 있다」를 내려보낸 뒤에도
 * 그 사이에 부품 요청서가 생기거나 건이 출하되어 잠길 수 있다. 그래서 규칙 셋을
 * **이 트랜잭션 안에서 다시** 판정한다 — 조회와 **같은 함수**로
 * (hasLivePartRequest · isImportedFromKyosanIntake · resolveUsedPartsWriteGate).
 * 주소로 직접 부른 요청도 여기서 같은 거절을 받는다.
 *
 * 🔴 **권한도 그 셋에 든다.** 화면에서 「수정」 단추를 감추는 것만으로는 모자라다 —
 * 권한 없는 사람이 서버 액션을 직접 불러도 이 안에서 거절된다. 그 판정은 역할
 * 이름 비교가 아니라 [역할별 접근 권한]의 `repairCases.usedParts` 조회다
 * (hasPermission) — 조회 쪽이 화면에 내려보낼 때 묻는 바로 그 키다. `actor` 는
 * 서버 액션이 **살아 있는 계정에서 다시 읽은** 사람이다(세션 토큰 값이 아니다).
 *
 * ── 왜 전부 지우고 다시 넣는가 ──────────────────────────────────────────────
 * 부모에 딸린 줄 목록을 통째로 받는 저장이다 — quote_items 의 replaceItems 와
 * 같은 판단이고, 같은 까닭으로 **반드시 repair_case_id 로 좁혀서** 지운다.
 * 줄마다 무엇이 바뀌었는지 맞춰 보는 대신 목록을 그대로 다시 그린다.
 *
 * `line_no` 는 배열 index + 1 이다 — 화면이 보낸 번호는 쳐다보지 않는다
 * (validation/repair-case-used-parts-input.ts 가 아예 읽지도 않는다).
 *
 * ── 동시 편집 ───────────────────────────────────────────────────────────────
 * repair_cases.version 을 쓴다 — 접수 건 자료 편집(updateRepairCase)이 쓰는 바로
 * 그 번호다. 사용 부품도 그 건의 자료이므로 **같은 번호 하나**로 다투게 두는 편이
 * 옳다. 두 번호를 두면 「상세 화면이 들고 있는 version」이 무엇을 가리키는지가
 * 화면마다 갈린다.
 *
 * 그래서 저장이 성공하면 건의 version 이 1 오른다. 조건부 UPDATE 의 WHERE 가
 * 실제 판단 지점이고(0행이면 CONFLICT), 그 앞의 SELECT 는 값싼 조기 거절 + 감사
 * 이력의 previousValue 를 위한 것이다 — softDeleteRepairCase 와 같은 모양이다.
 *
 * ── 재고는 1도 움직이지 않는다 ──────────────────────────────────────────────
 * 이 표는 원장이 아니다(스키마 머리말). stock_transactions ·
 * inventory_part_requests 를 건드리는 줄이 이 파일에 **하나도 없다.**
 * ============================================================================
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SaveUsedPartsMutationResultCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "ROLE_NOT_ALLOWED"
  | "PART_REQUEST_HISTORY_EXISTS"
  | "CASE_LOCKED"
  | "INVALID_PART";

export type SavedUsedPartLine = {
  lineNo: number;
  partId: string | null;
  partNameText: string;
  quantity: number;
};

export type SaveUsedPartsMutationResult =
  | { ok: true; version: number; lines: SavedUsedPartLine[] }
  | { ok: false; code: SaveUsedPartsMutationResultCode; message: string };

const VERSION_CONFLICT_MESSAGE =
  "다른 사용자가 먼저 저장했습니다. 최신 정보를 다시 불러온 뒤 수정해 주세요.";

/**
 * 받은 목록 그대로 이 건의 사용 부품을 다시 적는다.
 *
 * `lines` 는 검사를 통과한 것만 들어온다(모양 · 수량 1 이상 · partId 형식).
 * 여기서 더 보는 것은 **DB 를 봐야 아는 것들**뿐이다 — 건이 살아 있는가, 규칙
 * 셋에 걸리는가, 고른 부품이 실제로 있는가, version 이 맞는가.
 */
export async function saveRepairCaseUsedParts(params: {
  repairCaseId: string;
  expectedVersion: number;
  actorUserId: string;
  /**
   * 살아 있는 계정에서 읽은 사람(역할 + 개발자 표시). 이 안에서 권한을 **다시**
   * 묻는다 — 판정은 아래 resolveUsedPartsWriteGate 가 한다.
   */
  actor: PermissionActor;
  lines: readonly UsedPartLineInput[];
}): Promise<SaveUsedPartsMutationResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: repairCases.id, version: repairCases.version, isLocked: repairCases.isLocked })
      .from(repairCases)
      .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.isDeleted, false)))
      .for("update");

    if (!current) {
      return { ok: false, code: "NOT_FOUND", message: "해당 접수 건을 찾을 수 없습니다." };
    }

    // 🔴 조회가 쓰는 바로 그 세 재료 + 그것을 합치는 바로 그 함수. 트랜잭션
    // 안에서 다시 본다 — 화면이 열어 준 뒤에 바뀌었을 수 있다(요청서가 생기거나,
    // 건이 잠기거나, 관리자가 권한을 좁히거나).
    //
    // 권한만 먼저 보고 일찍 빠져나가지 않는다 — 그러면 판정이 두 벌이 되고,
    // 「권한이 먼저」라는 차례가 이 파일에도 한 벌 적히게 된다. 두 probe 는 이 건
    // 하나만 보는 인덱스 조회라 값이 싸고, 권한 조회는 요청 한 번에 한 번이다
    // (permission-resolver 의 cache). 작업 기록 저장(mutations/repair-case-work-
    // records.ts)도 트랜잭션 안에서 같은 창구를 부른다.
    const canWriteUsedParts = await hasPermission(params.actor, "repairCases.usedParts", "WRITE");
    const hasPartRequestHistory = await hasLivePartRequest(tx, params.repairCaseId);
    const isLegacyImportedCase = await isImportedFromKyosanIntake(tx, params.repairCaseId);
    const gate = resolveUsedPartsWriteGate({
      canWriteUsedParts,
      hasPartRequestHistory,
      isShipmentLocked: current.isLocked,
      isLegacyImportedCase,
    });
    if (!gate.ok) {
      return { ok: false, code: gate.code, message: gate.message };
    }

    // 값싼 조기 거절. 진짜 판단은 아래 조건부 UPDATE 의 WHERE 다.
    if (current.version !== params.expectedVersion) {
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    const invalidPart = await findInvalidPartId(tx, params.lines);
    if (invalidPart) {
      return {
        ok: false,
        code: "INVALID_PART",
        message: "선택한 부품을 찾을 수 없습니다. 목록에서 다시 골라 주세요.",
      };
    }

    // 감사 이력의 previousValue — 지우기 전에 읽어 둔다.
    const previousLines = await tx
      .select({
        lineNo: repairCaseUsedParts.lineNo,
        partId: repairCaseUsedParts.partId,
        partNameText: repairCaseUsedParts.partNameText,
        quantity: repairCaseUsedParts.quantity,
      })
      .from(repairCaseUsedParts)
      .where(eq(repairCaseUsedParts.repairCaseId, params.repairCaseId))
      .orderBy(asc(repairCaseUsedParts.lineNo));

    const bumped = await tx
      .update(repairCases)
      .set({ version: sql`${repairCases.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(repairCases.id, params.repairCaseId), eq(repairCases.version, params.expectedVersion)))
      .returning({ version: repairCases.version });

    if (bumped.length === 0) {
      // 조용히 덮어쓰지 않는다 — 위 SELECT 와 이 UPDATE 사이에 누가 먼저 저장했다.
      return { ok: false, code: "CONFLICT", message: VERSION_CONFLICT_MESSAGE };
    }

    // ⚠️ 반드시 repair_case_id 로 좁힌다. 조건 없는 delete 는 이 표를 통째로 비운다.
    await tx.delete(repairCaseUsedParts).where(eq(repairCaseUsedParts.repairCaseId, params.repairCaseId));

    const nextLines: SavedUsedPartLine[] = params.lines.map((line, index) => ({
      lineNo: index + 1,
      partId: line.partId,
      partNameText: line.partNameText,
      quantity: line.quantity,
    }));

    if (nextLines.length > 0) {
      await tx.insert(repairCaseUsedParts).values(
        nextLines.map((line) => ({
          repairCaseId: params.repairCaseId,
          lineNo: line.lineNo,
          partId: line.partId,
          partNameText: line.partNameText,
          quantity: line.quantity,
        }))
      );
    }

    // 줄 목록 전체를 앞뒤로 남긴다 — 이 저장은 「한 칸을 고쳤다」가 아니라
    // 「목록을 이렇게 다시 적었다」이므로, 한 줄만 적으면 무엇이 사라졌는지
    // 나중에 알 길이 없다. 대상 record 는 줄이 아니라 **그 접수 건**이다
    // (줄의 id 는 저장할 때마다 바뀐다).
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "UPDATE",
      targetEntity: "repair_case_used_parts",
      targetRecordId: params.repairCaseId,
      previousValue: { lines: previousLines },
      newValue: { lines: nextLines },
    });

    return { ok: true, version: bumped[0].version, lines: nextLines };
  });
}

/**
 * 고른 부품이 실제로 살아 있는가. FK 가 RESTRICT 라 없는 id 면 어차피 23503 으로
 * 터지는데, 그 예외는 사람에게 「일시적으로 저장할 수 없습니다」로만 보인다 —
 * 까닭을 알 수 있게 여기서 먼저 세운다. 손으로 적은 줄(partId 가 null)은 볼 것이
 * 없으므로 질의 자체가 일어나지 않는다.
 */
async function findInvalidPartId(tx: Tx, lines: readonly UsedPartLineInput[]): Promise<boolean> {
  const partIds = [...new Set(lines.map((line) => line.partId).filter((id): id is string => id !== null))];
  if (partIds.length === 0) return false;

  const found = await tx
    .select({ id: parts.id })
    .from(parts)
    .where(and(inArray(parts.id, partIds), eq(parts.isDeleted, false)));

  return found.length !== partIds.length;
}
