import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { HANDWRITTEN_QUOTE_FAILURE_MESSAGES } from "../../../../lib/xlsx/handwritten-quote-reader";

/**
 * ============================================================================
 * POST /api/quotes/parse-excel — 문지기 순서 · 이름 · 쓰기 없음을 **소스로** 지킨다 (견적서 ①a)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 대신 소스를 읽어 지킨다 —
 * services/quote-issue.integration.test.ts 맨 아래 묶음과 같은 장치를 **DB 없는 unit
 * 시험**으로 둔 것이다. 읽는 일 자체는 xlsx/handwritten-quote-reader.test.ts 가 본다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../../", import.meta.url);
const ROUTE = "src/app/api/quotes/parse-excel/route.ts";
const route = readFileSync(new URL(ROUTE, repoUrl), "utf8").replace(/\r\n/g, "\n");
const postBody = route.slice(route.indexOf("export async function POST"));

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

describe("수기 견적서 엑셀 읽기 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 견적서 id 가 없는 통로다 — 새 견적서(아직 id 없음)에서도 부른다", () => {
    assert.equal(ROUTE.includes("["), false);
    assert.match(route, /export async function POST\(request: NextRequest\): Promise<NextResponse>/);
    assert.equal(postBody.includes("params"), false);
  });

  test("🔴 순서: 출처 → 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes WRITE → 선언 길이 → 세며 읽기 → 읽개 → JSON", () => {
    const marks = [
      "isTrustedOrigin(request)",
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "WRITE")',
      "declaredLength > MAX_ATTACHMENT_SIZE_BYTES",
      "readBodyWithinLimit(body, MAX_ATTACHMENT_SIZE_BYTES)",
      "readHandwrittenQuoteWorkbook(received.bytes, {",
      "NextResponse.json(",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = postBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
  });

  test("보기 권한(READ)으로 들어오는 길이 없다 — 권한 판정은 한 번, WRITE", () => {
    assert.equal(postBody.includes('"READ"'), false);
    assert.equal(postBody.match(/hasPermission\(/g)?.length, 1);
  });

  test("🔴 쓰기가 없다 — 가져오는 것은 문지기 · 상한 · 읽개뿐(저장소 · DB · 감사 · 공유폴더 없음)", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/request-guards",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/domain/attachment-allowlist",
      "@/lib/xlsx/handwritten-quote-reader",
      "next/server",
    ]);
    for (const forbidden of [
      "@/lib/db/",
      "@/lib/storage/",
      "mutations",
      "createAttachmentRecord",
      "getAttachmentStorage",
      "writeTemp",
      "saveToQuoteArchive",
      "resolveQuoteArchiveRoot",
      "auditLogs",
      "recordAudit",
      "node:fs",
      "require(",
      "import(",
    ]) {
      assert.equal(route.includes(forbidden), false, `쓰기 쪽 흔적: ${forbidden}`);
    }
  });

  test("상한 — 선언 길이로 먼저 자르고, 읽으면서 다시 센다(둘 다 413)", () => {
    assert.equal(postBody.match(/fail\(413, "FILE_TOO_LARGE"/g)?.length, 2);
    assert.ok(route.includes("if (total > maxBytes) {"));
    assert.ok(route.includes("await reader.cancel()"));
  });

  test("실패 응답 — 읽개의 실패 코드마다 415 · 422 · 413, 모양은 { error, code }", () => {
    const expected: Record<string, number> = {
      XLS_LEGACY: 415,
      NOT_XLSX: 415,
      NO_QUOTE_SHEET: 422,
      CONTENT_TOO_LARGE: 413,
      SHEET_NOT_FOUND: 422,
    };
    assert.deepEqual(Object.keys(HANDWRITTEN_QUOTE_FAILURE_MESSAGES).sort(), Object.keys(expected).sort());
    for (const [code, status] of Object.entries(expected)) {
      assert.ok(route.includes(`  ${code}: ${status},`), `${code} → ${status}`);
    }
    assert.ok(route.includes("NextResponse.json({ error: message, code }, { status })"));
    assert.ok(postBody.includes("fail(STATUS_BY_READ_FAILURE[result.code], result.code, result.message)"));
  });

  test("성공 — 200 { sheet, sheetIndex, sheetName, sheets, fields, warnings } · 캐시하지 않는다", () => {
    for (const key of ["sheet", "sheetIndex", "sheetName", "sheets", "fields", "warnings"]) {
      assert.ok(postBody.includes(`      ${key}: result.${key},`), `응답에 ${key} 가 없다`);
    }
    assert.ok(postBody.includes("status: 200"));
    assert.ok(postBody.includes('"Cache-Control": "no-store"'));
  });

  test("🔴 `?sheet=` 를 읽개에 그대로 넘긴다 — 없는 시트를 조용히 딴 것으로 바꾸지 않는다", () => {
    assert.ok(postBody.includes("request.nextUrl.searchParams.get(SHEET_QUERY)"));
    assert.ok(postBody.includes("sheetIndex: sheetParam === null ? undefined : sheetIndexOf(sheetParam)"));
    // 숫자가 아니거나 빈 값이면 NaN 을 그대로 넘긴다 — 읽개가 SHEET_NOT_FOUND 로 거절한다.
    assert.ok(route.includes('return value.trim() === "" ? Number.NaN : Number(value);'));
    for (const guess of ["?? 0", "|| 0"]) {
      assert.equal(route.includes(guess), false, `없는 시트를 짐작으로 채운다: ${guess}`);
    }
  });

  test("로그에 파일의 값을 싣지 않는다 — console 은 한 번, 오류 이름만", () => {
    const calls = route.match(/console\.\w+\(/g) ?? [];
    assert.deepEqual(calls, ["console.error("]);
    const line = route.split("\n").find((candidate) => candidate.includes("console.error(")) ?? "";
    assert.ok(line.includes("errorNameOf(error)"), line);
  });

  test("머리말에 읽기 전용 · 감사 없음 · id 없는 까닭이 적혀 있다", () => {
    assert.ok(route.includes("감사를 남기지 않는다"));
    assert.ok(route.includes("왜 견적서 id 가 없는 통로인가"));
    assert.ok(route.includes("폼이 파일을 **저장 전에** 들고 있다"));
  });
});
