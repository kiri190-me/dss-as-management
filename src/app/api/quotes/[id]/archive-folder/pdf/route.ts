import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { quoteArchiveFileName, normalizeQuoteArchiveNameForCompare } from "@/lib/domain/quote-archive-naming";
import { isQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { quoteFolderXlsx2PdfOutputName } from "@/lib/domain/quote-folder-xlsx2pdf-link";
import { listQuoteArchiveEntries, type QuoteArchiveEntry } from "@/lib/storage/quote-archive-entries";
import { resolveQuoteArchiveRoot } from "@/lib/storage/quote-archive";
import { isValidQuoteId } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * GET /api/quotes/{id}/archive-folder/pdf — **그 PDF 가 폴더에 있는가** (2026-10-08)
 * ============================================================================
 * [저장]을 누르면 화면이 `dss-folder://xlsx2pdf/?p=…` 주소를 열고, 그 PC 의 Excel 이 공유폴더에
 * PDF 를 쓴다. 🔴 **도우미는 답을 주지 않는다** — 브라우저는 그 주소를 받을 프로그램이 있는지도,
 * 그 프로그램이 무엇을 했는지도 알 수 없다(server/quote-folder-helper.ts 머리말). 그래서
 * **서버가 폴더를 다시 읽어** 같은 이름 `.pdf` 가 생겼는지 본다. 이 통로가 그 눈이다.
 *
 * 이웃 통로 둘(`../route.ts` — 폴더가 어디인가 · `../entries/route.ts` — 폴더 안에 무엇이 있는가)을
 * 그대로 본떴다. 🔴 **문지기는 글자 그대로 같다**(route-source.test.ts 가 맞춰 본다).
 *
 * ── 🔴 쓰지 않는다 · 만들지 않는다 · 변환을 시키지도 않는다 ──────────────────
 * 이 통로는 **읽기 하나**다. 폴더를 찾아 맨 위 칸을 읽는 일(storage/quote-archive-entries.ts)만
 * 하고, 거기에 mkdir · 파일 쓰기 · 삭제가 들어올 길이 없다. **변환을 시키는 것은 이 통로가
 * 아니다** — 주소를 여는 것은 화면이고 쓰는 것은 그 PC 의 Excel 이다. 서버는 결과만 본다.
 *
 * ── 🔴 무엇을 PDF 로 바꿀 것인가 — 지어내지 않는다 ──────────────────────────
 * 저장이 공유폴더에 쓴 엑셀의 이름은 **이름 규칙이 정한 그 이름**이다
 * (domain/quote-archive-naming.ts 의 quoteArchiveFileName · 확장자 `xlsx`). 그래서 이 통로도
 * **같은 함수로 같은 이름**을 지어 폴더에서 찾는다 — 「엑셀처럼 보이는 것 가운데 하나」를
 * 고르지 않는다. 그렇게 고르면 번호가 같은 **다른 판**(사람이 손으로 넣은 파일)을 덮어쓰게
 * 시킬 수 있다. 못 찾으면 `no-source` 다(오류가 아니다 — 아직 저장 전이거나 건너뛴 장이다).
 * 🔴 **견주는 이름은 다듬어서**(normalizeQuoteArchiveNameForCompare) 본다 — NAS 에 적힌
 * 이름은 풀어쓴 한글(NFD)이거나 공백이 두 칸일 수 있다. 돌려주는 것은 **디스크의 실제 이름**이다.
 *
 * ── 🔴 결과 이름도 규칙이 정한다 ────────────────────────────────────────────
 * `.xlsx` 다섯 글자를 떼고 `.pdf` 를 붙인다(domain/quote-folder-xlsx2pdf-link.ts) — 도우미가
 * 제 손으로 짓는 그 규칙과 **같은 한 벌**이다. 통로가 제 손으로 이름을 짓지 않는다.
 *
 * ── 🔴 「전에도 있었다」를 가르는 재료를 함께 낸다 ───────────────────────────
 * 있는지(`pdfExists`)만 내면 **저장 전에 이미 있던 PDF** 를 「방금 만들었다」고 말하게 된다.
 * 그래서 **수정 시각**(`pdfModifiedAt`)을 함께 낸다 — 화면은 주소를 열기 **전에** 한 번 물어
 * 기준을 잡고, 뒤의 답과 견준다(components/quotes/quote-save-pdf-convert.ts). 🔴 그 한 줄의
 * stat 이 막혔으면 **이 칸만 빠진다**(이웃 목록 통로와 같은 규율) — 화면은 그때 「만들었다」고
 * 단언하지 않는다.
 *
 * ── 🔴 응답에 경로가 없다 ───────────────────────────────────────────────────
 * 나가는 것은 **루트 기준 상대 폴더 경로**와 **그 폴더 안에서의 이름 둘**뿐이다 — 이웃 통로가
 * 이미 내는 값과 같은 성질이다. 컨테이너 안 경로(QUOTE_ARCHIVE_DIR)도 전체 공유폴더 주소
 * (uncPath)도 담을 칸이 타입 수준에 없고, 실패 사유도 경로 없는 짧은 문장이다.
 *
 * ── 🔴 맞는 폴더가 여럿이면 아무것도 내지 않는다 ────────────────────────────
 * 어느 폴더인지 모르는 채로 변환을 시키면 **남의 견적서 폴더에 PDF 를 쓰게 할 수 있다.**
 * 상태만 돌려주고 끝낸다 — 이웃 목록 통로와 같은 판단이다.
 *
 * ── 줄 수 상한 ──────────────────────────────────────────────────────────────
 * 읽기는 저장소 모듈의 상한(100 줄)을 그대로 쓴다. 실측(2026-10-06)에서 견적서 폴더 하나에 든
 * 파일은 평균 서넛이라 걸리지 않는다 — 통로가 제 숫자를 들지 않는다(이웃 통로와 같다).
 *
 * ── 순서 ────────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 · 살아 있는 계정 · 승인 → 3) 권한(quotes READ) → 4) id 형식
 *  → 5) 견적서(휴지통이면 없는 것) → 6) 공유폴더 루트(꺼져 있으면 disabled) → 7) 찾아서 읽기
 *  → 8) 주소 규칙 · 이름 규칙 → 9) JSON
 *
 * ── 응답 ────────────────────────────────────────────────────────────────────
 *  · 200 `{ status: "found", relativePath, sourceName, pdfName, pdfExists, pdfModifiedAt? }`
 *  · 200 `{ status: "no-source" }` — 폴더는 있는데 바꿀 엑셀이 없다
 *  · 200 `{ status: "multiple" }` · `{ status: "not-found" }` · `{ status: "disabled" }`
 *  · 200 `{ status: "failed", reason }`
 *  · 실패 `{ error, code }` — 401 · 403 · 404. 모두 `Cache-Control: no-store`.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode = "DATABASE_MODE_REQUIRED" | "UNAUTHENTICATED" | "ACCOUNT_NOT_APPROVED" | "FORBIDDEN" | "NOT_FOUND";

/** 응답 본문. 🔴 컨테이너 안 경로 · 전체 공유폴더 주소를 담는 칸이 없다. */
type QuoteArchivePdfResponse =
  | {
      status: "found";
      /** 루트 기준 슬래시 경로 — `연도 폴더/견적서 폴더`. 화면이 변환 주소를 만들 때 쓴다. */
      relativePath: string;
      /** 바꿀 엑셀의 **그 폴더 안에서의 이름**(디스크의 실제 이름). */
      sourceName: string;
      /** 규칙이 정한 결과 이름 — 같은 폴더의 같은 이름 `.pdf`. */
      pdfName: string;
      pdfExists: boolean;
      /** 🔴 수정 시각(ISO). 없으면(아직 없다 · stat 이 막혔다) **이 칸이 통째로 빠진다.** */
      pdfModifiedAt?: string;
    }
  /** 폴더는 찾았는데 바꿀 엑셀이 없다 — **오류가 아니다**(엑셀 전용 · 아직 저장 전). */
  | { status: "no-source" }
  /** 🔴 어느 폴더인지 모른다 — 경로도 이름도 내지 않는다. */
  | { status: "multiple" }
  | { status: "not-found" }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 이웃 통로 둘과 **같은 문장**이다 — 같은 폴더를 두고 세 자리가 다른 말을 하지 않게. */
const UNOPENABLE_FOLDER_REASON =
  "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";

/** 🔴 사유에 경로 · 이름을 담지 않는다(이 기능 한 벌의 규율). */
const UNCONVERTIBLE_NAME_REASON = "이 견적서 엑셀의 이름은 PDF 변환 주소로 만들 수 없습니다.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

function respond(body: QuoteArchivePdfResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** 에포크 ms → ISO. 못 읽은 줄(null)은 **칸이 통째로 빠진다**(이웃 목록 통로와 같다). */
function modifiedAtOf(modifiedAtMs: number | null | undefined): { pdfModifiedAt?: string } {
  if (modifiedAtMs === null || modifiedAtMs === undefined || !Number.isFinite(modifiedAtMs)) return {};
  return { pdfModifiedAt: new Date(modifiedAtMs).toISOString() };
}

/** 그 폴더 안의 **파일** 가운데 이 이름인 것. 견줄 때만 다듬는다(NFD · 두 칸 공백). */
function fileNamed(entries: readonly QuoteArchiveEntry[], name: string): QuoteArchiveEntry | null {
  const wanted = normalizeQuoteArchiveNameForCompare(name);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (normalizeQuoteArchiveNameForCompare(entry.name) === wanted) return entry;
  }
  return null;
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

  // ── 7) 찾아서 읽는다 — 저장이 쓴 그 폴더를 **읽기만** 한다 ────────────
  //    🔴 이름 재료는 저장이 쓴 것과 **같은 한 벌**이다(신고증상 꼬리까지) — 폴더 찾기는
  //    번호만 보지만 파일 이름은 꼬리까지 쓰므로, 한 벌로 넘겨 두 쓰임이 갈라지지 않게 한다.
  const naming = {
    quoteNumber: quote.quoteNumber,
    kind: quote.kind,
    customerName: quote.customerNameText,
    modelName: quote.modelNameText,
    lotNumber: quote.lotNumberText,
    serialNumber: quote.serialNumberText,
    faultDescription: quote.faultDescriptionText,
  };
  const listed = await listQuoteArchiveEntries({ root: archiveRoot, quoteDate: quote.quoteDate, naming });

  // ── 8~9) JSON — 상대 경로 · 이름 둘 · 짧은 사유만 ────────────────────
  if (listed.status === "found") {
    // 도우미가 받지 않을 폴더 이름이면 변환 주소를 만들 수 없다 — 이웃 통로와 **같은 문장**.
    if (!isQuoteFolderRelativePath(listed.relativePath)) {
      return respond({ status: "failed", reason: UNOPENABLE_FOLDER_REASON });
    }
    // 🔴 저장이 쓴 그 이름을 **같은 함수로** 짓는다. 발행번호가 빈 장(검증이 막는다)에서는
    //    이름을 만들지 못하고 던지므로, 그때는 「바꿀 엑셀이 없다」로 끝낸다.
    let expectedName: string;
    try {
      expectedName = quoteArchiveFileName(naming, { extension: "xlsx" });
    } catch {
      return respond({ status: "no-source" });
    }
    const source = fileNamed(listed.entries, expectedName);
    if (source === null) {
      return respond({ status: "no-source" });
    }
    const pdfName = quoteFolderXlsx2PdfOutputName(source.name);
    if (pdfName === null) {
      return respond({ status: "failed", reason: UNCONVERTIBLE_NAME_REASON });
    }
    const pdf = fileNamed(listed.entries, pdfName);
    return respond({
      status: "found",
      relativePath: listed.relativePath,
      sourceName: source.name,
      pdfName,
      pdfExists: pdf !== null,
      ...modifiedAtOf(pdf?.modifiedAtMs),
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
