import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getDomesticOrderDetail } from "@/lib/db/queries/domestic-orders";
import { resolveDomesticOrderQuoteArchiveLookup } from "@/lib/domain/domestic-order-quote-archive";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { listQuoteArchiveEntries } from "@/lib/storage/quote-archive-entries";
import { resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";

/**
 * ============================================================================
 * GET /api/domestic-orders/{id}/quote-archive-folder/entries
 * — 기타건(내자 정리 한 줄)에 **적힌 견적서번호**의 폴더 안에 무엇이 있는가 (2026-11-06)
 * ============================================================================
 * 기타건 상세 「견적서」 탭의 공유폴더 구역이 부른다 — 🔴 **시스템 견적서가 없는 줄**에서만
 * 이 길을 탄다. 견적서가 있는 줄은 이웃 통로(api/quotes/[id]/archive-folder/entries)를
 * 그대로 쓴다(수리 건 탭과 같은 길). 문지기 · 응답 모양 · 금지 사항은 그 통로와
 * 이웃(api/repair-cases/[id]/purchase-order-folder/entries)을 본떴다.
 *
 * ── 🔴 **번호를 요청에서 받지 않는다** ─────────────────────────────────────
 * 받는 것은 **내자 줄의 id 하나**다. 견적서번호는 서버가 그 줄에서 꺼낸다
 * (domain/domestic-order-quote-archive.ts). 번호를 요청에 실어 받으면 내자 정리를 볼 수
 * 있는 사람이 **아무 견적서 번호나 넣어 남의 폴더를 들여다볼 수 있다** — 그 폴더에는 다른
 * 고객사의 견적서 · 결재본이 들어 있다. 그래서 이 파일에는 `searchParams` 도 본문 읽기도 없다.
 *
 * ── 🔴 권한이 **두 겹**이다 ───────────────────────────────────────────────
 *  · `domesticOrders` READ — 이 줄(내자 정리)을 볼 수 있는가. 번호 · 발행일이 그 표의 값이다.
 *  · `quotes` READ — **견적서 자료를 볼 수 있는가.** 나가는 것은 견적서 폴더의 파일 이름이고,
 *    거기에는 고객사 · 모델 · S/N 과 「有印」 결재본이 그대로 드러난다. 내자는 볼 수 있지만
 *    견적서는 못 보는 사람에게 열어 주면 그것이 곧 구멍이다.
 * 탭 페이지가 **같은 두 열쇠**를 본다 — 🔴 화면이 감춘 것은 관문이 아니므로 이 통로가
 * 스스로 다시 묻는다. 새 권한 영역을 만들지 않는다.
 *
 * ── 🔴 폴더를 찾는 규칙은 **한 벌이다** ───────────────────────────────────
 * 연도 폴더 · 견적서 폴더를 고르는 일은 저장소 모듈(storage/quote-archive-entries.ts →
 * quote-archive.ts)이 전부 한다 — 이 파일에는 폴더 이름을 견주는 코드가 한 줄도 없다.
 * 재료 둘(번호 · 연도 폴더를 정할 날짜)을 줄에서 꺼내는 일만 순수 함수에 맡긴다.
 *
 * ── 🔴 찾아볼 수 없는 줄은 **디스크를 보지 않는다** ────────────────────────
 * 번호가 없으면 `no-quote-number`, 번호는 있는데 연도 폴더를 정할 수 없으면
 * `no-quote-date` 로 끝난다(이웃 발주서 통로의 `no-order-date` 와 같은 결). 🔴 그 판단보다
 * **공유폴더 설정이 먼저**다 — 설정이 없는 개발 PC 에서 「번호가 없습니다」를 내밀면 설정이
 * 있는 운영처럼 보인다.
 *
 * ── 🔴 목록만 낸다 · 아무것도 만들지 않는다 · 절대 경로를 싣지 않는다 ──────
 * 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷과 루트 기준 상대 경로뿐이다. 파일
 * 바이트를 중계하지 않고(공유폴더의 파일은 첨부 통로의 검사 밖에 있다), mkdir · 파일 쓰기 ·
 * DB 쓰기 · 쓰기 메서드가 없다. 감사도 남기지 않는다 — 기록할 변경이 없다. 그 사실을
 * route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ─────────────────────────────
 * 어느 폴더인지 모르는 채로 내용을 보이면 **남의 견적서 서류를 보일 수 있다.** 상태만
 * 돌려주고 끝낸다(경로도 내지 않는다) — 정리는 사람이 한다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(domesticOrders READ →
 *  quotes READ) → 4) 내자 줄(휴지통이면 없는 것) → 5) 공유폴더 루트(꺼져 있으면 disabled)
 *  → 6) 번호 · 연도(못 정하면 여기서 끝난다) → 7) 찾아서 읽기 → 8) 주소 규칙 → 9) JSON
 *
 * 권한이 조회보다 앞이다 — 권한이 없는 사람에게는 그 id 의 줄이 있다는 사실도 알려 주지
 * 않는다. 문턱을 넘었는데 그 줄이 안 보이면 404 다(403 으로 갈라 답하면 존재가 새어 나간다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, entries, totalCount, truncated }`
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }`
 *  · 200 `{ status: "no-quote-number" }` · `{ status: "no-quote-date" }`
 *  · 200 `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 한 줄. 🔴 **경로를 담는 칸이 타입 수준에 없다** — 이름은 폴더 안에서의 이름뿐이다. */
type QuoteArchiveEntryBody = {
  name: string;
  isDirectory: boolean;
  /** 폴더는 0 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(ISO). 그 한 줄의 stat 이 막혔으면 **이 칸만 빠진다.** */
  modifiedAt?: string;
};

/** 응답 본문. 🔴 컨테이너 안 경로 · 전체 공유폴더 주소를 담는 칸이 없다. */
type DomesticOrderQuoteArchiveEntriesResponse =
  | {
      status: "found";
      /** 루트 기준 슬래시 경로 — `연도 폴더/견적서 폴더`. 화면이 줄의 [열기] 주소에 쓴다. */
      relativePath: string;
      entries: QuoteArchiveEntryBody[];
      /** 거른 뒤의 전체 줄 수. 아래 truncated 가 참이면 entries.length 보다 크다. */
      totalCount: number;
      /** 🔴 줄 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 목록도 경로도 없다 — 어느 폴더인지 모르는 채로 내용을 보이지 않는다. */
  | { status: "multiple" }
  | { status: "not-found" }
  /** 🔴 내자 줄에 견적서번호가 없다 — 공유폴더를 **보지 않았다**. */
  | { status: "no-quote-number" }
  /** 🔴 번호는 있는데 연도 폴더를 정할 수 없다 — 역시 **보지 않았다**. */
  | { status: "no-quote-date" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 이웃 통로와 **같은 문장**이다 — 같은 폴더를 두고 두 자리가 다른 말을 하지 않게. */
const UNOPENABLE_FOLDER_REASON =
  "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: DomesticOrderQuoteArchiveEntriesResponse): NextResponse {
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

  // ── 3) 권한 **두 겹** — 조회보다 앞이다 ──────────────────────────────
  // 🔴 이 줄만 **영역 키 그대로** 둔다(2026-11-12 둘째에 그 메뉴가 잎 넷으로 쪼개졌지만
  //    여기는 안 옮겼다). 묻는 것이 「기타건 상세에 들어올 수 있는가」이기 때문이다 —
  //    짝이 되는 화면(domestic-orders/[id]/quotes/page.tsx)의 첫 줄이
  //    requireAreaAccessForCurrentUser("domesticOrders") 이고, 쪼갠 뒤 그 뜻은 「잎 넷 중
  //    하나라도 열려 있는가」다. 여기를 `domesticOrders.view` 로 좁히면 **화면은 열리는데
  //    폴더만 안 열리는** 짝이 생긴다. 🔵 이 탭을 가르는 열쇠는 아래 `quotes` 다.
  if (!(await hasPermission(actingUser, "domesticOrders", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 내자 줄 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  //    🔴 화면(기타건 상세)이 읽는 **그 조회 그대로**다 — 번호 · 발행일을 여기서 다시
  //    고르지 않는다(연결된 견적서가 이기는 규칙이 그 조회 안에 있다).
  const { id } = await context.params;
  const row = await getDomesticOrderDetail(id);
  if (!row) {
    return fail(404, "NOT_FOUND", "해당 줄을 찾을 수 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ───
  //    🔴 번호 판정보다 **먼저**다(설정이 없는 환경이 있는 환경처럼 보이지 않게).
  const archiveRoot = resolveQuoteArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 🔴 번호 · 연도를 못 정하면 **여기서 끝난다** — 디스크를 보지 않는다 ──
  const lookup = resolveDomesticOrderQuoteArchiveLookup(row);
  if (lookup.status === "no-quote-number") {
    return respond({ status: "no-quote-number" });
  }
  if (lookup.status === "no-quote-date") {
    return respond({ status: "no-quote-date" });
  }

  // ── 7) 찾아서 읽는다 — 🔴 맨 위 칸만, 줄 수 · 기다리는 시간에 상한을 두고 ──
  //    🔴 **찾기가 실제로 보는 칸은 `quoteNumber` 하나**다(storage/quote-archive.ts 의 find —
  //    연도 폴더는 quoteDate 로, 견적서 폴더는 matchesQuoteArchiveFolder 로 고른다). 나머지
  //    둘은 **함께 쓰는 타입이 필수로 받는 칸**이라 채울 뿐이고, 그 값들이 쓰이는 곳은 폴더를
  //    **새로 지을 때**(quoteArchiveFolderName)인데 이 통로는 아무것도 만들지 않는다. 기타건에는
  //    견적서 장이 없어 종류 · 공급처를 알 길도 없다 — 지어낸 값이 폴더 선택에 끼어들지 않는다.
  const listed = await listQuoteArchiveEntries({
    root: archiveRoot,
    quoteDate: lookup.quoteDate,
    naming: { quoteNumber: lookup.quoteNumber, kind: "DOMESTIC", customerName: "" },
  });

  // ── 8~9) JSON — 상대 경로 · 줄 · 짧은 사유만 ─────────────────────────
  if (listed.status === "found") {
    // 도우미가 받지 않을 이름이면(사람이 NAS 에서 만든 이름 등) 줄마다의 [열기] 주소를 만들 수
    // 없다 — 이웃 통로와 **같은 문장**으로 미리 알린다.
    if (!isQuoteFolderRelativePath(listed.relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    return respond({
      status: "found",
      relativePath: listed.relativePath,
      entries: listed.entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory,
        sizeBytes: entry.sizeBytes,
        ...modifiedAtOf(entry.modifiedAtMs),
      })),
      totalCount: listed.totalCount,
      truncated: listed.truncated,
    });
  }
  if (listed.status === "multiple") {
    return respond({ status: "multiple" });
  }
  if (listed.status === "not-found") {
    return respond({ status: "not-found" });
  }
  if (listed.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: listed.reason });
}
