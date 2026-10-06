import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { listQuotesForRepairCase } from "@/lib/db/queries/quotes";
import { getRepairCaseContactFolderNamingById } from "@/lib/db/queries/repair-cases";
import { listQuoteArchiveProductFolders } from "@/lib/storage/quote-archive-product-folders";
import { resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/quote-archive-folders
 * — 이 장비(L/N + S/N)가 **예전에 받은** 견적서 폴더들 (2026-10-06)
 * ============================================================================
 * 수리 건 「견적서」 탭의 **「같은 장비의 지난 견적서」 구역**이 부른다. 문지기는 이웃 통로
 * (api/quotes/[id]/archive-folder/entries — 그 견적서 폴더 안에 무엇이 있는가)를 **글자
 * 그대로** 본떴다. 다른 것은 그 뒤다: 견적서 한 장이 아니라 **수리 건의 장비**에서 출발해
 * 연도 폴더를 전부 훑는다.
 *
 * ── 🔴 권한은 `quotes` READ 다 — 새 영역을 만들지도 넓히지도 않았다 ────────
 * 나가는 것은 **견적서 자료**(지난 견적서가 어느 폴더에 있고 번호가 무엇인가)다. 주소가
 * 수리 건 id 라고 해서 수리 건 쪽 열쇠를 쓰면, 견적서를 못 보는 사람이 견적번호 목록을
 * 보게 된다. 이웃 통로와 **같은 글자**를 쓴다.
 *
 * ── 🔴 목록만 낸다 — 파일 바이트를 중계하지 않는다 ──────────────────────────
 * 폴더마다 나가는 것은 **연도 · 폴더 이름 · 상대 경로 · 거기서 뽑은 번호들 · 파일 수**
 * 다섯뿐이다. 파일 이름 목록조차 나가지 않는다(번호만 뽑아 나른다). 그 폴더를 **여는** 일은
 * 그 PC 의 탐색기 도우미가 한다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 빈 목록으로 끝난다. 이 파일에는 폴더 만들기 · 파일 쓰기 · DB 쓰기가 없고,
 * 쓰기 메서드(POST · PUT)도 없다. 감사도 남기지 않는다 — 기록할 변경이 없다. 그 사실을
 * route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 절대 경로를 싣지 않는다 ─────────────────────────────────────────────
 * 응답 타입에 컨테이너 안 경로(루트)를 담는 칸이 아예 없다. 폴더를 가리키는 값은 **루트 기준
 * 상대 경로**(`연도 폴더/견적서 폴더`)뿐이고, 전체 공유폴더 주소(uncPath)는 내지 않는다 —
 * 이 구역에는 [위치 복사]가 없다. 실패 사유도 경로 없는 짧은 문장이다.
 *
 * ── 🔴 이 건의 견적서 폴더는 뺀다 ──────────────────────────────────────────
 * 바로 위 「이 건의 견적서 폴더」 구역이 이미 그리고 있다. 이 건에 등록된 견적서 번호들을
 * 저장소 모듈에 넘겨 거기서 거른다 — 거르는 판정은 그 구역이 폴더를 찾을 때 쓰는 것과
 * 같은 함수다(domain/quote-archive-naming.ts). 통로가 제 손으로 번호를 쪼개지 않는다.
 *
 * ── 🔴 폴더 이름이 도우미 주소 규칙 밖이어도 줄은 그대로 낸다 ───────────────
 * 이웃 통로는 폴더 하나의 **줄마다** 주소를 만들어야 해서 미리 막지만, 여기는 줄마다 단추가
 * 하나이고 그 단추가 **스스로** 「이 폴더 이름은 도우미 주소로 만들 수 없습니다」라고 알린다
 * (components/repair-cases/files/contact-folder-place-open.ts). 그러니 여기서 그 줄을 숨기면
 * 사람은 그런 폴더가 있다는 사실조차 모른다 — 보여 주고, 눌렀을 때 설명한다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ)
 *  → 4) 수리 건(휴지통이면 없는 것) → 5) 공유폴더 루트(꺼져 있으면 disabled)
 *  → 6) 이 건의 견적서 번호들 → 7) 장비로 찾기 → 8) JSON
 *
 * 권한이 조회보다 앞이다 — 권한이 없는 사람에게는 그 id 의 수리 건이 있다는 사실도 알려 주지
 * 않는다. 문턱을 넘었는데 그 건이 안 보이면 404 다(403 으로 갈라 답하면 존재가 새어 나간다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", folders, truncated }`
 *  · 200 `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 폴더 한 줄. 🔴 **컨테이너 안 경로를 담는 칸이 타입 수준에 없다.** */
type QuoteArchiveProductFolderBody = {
  /** 연도 폴더의 연도. 🔴 폴더 **번호**의 연도와 다를 수 있다(실측 사례가 있다). */
  year: number;
  folderName: string;
  /** 루트 기준 슬래시 경로 — `연도 폴더/견적서 폴더`. 화면의 [열기]가 쓴다. */
  relativePath: string;
  /** 그 폴더 안 파일 이름에서 뽑은 발행번호들. 없으면 빈 배열. */
  quoteNumbers: string[];
  /** 찌꺼기를 뺀 파일 수. */
  fileCount: number;
};

/** 응답 본문. 🔴 컨테이너 안 경로 · 전체 공유폴더 주소를 담는 칸이 없다. */
type QuoteArchiveProductFoldersResponse =
  | {
      status: "found";
      /** 연도 내림차순(최근이 위). 없으면 빈 배열이고, 화면은 구역을 그리지 않는다. */
      folders: QuoteArchiveProductFolderBody[];
      /** 🔴 폴더 수 상한에 걸려 잘렸는가. */
      truncated: boolean;
    }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: QuoteArchiveProductFoldersResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
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
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  //    🔴 L/N · S/N 을 얻으려고 **이미 있는 가벼운 조회**를 그대로 쓴다(연락서 폴더 이름을
  //    지을 때 쓰는 그 조회다 — 여덟 표 join 과 달리 연락처 스냅숏을 싣지 않는다).
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderNamingById(id);
  if (!repairCase) {
    return fail(404, "NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 이 값은 찾기에만 쓰고 응답에 싣지 않는다 ─────────
  const archiveRoot = resolveQuoteArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 이 건의 견적서 번호들 — 그 폴더는 위 구역이 이미 그린다 ───────────
  const quotes = await listQuotesForRepairCase(repairCase.id);

  // ── 7) 장비로 찾는다 — 🔴 L/N 과 S/N 이 **둘 다** 맞는 폴더만, 상한을 두고 ──
  const found = await listQuoteArchiveProductFolders({
    root: archiveRoot,
    lotNumber: repairCase.lotNumber,
    serialNumber: repairCase.serialNumber,
    excludeQuoteNumbers: quotes.map((quote) => quote.quoteNumber),
  });

  // ── 8) JSON — 상대 경로 · 번호 · 수 · 짧은 사유만 ──────────────────────
  if (found.status === "found") {
    return respond({
      status: "found",
      folders: found.folders.map((folder) => ({
        year: folder.year,
        folderName: folder.folderName,
        relativePath: folder.relativePath,
        quoteNumbers: folder.quoteNumbers,
        fileCount: folder.fileCount,
      })),
      truncated: found.truncated,
    });
  }
  if (found.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: found.reason });
}
