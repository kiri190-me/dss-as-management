import "server-only";
import { and, asc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "../client";
import { inventoryPartRequests, repairCases, repairCaseUsedParts, statusChangeHistories } from "../schema";
import { KYOSAN_INTAKE_LIST_SOURCE } from "./kyosan-intake-import";
import {
  resolveUsedPartsWriteGate,
  type UsedPartsWriteGate,
} from "@/lib/auth/repair-case-used-parts-authorization";

/**
 * ============================================================================
 * 「사용 부품」 칸이 읽는 것 — 적힌 줄 + "여기에 적을 건인가"
 * ============================================================================
 * 표를 만든 사정은 schema/repair-case-used-parts.ts 머리말에 있다. 요약하면,
 * `신고증상별 교환 부품` 통계의 부품 축이 **부품 요청서를 낸 건(개발 DB 216건 중
 * 36건, 17%)** 밖에 못 본다. 그래서 요청서가 없는 건에 사람이 손으로 적을 자리를
 * 만들었고, 이 파일은 그 자리를 **읽기만** 한다(적는 길은 다음 조각이다).
 *
 * ── 🔴 한 건의 부품 출처를 둘로 쪼개지 않는다 (사용자 확정 규칙) ──────────
 * 같은 건이 요청서에도 잡히고 손으로 적은 줄에도 잡히면 **통계가 같은 부품을 두
 * 번 센다.** 그래서 화면은 둘 중 하나만 연다:
 *
 *   · 반출 이력이 있는 건 → 안내 한 줄만. 적을 자리를 그리지 않는다.
 *   · 없는 건            → 「사용 부품」 칸을 연다.
 *
 * 이 함수는 그 판단의 재료(`hasPartRequestHistory`)를 함께 돌려준다. **DB 제약이
 * 아니다** — 요청서를 나중에 내면 이미 적어 둔 줄이 남을 수 있고, 그것은 위법이
 * 아니라 사람이 확인할 일이다(스키마 머리말의 같은 판단).
 *
 * ── 🔴 어떤 요청 줄을 "반출 이력"으로 치는가 ──────────────────────────────
 * REJECTED · CANCELLED 는 **치지 않는다.** 통계가 그 둘을 이미 빼고 세기 때문이다
 * (queries/product-models.ts 의 UNCOUNTED_PART_REQUEST_STATUSES — "물건이 나가지
 * 않은, 앞으로도 나가지 않을 요청"). 그 둘을 이력으로 쳐 버리면 **거절·취소만 남은
 * 건은 통계에도 안 잡히고 적을 자리도 없는** 구멍이 된다 — 이 표를 만든 까닭이
 * 바로 그 구멍이었다. 여기서 세는 집합과 통계가 세는 집합을 같게 두면 두 번 세는
 * 일도, 한 번도 안 세는 일도 생기지 않는다.
 *
 * 🔴 두 곳이 같은 목록을 따로 적고 있다 — 저 상수가 product-models.ts 안에 갇혀
 * 있어서다. 한 곳으로 모으는 것은 이 조각 밖이라 보고만 한다. 지금은 시험이 두
 * 목록을 글자로 못 박는다.
 *
 * ── 왜 parts 마스터와 조인하지 않는가 ──────────────────────────────────────
 * 화면에 보이는 것은 언제나 `part_name_text` 다. part_id 를 골랐어도 그 건에 적힌
 * 글자가 남아야 하고(마스터 품명이 나중에 바뀌어도), 목록이 조인 없이 그려진다 —
 * quote_items 와 같은 판단이다(스키마 머리말 '왜 part_id 와 part_name_text 를
 * 함께 두는가'). part_id 는 통계가 같은 부품을 같은 것으로 묶을 때 쓴다.
 *
 * ── 소스 게이트는 부르는 쪽에 있다 ─────────────────────────────────────────
 * 이 표는 DATABASE 소스 건에만 있다. MOCK · LOCAL_DEMO 는 대응물이 없으므로
 * [id]/page.tsx 가 `resolved.source === "DATABASE"` 일 때만 이 함수를 부른다 —
 * partRequestData · derivedServiceSummary 가 쓰는 것과 같은 게이트다.
 * ============================================================================
 */

/** 한 줄 — 화면이 그리는 것이 전부다(작성자·시각은 아직 화면에 쓰지 않는다). */
export type RepairCaseUsedPartRow = {
  id: string;
  lineNo: number;
  /** 부품 마스터에서 고른 것. **null 이 정상이다** — 마스터에 없는 부품은 글자로만 적는다. */
  partId: string | null;
  /** 화면에 보이는 품명. NOT NULL 이라 언제나 있다. */
  partNameText: string;
  quantity: number;
};

export type RepairCaseUsedPartsView = {
  /** `line_no` 차례대로. 아직 아무도 적지 않았으면 빈 배열이다(그것이 보통이다). */
  rows: RepairCaseUsedPartRow[];
  /**
   * 이 건에 살아 있는 부품 요청 줄이 하나라도 있는가 — 있으면 화면은 적을 자리를
   * 그리지 않고 안내만 낸다. 위 머리말의 '한 건의 부품 출처를 둘로 쪼개지 않는다'.
   */
  hasPartRequestHistory: boolean;
  /**
   * 🔴 **여기에 적을 수 있는 건인가 — 서버가 내린 판정이다** (B-2).
   *
   * 화면은 이 값만 보고 입력 칸을 그릴지 정한다. 화면이 스스로 판정하면 판정이
   * 두 벌이 되고, 그러면 화면이 여는 조건과 서버가 받아 주는 조건이 어긋난다 —
   * 저장을 받는 mutation 도 **같은 함수**(resolveUsedPartsWriteGate)를 부른다.
   */
  writeGate: UsedPartsWriteGate;
};

/**
 * 반출 이력으로 **치지 않는** 요청 상태.
 *
 * 🔴 queries/product-models.ts 의 UNCOUNTED_PART_REQUEST_STATUSES 와 **같은
 * 목록이어야 한다** — 그쪽은 통계가 세는 집합을, 이쪽은 화면이 잠그는 집합을
 * 정한다. 둘이 어긋나는 순간 두 번 세거나 한 번도 안 세는 건이 생긴다.
 */
const UNCOUNTED_PART_REQUEST_STATUSES = ["REJECTED", "CANCELLED"] as const;

/**
 * 🔴 **반출 이력 판정의 유일한 정의.** 조회(이 파일)와 저장
 * (mutations/repair-case-used-parts.ts)이 이 조건 하나를 함께 쓴다 — 두 벌로
 * 적으면 한쪽만 고쳐지는 날이 오고, 그날부터 화면이 여는 건과 서버가 받아 주는
 * 건이 달라진다.
 */
export function livePartRequestCondition(repairCaseId: string): SQL | undefined {
  return and(
    eq(inventoryPartRequests.repairCaseId, repairCaseId),
    notInArray(inventoryPartRequests.status, [...UNCOUNTED_PART_REQUEST_STATUSES])
  );
}

/**
 * 🔴 **「과거 인수품 가져오기」로 들어온 건인가** — 판정의 유일한 정의.
 *
 * `status_change_histories` 에 그 건의 줄이 있고, action_type 이
 * LEGACY_IMPORT_STATE_SET 이며 metadata->>'source' 가 KYOSAN_INTAKE_LIST 인 것.
 * 그 글자는 queries/kyosan-intake-import.ts 가 이미 상수로 갖고 있어 가져다 쓴다
 * (같은 파일 listImportedCasesNeedingBillingReview 가 쓰는 조건과 같은 모양이다).
 */
export function importedFromKyosanIntakeCondition(repairCaseId: string): SQL | undefined {
  return and(
    eq(statusChangeHistories.repairCaseId, repairCaseId),
    eq(statusChangeHistories.actionType, "LEGACY_IMPORT_STATE_SET"),
    sql`${statusChangeHistories.metadata} ->> 'source' = ${KYOSAN_INTAKE_LIST_SOURCE}`
  );
}

/**
 * `db` 도 트랜잭션도 받는다 — 저장 쪽은 자기 트랜잭션 안에서 같은 판정을 다시
 * 해야 하고(화면이 열어 준 뒤 사이에 요청서가 생길 수 있다), 그때도 **같은
 * 함수**여야 한다. PgTransaction 이 PgDatabase 를 상속하므로 둘 다 들어온다.
 */
type SelectExecutor = Pick<typeof db, "select">;

/** 있나 없나만 본다 — 개수를 세지 않는다. limit(1) 이면 인덱스에서 한 줄 보고 멈춘다. */
export async function hasLivePartRequest(
  executor: SelectExecutor,
  repairCaseId: string
): Promise<boolean> {
  const probe = await executor
    .select({ present: sql<number>`1` })
    .from(inventoryPartRequests)
    .where(livePartRequestCondition(repairCaseId))
    .limit(1);
  return probe.length > 0;
}

/** 같은 방식 — 가져오기 흔적이 한 줄이라도 있으면 그만이다. */
export async function isImportedFromKyosanIntake(
  executor: SelectExecutor,
  repairCaseId: string
): Promise<boolean> {
  const probe = await executor
    .select({ present: sql<number>`1` })
    .from(statusChangeHistories)
    .where(importedFromKyosanIntakeCondition(repairCaseId))
    .limit(1);
  return probe.length > 0;
}

/**
 * 「사용 부품」 칸이 필요로 하는 것 전부를 한 번에 — 적힌 줄과, **여기에 적을 수
 * 있는 건인가**(B-2 의 두 규칙).
 *
 * 네 질의를 **나란히**(Promise.all) 쏜다 — 전부 이 건 하나만 보는 작은 인덱스
 * 조회다(`repair_case_used_parts_repair_case_id_line_no_unique` 의 선행 칼럼,
 * `inventory_part_requests_repair_case_id_idx`, repair_cases 기본키,
 * `status_change_histories` 의 건별 인덱스). 부르는 쪽도 이 함수를 자기
 * Promise.all 에 태우므로 화면이 기다리는 시간은 늘지 않는다.
 */
export async function getRepairCaseUsedPartsView(repairCaseId: string): Promise<RepairCaseUsedPartsView> {
  const [rows, hasPartRequestHistory, caseProbe, isLegacyImportedCase] = await Promise.all([
    db
      .select({
        id: repairCaseUsedParts.id,
        lineNo: repairCaseUsedParts.lineNo,
        partId: repairCaseUsedParts.partId,
        partNameText: repairCaseUsedParts.partNameText,
        quantity: repairCaseUsedParts.quantity,
      })
      .from(repairCaseUsedParts)
      .where(eq(repairCaseUsedParts.repairCaseId, repairCaseId))
      .orderBy(asc(repairCaseUsedParts.lineNo)),
    hasLivePartRequest(db, repairCaseId),
    db
      .select({ isLocked: repairCases.isLocked })
      .from(repairCases)
      .where(and(eq(repairCases.id, repairCaseId), eq(repairCases.isDeleted, false)))
      .limit(1),
    isImportedFromKyosanIntake(db, repairCaseId),
  ]);

  return {
    rows,
    hasPartRequestHistory,
    writeGate: resolveUsedPartsWriteGate({
      hasPartRequestHistory,
      // 건을 못 찾았으면(휴지통에 들어갔거나 사라졌다) **잠긴 것으로 본다** —
      // 그래야 화면이 적을 자리를 열지 않는다. 저장 쪽은 같은 경우를 NOT_FOUND 로
      // 돌려준다.
      isShipmentLocked: caseProbe[0]?.isLocked ?? true,
      isLegacyImportedCase,
    }),
  };
}
