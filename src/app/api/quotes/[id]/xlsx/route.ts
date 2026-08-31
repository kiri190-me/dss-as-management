import { NextResponse, type NextRequest } from "next/server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import { getQuoteForEdit } from "@/lib/db/queries/quotes";
import { recordQuoteExport } from "@/lib/db/mutations/quote-exports";
import { buildQuoteFileName, quoteContentDisposition } from "@/lib/domain/quote-file-name";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import { isValidQuoteId } from "@/lib/validation/quote-input";
import {
  QuoteTemplateError,
  readOhQuoteTemplate,
  readQuoteTemplate,
  readQuoteTemplateFor,
} from "@/lib/storage/quote-template";
import { fillQuoteWorkbook } from "@/lib/xlsx/quote-template";
import { fillOhQuoteWorkbook } from "@/lib/xlsx/oh-quote-template";
import {
  fillMatcherQuoteWorkbook,
  type MatcherWorkScope,
} from "@/lib/xlsx/matcher-quote-template";

/**
 * ============================================================================
 * GET /api/quotes/{id}/xlsx — 견적서가 밖으로 나가는 단 하나의 통로
 * ============================================================================
 * 저장된 값(quotes + quote_items)에 원본 양식을 씌워 **그 자리에서 만든** xlsx 를
 * 흘려보낸다. 만들어진 파일은 디스크에 남기지 않는다 — 남기면 그 폴더가
 * 로그인·권한·감사를 우회하는 두 번째 통로가 된다.
 *
 * ── 순서 ────────────────────────────────────────────────────────────────
 *  1) 저장 모드 → 2) 세션 → 3) 계정 승인 → 4) 권한(READ) → 5) 견적서 조회
 *  → 6) 양식 읽기 → 7) 채우기 → 8) 감사(EXCEL_EXPORT) → 9) 전송
 *
 * 4번이 5번보다 앞인 이유: 권한이 없는 사람에게는 "그 id 의 견적서가 있다"는
 * 사실조차 알려 주지 않는다.
 *
 * ── 왜 READ 로 충분한가 ─────────────────────────────────────────────────
 * 이 통로는 **아무것도 바꾸지 않는다.** 이미 저장된 값을 보기 좋은 형태로
 * 옮겨 줄 뿐이라, 목록에서 그 견적서를 볼 수 있는 사람이면 그 내용을 파일로도
 * 받을 수 있는 것이 맞다. WRITE 를 요구하면 "화면에서는 금액까지 다 보이는데
 * 파일로는 못 받는" 상태가 되고, 그 사람은 결국 화면을 보고 손으로 옮겨 적는다.
 *
 * 대신 **감사는 남긴다** — 직인이 찍힌 문서가 나가는 일이다(mutations/
 * quote-exports.ts 의 '왜 남기는가').
 *
 * ── 실패 응답에 경로를 싣지 않는다 ──────────────────────────────────────
 * 양식을 못 읽었을 때 그 경로를 응답에 담으면 오류 메시지가 디스크 구조를
 * 알려 주는 창구가 된다. 경로는 서버 로그에만 남는다
 * (storage/quote-template.ts).
 * ============================================================================
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureCode =
  | "UNAUTHENTICATED"
  | "ACCOUNT_NOT_APPROVED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TEMPLATE_UNAVAILABLE"
  | "RENDER_FAILED";

function fail(status: number, code: FailureCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (getAuthSource() !== "database") {
    return fail(403, "FORBIDDEN", "데이터베이스 저장 모드가 아닙니다.");
  }

  // ── 2~3) 세션과 계정 승인 ────────────────────────────────────────────
  const session = await readSession();
  if (!session) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");
  if (session.approvalStatus !== "APPROVED") {
    return fail(403, "ACCOUNT_NOT_APPROVED", "계정이 아직 승인되지 않았습니다.");
  }
  // 세션에 박혀 있는 role 이 아니라 살아 있는 계정을 다시 읽는다 — 강등된
  // 계정이 토큰 만료 전까지 예전 권한으로 받아 가는 구멍을 막는다.
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return fail(401, "UNAUTHENTICATED", "로그인이 필요합니다.");

  // ── 4) 권한 — 조회보다 앞이다 ────────────────────────────────────────
  if (!(await hasPermission(actingUser.role, "quotes", "READ"))) {
    return fail(403, "FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
  }

  // ── 5) 견적서 ────────────────────────────────────────────────────────
  const { id } = await context.params;
  // 형식이 틀린 id 로 DB 를 때리지 않는다.
  if (!isValidQuoteId(id)) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  // 지워진 장은 여기서도 없는 것이다(getQuoteForEdit 이 is_deleted 로 좁힌다).
  // 화면에서 지운 견적서를 주소만으로 계속 뽑을 수 있으면 휴지통이 뜻을 잃는다.
  const quote = await getQuoteForEdit(id);
  if (!quote) return fail(404, "NOT_FOUND", "해당 견적서를 찾을 수 없습니다.");

  // ── 6~7) 양식을 읽어 채운다 ──────────────────────────────────────────
  let workbook: Buffer;
  try {
    // 양식은 넷이고 셀 자리가 서로 겹치지 않는다. 장비 종류 × 견적서 종류로
    // 고른다(domain/quote-template-variant.ts).
    const templateKey = quoteTemplateKey(quote.laborEquipmentKind, quote.kind);
    const isOverhaul = quote.kind === "OVERHAUL";
    const common = {
      quoteNumber: quote.quoteNumber,
      // date 칼럼이 "YYYY-MM-DD" 로 온다. new Date("2026-08-28") 은 UTC 자정으로
      // 읽혀 시간대에 따라 하루가 밀리므로, 글자를 그대로 쪼개 로컬 날짜를 만든다
      // (xlsx/sheet-patch.ts 의 toExcelSerialDate 가 로컬 연·월·일을 본다).
      quoteDate: parseDateOnly(quote.quoteDate),
      customerName: quote.customerNameText,
      subject: quote.subject,
      modelName: quote.modelNameText ?? undefined,
      serialNumber: quote.serialNumberText ?? undefined,
      lotNumber: quote.lotNumberText ?? undefined,
      // null 은 "양식의 기본 문구를 그대로 쓴다"는 뜻이라 undefined 로 넘긴다
      // (quote-template.ts 의 '비워 두면 양식의 기본 문구').
      validity: quote.validity ?? undefined,
      delivery: quote.delivery ?? undefined,
      payment: quote.payment ?? undefined,
      // 양식의 `1) 부품 비용` 칸으로 갈 줄들. OH 표시가 붙은 줄은 빼고
      // 아래 overhaulParts 로 보낸다 — 두 그룹은 양식에서 자리가 다르다.
      parts: quote.items
        .filter((item) => !item.isOverhaulPart)
        .map((item) => ({
          name: item.partNameText,
          quantity: item.quantity,
          // numeric 은 문자열로 온다. 숫자를 요구하는 엔진에 넘기는 **이 한
          // 지점에서만** 바꾼다(schema/quotes.ts 의 '금액은 numeric 이다').
          unitPrice: Number(item.unitPrice),
        })),
      workCost: Number(quote.workCost),
    };

    if (templateKey.startsWith("MATCHER:")) {
      /**
       * 매쳐 양식에는 O/H 부품 칸이 따로 없다 — **부품이 한 목록**이라 나눈
       * 것을 다시 합쳐 넘긴다. 대신 줄 수가 고정이 아니어서 담을 만큼 늘어난다
       * (xlsx/matcher-quote-template.ts).
       */
      workbook = fillMatcherQuoteWorkbook(await readQuoteTemplateFor(templateKey), {
        ...common,
        parts: quote.items.map((item) => ({
          name: item.partNameText,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
        })),
        workScope: groupWorkScope(quote.workScopeLines),
      });
    } else {
      workbook = isOverhaul
        ? fillOhQuoteWorkbook(await readOhQuoteTemplate(), {
            ...common,
            // `2) OH 부품 비용` 칸(34~46행). OH 표시가 붙은 줄만 여기로 간다.
            overhaulParts: quote.items
              .filter((item) => item.isOverhaulPart)
              .map((item) => ({
                name: item.partNameText,
                quantity: item.quantity,
                unitPrice: Number(item.unitPrice),
              })),
          })
        : fillQuoteWorkbook(await readQuoteTemplate(), common);
    }
  } catch (err) {
    if (err instanceof QuoteTemplateError) {
      return fail(503, "TEMPLATE_UNAVAILABLE", err.message);
    }
    // 양식이 바뀌어 셀을 못 찾은 경우가 여기로 온다(sheet-patch.ts 는 조용히
    // 넘어가지 않고 던진다 — 빈 칸짜리 견적서가 나가는 것보다 낫다).
    // 값 자체는 로그에 담지 않는다: 품명·신고증상에 고객사 사정이 섞인다.
    console.error("[quote-xlsx] 견적서를 만들지 못했다", {
      quoteId: quote.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return fail(500, "RENDER_FAILED", "견적서를 만들지 못했습니다. 관리자에게 문의해 주세요.");
  }

  // ── 8) 감사 — 파일을 돌려주기 전에 남긴다 ────────────────────────────
  // 응답을 먼저 반환하면 기록이 누락될 수 있다(첨부 다운로드의 같은 판단).
  await recordQuoteExport({
    quoteId: quote.id,
    quoteNumber: quote.quoteNumber,
    actorUserId: actingUser.id,
  });

  // ── 9) 전송 ──────────────────────────────────────────────────────────
  const fileName = buildQuoteFileName({
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerNameText,
  });

  return new NextResponse(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": quoteContentDisposition(fileName),
      "Content-Length": String(workbook.byteLength),
      // 직인이 찍힌 문서다. 중간 캐시에 남지 않게 한다.
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}

/**
 * 작업 내역 줄을 세 묶음으로 나눈다. 차례는 조회가 이미 묶음별로 매겨 준다
 * (db/queries/quotes.ts).
 */
function groupWorkScope(
  lines: readonly { section: keyof MatcherWorkScope; text: string }[]
): MatcherWorkScope {
  const grouped: Record<keyof MatcherWorkScope, string[]> = {
    INVESTIGATION: [],
    REPAIR: [],
    POWER_TEST: [],
  };
  for (const line of lines) grouped[line.section].push(line.text);
  return grouped;
}

/** "YYYY-MM-DD" → 그 날짜의 로컬 Date. `new Date(문자열)` 은 UTC 로 읽혀 하루가 밀린다. */
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
