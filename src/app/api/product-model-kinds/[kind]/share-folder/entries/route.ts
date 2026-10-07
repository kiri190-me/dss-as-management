import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { checkQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { isProductModelKind } from "@/lib/domain/product-model-kind";
import { resolveRepairDocsArchiveRoot } from "@/lib/storage/repair-docs-archive";
import { listRepairDocsEntries } from "@/lib/storage/repair-docs-entries";

/**
 * ============================================================================
 * GET /api/product-model-kinds/{kind}/share-folder/entries — 서류함 안에 무엇이 있는가
 * ============================================================================
 * 제품 종류의 **공통 서류**를 올리지 않고 **자리만 가리키는** 기능(사용자 결정
 * 2026-10-07)에서, 사람이 그 자리를 **고르는 창**이 부른다. 고르는 창의 모양은 수리 건
 * 상세 「파일 관리」의 공유폴더 구역과 같고, 그래서 이 통로는 그쪽 통로
 * (api/repair-cases/[id]/contact-folder/entries/route.ts)를 그대로 본떴다.
 *
 * ── 🔴 `{kind}` 가 주소에 있지만 **폴더는 종류와 무관하다** ─────────────────
 * 이 통로가 읽는 것은 `REPAIR_DOCS_ARCHIVE_DIR` **하나뿐**이다. 종류마다 다른 폴더가
 * 있는 것이 **아니다** — 제너레이터로 열든 매쳐로 열든 **같은 서류함의 같은 칸**이
 * 보인다. 그래도 `{kind}` 를 주소에 둔 까닭은 **권한과 감사의 단위가 종류**이기
 * 때문이다: 이 통로를 쓰는 화면이 「그 종류의 서류함」이고, 여기서 고른 자리는
 * 곧 그 종류의 가리킴으로 담긴다(server/actions/product-model-kind-share-docs.ts).
 * 주소에 종류가 없으면 「어느 종류의 일로 폴더를 들여다봤는가」가 기록에서 사라진다.
 * 🔴 **다음 사람에게**: 종류마다 다른 루트를 주고 싶어지면 이 머리말부터 고칠 것.
 *
 * ── 🔴 목록만 낸다 — 파일 바이트를 중계하지 않는다 ──────────────────────────
 * 이 통로로 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의
 * 파일은 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리
 * 출처(same-origin)로 내보내면 그 방어선이 통째로 빠진다. 파일을 **여는** 일은 그 PC 의
 * 탐색기 도우미가 한다. 그래서 여기에는 스트림도, `Content-Disposition` 도, 내려받기
 * 갈래도 없다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 이 파일에는 mkdir · 파일 쓰기 · DB 쓰기가 없고, 쓰기 메서드(POST · PUT · DELETE)도
 * 없다. 감사도 남기지 않는다 — 기록할 변경이 없다. 가리킴을 **담고 지우는** 일은
 * 서버 액션이 하고, 그쪽이 감사를 남긴다.
 *
 * ── 🔴 절대 경로를 싣지 않는다 ─────────────────────────────────────────────
 * 응답 타입에 그 칸이 아예 없다. 줄마다 나가는 이름은 **그 자리에서의 이름**이고,
 * 루트(컨테이너 안 경로)도 이어 붙인 전체 경로도 없다. 실패 사유도 경로 없는 짧은
 * 문장이다 — 이 서류함의 폴더 이름에는 고객사명이 섞여 있다.
 *
 * ── 🔴 하위 폴더는 **상대 경로 한 칸**으로만 받는다 ────────────────────────
 * `?path=2. 인수시 서류/2. MB 인수시 체크시트` 는 **루트 안에서의 자리**다. 검사는
 * **이미 있는 것을 그대로** 쓴다 — checkQuoteFolderRelativePath
 * (domain/quote-folder-link.ts)가 빈 마디 · `.` · `..` · 드라이브 문자 · UNC ·
 * 제어문자 · Windows 금지 글자 · 끝이 점 · 공백인 마디까지 여덟 갈래로 거절한다
 * (도우미 주소가 쓰는 바로 그 규칙이다). 어긋나면 **400** 이고, 디스크를 보지 않는다.
 * 깊이 상한 · 줄 수 상한 · 기다리기 상한은 **저장소 모듈이 쥔다**(repair-docs-entries.ts) —
 * 통로가 제 숫자를 들지 않는다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 출처 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(productModels.view READ)
 *  → 4) 종류 코드(셋 중 하나인가) → 5) 하위 경로 검사 → 6) 공유폴더 루트(꺼져 있으면
 *  disabled) → 7) 그 자리 읽기 → 8) JSON
 *
 * 🔴 1·3·4 단계의 순서와 모양은 **종류 서류 올리기 통로**를 그대로 따랐다
 * (api/product-model-kinds/[kind]/attachments/route.ts) — 같은 주소 아래의 통로라
 * 앞머리가 갈라지면 어느 쪽이 맞는지 다음 사람이 알 수 없다. 🔴 이웃한 연락서 목록
 * 통로에는 출처 확인이 **없다**(그쪽은 수리 건 상세가 쓰는 조회다). 이쪽은 같은
 * `{kind}` 아래 형제 통로에 맞춰 **한 겹 더 조인다** — 화면이 같은 출처에서 fetch 로
 * 부르므로 Sec-Fetch-Site 가 `same-origin` 이고, 주소창에 직접 쳐 넣는 길은 막힌다.
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 * **`productModels.view` READ** 다 — 새 권한을 만들지 않았다. 폴더를 **들여다보는**
 * 것은 종류 서류함을 **보는** 일과 같은 문턱이고(화면 page.tsx 가 그 권한으로 열린다),
 * 가리킴을 **담고 지우는** 쪽만 `productModels.files` WRITE 다(서버 액션).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "listed", entries, totalCount, truncated }`
 *  · 200 `{ status: "disabled" }` — 설정이 비어 있다(지금 개발 PC가 그렇다)
 *  · 200 `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 400 · 401 · 403. 성공 JSON 은 `Cache-Control: no-store`.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  /** 주소의 마디가 애초에 종류가 아니다 — 올리기 통로와 같은 코드 · 같은 400 이다. */
  | "INVALID_KIND"
  /** 🔴 하위 폴더 경로가 규칙 밖이다 — 디스크를 보기 전에 끝난다. */
  | "INVALID_PATH";

/** 한 줄. 🔴 **경로를 담는 칸이 타입 수준에 없다** — 이름은 그 자리에서의 이름뿐이다. */
type RepairDocsEntryBody = {
  name: string;
  isDirectory: boolean;
  /** 폴더는 0 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(ISO). 그 한 줄의 stat 이 막혔으면 **이 칸만 빠진다.** */
  modifiedAt?: string;
};

type RepairDocsEntriesResponse =
  | {
      status: "listed";
      entries: RepairDocsEntryBody[];
      /** 거른 뒤의 전체 줄 수. 아래 truncated 가 참이면 entries.length 보다 크다. */
      totalCount: number;
      /** 🔴 줄 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: RepairDocsEntriesResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(빈 문자열을 내지 않는다). */
function modifiedAtOf(modifiedAtMs: number | null): { modifiedAt?: string } {
  if (modifiedAtMs === null || !Number.isFinite(modifiedAtMs)) return {};
  return { modifiedAt: new Date(modifiedAtMs).toISOString() };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ kind: string }> }
): Promise<NextResponse> {
  // ── 1) 출처 ──────────────────────────────────────────────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
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

  // ── 3) 권한 — 디스크를 보기보다 앞이다 ───────────────────────────────
  if (!(await hasPermission(actingUser, "productModels.view", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 종류 코드 — DB 를 묻지 않는다(주인이 행이 아니라 enum 이다) ────
  const { kind } = await context.params;
  if (!isProductModelKind(kind)) {
    return fail(400, "INVALID_KIND", "제품 종류를 확인할 수 없습니다.");
  }

  // ── 5) 하위 폴더 자리 — 🔴 도우미 주소와 **같은 규칙**으로 본다(새로 짜지 않는다) ──
  const insidePath = request.nextUrl.searchParams.get("path") ?? "";
  if (insidePath !== "" && checkQuoteFolderRelativePath(insidePath) !== null) {
    return fail(400, "INVALID_PATH", "하위 폴더 경로가 올바르지 않습니다.");
  }

  // ── 6) 공유폴더 루트 — 이 값은 읽기에만 쓰고 응답에 싣지 않는다 ───────
  const archiveRoot = resolveRepairDocsArchiveRoot();
  if (archiveRoot === null) {
    // 설정이 비어 있으면 **이 기능만** 꺼진다 — 화면은 그 사실을 사람에게 알린다.
    return respond({ status: "disabled" });
  }

  // ── 7) 그 자리를 읽는다 — 🔴 맨 위 칸만, 깊이 · 줄 수 · 기다리기 상한을 두고 ──
  const listed = await listRepairDocsEntries({ root: archiveRoot, relativePath: insidePath });
  if (listed.status === "failed") {
    return respond({ status: "failed", reason: listed.reason });
  }

  // ── 8) JSON — 이름 · 크기 · 수정 시각 · 폴더인가. 경로는 나가지 않는다 ───
  return respond({
    status: "listed",
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
