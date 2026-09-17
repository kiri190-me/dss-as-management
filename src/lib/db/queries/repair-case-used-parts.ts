import "server-only";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../client";
import { inventoryPartRequests, repairCaseUsedParts } from "../schema";

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
 * 「사용 부품」 칸이 필요로 하는 것 전부를 한 번에.
 *
 * 두 질의를 **나란히**(Promise.all) 쏜다 — 둘 다 이 건 하나만 보는 작은 인덱스
 * 조회다(`repair_case_used_parts_repair_case_id_line_no_unique` 의 선행 칼럼,
 * `inventory_part_requests_repair_case_id_idx`). 부르는 쪽도 이 함수를 자기
 * Promise.all 에 태우므로 화면이 기다리는 시간은 늘지 않는다.
 */
export async function getRepairCaseUsedPartsView(repairCaseId: string): Promise<RepairCaseUsedPartsView> {
  const [rows, requestProbe] = await Promise.all([
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
    // 있나 없나만 본다 — 개수를 세지 않는다. limit(1) 이면 인덱스에서 한 줄
    // 보고 멈춘다.
    db
      .select({ present: sql<number>`1` })
      .from(inventoryPartRequests)
      .where(
        and(
          eq(inventoryPartRequests.repairCaseId, repairCaseId),
          notInArray(inventoryPartRequests.status, [...UNCOUNTED_PART_REQUEST_STATUSES])
        )
      )
      .limit(1),
  ]);

  return { rows, hasPartRequestHistory: requestProbe.length > 0 };
}
