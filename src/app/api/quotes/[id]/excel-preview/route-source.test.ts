import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES } from "../../../../../lib/server/services/quote-excel-preview";

/**
 * ============================================================================
 * GET /api/quotes/{id}/excel-preview — 문지기 순서 · 이름 · 쓰기 없음 · 감사 없음을 **소스로** 지킨다 (견적서 ②b)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 대신 소스를 읽어 지킨다 —
 * parse-excel/route-source.test.ts 와 같은 장치다. 읽는 일 자체는
 * services/quote-excel-preview.test.ts 가 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const getBody = route.slice(route.indexOf("export async function GET"));

function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
  )) {
    names.push(match[1]);
  }
  return names.sort();
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^import\s[\s\S]*?\sfrom\s+"([^"]+)";/gm)].map((match) => match[1]).sort();
}

describe("엑셀 전용 미리보기 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → id 형식 → 견적서 → 엑셀 전용 → 붙인 엑셀 → 검사 → xls → 경로 검증 · 읽기(상한) → 격자 → JSON", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "isValidQuoteId(id)",
      "getQuoteForEdit(id)",
      "!quote.isExcelOnly",
      "decideQuoteDownloadSource(quote, await listLiveQuoteAttachments(quote.id))",
      "decideAttachmentDownload({",
      'extension === "xls"',
      "resolveAttachmentAbsolutePath(resolveUploadsRoot(), attachment.storedPath)",
      "getAttachmentStorage().read(attachment.storedPath)",
      "readAttachmentBytesWithinLimit(stream, MAX_ATTACHMENT_SIZE_BYTES)",
      "buildQuoteExcelPreview(received.bytes)",
      "NextResponse.json(",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
  });

  test("🔴 보기 권한(READ) 하나 — 넓히지도 좁히지도 않는다", () => {
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
    assert.equal(getBody.includes('"ADMIN"'), false);
  });

  test("🔴 쓰기 · 감사가 없다 — 가져오는 것은 문지기 · 조회 · 판정 · 저장소 읽기 · 서비스뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "../xlsx/download-source",
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/attachments",
      "@/lib/db/queries/quotes",
      "@/lib/domain/attachment-allowlist",
      "@/lib/domain/attachment-download-policy",
      "@/lib/domain/attachment-path",
      "@/lib/server/services/quote-excel-preview",
      "@/lib/storage/local-fs-adapter",
      "@/lib/validation/quote-input",
      "next/server",
    ]);
    for (const forbidden of [
      "mutations",
      "recordQuoteExport",
      "recordAudit",
      "auditLogs",
      "writeTemp",
      ".commit(",
      ".delete(",
      "saveToQuoteArchive",
      "node:fs",
      "node:path",
      "require(",
      "import(",
    ]) {
      assert.equal(route.includes(forbidden), false, `쓰기 · 감사 쪽 흔적: ${forbidden}`);
    }
  });

  test("🔴 요청 글자는 경로가 되지 않는다 — id 는 형식을 본 뒤 조회에만, 읽는 경로는 DB 의 줄에서", () => {
    assert.equal(getBody.match(/\(id\)/g)?.length, 2, "id 가 두 곳(형식 · 조회) 밖에서 쓰인다");
    assert.equal(getBody.includes("${id}"), false);
    assert.equal(getBody.match(/attachment\.storedPath/g)?.length, 2, "경로 검증 · 읽기 두 곳뿐이어야 한다");
    assert.equal(getBody.includes("request."), false, "요청의 다른 값을 쓴다");
  });

  test("엑셀 전용이 아니면 409 · 붙인 엑셀 없으면 404 · 검사 막히면 403(판정 문장) · xls 면 415", () => {
    assert.ok(getBody.includes('fail(409, "NOT_EXCEL_ONLY"'));
    assert.ok(getBody.includes('fail(404, "EXCEL_NOT_ATTACHED", QUOTE_EXCEL_MISSING_MESSAGE)'));
    assert.ok(getBody.includes('fail(403, "SCAN_BLOCKED", decision.message)'));
    assert.ok(getBody.includes('fail(415, "XLS_LEGACY", QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES.XLS_LEGACY)'));
    assert.ok(QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES.XLS_LEGACY.startsWith("옛 엑셀 형식(.xls)이라"));
  });

  test("서비스의 실패 코드마다 응답 코드 — 415 · 422, 모양은 { error, code }", () => {
    const expected: Record<string, number> = {
      XLS_LEGACY: 415,
      NOT_XLSX: 422,
      CONTENT_TOO_LARGE: 422,
      SHEET_UNREADABLE: 422,
      SHEET_TOO_LARGE: 422,
    };
    assert.deepEqual(Object.keys(QUOTE_EXCEL_PREVIEW_FAILURE_MESSAGES).sort(), Object.keys(expected).sort());
    for (const [code, status] of Object.entries(expected)) {
      assert.ok(route.includes(`  ${code}: ${status},`), `${code} → ${status}`);
    }
    assert.ok(route.includes("NextResponse.json({ error: message, code }, { status })"));
    assert.ok(getBody.includes("fail(STATUS_BY_PREVIEW_FAILURE[result.code], result.code, result.message)"));
  });

  test("성공 — 200 { grid, warnings } · 캐시하지 않는다 · 전역 보안 헤더와 같은 이름을 달지 않는다", () => {
    assert.ok(getBody.includes("{ grid: result.grid, warnings: result.warnings }"));
    assert.ok(getBody.includes("status: 200"));
    assert.ok(getBody.includes('"Cache-Control": "no-store"'));
    for (const globalHeader of [
      "X-Frame-Options",
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
    ]) {
      assert.equal(route.includes(`"${globalHeader}"`), false, `전역 헤더와 같은 이름: ${globalHeader}`);
    }
  });

  test("🔴 로그에 값 · 경로를 싣지 않는다 — id 와 오류 이름만", () => {
    const blocks = [...route.matchAll(/console\.(\w+)\(([\s\S]*?)\}\);/g)];
    assert.equal(blocks.length, 3);
    for (const [, method, args] of blocks) {
      assert.equal(method, "error");
      assert.ok(args.includes("error: errorNameOf(error)"), args);
      for (const leak of ["storedPath", ".message", "received", "result", "String(error)"]) {
        assert.equal(args.includes(leak), false, `로그에 ${leak}: ${args}`);
      }
    }
  });

  test("머리말에 감사 없음 · READ 인 까닭 · 경로가 되지 않는 까닭이 적혀 있다", () => {
    assert.ok(route.includes("감사를 남기지 않는다"));
    assert.ok(route.includes("왜 READ 로 충분한가"));
    assert.ok(route.includes("요청 글자는 경로가 되지 않는다"));
  });
});
