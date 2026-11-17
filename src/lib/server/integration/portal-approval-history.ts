/**
 * ============================================================================
 * 통합 승인함이 「이 사람이 이 기간에 한 결재」를 물어 올 때의 판단
 * ============================================================================
 * 조각 10a 가 조회를 만들었고(db/queries/approval-history.ts), 여기는 그것을
 * **밖으로 내줄 모양**으로 옮기는 자리다. 라우트에는 「토큰 꺼내 검증하고 이 함수
 * 부르기」만 남는다 — portal-notifications.ts · portal-approvals.ts 와 같은 틀이고,
 * DB 를 인자로 받는 까닭도 같다(DB 없이 그대로 시험할 수 있다).
 *
 * ── 🔴 통로 계약은 **세 집(A/S · 재고관리 · 휴가)이 글자 그대로 같다** ────────
 *     GET /api/integration/approval-history?from=<ISO8601>&to=<ISO8601>
 *     → { entries: [ { id, subject, approvalName, decidedAt, decision,
 *                      relation, counterpartName, href } ] }
 * 포털이 셋을 모아 한 화면에 그린다. 한 글자라도 어긋나면 **그 집 것만 조용히 안
 * 그려진다** — 오류도 로그도 없다. 그래서 아래 타입의 칸 이름을 이 집 사정으로
 * 고치지 마라. 고치려면 세 집과 포털을 함께 고쳐야 한다.
 *
 * ── 🔴 A/S 안의 줄과 **같은 타입이 아니다** ──────────────────────────────
 * `ApprovalHistoryEntry`(domain/approval-history.ts)에는 포털에 줄 까닭이 없는 칸이
 * 여럿 있다 — 올리며 적은 말 · 결정하며 적은 말 · 사람 id · 그 건의 id. 결재 사유에는
 * 고객사나 사람 이야기가 그대로 적혀 있을 수 있고, 통합 화면은 그것을 그릴 자리도
 * 없다. 그래서 **계약의 여덟 칸만** 골라 옮긴다(아래 toPortalApprovalHistoryEntry).
 *
 * ── 🔴 `relation` 은 보는 사람 기준이고, 계약의 값은 **넷**이다 ──────────────
 *  · `SELF`        내가 내 자리를 눌렀다
 *  · `ON_BEHALF`   내가 **남을 대신해** 눌렀다 (상대 = 자리 주인)
 *  · `BY_DELEGATE` **내 자리를 남이** 눌렀다 (상대 = 누른 사람)
 *  · `UNKNOWN`     누른 사람이 **안 적힌 옛 줄**
 * 🔵 **A/S 는 넷째를 내지 않는다.** 이 집은 「누가 눌렀나」를 칸에 적어 두고
 * (`decided_by_user_id`), 결정된 줄에 그 칸이 비는 일이 표의 CHECK 으로 막혀 있다 —
 * 조회도 비면 그 줄을 버린다. 그래서 아래 타입의 `relation` 은 셋뿐이고, 넷째를
 * 흉내 내는 가짜 값을 만들지 마라. 나머지 두 집은 그 칸이 없어 넷째가 실제로 나온다.
 * ============================================================================
 */

import { absoluteNotificationHref } from "@/lib/domain/notification-links";
import type {
  ApprovalHistoryDecision,
  ApprovalHistoryEntry,
  ApprovalHistoryRelation,
} from "@/lib/domain/approval-history";
import type { ApprovalHistoryPeriod } from "@/lib/db/queries/approval-history";
import { portalActorCanWork, type FindActorBySsoSubject } from "./portal-notifications";

/** 내역 한 줄 — 🔴 **이 모양이 세 집의 계약이다.** */
export type PortalApprovalHistoryEntry = {
  /**
   * 이 집 안에서 유일한 열쇠. 포털이 목록의 열쇠로 쓰고, 제 쪽 접두사를 한 번 더
   * 붙인다(`{client_id}:{id}` — 종·승인함과 같은 모양).
   *
   * 🔴 **갈래 딱지를 앞에 붙인다.** 결재가 쌓이는 표가 둘이라(`repair_case_approvals`
   * · `quote_approvals`) 행 id 만으로는 「이 집 안에서 유일」을 표가 보장하지 않는다.
   *
   * 🔵 **단계 번호는 붙이지 않는다**(재고관리는 붙였다 — 2026-11-17). 그 집은 한
   * 신청의 **단계마다** 줄이 서므로 (신청, 단계)가 열쇠인데, 이 집의 열쇠는 결재
   * **행 하나**(`approvals.id`)다. 같은 건의 검수와 출하는 **행이 둘**이고, 반려 뒤
   * 다시 올려 결정된 것도 행이 따로라 행 id 만으로 이미 갈린다. 🔴 한 행이 두 갈래로
   * 셀 일도 없다 — 같은 표의 접수 건 행과 기타건 행은 표의 CHECK 둘이 「주체 칸이 둘 다
   * 차 있는 행은 없다」를 못 박고 있어, 조회 셋이 저마다 INNER JOIN 으로 한 번씩만 집는다.
   *
   * 🔵 종의 결과 알림 열쇠(`APPROVAL_GRANTED:rca:<uuid>`)를 쓰지 않는 까닭: 그 열쇠에는
   * **승인이냐 반려냐가 박혀 있다.** 내역의 열쇠는 결재 행 하나를 가리키면 되고,
   * 결과 글자를 열쇠에 섞으면 받는 쪽이 그 글자로 무언가를 판단하기 시작한다.
   */
  id: string;
  /** 사람이 알아보는 글자 — 인수번호 · 발행번호 · 품명. 🔴 비지 않는다. */
  subject: string;
  /** 무슨 결재인가 — 「수리 검수 승인」·「최종 출하 승인」·「견적서 승인」… */
  approvalName: string;
  /** ISO 8601(UTC `Z`). 🔴 **결정** 시각이다 — 요청 시각이 아니다. */
  decidedAt: string;
  decision: ApprovalHistoryDecision;
  /** 🔴 보는 사람 기준(파일 머리말). A/S 는 `UNKNOWN` 을 내지 않는다. */
  relation: ApprovalHistoryRelation;
  /**
   * 상대 사람 이름. 🔴 **누가 상대인가는 `relation` 이 정한다** — 내가 대신 누른
   * 줄이면 **자리 주인**이고, 내 자리를 남이 누른 줄이면 **누른 사람**이다.
   * `SELF` 면 상대가 없어 `null` 이다.
   */
  counterpartName: string | null;
  /** 🔴 **절대 주소.** 포털 화면에서 눌러도 A/S 로 온다. */
  href: string;
};

export type PortalApprovalHistory = {
  entries: PortalApprovalHistoryEntry[];
};

/**
 * 계정을 못 찾았을 때의 답. 🔴 **오류가 아니다** — 아래 buildPortalApprovalHistory
 * 의 그 절을 보라.
 */
const EMPTY_HISTORY: PortalApprovalHistory = { entries: [] };

/**
 * 이름이 비어 오면 `null` 로 돌린다.
 *
 * 조회는 사람 이름을 LEFT JOIN 으로 들고 오고, 못 찾으면 빈 글자를 넣는다
 * (queries/approval-history.ts 의 `row.decidedByName ?? ""`). 빈 글자를 그대로
 * 내보내면 포털은 **이름이 있는 줄**로 보고 「· 」 같은 자리만 그린다. 「모른다」는
 * 계약에 이미 `null` 로 적을 자리가 있으니 그쪽으로 보낸다.
 */
function nameOrNull(name: string | null): string | null {
  if (name === null) return null;
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 「상대는 누구인가」 — 🔴 **`relation` 마다 다른 칸을 본다.**
 *
 * 뒤바꾸면 「내가 대신 눌러 준 사람」 자리에 **내 이름**이 선다. 그 어긋남은 오류를
 * 내지 않고 포털 화면에서 「내가 나를 대신했다」로만 보인다.
 */
export function portalApprovalHistoryCounterpart(entry: ApprovalHistoryEntry): string | null {
  // 내가 남의 자리를 눌렀다 → 상대는 **자리 주인**이다.
  if (entry.relation === "ON_BEHALF") return nameOrNull(entry.delegatedFromName);
  // 내 자리를 남이 눌렀다 → 상대는 **누른 사람**이다.
  if (entry.relation === "BY_DELEGATE") return nameOrNull(entry.decidedByName);
  // 직접 누른 줄에는 상대가 없다.
  return null;
}

/**
 * A/S 안의 내역 한 줄 → 포털에 내줄 한 줄.
 *
 * 🔴 **제목 · 결재 이름 · 주소를 여기서 새로 짓지 않는다.** 셋 다 조회가 이미
 * 도메인(domain/approval-history.ts)에서 지어 실어 온 값이고, 그 도메인은 종이 쓰는
 * 함수 셋을 그대로 부른다. 여기서 한 글자라도 다시 적으면 같은 결재가 종과 내역에서
 * 다른 말로 선다.
 *
 * 🔴 **주소에 기준 주소를 붙이는 자리가 여기다.** 조회가 주는 것은 상대 주소이고
 * (`/repair-cases/…`), 그대로 내보내면 포털 화면에서 **포털 안의 없는 주소**로 간다
 * (domain/notification-links.ts 머리말). 기준 주소는 **요청의 Host 가 아니라**
 * 환경에서 온다 — 부르는 쪽이 적는 값에 주소가 끌려가면 그대로 피싱 링크가 된다.
 */
export function toPortalApprovalHistoryEntry(
  entry: ApprovalHistoryEntry,
  baseUrl: string
): PortalApprovalHistoryEntry {
  return {
    id: `${entry.source}:${entry.approvalId}`,
    subject: entry.subject,
    approvalName: entry.approvalName,
    decidedAt: entry.decidedAt,
    decision: entry.status,
    relation: entry.relation,
    counterpartName: portalApprovalHistoryCounterpart(entry),
    href: absoluteNotificationHref(entry.href, baseUrl),
  };
}

/** 기간을 읽어 낸 결과. 🔴 못 읽으면 통로가 400 `invalid_period` 로 답한다. */
export type ApprovalHistoryPeriodParse =
  | { ok: true; period: ApprovalHistoryPeriod }
  | { ok: false };

/**
 * 🔴 **모양 한 겹 — 시간대가 적힌 ISO 8601 만 받는다.**
 *
 * 🔴 **세 집(A/S · 재고관리 · 휴가)이 글자 그대로 같은 정규식을 쓴다**(2026-11-17).
 * 여기서 한 글자라도 넓히거나 좁히면 같은 요청을 집마다 다르게 답하게 된다.
 *
 * 걸러 내는 것 셋, 전부 **오류 없이 틀린 답을 내는** 꼴이다:
 *  1. 🔴 **`new Date()` 만으로는 `"0"` 이 `NaN` 이 아니다**(재고관리 실측:
 *     `1999-12-31T15:00:00.000Z`. `"2026"` 도 2026-01-01 로 읽힌다). 거르지 않으면
 *     `?from=0` 이 **26년치 기간**으로 조용히 열린다.
 *  2. 🔴 **`2026-11-01T00:00:00`(T 는 붙었는데 시간대가 없음)은 그 기계의 지역 시간**
 *     으로 읽힌다. 개발 PC(KST)와 NAS 컨테이너(UTC)가 **아홉 시간** 어긋나고, 증상은
 *     「월말 하루치가 안 보인다」뿐이라 원인을 찾기 어렵다.
 *  3. 🔴 **날짜만(`2026-11-01`)은 UTC 자정** = 한국 시간 그날 오전 9시다. 「11월」을
 *     물었는데 첫날 아홉 시간이 조용히 빠진다.
 *
 * 🔵 실제 트래픽은 걸리지 않는다 — 포털이 보내는 값은 `toISOString()` 이라 언제나
 * `Z` 로 끝난다. 넘치는 날짜(`2026-02-30`)의 판정은 그대로 Date 에 맡긴다.
 */
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

/**
 * 쿼리 한 칸을 **그 순간**으로. 없거나 못 읽으면 `null`.
 *
 * 🔴 **읽은 값을 손보지 않는다** — 하루를 더하지도, 자정으로 내리지도, 한국 시간으로
 * 옮기지도 않는다. 기간은 반열린 구간 `[from, to)` 이고(ApprovalHistoryPeriod 주석),
 * 끝 값에 하루를 더하는 친절이 들어가는 순간 그 반열림이 조용히 깨진다. 「어디까지를
 * 뜻하는가」는 **부르는 쪽이 적어 보낸다.**
 *
 * 🔴 **시간대는 부르는 쪽이 적어 보낸다** — 위 ISO_WITH_ZONE 이 그것을 요구한다.
 * 여기서 KST 로 멋대로 옮기지도, 빠진 시간대를 짐작해 채우지도 않는다. 짐작은 세 집
 * 가운데 이 집에만 들어가고, 그러면 같은 요청이 집마다 다른 순간을 뜻하게 된다.
 *
 * 🔴 **`+09:00` 을 그대로 쿼리에 붙이면 못 읽는다.** `+` 는 쿼리 문자열에서 **공백**
 * 으로 풀린다(`2026-11-17T00:00:00 09:00`). 부르는 쪽이 `%2B` 로 적거나 UTC `Z` 로
 * 보내야 한다 — 공백을 `+` 로 되돌리는 짐작도 넣지 않는다(위와 같은 까닭).
 */
function readInstant(raw: string | null): Date | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!ISO_WITH_ZONE.test(trimmed)) return null;
  const at = new Date(trimmed);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * `?from=…&to=…` → 재는 기간.
 *
 * 🔴 **둘 다 필수다.** 기본값을 두지 않는 것은 조회가 기간을 선택 인자로 두지 않은
 * 것과 같은 까닭이다 — 기간을 빠뜨린 요청이 조용히 **전 기간**을 열면, 그 실수는
 * 「줄이 좀 많네」로만 보인다.
 *
 * 🔴 **거꾸로 된 기간(`to` ≤ `from`)은 거절하지 않는다.** 그런 구간에는 드는 줄이
 * 없어 답이 **빈 목록**이고(조회의 `decided_at >= from AND decided_at < to` 가 함께
 * 참일 수 없다), 그것이 「아무것도 들지 않는 구간」의 정직한 답이다. 계약이 400 으로
 * 적어 둔 것은 **없거나 못 읽는** 둘뿐이다 — 계약에 없는 400 을 이 집만 내면 포털이
 * 그것을 **이 집의 고장**으로 읽고, 승인함에서 이 집 줄이 통째로 사라진다
 * (2026-11-17, 세 집이 함께 정한 것).
 *
 * 🔴 **사람은 여기서 읽지 않는다.** 이 함수가 돌려주는 것은 기간뿐이고, 그래서
 * 쿼리에 `sub` 를 붙여 보내도 흘러들 자리가 없다 — 대상 사람은 토큰 안에서만 온다
 * (라우트 머리말).
 */
export function parseApprovalHistoryPeriod(params: URLSearchParams): ApprovalHistoryPeriodParse {
  const from = readInstant(params.get("from"));
  const to = readInstant(params.get("to"));
  if (from === null || to === null) return { ok: false };
  return { ok: true, period: { from, to } };
}

/**
 * 「이 사람이 이 기간에 한(또는 제 자리를 맡겨 남이 한) 결재」 전부.
 *
 * 🔴 **대상 사람은 `subject` 하나로만 정해진다** — 토큰이 실어 온 포털 쪽 id 다.
 * 그 값을 A/S `users.id` 로 되짚는 일은 `findActor` 가 하고, 조회에는 **되짚은
 * id 만** 넘어간다. 부르는 쪽이 남의 번호를 끼워 넣을 자리가 이 함수 안에 없다.
 *
 * 🔴 **A/S 에 계정이 없는 사람은 빈 목록이다 — 오류가 아니다**(설계서 F-3). 포털은
 * **세 집에 같은 질문을 동시에** 던져 한 화면에 모은다. 다른 집에만 계정이 있는
 * 사람은 흔한데, 그때 이 집이 4xx/5xx 를 뱉으면 포털이 그 줄을 실패로 보고 **나머지
 * 두 집의 내역까지** 못 그릴 수 있다. 「이 집에는 내역이 없다」와 「물어볼 수 없었다」는
 * 사람에게 전혀 다른 말이고, 앞의 것이 사실이다.
 * 🔵 정지·미승인·잠긴 계정도 같다(portalActorCanWork) — 옆 통로 둘과 같은 줄이다.
 *
 * 🔴 **차례를 다시 세우지 않는다.** 조회가 결정이 늦은 것부터 세워서 준다
 * (compareApprovalHistoryNewestFirst). 여기서 한 번 더 세우면 규칙이 두 벌이 된다.
 */
export async function buildPortalApprovalHistory(params: {
  subject: string;
  baseUrl: string;
  period: ApprovalHistoryPeriod;
  findActor: FindActorBySsoSubject;
  listHistory: (
    viewerUserId: string,
    period: ApprovalHistoryPeriod
  ) => Promise<readonly ApprovalHistoryEntry[]>;
}): Promise<PortalApprovalHistory> {
  const actor = await params.findActor(params.subject);
  if (!actor || !portalActorCanWork(actor)) return EMPTY_HISTORY;

  const entries = await params.listHistory(actor.id, params.period);
  return {
    entries: entries.map((entry) => toPortalApprovalHistoryEntry(entry, params.baseUrl)),
  };
}
