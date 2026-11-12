import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import { resolveDomesticOrderPurchaseOrderArchiveLookup } from "@/lib/domain/domestic-order-purchase-order-archive";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { resolvePurchaseOrderArchiveRoot } from "@/lib/storage/purchase-order-archive";
import { findPurchaseOrderArchiveFolderByNumber } from "@/lib/storage/purchase-order-number-archive";

/**
 * ============================================================================
 * GET /api/domestic-orders/{id}/purchase-order-folder/entries
 * — 기타건(내자 정리 한 줄)에 **적힌 발주서번호**의 폴더 안에 무엇이 있는가 (2026-11-06)
 * ============================================================================
 * 기타건 상세 「발주서」 탭의 공유폴더 구역이 부른다. 사용자 결정 2026-11-06: 「[발주서]는
 * 내자정리에 적힌 **[발주서 번호]**를 통해서 발주서들을 찾도록 해줘 … **같은 발주서 번호를
 * 가진 폴더와 연결**시켜줘」. 문지기 · 응답 모양 · 금지 사항은 이웃 둘을 본떴다 —
 * 수리 건 쪽 통로(api/repair-cases/[id]/purchase-order-folder/entries)와 바로 앞 조각의
 * 견적서 통로(api/domestic-orders/[id]/quote-archive-folder/entries).
 *
 * ── 🔴 **번호를 요청에서 받지 않는다** ─────────────────────────────────────
 * 받는 것은 **내자 줄의 id 하나**다. 발주서번호는 서버가 그 줄에서 꺼낸다
 * (domain/domestic-order-purchase-order-archive.ts). 번호를 요청에 실어 받으면 내자 정리를
 * 볼 수 있는 사람이 **아무 발주서 번호나 넣어 남의 발주 건 폴더를 들여다볼 수 있다** — 그
 * 폴더에는 다른 고객사의 발주서와 금액이 그대로 들어 있다. 그래서 이 파일에는 `searchParams`
 * 도 본문 읽기도 없다.
 *
 * ── 🔴 열쇠는 `domesticOrders` READ **하나**다 ────────────────────────────
 * 나가는 것은 **고객사가 우리에게 낸 발주서(내자)** 자료이고, 폴더 이름에 발주 금액이 들어
 * 있다(`… - 16,720,000원`). 「발주서를 볼 수 있는가」는 이미 그 하나가 답하고 있다 — 수리 건
 * 쪽 통로와 **같은 글자**이고, 새 영역을 만들면 관리자가 한쪽만 풀어 둔 상태가 생긴다.
 *  · 🔵 **견적서 열쇠(`quotes`)를 묻지 않는다** — 바로 앞 조각의 견적서 통로가 둘을 묻는 것은
 *    그쪽이 **견적서 폴더**를 열기 때문이다. 여기서 나가는 것은 발주서이고, 그 문은 하나다.
 *  · 🔴 권한이 **두 겹**인 것은 그대로다: 탭 페이지(레이아웃의 영역 가드)가 한 번, 이 통로가
 *    스스로 한 번. 화면이 감춘 것은 관문이 아니다 — 주소를 직접 치면 그대로 들어와진다.
 *
 * ── 🔴 **발주발행일로 문을 열지 않는다**(수리 건 통로와 다른 한 가지) ───────
 * 수리 건 통로는 발주발행일이 비면 공유폴더를 아예 안 본다(사용자 결정 2026-10-12). 거기서는
 * **찾는 열쇠가 장비(L/N · S/N)** 라 발주가 안 나간 건에 **지난 발주서**가 걸리기 때문이다.
 * 여기서는 열쇠가 **그 줄에 적힌 번호 자체**이고, 번호가 있다는 것은 발주가 이미 났다는 뜻이며
 * 그 번호의 폴더는 정의상 이 줄의 발주 건이다. 까닭은 순수 함수 머리말에 길게 적어 두었다 —
 * 🔴 **이 통로가 그 판단을 다시 하지 않는다**(날짜 칸을 아예 읽지 않는다).
 *
 * ── 🔴 찾아볼 수 없는 줄은 **디스크를 보지 않는다** ────────────────────────
 * 쓸 수 있는 번호가 없으면 `no-po-number` 로 끝난다. 🔴 그 판단보다 **공유폴더 설정이
 * 먼저**다 — 설정이 없는 개발 PC 에서 「번호가 없습니다」를 내밀면 설정이 있는 운영처럼 보인다.
 *
 * ── 🔴 목록만 낸다 · 아무것도 만들지 않는다 · 절대 경로를 싣지 않는다 ──────
 * 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷과 루트 기준 상대 경로뿐이다. 파일
 * 바이트를 중계하지 않고(공유폴더의 파일은 첨부 통로의 검사 밖에 있다), mkdir · 파일 쓰기 ·
 * DB 쓰기 · 쓰기 메서드가 없다. 감사도 남기지 않는다 — 기록할 변경이 없다. 그 사실을
 * route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ─────────────────────────────
 * 같은 번호의 폴더가 둘이면 `multiple` 하나로 끝낸다(경로도 내지 않는다). 번호가 같다고 같은
 * 발주 건이라는 보장이 없다 — 사람이 남의 폴더에 번호를 잘못 적어 둔 날, 임의로 하나를
 * 고르면 그것이 곧 남의 발주서를 보여 주는 길이다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(domesticOrders READ)
 *  → 4) 내자 줄(휴지통이면 없는 것) → 5) 공유폴더 루트(꺼져 있으면 disabled)
 *  → 6) 번호(없으면 no-po-number — 여기서 끝난다) → 7) 번호로 찾아 읽기
 *  → 8) 주소 규칙 → 9) JSON
 *
 * 권한이 조회보다 앞이다 — 권한이 없는 사람에게는 그 id 의 줄이 있다는 사실도 알려 주지
 * 않는다. 문턱을 넘었는데 그 줄이 안 보이면 404 다(403 으로 갈라 답하면 존재가 새어 나간다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, entries, totalCount, truncated }`
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }` · `{ status: "no-po-number" }`
 *  · 200 `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 한 줄. 🔴 **경로를 담는 칸이 타입 수준에 없다** — 이름은 폴더 안에서의 이름뿐이다. */
type PurchaseOrderEntryBody = {
  name: string;
  isDirectory: boolean;
  /** 폴더는 0 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(ISO). 그 한 줄의 stat 이 막혔으면 **이 칸만 빠진다.** */
  modifiedAt?: string;
};

/** 응답 본문. 🔴 컨테이너 안 경로 · 전체 공유폴더 주소를 담는 칸이 없다. */
type DomesticOrderPurchaseOrderFolderEntriesResponse =
  | {
      status: "found";
      /** 루트 기준 슬래시 경로 — `연도/고객사/발주 건`. 화면이 줄의 [열기] 주소에 쓴다. */
      relativePath: string;
      entries: PurchaseOrderEntryBody[];
      /** 거른 뒤의 전체 줄 수. 아래 truncated 가 참이면 entries.length 보다 크다. */
      totalCount: number;
      /** 🔴 줄 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 목록도 경로도 없다 — 어느 폴더인지 모르는 채로 내용을 보이지 않는다. */
  | { status: "multiple" }
  | { status: "not-found" }
  /** 🔴 내자 줄에 쓸 수 있는 발주서번호가 없다 — 공유폴더를 **보지 않았다**. */
  | { status: "no-po-number" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 수리 건 쪽 통로와 **같은 문장**이다 — 같은 서류함을 두고 두 자리가 다른 말을 하지 않게. */
const UNOPENABLE_FOLDER_REASON =
  "발주서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: DomesticOrderPurchaseOrderFolderEntriesResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(빈 문자열을 내지 않는다). */
function modifiedAtOf(modifiedAtMs: number | null): { modifiedAt?: string } {
  if (modifiedAtMs === null || !Number.isFinite(modifiedAtMs)) return {};
  return { modifiedAt: new Date(modifiedAtMs).toISOString() };
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 저장 모드 ──────────────────────────────────────────────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }

  // ── 3) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  // 🔴 2026-11-12(둘째)에 `domesticOrders` → `domesticOrders.view` 로 내려왔다(그 메뉴가
  //    잎 넷으로 쪼개졌다). 이 통로가 내주는 것을 그리는 탭(기타건 상세의 [발주서])과
  //    **같은 열쇠**여야 한다 — 그 탭은 같은 날부터 이 잎으로 가려진다. 갈리면 탭은
  //    열리는데 폴더만 안 열린다. 통과하는 역할은 쪼개기 전과 다르지 않다.
  if (!(await hasPermission(actingUser, "domesticOrders.view", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 내자 줄 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  //    🔴 화면(기타건 상세)이 읽는 **그 조회 그대로**다 — 번호를 여기서 다시 고르지 않는다.
  const { id } = await context.params;
  const row = await getDomesticOrderDetail(id);
  if (!row) {
    return fail(404, "NOT_FOUND", "해당 줄을 찾을 수 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ───
  //    🔴 번호 판정보다 **먼저**다(설정이 없는 환경이 있는 환경처럼 보이지 않게).
  const archiveRoot = resolvePurchaseOrderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 🔴 쓸 수 있는 번호가 없으면 **여기서 끝난다** — 디스크를 보지 않는다 ──
  const lookup = resolveDomesticOrderPurchaseOrderArchiveLookup(row);
  if (lookup.status === "no-po-number") {
    return respond({ status: "no-po-number" });
  }

  // ── 7) 번호로 찾아 읽는다 — 🔴 **둘째 마디가 같은** 폴더 하나만 ──────────
  const found = await findPurchaseOrderArchiveFolderByNumber({
    root: archiveRoot,
    purchaseOrderNumber: lookup.purchaseOrderNumber,
  });

  // ── 8~9) JSON — 상대 경로 · 줄 · 짧은 사유만 ─────────────────────────
  if (found.status === "found") {
    // 도우미가 받지 않을 이름이면 줄마다의 [열기] 주소를 만들 수 없다 — 미리 알린다.
    if (!isQuoteFolderRelativePath(found.relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    return respond({
      status: "found",
      relativePath: found.relativePath,
      entries: found.entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        sizeBytes: entry.sizeBytes,
        ...modifiedAtOf(entry.modifiedAtMs),
      })),
      totalCount: found.totalCount,
      truncated: found.truncated,
    });
  }
  if (found.status === "multiple") {
    return respond({ status: "multiple" });
  }
  if (found.status === "not-found") {
    return respond({ status: "not-found" });
  }
  if (found.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: found.reason });
}
