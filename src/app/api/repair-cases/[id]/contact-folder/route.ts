import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { resolveContactFolderUncPath } from "@/lib/server/contact-folder-helper";
import { findContactFolder, resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/contact-folder — 그 수리 건의 연락서 폴더가 어디인가
 * ============================================================================
 * 수리 건 상세 「기본 정보」의 [폴더 열기]가 부른다. 연락서 공유폴더
 * (CONTACT_FOLDER_ARCHIVE_DIR)에서 **인수번호 하나로** 폴더를 찾아 루트 기준 상대 경로만
 * 돌려준다. 화면은 그 경로로 `dss-folder://open/?p=…` 주소를 만들고(domain/quote-folder-link.ts),
 * PC 의 도우미가 설치 때 박힌 자기 루트(UNC)에 붙여 탐색기로 연다(server/quote-folder-helper.ts).
 *
 * 견적서 쪽 같은 통로(api/quotes/{id}/archive-folder)를 그대로 본떴다 — 단계 차례도 같다.
 *
 * ── 🔴 아무것도 만들지 않는다 ──────────────────────────────────────────────
 * 폴더가 없으면 `not-found` 로 끝난다. **폴더 만들기는 뒤 조각이다.** 이 파일에는 mkdir ·
 * 파일 쓰기 · DB 쓰기가 없고, 쓰기 메서드(POST · PUT)도 없다. 감사도 남기지 않는다 —
 * 기록할 변경이 없다. 그 사실을 route-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 컨테이너 안 경로는 싣지 않는다 ─────────────────────────────────────
 * 공유폴더가 서버 안에 마운트된 경로(CONTACT_FOLDER_ARCHIVE_DIR)는 서버 구조를 알려 준다 —
 * 이 통로가 알릴 까닭이 없다. **응답 타입에 그 칸이 아예 없다.** 나가는 것은 상대 경로 ·
 * 디스크의 폴더 이름 · 설정된 전체 주소뿐이고, 실패 사유도 경로 없는 짧은 문장이다
 * (storage/contact-folder-archive.ts 머리말의 reasonFromFsError 규율).
 *
 * ── 🔴 찾는 열쇠는 인수번호 하나뿐이다 ────────────────────────────────────
 * 모델 · S/N · L/N 으로 짝을 확정하지 않는다 — 같은 장비가 여러 번 수리를 오기 때문이다
 * (domain/contact-folder-naming.ts · kyosan/report-match.ts 머리말). 그래서 이 통로가 DB 에서
 * 읽는 것도 인수번호 한 칸뿐이다(queries/repair-cases.ts 의 최소 조회).
 *
 * ── 전체 주소(uncPath) ────────────────────────────────────────────────────
 * 도우미 설치가 막힌 PC 를 위한 우회로다. 🔴 **서버가 계산하지 않는다** — 설정값
 * (CONTACT_FOLDER_ARCHIVE_UNC_PATH)을 그대로 내보낸다(server/contact-folder-helper.ts).
 * 설치본에 박히는 루트(CONTACT_FOLDER_ARCHIVE_UNC_ROOT)는 **여기로 나가지 않는다.**
 * 설정이 비면 **이 칸만 빠진다** — 폴더 열기(상대 경로 · 도우미 주소)는 그대로 돈다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(repairCases.files READ)
 *  → 4) 수리 건(휴지통이면 없는 것) → 5) 공유폴더 루트(꺼져 있으면 disabled) → 6) 찾기 → 7) JSON
 *
 * 권한 **두 겹**이다(domain/attachment-download-policy.ts 의 규율 그대로):
 *  · 넓은 문턱 `repairCases.files` READ 가 없으면 **403** — 조회보다 **앞**이다. 권한이 없는
 *    사람에게는 그 id 의 수리 건이 있다는 사실도 알려 주지 않는다.
 *  · 문턱을 넘었는데 그 건이 안 보이면(없다 · 휴지통 · id 모양이 아니다) **404**다. 403 으로
 *    갈라 답하면 「그 id 는 실재하는 수리 건」이 새어 나간다.
 * 권한이 READ 인 까닭: 그 건의 파일을 볼 수 있는 사람이면 그 서류가 꽂힌 자리도 볼 수 있다
 * (ATTACHMENT_OWNER_PERMISSIONS 의 VIEW.REPAIR_CASE 와 같은 칸이다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, folderName, uncPath? }`
 *  · 200 `{ status: "multiple", folderNames }` — 🔴 앱이 고르지 않는다. 사람이 정리한다.
 *  · 200 `{ status: "not-found" }` · `{ status: "disabled" }` · `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`(JSON 성공 응답).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/**
 * 응답 본문. 🔴 **컨테이너 안 경로(절대 경로)를 담는 칸이 타입 수준에 없다.** uncPath 는
 * 설정이 있을 때만 붙는 **설정값 그대로**이고, 그것도 폴더를 찾았을 때뿐이다.
 */
type ContactFolderResponse =
  | { status: "found"; relativePath: string; folderName: string; uncPath?: string }
  | { status: "multiple"; folderNames: string[] }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

const UNOPENABLE_FOLDER_REASON =
  "연락서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: ContactFolderResponse): NextResponse {
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
  if (!(await hasPermission(actingUser, "repairCases.files", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderKeyById(id);
  if (!repairCase) {
    return fail(404, "NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
  }

  // ── 5) 공유폴더 루트 — 이 값은 찾기에만 쓰고 응답에 싣지 않는다 ─────────
  const archiveRoot = resolveContactFolderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 6) 찾기 — 읽기만 한다. 없으면 「아직 없습니다」로 끝난다(만들지 않는다) ──
  const result = await findContactFolder({ root: archiveRoot, intakeNumber: repairCase.intakeNumber });

  // ── 7) JSON — 상대 경로 · 폴더 이름 · 짧은 사유만 ────────────────────
  if (result.status === "found") {
    // 🔴 연락서 루트에는 연도 폴더가 없다 — 상대 경로가 곧 **디스크의 실제 폴더 이름**이다.
    //    그래도 두 칸을 따로 둔다: 하나는 도우미 주소를 만들 재료고, 하나는 사람에게 보일 이름이다.
    const relativePath = result.folderName;
    // 도우미가 받지 않을 이름이면(사람이 NAS 에서 만든 이름 등) 주소를 만들 수 없다 — 미리 알린다.
    if (!isQuoteFolderRelativePath(relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    // 설정이 비었으면 null 이고, 그 칸만 빠진다.
    const uncPath = resolveContactFolderUncPath();
    return respond({
      status: "found",
      relativePath,
      folderName: result.folderName,
      ...(uncPath === null ? {} : { uncPath }),
    });
  }
  if (result.status === "multiple") {
    // 🔴 앱이 고르지 않는다 — 어느 쪽이 맞는지는 사람이 안다(pickContactFolder 머리말).
    return respond({ status: "multiple", folderNames: result.folderNames });
  }
  if (result.status === "not-found") {
    return respond({ status: "not-found" });
  }
  if (result.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  return respond({ status: "failed", reason: result.reason });
}
