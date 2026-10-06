import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { listQuoteArchiveEntries } from "@/lib/storage/quote-archive-entries";
import { resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";
import { isValidQuoteId } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * GET /api/quotes/{id}/archive-folder/entries — 그 견적서의 폴더 **안에 무엇이 있는가** (2026-10-06)
 * ============================================================================
 * 견적서 편집 화면의 **공유폴더 구역**이 부른다. 이웃한 `../route.ts`(그 폴더가 **어디인가**)를
 * 그대로 본떴다 — 문지기 차례도 권한 영역도 같은 글자다. 다른 것은 마지막 한 걸음뿐이다:
 * 찾은 폴더의 **맨 위 칸**을 읽어 줄로 돌려준다.
 *
 * ── 🔴 목록만 낸다 — 파일 바이트를 중계하지 않는다 ──────────────────────────
 * 이 통로로 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의 파일은
 * 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리 출처(same-origin)로
 * 내보내면 그 방어선이 통째로 빠진다. 파일을 **여는** 일은 그 PC 의 탐색기 도우미가 한다
 * (domain/quote-folder-file-link.ts). 그래서 여기에는 스트림도, `Content-Disposition` 도,
 * 내려받기 갈래도 없다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 `not-found` 로 끝난다(폴더는 견적서 저장 · 결재 PDF 저장이 만든다 — 화면에서
 * 부르던 [견적서 받기]는 2026-10-06 에 없앴고, 통로는 그대로 살아 있다).
 * 이 파일에는 mkdir · 파일 쓰기 · DB 쓰기가 없고, 쓰기 메서드(POST · PUT)도 없다.
 * 감사도 남기지 않는다 — 기록할 변경이 없다. 그 사실을 route-source.test.ts 가 원본을 글자로
 * 읽어 못 박는다.
 *
 * ── 🔴 절대 경로를 싣지 않는다 ─────────────────────────────────────────────
 * 응답 타입에 컨테이너 안 경로(루트)를 담는 칸이 아예 없다. 줄마다 나가는 이름은 **그 폴더
 * 안에서의 이름**이고, 폴더를 가리키는 값은 **루트 기준 상대 경로**(`연도 폴더/견적서 폴더`)
 * 뿐이다 — 이웃 통로가 [폴더 열기]에 쓰는 바로 그 값이고, 화면이 줄의 [열기] 주소를 만들 때
 * 쓴다. 🔴 **전체 공유폴더 주소(uncPath)는 일부러 내지 않는다** — 그것은 `\\서버\공유\…` 라는
 * 절대 경로이고, [위치 복사]가 있는 이웃 통로의 몫이다. 이 구역에는 그 단추가 없다.
 * 실패 사유도 경로 없는 짧은 문장이다(storage/quote-archive.ts 머리말의 규율).
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ─────────────────────────────
 * 어느 폴더인지 모르는 채로 내용을 보이면 **남의 견적서 서류를 보여 줄 수 있다.** 상태만
 * 돌려주고 끝낸다(경로도 내지 않는다) — 정리는 사람이 한다. 연락서 쪽 목록 통로와 같은 판단이다.
 *
 * ── 🔴 하위 폴더로 내려가는 칸이 없다 ──────────────────────────────────────
 * 연락서 쪽 목록 통로에는 `?path=…` 가 있지만 여기에는 **일부러 없다.** 실측(2026-10-06)에서
 * 견적서 폴더 안의 하위 폴더는 **0 개**였다 — 평평하다. 받지 않는 칸은 검사할 일도 없다.
 * 줄 수 상한 · 기다리기 상한은 **저장소 모듈이 쥔다** — 통로가 제 숫자를 들지 않는다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ) → 4) id 형식
 *  → 5) 견적서(휴지통이면 없는 것) → 6) 공유폴더 루트(꺼져 있으면 disabled) → 7) 찾아서 읽기
 *  → 8) 주소 규칙 → 9) JSON
 *
 * 권한은 이웃 통로와 **같은 글자**(`quotes` READ)다: 그 견적서를 볼 수 있는 사람이면 그 서류가
 * 꽂힌 자리도, 거기 무엇이 들었는지도 볼 수 있다. 권한이 조회보다 앞이다 — 권한이 없는
 * 사람에게는 그 id 의 견적서가 있다는 사실도 알려 주지 않는다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, entries, totalCount, truncated }`
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }`
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
type QuoteArchiveEntriesResponse =
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
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 이웃 통로와 **같은 문장**이다 — 같은 폴더를 두고 두 자리가 다른 말을 하지 않게. */
const UNOPENABLE_FOLDER_REASON =
  "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: QuoteArchiveEntriesResponse): NextResponse {
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
  if (!(await hasPermission(actingUser, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4~5) 견적서 ──────────────────────────────────────────────────────
  const { id } = await context.params;
  if (!isValidQuoteId(id)) {
    return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
  }
  // 휴지통의 장은 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다).
  const quote = await getQuoteForEdit(id);
  if (!quote) {
    return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");
  }

  // ── 6) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ───
  const archiveRoot = resolveQuoteArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 7) 찾아서 읽는다 — 🔴 맨 위 칸만, 줄 수 · 기다리는 시간에 상한을 두고 ──
  const listed = await listQuoteArchiveEntries({
    root: archiveRoot,
    quoteDate: quote.quoteDate,
    naming: {
      quoteNumber: quote.quoteNumber,
      kind: quote.kind,
      customerName: quote.customerNameText,
      modelName: quote.modelNameText,
      lotNumber: quote.lotNumberText,
      serialNumber: quote.serialNumberText,
    },
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
