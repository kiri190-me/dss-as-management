import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isTrustedOrigin } from "@/lib/auth/request-guards";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import {
  readHandwrittenQuoteWorkbook,
  type HandwrittenQuoteReadFailureCode,
  type HandwrittenQuoteReadResult,
} from "@/lib/xlsx/handwritten-quote-reader";

/**
 * ============================================================================
 * POST /api/quotes/parse-excel — 수기 견적서 엑셀에서 견적서 칸의 값을 읽어 돌려준다 (견적서 ①a)
 * ============================================================================
 * 본문은 .xlsx 파일 바이트 그대로다(multipart 를 쓰지 않는 까닭은 첨부 통로들과 같다 —
 * api/repair-cases/[id]/attachments/route.ts 머리말). 읽는 일은 전부
 * xlsx/handwritten-quote-reader.ts 가 하고, 이 파일은 문지기와 응답 모양만 맡는다.
 *
 * ── 🔴 읽기 전용이다 ────────────────────────────────────────────────────
 * 파일을 **어디에도 두지 않는다** — 첨부 저장소 · 임시 폴더 · 공유폴더 · DB 어느 곳에도
 * 쓰지 않고, 메모리에서 읽고 버린다. **감사를 남기지 않는다** — 사람이 이미 손에 가진
 * 파일을 읽어 폼에 옮겨 줄 뿐이라, 기록할 변경이 없다. 폼이 그 값으로 견적서를 저장하면
 * 그때 저장 통로가 제 감사를 남긴다.
 *
 * ── 왜 견적서 id 가 없는 통로인가 ─────────────────────────────────────────
 * 폼이 파일을 **저장 전에** 들고 있다. 새 견적서는 아직 id 가 없고, 수기 엑셀 칸도 저장할
 * 때 올라간다 — 그 전에 값을 채워 보여 주려면 id 없이 바이트만 받아야 한다. 그래서
 * api/quotes/[id]/… 아래가 아니라 여기다(정적 이름이라 [id] 와 부딪히지 않는다).
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 요청 출처 → 2) 저장 모드 → 3) 세션 · 살아 있는 계정 · 승인 → 4) 권한(quotes WRITE)
 *  → 5) 본문 바이트(상한 MAX_ATTACHMENT_SIZE_BYTES — 선언 길이로 먼저 자르고, 읽으면서
 *  다시 센다) → 6) 읽개 → 7) JSON
 *
 * 권한이 WRITE 인 까닭: 이 값은 견적서 편집 폼에 채우는 것이고, 폼을 저장할 수 있는
 * 사람만 부를 이유가 있다. 서버에서 믿을 수 없는 파일을 푸는 일이라 문턱을 낮추지 않는다.
 *
 * ── 응답 ────────────────────────────────────────────────────────────────
 *  · 200 `{ sheet, fields, warnings }` — 칸이 비거나 이상해도 200 이다(그 칸만 null, 까닭은
 *    warnings). 모양은 handwritten-quote-reader.ts 의 HandwrittenQuoteFields.
 *  · 실패 `{ error, code }` — 415 옛 .xls · xlsx 아님 / 422 알아볼 시트 없음 / 413 너무 큼
 *    (본문 또는 풀어 본 내용). 실패 응답과 로그에 파일의 값을 싣지 않는다.
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNTRUSTED_ORIGIN"
  | "DATABASE_MODE_REQUIRED"
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "EMPTY_BODY"
  | "FILE_TOO_LARGE"
  | "BODY_READ_FAILED"
  | "PARSE_FAILED"
  | HandwrittenQuoteReadFailureCode;

/** 읽개의 실패 → 응답 코드. 코드가 하나 늘면 컴파일러가 여기를 채우라고 짚는다. */
const STATUS_BY_READ_FAILURE: Record<HandwrittenQuoteReadFailureCode, number> = {
  XLS_LEGACY: 415,
  NOT_XLSX: 415,
  NO_QUOTE_SHEET: 422,
  CONTENT_TOO_LARGE: 413,
};

const FILE_TOO_LARGE_MESSAGE = "파일이 20MB를 넘습니다.";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1) 요청 출처 — 다른 사이트가 사용자 몰래 파일을 밀어 넣는 요청을 막는다 ──
  if (!isTrustedOrigin(request)) {
    return fail(403, "UNTRUSTED_ORIGIN", "요청 출처를 확인할 수 없습니다.");
  }

  // ── 2) 저장 모드 — 견적서는 데이터베이스 저장 모드에서만 있는 화면이다 ──────
  if (getAuthSource() !== "database") {
    return fail(403, "DATABASE_MODE_REQUIRED", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 3) 세션 · 살아 있는 계정 · 승인 ──────────────────────────────────
  const session = await readSession();
  if (!session) {
    return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  }
  // 세션에 박힌 값이 아니라 살아 있는 계정을 다시 읽는다 — 토큰이 발급된 뒤 계정이
  // 정지 · 삭제 · 강등됐을 수 있다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    return fail(401, "UNAUTHENTICATED", "사용자 정보를 확인할 수 없습니다.");
  }
  if (actingUser.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "승인 대기 중인 계정은 파일을 읽을 수 없습니다.");
  }

  // ── 4) 권한 — 견적서를 고칠 수 있는 사람만. 본문을 받기 전이다 ─────────────
  if (!(await hasPermission(actingUser, "quotes", "WRITE"))) {
    return fail(403, "FORBIDDEN", "견적서를 고칠 권한이 없습니다.");
  }

  // ── 5) 본문 — 선언 길이로 먼저 자르고, 읽으면서 다시 센다 ────────────────
  // 선언 길이는 믿을 수 없지만(진짜 판정은 아래에서 센 바이트로 한다) 맞을 때는 20MB 를
  // 받아 놓고 버리는 일을 통째로 아낀다.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ATTACHMENT_SIZE_BYTES) {
    return fail(413, "FILE_TOO_LARGE", FILE_TOO_LARGE_MESSAGE);
  }

  const body = request.body;
  if (!body) {
    return fail(400, "EMPTY_BODY", "읽을 파일이 없습니다.");
  }

  let received: { ok: true; bytes: Buffer } | { ok: false };
  try {
    received = await readBodyWithinLimit(body, MAX_ATTACHMENT_SIZE_BYTES);
  } catch {
    return fail(400, "BODY_READ_FAILED", "파일을 받는 중에 연결이 끊겼습니다. 다시 올려 주세요.");
  }
  if (!received.ok) {
    return fail(413, "FILE_TOO_LARGE", FILE_TOO_LARGE_MESSAGE);
  }
  if (received.bytes.length === 0) {
    return fail(400, "EMPTY_BODY", "빈 파일은 읽을 수 없습니다.");
  }

  // ── 6) 읽개 — 메모리에서만 읽는다(머리말 '읽기 전용') ──────────────────
  let result: HandwrittenQuoteReadResult;
  try {
    result = readHandwrittenQuoteWorkbook(received.bytes);
  } catch (error) {
    // 읽개는 내용 때문에 던지지 않는다. 여기로 오면 결함이다 — 오류 이름만 남긴다.
    console.error("[quote-parse-excel] 엑셀을 읽다 멈췄다", { error: errorNameOf(error) });
    return fail(500, "PARSE_FAILED", "엑셀을 읽는 중 문제가 발생했습니다.");
  }
  if (!result.ok) {
    return fail(STATUS_BY_READ_FAILURE[result.code], result.code, result.message);
  }

  // ── 7) JSON ─────────────────────────────────────────────────────────
  return NextResponse.json(
    { sheet: result.sheet, fields: result.fields, warnings: result.warnings },
    {
      status: 200,
      // 고객 정보가 담긴 응답이다. 중간 캐시에 남지 않게 한다.
      headers: { "Cache-Control": "no-store" },
    }
  );
}

/** 본문을 끝까지 읽되 상한을 넘는 순간 멈춘다. 첨부 상한(20MB)이 있어 메모리에 담아도 된다. */
async function readBodyWithinLimit(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer } | { ok: false }> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

/** 로그에 남길 짧은 표지 — 오류 이름만. message 에는 파일의 값이 섞일 수 있다. */
function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
