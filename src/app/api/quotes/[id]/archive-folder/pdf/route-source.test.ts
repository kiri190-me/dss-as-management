import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/quotes/{id}/archive-folder/pdf — 문지기 순서 · 읽기만 · 경로 비노출 (2026-10-08)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 읽기 자체는
 * storage/quote-archive-entries.test.ts 가, 이름 규칙은 domain/quote-archive-naming.test.ts 와
 * domain/quote-folder-xlsx2pdf-link.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 일곱이다:
 *  · 🔴 문지기가 **이웃 통로(`../entries/route.ts`)와 글자 그대로 같다**(권한도 같은 글자)
 *  · 🔴 권한이 **조회보다 앞**이다
 *  · 🔴 **쓰지 않는다 · 만들지 않는다 · 변환을 시키지 않는다** — mkdir · 쓰기 · 삭제 ·
 *    쓰기 메서드 · 도우미 주소를 여는 코드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다**
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다**(uncPath 도 없다)
 *  · 🔴 바꿀 엑셀은 **이름 규칙이 지은 그 이름**으로 찾는다 — 고르지 않는다
 *  · 🔴 「전에도 있었다」를 가를 재료(수정 시각)를 함께 낸다
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 이웃 통로 — 그 폴더 **안에 무엇이 있는가**. 문지기를 그대로 본떴다. */
const sibling = readFileSync(new URL("../entries/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · uncPath …)에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const nextConfig = readFileSync(new URL("../../../../../../../next.config.ts", import.meta.url), "utf8");
const getBody = code.slice(code.indexOf("export async function GET"));

const GLOBAL_HEADERS = [
  "X-Frame-Options",
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security",
];

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

/** 문지기 토막 — GET 의 머리부터 **공유폴더 루트를 꺼내기 직전**까지(이웃 시험과 같은 방식). */
function gatekeeper(source: string): string {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const from = body.indexOf("export async function GET");
  const to = body.indexOf("const archiveRoot = resolveQuoteArchiveRoot();");
  assert.ok(from >= 0 && to > from, "문지기 토막을 찾지 못했다");
  return body.slice(from, to).replace(/\s+/g, "");
}

describe("견적서 PDF 확인 통로 — 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.equal(/^export\s*(?:\{|default|\*)/m.test(route), false);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
  });

  test("🔴 GET 뿐 — 쓰기 메서드를 만들지 않는다", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 문지기가 이웃 통로(`../entries/route.ts`)와 **글자 그대로 같다**", () => {
    assert.equal(gatekeeper(route), gatekeeper(sibling));
    // 권한은 **같은 글자**다 — 새 영역을 만들지도, 넓히지도 않았다.
    assert.ok(route.includes('hasPermission(actingUser, "quotes", "READ")'));
    assert.ok(sibling.includes('hasPermission(actingUser, "quotes", "READ")'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 살아 있는 계정 · 승인 → quotes READ → id → 견적서 → 루트 → 읽기 → 이름", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "quotes", "READ")',
      "isValidQuoteId(id)",
      "await getQuoteForEdit(id)",
      "resolveQuoteArchiveRoot()",
      "listQuoteArchiveEntries({",
      "isQuoteFolderRelativePath(listed.relativePath)",
      'quoteArchiveFileName(naming, { extension: "xlsx" })',
      "quoteFolderXlsx2PdfOutputName(source.name)",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    assert.ok(
      getBody.indexOf('hasPermission(actingUser, "quotes", "READ")') < getBody.indexOf("await getQuoteForEdit(id)"),
      "권한 검사가 조회보다 뒤에 있다"
    );
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 문턱을 넘었는데 안 보이면 403 이 아니라 404 — 존재 여부를 흘리지 않는다", () => {
    const afterQuery = getBody.slice(getBody.indexOf("isValidQuoteId(id)"));
    assert.ok(afterQuery.includes('fail(404, "NOT_FOUND"'), "조회 뒤의 404 가 없다");
    assert.equal(afterQuery.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 · 읽기 전용 · 이름 규칙뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/quotes",
      "@/lib/domain/quote-archive-naming",
      "@/lib/domain/quote-folder-link",
      "@/lib/domain/quote-folder-xlsx2pdf-link",
      "@/lib/storage/quote-archive",
      "@/lib/storage/quote-archive-entries",
      "@/lib/validation/quote-input",
      "next/server",
    ]);
    for (const forbidden of [
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bappendFile\b/,
      /\bcreateWriteStream\b/,
      /\bunlink\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brename\b/,
      /node:fs/,
      /saveToQuoteArchive/,
      /createQuoteArchiveFolder/,
      /mutations/,
      /recordAudit/,
      /recordQuoteExport/,
      /require\(/,
      /\bimport\(/,
      /console\./,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
  });

  test("🔴 변환을 시키지 않는다 — 통로에 도우미 주소도, 주소를 만드는 함수도 없다", () => {
    // 주소를 만들고 여는 것은 **화면**이다(components/quotes/quote-save-pdf-convert.ts).
    for (const forbidden of [/dss-folder:/, /buildQuoteFolderXlsx2PdfLink/, /iframe/, /QUOTE_FOLDER_XLSX2PDF_LINK_PREFIX/]) {
      assert.equal(forbidden.test(code), false, `변환을 시키는 흔적: ${forbidden}`);
    }
    // 이 통로가 domain 에서 가져다 쓰는 것은 **결과 이름 규칙 하나**다.
    const imported = /import \{ (quoteFolderXlsx2PdfOutputName) \} from "@\/lib\/domain\/quote-folder-xlsx2pdf-link";/.exec(
      route
    );
    assert.ok(imported, "결과 이름 규칙을 가져다 쓰지 않는다");
  });

  test("🔴 파일 바이트를 중계하지 않는다 — 나가는 것은 JSON 뿐이다", () => {
    for (const forbidden of [
      /\breadFile\b/,
      /\bcreateReadStream\b/,
      /Content-Disposition/,
      /arrayBuffer/,
      /ReadableStream/,
      /new Response\(/,
      /NextResponse\.redirect/,
      /sendFile/,
    ]) {
      assert.equal(forbidden.test(code), false, `내용을 내보내는 흔적: ${forbidden}`);
    }
    // 응답을 만드는 길은 둘뿐이다 — 실패 JSON 과 성공 JSON.
    assert.equal(code.match(/NextResponse\.json\(/g)?.length, 2);
  });

  test("🔴 컨테이너 안 경로 · 전체 공유폴더 주소가 응답에 실리지 않는다", () => {
    assert.equal(code.includes("QUOTE_ARCHIVE_DIR"), false);
    assert.equal(code.includes("QUOTE_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // archiveRoot 는 선언 · null 판정 · 읽기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolveQuoteArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    // 🔴 응답을 만드는 토막(저장소에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (listed.status === "found") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(code.indexOf("type QuoteArchivePdfResponse"), code.indexOf("const UNOPENABLE_FOLDER_REASON"));
    assert.ok(types.includes('status: "found"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath", "uncpath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(fields)].sort(),
      ["pdfExists", "pdfModifiedAt", "pdfName", "reason", "relativePath", "sourceName", "status"].sort()
    );
  });

  test("🔴 바꿀 엑셀은 이름 규칙이 지은 그 이름으로 찾는다 — 「엑셀처럼 보이는 것」을 고르지 않는다", () => {
    assert.ok(getBody.includes('expectedName = quoteArchiveFileName(naming, { extension: "xlsx" });'));
    assert.ok(getBody.includes("const source = fileNamed(listed.entries, expectedName);"));
    // 고르는 코드(정렬 · 최신 · 확장자 훑기)가 없다.
    for (const forbidden of [/\.filter\(/, /\.sort\(/, /modifiedAtMs >/, /xlsm/, /\.xls\b/]) {
      assert.equal(forbidden.test(getBody), false, `고르는 흔적: ${forbidden}`);
    }
    // 이름 재료는 저장이 쓰는 것과 같은 한 벌이다 — 신고증상 꼬리까지.
    assert.ok(getBody.includes("faultDescription: quote.faultDescriptionText,"));
  });

  test("🔴 「전에도 있었다」를 가를 재료를 함께 낸다 — 수정 시각", () => {
    assert.ok(code.includes("function modifiedAtOf(modifiedAtMs: number | null | undefined)"));
    assert.ok(getBody.includes("...modifiedAtOf(pdf?.modifiedAtMs),"));
    // 못 읽은 줄은 칸이 통째로 빠진다 — 빈 글자를 내지 않는다.
    assert.ok(code.includes("return {};"));
    assert.ok(getBody.includes("pdfExists: pdf !== null,"));
  });

  test("🔴 폴더가 여럿이면 아무것도 내지 않는다 — 남의 폴더에 쓰게 할 수 없다", () => {
    assert.ok(
      getBody.includes('if (listed.status === "multiple") {\n    return respond({ status: "multiple" });\n  }'),
      getBody.slice(getBody.indexOf('listed.status === "multiple"'), getBody.indexOf('listed.status === "multiple"') + 200)
    );
    assert.ok(
      getBody.indexOf('if (listed.status === "found") {') < getBody.indexOf("const source = fileNamed("),
      "found 를 확인하기 전에 이름을 낸다"
    );
  });

  test("상태 여섯 — found · no-source · multiple · not-found · disabled · failed, 캐시하지 않는다", () => {
    for (const status of [
      'status: "found"',
      'status: "no-source"',
      'status: "multiple"',
      'status: "not-found"',
      'status: "disabled"',
      'status: "failed"',
    ]) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("🔴 사유에 경로가 한 글자도 없다 — 서버가 지은 문장 둘뿐", () => {
    const reason = "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";
    assert.ok(route.includes(reason), "이웃 통로와 문장이 달라졌다");
    assert.ok(sibling.includes(reason), "이웃 통로의 문장이 바뀌었다 — 두 자리가 다른 말을 한다");
    assert.ok(route.includes("이 견적서 엑셀의 이름은 PDF 변환 주소로 만들 수 없습니다."));
    // `reason:` 에 들어가는 것은 상수 둘과 저장소 모듈이 준 짧은 문장 하나뿐이다.
    const reasons = [...getBody.matchAll(/reason: ([^,}\n]+)/g)].map((match) => match[1].trim());
    assert.deepEqual(reasons.sort(), ["UNCONVERTIBLE_NAME_REASON", "UNOPENABLE_FOLDER_REASON", "listed.reason"].sort());
  });

  test("🔴 줄 수 · 기다리기 상한은 저장소 모듈이 쥔다 — 통로가 제 숫자를 들지 않는다", () => {
    assert.equal(/limit\s*:/.test(getBody), false, "통로가 제 상한을 넘긴다");
    assert.equal(/timeoutMs\s*:/.test(getBody), false, "통로가 제 기다리기 상한을 넘긴다");
    assert.equal(getBody.includes("searchParams"), false, "받는 칸이 생겼다 — 이름을 바깥에서 받지 않는다");
    assert.equal(code.includes("node:path"), false);
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
