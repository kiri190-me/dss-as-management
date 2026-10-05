import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { checkQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { findContactFolder, resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";
import { listContactFolderEntries } from "@/lib/storage/contact-folder-entries";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/contact-folder/entries — 그 폴더 안에 무엇이 있는가
 * ============================================================================
 * 수리 건 상세 「파일 관리」 탭의 **공유폴더 구역**이 부른다. 이웃한
 * `../route.ts`(연락서 폴더가 **어디인가**)를 그대로 본떴다 — 단계 차례도 같다. 다른 것은
 * 마지막 한 걸음뿐이다: 찾은 폴더의 **맨 위 칸**을 읽어 줄로 돌려준다.
 *
 * ── 🔴 목록만 낸다 — 파일 바이트를 중계하지 않는다 ──────────────────────────
 * 이 통로로 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의 파일은
 * 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리 출처(same-origin)로
 * 내보내면 그 방어선이 통째로 빠진다. 파일을 **여는** 일은 PC 의 탐색기 도우미가 한다
 * (뒤 조각). 그래서 여기에는 스트림도, `Content-Disposition` 도, 내려받기 갈래도 없다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 `not-found` 로 끝난다. 이 파일에는 mkdir · 파일 쓰기 · DB 쓰기가 없고,
 * 쓰기 메서드(POST · PUT)도 없다. 감사도 남기지 않는다 — 기록할 변경이 없다. 그 사실을
 * route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 절대 경로를 싣지 않는다 ─────────────────────────────────────────────
 * 응답 타입에 그 칸이 아예 없다. 줄마다 나가는 이름은 **그 폴더 안에서의 이름**이고,
 * 루트(컨테이너 안 경로)도 이어 붙인 전체 경로도 없다. 실패 사유도 경로 없는 짧은
 * 문장이다(storage/contact-folder-archive.ts 머리말의 규율).
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ─────────────────────────────
 * 어느 폴더인지 모르는 채로 내용을 보이면 **남의 수리 건 서류를 보여 줄 수 있다.**
 * 이름만 돌려주고 끝낸다 — 정리는 사람이 한다(pickContactFolder 머리말).
 *
 * ── 🔴 하위 폴더는 **상대 경로 한 칸**으로만 받는다 (조각 10) ───────────────
 * `?path=사진/2026` 은 **찾은 연락서 폴더 안에서의 자리**다. 루트도 폴더 이름도 들어오지
 * 않는다. 검사는 **이미 있는 것을 그대로** 쓴다 — checkQuoteFolderRelativePath
 * (domain/quote-folder-link.ts)가 빈 마디 · `.` · `..` · 드라이브 문자 · UNC · 제어문자 ·
 * Windows 금지 글자 · 끝이 점 · 공백인 마디까지 여덟 갈래로 거절한다(도우미 주소가 쓰는
 * 바로 그 규칙이다). 어긋나면 **400** 이고, 디스크를 보지 않는다. 깊이 상한 · 줄 수 상한 ·
 * 기다리기 상한은 **저장소 모듈이 쥔다** — 통로가 제 숫자를 들지 않는다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(repairCases.files READ)
 *  → 4) 수리 건(휴지통이면 없는 것) → 5) 하위 경로 검사 → 6) 공유폴더 루트(꺼져 있으면
 *  disabled) → 7) 폴더 찾기 → 8) **찾았을 때만** 그 안을 읽기 → 9) JSON
 *
 * 권한 **두 겹**이다(이웃 통로와 같다):
 *  · 넓은 문턱 `repairCases.files` READ 가 없으면 **403** — 조회보다 **앞**이다.
 *  · 문턱을 넘었는데 그 건이 안 보이면 **404**다(403 으로 갈라 답하면 존재가 새어 나간다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", folderName, entries, totalCount, truncated }`
 *  · 200 `{ status: "multiple", folderNames }` · `{ status: "not-found" }`
 *  · 200 `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  /** 🔴 하위 폴더 경로가 규칙 밖이다 — 디스크를 보기 전에 끝난다. */
  | "INVALID_PATH";

/** 한 줄. 🔴 **경로를 담는 칸이 타입 수준에 없다** — 이름은 폴더 안에서의 이름뿐이다. */
type ContactFolderEntryBody = {
  name: string;
  isDirectory: boolean;
  /** 폴더는 0 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(ISO). 그 한 줄의 stat 이 막혔으면 **이 칸만 빠진다.** */
  modifiedAt?: string;
};

type ContactFolderEntriesResponse =
  | {
      status: "found";
      folderName: string;
      entries: ContactFolderEntryBody[];
      /** 거른 뒤의 전체 줄 수. 아래 truncated 가 참이면 entries.length 보다 크다. */
      totalCount: number;
      /** 🔴 줄 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  | { status: "multiple"; folderNames: string[] }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: ContactFolderEntriesResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(빈 문자열을 내지 않는다). */
function modifiedAtOf(modifiedAtMs: number | null): { modifiedAt?: string } {
  if (modifiedAtMs === null || !Number.isFinite(modifiedAtMs)) return {};
  return { modifiedAt: new Date(modifiedAtMs).toISOString() };
}

export async function GET(
  request: NextRequest,
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
  if (!(await hasPermission(actingUser, "repairCases.files", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderKeyById(id);
  if (!repairCase) {
    return fail(404, "NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
  }

  // ── 5) 하위 폴더 자리 — 🔴 도우미 주소와 **같은 규칙**으로 본다(새로 짜지 않는다) ──
  const insidePath = request.nextUrl.searchParams.get("path") ?? "";
  if (insidePath !== "" && checkQuoteFolderRelativePath(insidePath) !== null) {
    return fail(400, "INVALID_PATH", "하위 폴더 경로가 올바르지 않습니다.");
  }

  // ── 6) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ───
  const archiveRoot = resolveContactFolderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 7) 폴더 찾기 — 읽기만 한다. 없으면 「아직 없습니다」로 끝난다 ────────
  const found = await findContactFolder({ root: archiveRoot, intakeNumber: repairCase.intakeNumber });
  if (found.status === "multiple") {
    // 🔴 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 이름만 준다.
    return respond({ status: "multiple", folderNames: found.folderNames });
  }
  if (found.status === "not-found") {
    return respond({ status: "not-found" });
  }
  if (found.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  if (found.status === "failed") {
    return respond({ status: "failed", reason: found.reason });
  }

  // ── 8) 그 안을 읽는다 — 🔴 그 자리의 맨 위 칸만, 깊이 · 줄 수 · 기다리는 시간에 상한을 두고 ──
  const listed = await listContactFolderEntries({
    root: archiveRoot,
    folderName: found.folderName,
    relativePath: insidePath,
  });
  if (listed.status === "failed") {
    return respond({ status: "failed", reason: listed.reason });
  }

  // ── 9) JSON — 이름 · 크기 · 수정 시각 · 폴더인가. 경로는 나가지 않는다 ───
  return respond({
    status: "found",
    folderName: found.folderName,
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
