import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { recordContactFolderShareDocSaved } from "@/lib/db/mutations/contact-folders";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { checkQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import {
  copyIntoContactFolderCommonFolder,
  resolveContactFolderArchiveRoot,
} from "@/lib/storage/contact-folder-archive";
import {
  readRepairDocsFile,
  resolveRepairDocsArchiveRoot,
  type RepairDocsFileRejection,
} from "@/lib/storage/repair-docs-archive";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/share-docs/contact-folder — **[연락서 폴더에 저장]**
 * ============================================================================
 * 수리 건 상세 「파일 관리」의 두 구역 — 「그 종류의 공통 서류」와 「이 제품 모델 전용
 * 서류」 — 에서 한 줄의 [열기] 옆에 선 단추가 부른다. 그 줄이 가리킨 「1. 수리 관련」
 * 서류함의 파일을 서버가 읽어 **이 건의 연락서 폴더 `공통` 에 꽂는다.**
 *
 * ── 🔴 꽂는 자리는 접수 자동 복사와 **같은 자리**다 ─────────────────────
 * `copyIntoContactFolderCommonFolder` 는 2026-10-06 에 **접수가 종류 공통 서류를 넣으려고**
 * 만든 함수다. 이 통로는 그 흐름을 **나중에 손으로도** 하게 하는 것이라 자리가 같아야
 * 한다 — `DATA`(사람이 측정 자료를 넣는 자리)도, 올리기의 분류 이름표 폴더도 아니다.
 * 덮어쓰지 않기 · 같은 내용이면 안 쓰기 · NFC/NFD · 번호 비켜 가기 · 🔴 **연락서 폴더를
 * 만들지 않기**가 전부 그 함수 한 벌의 규율이고, 여기서 한 글자도 다시 적지 않는다.
 *
 * ── 🔴 바이트는 브라우저로 나가지 않는다 ────────────────────────────────
 * 이 통로는 **내려받기가 아니다.** 서버가 읽어 곧바로 다른 폴더에 쓰고, 응답으로 나가는
 * 것은 **꽂은 결과**(상태 · 디스크에 실제로 쓴 파일 이름 · 경로 없는 짧은 사유)뿐이다.
 * 스트림도 `Content-Disposition` 도 미리보기 갈래도 없다 — 그래서 「공유폴더 파일은 첨부
 * 통로의 방어선 밖에 있다」는 걱정이 여기서는 성립하지 않는다(읽는 모듈
 * storage/repair-docs-archive.ts 의 머리말).
 *
 * ── 🔴 「1. 수리 관련」에 **쓰지 않는다** ───────────────────────────────
 * 운영에서 그 볼륨은 **읽기 전용**으로 붙어 있다(2026-10-08). 이 파일에 그쪽을 향한
 * `mkdir` · `writeFile` · `rm` · `rename` 이 한 글자도 없다는 사실을 route-source.test.ts
 * 가 원본 글자로 본다.
 *
 * ── 🔴 화면이 보낸 경로를 믿지 않는다 ───────────────────────────────────
 * `?path=` 는 **루트 안에서의 자리**다(목록 통로 둘과 같은 모양). 검사는 **이미 있는
 * 것을 그대로** 쓴다 — `checkQuoteFolderRelativePath` 가 여기서 한 번(디스크를 보기 전),
 * 읽는 모듈이 제 안에서 한 번 더, 그리고 걷는 동안 마디마다 「보이는 폴더 줄인가」와
 * `assertInsideShareFolderRoot` 가 본다. 🔴 상한(크기 20MB · 실행 파일 거절 · 깊이 ·
 * 기다리기)은 **저장소 모듈이 쥔다** — 통로가 제 숫자를 들지 않는다.
 *
 * ── 🔴 폴더는 가져오지 않는다 ───────────────────────────────────────────
 * 가리킨 줄이 폴더면 거절한다(400). 폴더째 복사는 범위가 다르고 상한을 셀 수 없다.
 * 화면도 **파일 줄에만** 단추를 그린다 — 두 겹이다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 출처 → 2) 저장 모드 → 3) 세션 · 살아 있는 계정 · 승인
 *  → 4) 권한(repairCases.files WRITE) → 5) 🔴 두 공유폴더 설정(하나라도 비면 409,
 *  DB 도 디스크도 안 본다) → 6) 수리 건(휴지통이면 없는 것) → 7) 경로 검사
 *  → 8) 바이트 읽기 → 9) `공통` 에 꽂기 → 10) 감사(새로 꽂았을 때만) → 11) JSON
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 * **`repairCases.files` WRITE** 다 — 🔴 새 권한을 만들지 않았다. 이 탭이 올리기 ·
 * 지우기에 쓰는 바로 그 문이고, 이 길도 **파일을 하나 늘리는** 일이다. 화면은 그 권한이
 * 없거나 설정이 비면 단추를 **아예 그리지 않는다**(눌러도 막히는 단추를 내밀지 않는다).
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ contactFolderCopy }` — 올리기 · [DATA에 저장]과 **같은 모양**이라 화면이
 *    같은 읽개를 쓴다(components/repair-cases/files/contact-folder-copy-notice.ts).
 *  · 실패 `{ error, code }` — 400 · 401 · 403 · 404 · 409 · 413 · 500.
 *    🔴 어느 쪽에도 절대 경로 · 루트 · 연락서 폴더 이름이 들어가지 않는다.
 * ============================================================================
 */

// 파일을 다루므로 Node 런타임이 필요하다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "SHARE_FOLDER_DISABLED"
  | "NOT_FOUND"
  /** 🔴 가리킨 자리가 규칙 밖이다 — 디스크를 보기 전에 끝난다. */
  | "INVALID_PATH"
  /** 그 자리에 아무것도 없다(바로가기도 여기로 모인다). */
  | "SOURCE_NOT_FOUND"
  /** 폴더를 가리킨 줄이다 — 폴더째 가져오지 않는다. */
  | "NOT_A_FILE"
  | "EXECUTABLE_FILE"
  | "TOO_LARGE"
  | "AUDIT_FAILED";

/**
 * 공유폴더에 꽂은 결과 — 🔴 **응답에 절대 경로 · 루트 · 연락서 폴더 이름을 담는 칸이
 * 없다.** 모양은 올리기 · [DATA에 저장] 통로의 `contactFolderCopy` 와 **같다**(화면이
 * 같은 읽개를 쓴다).
 */
type ContactFolderCopyNote =
  | { status: "copied"; fileName: string; categoryFolderBlockedByFile: boolean }
  | { status: "unchanged"; fileName: string; categoryFolderBlockedByFile: boolean }
  /** 🔴 연락서 폴더가 아직 없다 — 만들지 않았다. */
  | { status: "no-folder" }
  /** 맞는 폴더가 여럿이라 어디에 넣을지 앱이 고르지 않았다. */
  | { status: "multiple" }
  | { status: "failed"; reason: string };

/** 거절 갈래 → HTTP 상태 · 코드. 🔴 사유 **글귀**로 갈라 보지 않는다(바뀌면 조용히 틀린다). */
const REJECTION_RESPONSE: Record<RepairDocsFileRejection, { status: number; code: FailureCode }> = {
  INVALID_PATH: { status: 400, code: "INVALID_PATH" },
  NOT_FOUND: { status: 404, code: "SOURCE_NOT_FOUND" },
  NOT_A_FILE: { status: 400, code: "NOT_A_FILE" },
  EXECUTABLE: { status: 400, code: "EXECUTABLE_FILE" },
  TOO_LARGE: { status: 413, code: "TOO_LARGE" },
};

function fail(status: number, code: FailureCode, message: string): NextResponse {
  // 🔴 실패 응답에 공유폴더 경로 · 루트를 싣지 않는다 — 이 서류함의 폴더 이름에는
  //    고객사명이 섞여 있다(이웃 통로들과 같은 규율).
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // ── 1) 출처 — 바꾸는 통로다 ──────────────────────────────────────────
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // ── 2) 저장 모드 — 이웃한 수리 건 통로들과 같은 자리다 ───────────────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 3) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
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

  // ── 4) 권한 — 🔴 조회보다 앞이다. 이 탭이 쓰는 문 그대로(새 권한 없음) ──
  if (!(await hasPermission(actingUser, "repairCases.files", "WRITE"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 5) 두 공유폴더 — 🔴 하나라도 비면 DB 도 디스크도 보지 않는다 ───────
  //    읽을 곳(수리 관련)과 쓸 곳(연락서 폴더)이 **둘 다** 있어야 성립하는 일이다.
  if (resolveRepairDocsArchiveRoot() === null || resolveContactFolderArchiveRoot() === null) {
    return fail(409, "SHARE_FOLDER_DISABLED", "이 환경에는 공유폴더가 설정되어 있지 않습니다.");
  }

  // ── 6) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderKeyById(id);
  if (!repairCase) {
    return fail(404, "NOT_FOUND", "해당 수리 건을 찾을 수 없습니다.");
  }

  // ── 7) 가리킨 자리 — 🔴 도우미 주소 · 목록 통로와 **같은 규칙**으로 본다 ──
  const sourcePath = request.nextUrl.searchParams.get("path") ?? "";
  if (checkQuoteFolderRelativePath(sourcePath) !== null) {
    return fail(400, "INVALID_PATH", "가리킨 자리가 올바르지 않습니다.");
  }

  // ── 8) 바이트를 읽는다 — 🔴 상한 · 실행 파일 · 걷기는 저장소 모듈이 쥔다 ──
  const read = await readRepairDocsFile({ relativePath: sourcePath });
  if (read.status === "rejected") {
    const mapped = REJECTION_RESPONSE[read.rejection];
    // 사유는 읽는 모듈이 정한 **경로 없는** 문장 그대로다 — 여기서 짓지 않는다.
    return fail(mapped.status, mapped.code, read.reason);
  }
  if (read.status === "disabled") {
    // 위 5) 에서 루트를 먼저 보았으므로 닿지 않는다. 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return fail(409, "SHARE_FOLDER_DISABLED", "이 환경에는 공유폴더가 설정되어 있지 않습니다.");
  }
  if (read.status === "failed") {
    // 🔴 느림 · 연결 끊김 같은 **지나가는 일**이다. 꽂기 실패와 같은 모양으로 답해
    //    화면이 그 한 줄을 그대로 보여 주고 사람이 다시 눌러 볼 수 있게 한다.
    return NextResponse.json({ contactFolderCopy: { status: "failed", reason: read.reason } }, { status: 200 });
  }

  // ── 9) 꽂는다 — 🔴 `공통` 에. 연락서 폴더는 만들지 않는다(없으면 no-folder) ──
  const result = await copyIntoContactFolderCommonFolder({
    intakeNumber: repairCase.intakeNumber,
    originalFileName: read.fileName,
    bytes: read.bytes,
  });

  // ── 10) 감사 — 🔴 **이번에 새로 꽂았을 때만**(이웃 둘과 같은 규율) ──────
  if (result.status === "copied") {
    try {
      await recordContactFolderShareDocSaved({
        actorUserId: actingUser.id,
        repairCaseId: repairCase.id,
        sourceRelativePath: sourcePath,
        fileName: result.fileName,
        fileSize: read.bytes.byteLength,
      });
    } catch (error) {
      // 🔴 오류 message 를 싣지 않는다 — 전체 경로가 들어 있다.
      console.error("[share-doc-contact-folder-save] 감사 기록을 남기지 못했다", {
        repairCaseId: repairCase.id,
        name: error instanceof Error ? error.name : typeof error,
      });
      return fail(500, "AUDIT_FAILED", "공유폴더에는 넣었지만 기록을 남기지 못했습니다. 관리자에게 알려 주세요.");
    }
  }

  return NextResponse.json({ contactFolderCopy: toNote(result) }, { status: 200 });
}

/** 저장 모듈의 결과를 **응답에 실어도 되는 모양**으로 줄인다(경로 · 폴더 이름을 뺀다). */
function toNote(result: Awaited<ReturnType<typeof copyIntoContactFolderCommonFolder>>): ContactFolderCopyNote {
  if (result.status === "copied" || result.status === "unchanged") {
    return {
      status: result.status,
      fileName: result.fileName,
      // 🔴 `공통` 자리를 같은 이름의 **파일**이 막아 폴더 바로 아래로 비켜 갔는가.
      categoryFolderBlockedByFile: result.categoryFolderBlockedByFile,
    };
  }
  if (result.status === "no-folder") return { status: "no-folder" };
  if (result.status === "multiple") return { status: "multiple" };
  if (result.status === "disabled") {
    // 위에서 루트를 먼저 보았으므로 닿지 않는다. 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return { status: "failed", reason: "공유폴더가 설정되어 있지 않습니다." };
  }
  return { status: "failed", reason: result.reason };
}
