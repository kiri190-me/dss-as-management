import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  SERVICE_REPORT_PERMISSION_AREA,
  SERVICE_REPORT_REQUIRED_LEVELS,
} from "@/lib/auth/service-report-authorization";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getRepairCaseContactFolderKeyById } from "@/lib/db/queries/repair-cases";
import { checkQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import {
  isQuoteFolderXlsx2PdfSourceName,
  quoteFolderXlsx2PdfOutputName,
} from "@/lib/domain/quote-folder-xlsx2pdf-link";
import { normalizeShareFolderNameForCompare } from "@/lib/domain/share-folder-naming";
import { findContactFolder, resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";
import { listContactFolderEntries, type ContactFolderEntry } from "@/lib/storage/contact-folder-entries";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/service-report/contact-folder/pdf
 *   — **그 PDF 가 연락서 폴더에 생겼는가** (2026-10-12)
 * ============================================================================
 * 보고서 [저장]이 끝나면 이웃 통로(`../route.ts`)가 엑셀을 분류 폴더에 꽂고, 화면이
 * `dss-folder://xlsx2pdf/?p=…` 를 열어 그 PC 의 Excel 로 PDF 를 만들게 한다. 🔴 **도우미는
 * 답을 주지 않는다** — 브라우저는 그 주소를 받을 프로그램이 있는지도, 무엇을 했는지도 모른다
 * (server/quote-folder-helper.ts 머리말). 그래서 **서버가 폴더를 다시 읽어** 같은 이름
 * `.pdf` 가 있는지 본다. 이 통로가 그 눈이다.
 *
 * 🔴 **견적서 쪽 같은 통로(api/quotes/{id}/archive-folder/pdf)를 그대로 본떴다.** 다른 것은
 * 「어느 폴더의 어느 엑셀인가」를 **찾는 방법** 하나뿐이다:
 *  · 견적서는 폴더 이름도 파일 이름도 **규칙이 정한 한 이름**이라 서버가 다시 지어 찾는다.
 *  · 🔴 연락서 폴더는 **덮어쓰지 않고 번호로 비켜 간다**(`… (2).xlsx`). 그래서 「방금 쓴
 *    그 한 장」은 쓴 쪽만 안다 — 꽂기 통로가 돌려준 **그 이름**(`?name=`)과 **그 자리**
 *    (`?path=`)를 그대로 받아 본다. 서버가 「엑셀처럼 보이는 것 가운데 하나」를 고르지
 *    않는 것은 견적서 쪽과 같은 절제다.
 *
 * ── 🔴 받은 자리를 믿지 않는다 ──────────────────────────────────────────
 *  · `?path=` 는 **찾은 연락서 폴더 안에서의 자리**다(비면 폴더 맨 위). 검사는 이웃 목록
 *    통로가 쓰는 **그 규칙 그대로**(checkQuoteFolderRelativePath)이고, 실제로 내려가는 일은
 *    저장소 모듈이 한다 — 마디마다 「그 자리에 보이는 폴더 줄인가」를 보고, 바로가기는
 *    따라가지 않으며, 루트 담김을 한 겹 더 본다(storage/contact-folder-entries.ts).
 *  · `?name=` 은 **마디 하나짜리 `.xlsx` 이름**이어야 한다 — 변환 주소가 쓰는 그 판정이다
 *    (isQuoteFolderXlsx2PdfSourceName). 그래서 `/` 도 `..` 도 들어올 수 없다.
 *
 * ── 🔴 읽기 하나다 — 쓰지 않는다 · 만들지 않는다 · 변환을 시키지도 않는다 ──
 * 폴더를 찾아 그 자리의 맨 위 칸을 읽는 일만 한다. `mkdir` · 파일 쓰기 · 삭제가 들어올
 * 길이 없고, 도우미 주소를 만들지도 열지도 않는다 — **변환을 시키는 것은 화면**이고 쓰는
 * 것은 그 PC 의 Excel 이다. 서버는 결과만 본다(route-source.test.ts 가 원본으로 못 박는다).
 *
 * ── 🔴 「전에도 있었다」를 가를 재료를 함께 낸다 ────────────────────────
 * 있는지(`pdfExists`)만 내면 **저장 전에 이미 있던 PDF** 를 「방금 만들었다」고 말하게 된다.
 * 그래서 **수정 시각**(`pdfModifiedAt`)을 함께 낸다 — 화면은 주소를 열기 **전에** 한 번 물어
 * 기준을 잡고 뒤의 답과 견준다. 🔴 그 한 줄의 stat 이 막혔으면 **이 칸만 빠지고**, 화면은
 * 그때 「만들었다」고 단언하지 않는다(거짓 성공이 아니라 거짓 실패 쪽으로 틀린다).
 *
 * ── 🔴 권한은 이웃 통로(`../route.ts`)와 **같은 원본**에서 읽는다 ────────
 * 엑셀을 그 폴더에 넣을 수 있는 사람이면 그것이 PDF 가 됐는지도 볼 수 있다. 🔴 파일 관리
 * 쪽 문(`repairCases.files` READ)을 쓰지 않는 까닭은, 관리자가 그 잎만 NONE 으로 낮추면
 * **방금 저장한 사람이 제 변환 결과를 못 보게** 되기 때문이다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", sourceName, pdfName, pdfExists, pdfModifiedAt? }`
 *  · 200 `{ status: "no-source" }` — 그 자리에 그 엑셀이 없다
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }` · `{ status: "disabled" }`
 *  · 200 `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 400 · 401 · 403 · 404. 모두 `Cache-Control: no-store`.
 *    🔴 어느 쪽에도 절대 경로 · 루트 · 연락서 폴더 이름이 들어가지 않는다.
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
  /** 🔴 받은 자리 · 이름이 규칙 밖이다 — 디스크를 보기 전에 끝난다. */
  | "INVALID_PATH";

/** 응답 본문. 🔴 **경로 · 폴더 이름을 담는 칸이 타입 수준에 없다.** */
type ServiceReportContactFolderPdfResponse =
  | {
      status: "found";
      /** 그 자리에서 찾은 엑셀의 **디스크 실제 이름**. */
      sourceName: string;
      /** 규칙이 정한 결과 이름 — 같은 자리의 같은 이름 `.pdf`. */
      pdfName: string;
      pdfExists: boolean;
      /** 🔴 수정 시각(ISO). 없으면(아직 없다 · stat 이 막혔다) **이 칸이 통째로 빠진다.** */
      pdfModifiedAt?: string;
    }
  /** 그 자리에 바꿀 엑셀이 없다 — **오류가 아니다**(사람이 치웠을 수 있다). */
  | { status: "no-source" }
  | { status: "multiple" }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 🔴 사유에 경로 · 이름을 담지 않는다(이 기능 한 벌의 규율). */
const UNCONVERTIBLE_NAME_REASON = "이 보고서 엑셀의 이름은 PDF 변환 주소로 만들 수 없습니다.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: ServiceReportContactFolderPdfResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(이웃 통로들과 같다). */
function modifiedAtOf(modifiedAtMs: number | null | undefined): { pdfModifiedAt?: string } {
  if (modifiedAtMs === null || modifiedAtMs === undefined || !Number.isFinite(modifiedAtMs)) return {};
  return { pdfModifiedAt: new Date(modifiedAtMs).toISOString() };
}

/** 그 자리의 **파일** 가운데 이 이름인 것. 견줄 때만 다듬는다(NFD · 두 칸 공백). */
function fileNamed(entries: readonly ContactFolderEntry[], name: string): ContactFolderEntry | null {
  const wanted = normalizeShareFolderNameForCompare(name);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (normalizeShareFolderNameForCompare(entry.name) === wanted) return entry;
  }
  return null;
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
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");

  // ── 3) 권한 — 🔴 이웃 꽂기 통로와 **같은 원본**에서 읽는다. 조회보다 앞이다 ──
  if (
    !(await hasPermission(actingUser, SERVICE_REPORT_PERMISSION_AREA, SERVICE_REPORT_REQUIRED_LEVELS.edit))
  ) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 4) 수리 건 — 없다 · 휴지통 · id 모양이 아니다를 모두 404 로 모은다 ──
  const { id } = await context.params;
  const repairCase = await getRepairCaseContactFolderKeyById(id);
  if (!repairCase) return fail(404, "NOT_FOUND", "해당 접수 건을 찾을 수 없습니다.");

  // ── 5) 받은 자리 · 이름 — 🔴 디스크를 보기 전에 본다 ───────────────────
  const insidePath = request.nextUrl.searchParams.get("path") ?? "";
  if (insidePath !== "" && checkQuoteFolderRelativePath(insidePath) !== null) {
    return fail(400, "INVALID_PATH", "하위 폴더 경로가 올바르지 않습니다.");
  }
  const sourceName = request.nextUrl.searchParams.get("name") ?? "";
  if (!isQuoteFolderXlsx2PdfSourceName(sourceName)) {
    return fail(400, "INVALID_PATH", "바꿀 엑셀 이름이 올바르지 않습니다.");
  }

  // ── 6) 공유폴더 루트 — 이 값은 찾기 · 읽기에만 쓰고 응답에 싣지 않는다 ──
  const archiveRoot = resolveContactFolderArchiveRoot();
  if (archiveRoot === null) {
    return respond({ status: "disabled" });
  }

  // ── 7) 폴더 찾기 — 🔴 인수번호 하나로만. 읽기만 한다 ───────────────────
  const found = await findContactFolder({ root: archiveRoot, intakeNumber: repairCase.intakeNumber });
  if (found.status === "multiple") {
    // 🔴 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 상태만 준다.
    return respond({ status: "multiple" });
  }
  if (found.status === "not-found") return respond({ status: "not-found" });
  if (found.status === "disabled") {
    // 루트를 먼저 보았으므로 여기에 닿지 않지만, 상태가 하나 늘면 컴파일러가 짚게 둔다.
    return respond({ status: "disabled" });
  }
  if (found.status === "failed") return respond({ status: "failed", reason: found.reason });

  // ── 8) 그 자리를 읽는다 — 깊이 · 줄 수 · 기다리기 상한은 저장소 모듈이 쥔다 ──
  const listed = await listContactFolderEntries({
    root: archiveRoot,
    folderName: found.folderName,
    relativePath: insidePath,
  });
  if (listed.status === "failed") {
    return respond({ status: "failed", reason: listed.reason });
  }

  // ── 9) JSON — 이름 둘 · 있는가 · 수정 시각 ─────────────────────────────
  const source = fileNamed(listed.entries, sourceName);
  if (source === null) return respond({ status: "no-source" });
  // 🔴 결과 이름도 **규칙이 정한다** — 도우미가 제 손으로 짓는 그 규칙과 같은 한 벌이다.
  const pdfName = quoteFolderXlsx2PdfOutputName(source.name);
  if (pdfName === null) {
    return respond({ status: "failed", reason: UNCONVERTIBLE_NAME_REASON });
  }
  const pdf = fileNamed(listed.entries, pdfName);
  return respond({
    status: "found",
    sourceName: source.name,
    pdfName,
    pdfExists: pdf !== null,
    ...modifiedAtOf(pdf?.modifiedAtMs),
  });
}
