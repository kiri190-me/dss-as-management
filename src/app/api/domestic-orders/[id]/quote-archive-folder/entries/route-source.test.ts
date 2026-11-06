import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/domestic-orders/{id}/quote-archive-folder/entries
 * — 번호를 **서버가 꺼낸다** · 권한 두 겹 · 목록만 · 경로 비노출 (2026-11-06)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 읽기 자체는
 * lib/storage/quote-archive-entries.test.ts 가, 찾기는 lib/storage/quote-archive.test.ts 가,
 * 번호 · 연도를 고르는 순수 함수는 lib/domain/domestic-order-quote-archive.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 일곱이다:
 *  · 🔴 **번호를 요청에서 받지 않는다** — 받는 것은 내자 줄의 id 하나이고, 견적서번호는
 *    서버가 그 줄에서 꺼낸다. 번호를 받으면 내자 정리를 볼 수 있는 사람이 **아무 번호나
 *    넣어 남의 폴더**를 들여다볼 수 있다.
 *  · 🔴 권한이 **두 겹**(`domesticOrders` READ → `quotes` READ)이고 **조회보다 앞**이다
 *  · 🔴 찾아볼 수 없는 줄은 **디스크를 보지 않는다**(설정 판정은 그보다도 앞이다)
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — mkdir · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 목록만 낸다
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다**
 *  · 🔴 맞는 폴더가 **여럿이면 목록도 경로도 내지 않는다**
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 통로의 머리말은 금지 사항을 낱말 그대로 설명한다
 * (「searchParams 도 본문 읽기도 없다」 · 「mkdir · 파일 쓰기 … 가 없다」). 걷어내지 않으면
 * 「없다」를 재는 시험이 **주석 때문에 빨개진다.**
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 이웃 통로 — 견적서 id 로 부르는 같은 구역의 통로. 문지기 뒷부분 · 문장을 견준다. */
const quoteRoute = readFileSync(
  new URL("../../../../quotes/[id]/archive-folder/entries/route.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게(위 머리말). */
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

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
}

describe("기타건 공유폴더 통로 — 소스로 지킨다", () => {
  test("🔵 못 — 원본이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
    assert.ok(route.length > 2000, `원본이 너무 짧다(${route.length})`);
    assert.ok(getBody.length > 500, `GET 몸통을 못 찾았다(${getBody.length})`);
    // 머리말에는 금지 낱말이 그대로 적혀 있고, 코드에는 없다 — 둘 다 확인해야 「없다」가 뜻을 갖는다.
    assert.ok(route.includes("searchParams"), "머리말이 바뀌었다 — 이 못을 다시 보라");
    assert.equal(code.includes("searchParams"), false);
  });

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

  test("🔴 **번호를 요청에서 받지 않는다** — 받는 것은 줄 id 하나다", () => {
    // 요청에서 값을 꺼내는 길이 아예 없다. `_request` 는 이름만 받고 쓰지 않는다.
    for (const forbidden of ["searchParams", "nextUrl", "_request.", "request.json", "headers.get", "cookies.get"]) {
      assert.equal(code.includes(forbidden), false, `요청에서 값을 꺼낸다: ${forbidden}`);
    }
    // 🔴 번호가 코드에 나오는 자리는 **저장소에 넘기는 그 한 줄**뿐이고, 값의 출처는 줄에서
    //    꺼낸 lookup 이다. 화면이 보낸 값이 끼어들 자리가 없다.
    assert.ok(
      getBody.includes('naming: { quoteNumber: lookup.quoteNumber, kind: "DOMESTIC", customerName: "" },'),
      getBody.slice(getBody.indexOf("listQuoteArchiveEntries"), getBody.indexOf("listQuoteArchiveEntries") + 300)
    );
    assert.equal(code.match(/quoteNumber/g)?.length, 2, "번호가 다른 자리에서도 쓰인다");
    // 번호와 날짜를 고르는 일은 순수 함수 한 벌이다 — 통로가 제 손으로 고르지 않는다.
    assert.ok(getBody.includes("const lookup = resolveDomesticOrderQuoteArchiveLookup(row);"));
    assert.equal(code.match(/resolveDomesticOrderQuoteArchiveLookup/g)?.length, 2, "들여오고 한 번 부르는 것이 전부가 아니다");
  });

  test("🔴 순서: 저장 모드 → 세션 → 계정 · 승인 → domesticOrders READ → quotes READ → 줄 → 루트 → 번호 → 읽기 → 규칙", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "domesticOrders", "READ")',
      'hasPermission(actingUser, "quotes", "READ")',
      "await getDomesticOrderDetail(id)",
      "resolveQuoteArchiveRoot()",
      "resolveDomesticOrderQuoteArchiveLookup(row)",
      "listQuoteArchiveEntries({",
      "isQuoteFolderRelativePath(listed.relativePath)",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = indexOrFail(getBody, mark);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 권한이 조회보다 **앞**이다 — 두 자리를 직접 견준다.
    assert.ok(
      getBody.indexOf('hasPermission(actingUser, "quotes", "READ")') <
        getBody.indexOf("await getDomesticOrderDetail(id)"),
      "권한 검사가 조회보다 뒤에 있다"
    );
    // 넓은 문턱은 READ 둘뿐이고, 쓰기 권한을 묻지 않는다.
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 2);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 찾아볼 수 없는 줄은 **디스크를 보지 않는다** — 설정 판정은 그보다 앞이다", () => {
    const root = indexOrFail(getBody, "if (archiveRoot === null) {");
    const noNumber = indexOrFail(getBody, 'return respond({ status: "no-quote-number" });');
    const noDate = indexOrFail(getBody, 'return respond({ status: "no-quote-date" });');
    const read = indexOrFail(getBody, "await listQuoteArchiveEntries({");
    assert.ok(root < noNumber && noNumber < noDate && noDate < read, "자리가 어긋났다");
  });

  test("🔴 문턱을 넘었는데 안 보이면 403 이 아니라 404 — 존재 여부를 흘리지 않는다", () => {
    const afterQuery = getBody.slice(getBody.indexOf("await getDomesticOrderDetail(id)"));
    assert.ok(afterQuery.includes('fail(404, "NOT_FOUND"'), "조회 뒤의 404 가 없다");
    assert.equal(afterQuery.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 · 읽기 전용뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/domestic-orders",
      "@/lib/domain/domestic-order-quote-archive",
      "@/lib/domain/quote-folder-link",
      "@/lib/storage/quote-archive",
      "@/lib/storage/quote-archive-entries",
      "next/server",
    ]);
    for (const forbidden of [
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bappendFile\b/,
      /\bcreateWriteStream\b/,
      /\bunlink\b/,
      /\brmdir\b/,
      /\brename\b/,
      /node:fs/,
      /saveToQuoteArchive/,
      /createQuoteArchiveFolder/,
      /mutations/,
      /recordAudit/,
      /require\(/,
      /\bimport\(/,
      /console\./,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
  });

  test("🔴 폴더를 찾는 규칙을 제 손으로 쓰지 않는다 — 저장소 모듈에 맡긴다", () => {
    for (const forbidden of ["matchesQuoteArchiveFolder", "isQuoteArchiveYearFolder", "quoteArchiveBaseNumber"]) {
      assert.equal(code.includes(forbidden), false, `폴더 찾는 규칙이 두 벌이 됐다: ${forbidden}`);
    }
    // 저장소 쪽 상한도 통로가 들지 않는다 — 줄 수 · 기다리기는 그 모듈의 숫자다.
    assert.equal(/limit\s*:/.test(getBody), false, "통로가 제 상한을 넘긴다");
    assert.equal(/timeoutMs\s*:/.test(getBody), false, "통로가 제 기다리기 상한을 넘긴다");
  });

  test("🔴 파일 바이트를 중계하지 않는다 — 나가는 것은 JSON 목록뿐이다", () => {
    for (const forbidden of [
      /\breadFile\b/,
      /\bcreateReadStream\b/,
      /Content-Disposition/,
      /arrayBuffer/,
      /ReadableStream/,
      /new Response\(/,
      /NextResponse\.redirect/,
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
    // 🔴 전체 주소(uncPath)는 일부러 내지 않는다 — 이 구역에는 [위치 복사]가 없다.
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // archiveRoot 는 선언 · null 판정 · 읽기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 1);
    // 🔴 응답을 만드는 토막(저장소에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (listed.status === "found") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(
      code.indexOf("type QuoteArchiveEntryBody"),
      code.indexOf("const UNOPENABLE_FOLDER_REASON")
    );
    assert.ok(types.includes('status: "found"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath", "uncpath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    assert.deepEqual(
      [...new Set(fields)].sort(),
      [
        "entries",
        "isDirectory",
        "modifiedAt",
        "name",
        "reason",
        "relativePath",
        "sizeBytes",
        "status",
        "totalCount",
        "truncated",
      ].sort()
    );
  });

  test("🔴 맞는 폴더가 여럿이면 목록도 경로도 내지 않는다", () => {
    // 🔴 가지 전체가 이 세 줄뿐이다 — 목록도(entries) 폴더 경로도(relativePath) 끼어들 자리가 없다.
    assert.ok(
      getBody.includes('if (listed.status === "multiple") {\n    return respond({ status: "multiple" });\n  }'),
      getBody.slice(getBody.indexOf('listed.status === "multiple"'), getBody.indexOf('listed.status === "multiple"') + 200)
    );
    // 줄을 내보내는 자리는 **found 일 때 하나뿐**이다.
    assert.equal(getBody.match(/listed\.entries\.map\(/g)?.length, 1);
    assert.ok(
      getBody.indexOf('if (listed.status === "found") {') < getBody.indexOf("listed.entries.map("),
      "found 를 확인하기 전에 줄을 내보낸다"
    );
  });

  test("상태 일곱 — found · multiple · not-found · no-quote-number · no-quote-date · disabled · failed", () => {
    for (const status of [
      'status: "found"',
      'status: "multiple"',
      'status: "not-found"',
      'status: "no-quote-number"',
      'status: "no-quote-date"',
      'status: "disabled"',
      'status: "failed"',
    ]) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("폴더 이름이 도우미 주소 규칙 밖이면 이웃 통로와 **같은 문장**으로 알린다", () => {
    const reason = "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";
    assert.ok(route.includes(reason), "문장이 바뀌었다");
    assert.ok(quoteRoute.includes(reason), "이웃 통로의 문장이 바뀌었다 — 두 자리가 다른 말을 한다");
    // 규칙은 도우미 주소가 쓰는 그 함수 하나다 — 통로가 제 손으로 세지 않는다.
    assert.ok(getBody.includes("if (!isQuoteFolderRelativePath(listed.relativePath)) {"));
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
