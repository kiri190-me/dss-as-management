import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../client";
import { attachments, improvementRequests, users } from "../schema";
import type { ImprovementRequestStatus } from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선 요청 — 목록 조회 (읽기만 한다)
 * ============================================================================
 * 설정 › 「개선 요청」 화면이 부른다. 표의 뜻과 설계의 이유는
 * db/schema/improvement-requests.ts 머리말에 있다.
 *
 * ── 사람으로 거르지 않는다 ──────────────────────────────────────────────
 * 목록은 **모두가 본다**(schema 헤더). 누가 이 화면에 들어올 수 있는가는 페이지가
 * 정하고, 누가 어느 글을 고치거나 지울 수 있는가는 도메인 함수
 * (domain/improvement-request.ts)를 화면이 불러 단추를 그릴지 정한다 — 이 조회는
 * 그 판정에 필요한 값(status · createdByUserId · version)을 그대로 넘길 뿐이다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 * 최근 글부터(created_at 내림차순). 같은 시각이면 id 로 한 번 더 정렬해, 새로
 * 고침할 때마다 두 줄이 자리를 바꾸지 않게 한다.
 *
 * ── 이름은 세 사람 ──────────────────────────────────────────────────────
 * 적은 사람 · 진행중으로 옮긴 사람 · 해결한 사람. users 를 별칭 셋으로 붙인다.
 * 적은 사람은 언제나 있으므로(created_by NOT NULL + FK RESTRICT) 안쪽 조인이고,
 * 나머지 둘은 비어 있을 수 있으므로 바깥 조인이다. 소프트 삭제된 계정도 이름은
 * 그대로 보인다 — 적은 사람이 떠났다고 「누가 요청했는가」가 사라지면 안 된다.
 *
 * ── 시각은 ISO 문자열 ───────────────────────────────────────────────────
 * 서버 컴포넌트가 클라이언트로 넘기는 값이라 Date 를 그대로 두지 않는다.
 *
 * 🔴 body 는 자유 입력이다(schema 헤더의 PII). 화면에 그리는 것 말고는 어디로도
 * 내보내지 않는다.
 *
 * ── 스크린샷은 한 번에 읽어 묶는다 (2026-09-13) ─────────────────────────
 * 글마다 살아 있는 스크린샷(그 글이 주인이고 휴지통에 없는 첨부)을 올린 차례대로
 * 싣는다. 🔴 **글마다 조회하지 않는다(N+1 금지)** — 글 목록을 읽은 뒤 그 id 들로
 * attachments 를 **한 번** 읽어(`improvement_request_id IN (...) AND is_deleted =
 * false` — 부분 인덱스 attachments_improvement_request_id_not_deleted_idx 를 타는
 * 모양) 글 id 로 묶는다. 그래서 글이 몇 개든 조회는 둘이다(글이 없으면 하나).
 *
 * 「스크린샷」의 정의는 올리기 통로가 5장을 셀 때와 같다 — 분류로 다시 거르지 않는다.
 * 개선 요청이 주인인 첨부는 올리기 통로가 언제나 SCREENSHOT 으로 만들고, 셈과 목록이
 * 다른 정의를 쓰면 화면에는 넉 장인데 「5장까지」로 거절되는 일이 생긴다.
 *
 * 미리보기 경로(preview_path)는 내보내지 않는다 — 저장 루트 아래의 내부 구조다. 화면은
 * 「있는가」만 알면 되고, 썸네일은 내려받기 통로(`?view=thumb`)가 경로를 대신 고른다.
 * ============================================================================
 */

/** 글 한 건에 붙은 살아 있는 스크린샷 하나. */
export type ImprovementRequestScreenshot = {
  /** 첨부 id — 내려받기 통로(/api/attachments/{id}/download)와 지우기 액션이 받는 값. */
  id: string;
  /** 올린 사람이 붙인 원래 이름. 표시에만 쓴다(PII 가 섞일 수 있다 — schema/attachments.ts). */
  originalFileName: string;
  /** 미리보기(썸네일)가 있는가. 없으면 화면은 `?view=thumb` 가 원본을 돌려준다고 알면 된다. */
  hasPreview: boolean;
  /** 올린 시각(ISO). */
  uploadedAt: string;
};

const author = alias(users, "improvement_request_author");
const inProgressUser = alias(users, "improvement_request_in_progress_user");
const resolvedUser = alias(users, "improvement_request_resolved_user");

export type ImprovementRequestListItem = {
  id: string;
  body: string;
  /**
   * 어느 메뉴 아래의 일인가 — navItems 의 key 그대로(이름이 아니다). `null` 은 메뉴
   * 칸이 생기기 전의 글이다. 이름은 화면이 improvementRequestMenuLabel 로 푼다 —
   * 사이드바에서 빠진 옛 열쇠도 걸러 내지 않고 넘긴다(화면이 「(없어진 메뉴)」로 읽는다).
   */
  menuKey: string | null;
  status: ImprovementRequestStatus;
  createdByUserId: string;
  createdByName: string;
  createdAt: string;
  /** 진행중으로 옮긴 사람과 때. 접수 상태면 셋 다 `null`. */
  inProgressByUserId: string | null;
  inProgressByName: string | null;
  inProgressAt: string | null;
  /** 해결로 옮긴 사람과 때. 해결 상태가 아니면 셋 다 `null`. */
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  /** 고치기·상태 옮기기·지우기가 expectedVersion 으로 돌려보낼 값. */
  version: number;
  /** 살아 있는 스크린샷, 올린 차례대로(먼저 올린 것부터). 없으면 빈 배열. */
  screenshots: ImprovementRequestScreenshot[];
};

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/**
 * 글 id 들의 살아 있는 스크린샷을 **한 번의 조회로** 읽어 글 id 로 묶는다(파일 헤더의
 * '스크린샷은 한 번에 읽어 묶는다'). 올린 시각 오름차순, 같은 시각이면 id 로 — 새로
 * 고칠 때마다 두 장이 자리를 바꾸지 않게.
 */
async function listLiveScreenshotsByRequest(
  improvementRequestIds: readonly string[]
): Promise<Map<string, ImprovementRequestScreenshot[]>> {
  const grouped = new Map<string, ImprovementRequestScreenshot[]>();
  if (improvementRequestIds.length === 0) return grouped;

  const rows = await db
    .select({
      id: attachments.id,
      improvementRequestId: attachments.improvementRequestId,
      originalFileName: attachments.originalFileName,
      previewPath: attachments.previewPath,
      uploadedAt: attachments.uploadedAt,
    })
    .from(attachments)
    .where(
      and(
        inArray(attachments.improvementRequestId, [...improvementRequestIds]),
        eq(attachments.isDeleted, false)
      )
    )
    .orderBy(asc(attachments.uploadedAt), asc(attachments.id));

  for (const row of rows) {
    // IN 조건이라 NULL 은 올 수 없지만, 타입이 nullable 이라 한 번 거른다.
    if (row.improvementRequestId === null) continue;
    const list = grouped.get(row.improvementRequestId) ?? [];
    list.push({
      id: row.id,
      originalFileName: row.originalFileName,
      hasPreview: row.previewPath !== null,
      uploadedAt: row.uploadedAt.toISOString(),
    });
    grouped.set(row.improvementRequestId, list);
  }
  return grouped;
}

/** 모든 개선 요청 — 최근 글부터. */
export async function listImprovementRequests(): Promise<ImprovementRequestListItem[]> {
  const rows = await db
    .select({
      id: improvementRequests.id,
      body: improvementRequests.body,
      menuKey: improvementRequests.menuKey,
      status: improvementRequests.status,
      createdByUserId: improvementRequests.createdBy,
      createdByName: author.name,
      createdAt: improvementRequests.createdAt,
      inProgressByUserId: improvementRequests.inProgressBy,
      inProgressByName: inProgressUser.name,
      inProgressAt: improvementRequests.inProgressAt,
      resolvedByUserId: improvementRequests.resolvedBy,
      resolvedByName: resolvedUser.name,
      resolvedAt: improvementRequests.resolvedAt,
      updatedAt: improvementRequests.updatedAt,
      version: improvementRequests.version,
    })
    .from(improvementRequests)
    .innerJoin(author, eq(author.id, improvementRequests.createdBy))
    .leftJoin(inProgressUser, eq(inProgressUser.id, improvementRequests.inProgressBy))
    .leftJoin(resolvedUser, eq(resolvedUser.id, improvementRequests.resolvedBy))
    .orderBy(desc(improvementRequests.createdAt), desc(improvementRequests.id));

  const screenshotsByRequest = await listLiveScreenshotsByRequest(rows.map((row) => row.id));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    inProgressAt: toIsoOrNull(row.inProgressAt),
    resolvedAt: toIsoOrNull(row.resolvedAt),
    updatedAt: row.updatedAt.toISOString(),
    screenshots: screenshotsByRequest.get(row.id) ?? [],
  }));
}
