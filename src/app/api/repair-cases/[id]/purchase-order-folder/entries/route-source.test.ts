import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/purchase-order-folder/entries
 * — 문지기 순서 · 발행일 관문 · 목록만 · 경로 비노출 (2026-10-12)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 찾기 자체는
 * storage/purchase-order-archive.test.ts 가, 이름 읽기는
 * domain/purchase-order-folder-name.test.ts 가, 화면은
 * components/repair-cases/purchase-orders/PurchaseOrderFolderSection.test.tsx 가 본다.
 *
 * 여기서 못 박는 것은 여섯이다:
 *  · 🔴 문지기 **차례**가 이웃 통로(지난 견적서 폴더)와 같다 — 권한이 **조회보다 앞**이다
 *  · 🔴 권한이 `domesticOrders` READ 다 — 🔴 **견적서 열쇠가 아니다**(나가는 것은 발주서
 *    자료이고 폴더 이름에 발주 금액이 들어 있다). 새 영역을 만들지도 넓히지도 않았다
 *  · 🔴 **발주발행일이 비면 저장소 모듈을 부르지 않는다** — 공유폴더를 아예 보지 않는다
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — 폴더 만들기 · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다** — JSON 목록만 낸다
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다** — 전체 공유폴더 주소(uncPath)도 없다
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 이웃 통로 — 이 장비가 **예전에 받은 견적서 폴더들**. 문지기 차례를 본떴다. */
const sibling = readFileSync(new URL("../../quote-archive-folders/route.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(uncPath · quotes …)에 걸리지 않게. */
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

/**
 * 문지기 토막 — GET 의 머리부터 **주소의 id 를 꺼내기 직전**까지(저장 모드 · 세션 · 살아 있는
 * 계정 · 승인 · 권한). 주석과 공백을 걷어 두 통로를 견준다.
 */
function gatekeeper(source: string): string {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const from = body.indexOf("export async function GET");
  const to = body.indexOf("const { id } = await context.params;");
  assert.ok(from >= 0 && to > from, "문지기 토막을 찾지 못했다");
  return body.slice(from, to).replace(/\s+/g, "");
}

describe("발주서 폴더 통로 — 소스로 지킨다", () => {
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

  test("🔴 문지기가 이웃 통로와 **권한 영역 한 낱말만 다르다**", () => {
    // 🔴 열쇠는 `domesticOrders` 다 — 나가는 것은 발주서 자료(폴더 이름에 발주 금액이 있다).
    assert.ok(code.includes('hasPermission(actingUser, "domesticOrders", "READ")'));
    // 🔴 견적서 열쇠로 바꿔 달지 않았다.
    assert.equal(code.includes('"quotes"'), false, "권한 영역이 견적서로 바뀌었다");
    // 그 한 낱말을 맞추면 문지기가 이웃과 **글자 그대로 같다**.
    assert.equal(gatekeeper(route), gatekeeper(sibling).replace('"quotes"', '"domesticOrders"'));
  });

  test("🔴 순서: 저장 모드 → 세션 → 계정 · 승인 → domesticOrders READ → 수리 건 → 루트 → 발행일 → 찾기", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "domesticOrders", "READ")',
      "await context.params",
      "getRepairCaseContactFolderNamingById(id)",
      "resolvePurchaseOrderArchiveRoot()",
      "listQuoteInfoForRepairCases([repairCase.id])",
      "findPurchaseOrderArchiveFolder({",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = getBody.indexOf(mark);
      assert.ok(at >= 0, `없다: ${mark}`);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 권한이 조회보다 **앞**이다 — 두 자리를 직접 견준다.
    assert.ok(
      getBody.indexOf('hasPermission(actingUser, "domesticOrders", "READ")') <
        getBody.indexOf("getRepairCaseContactFolderNamingById(id)"),
      "권한 검사가 조회보다 뒤에 있다"
    );
    // 넓은 문턱은 READ 한 번뿐이고, 쓰기 권한을 묻지 않는다.
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 문턱을 넘었는데 안 보이면 403 이 아니라 404 — 존재 여부를 흘리지 않는다", () => {
    const afterQuery = getBody.slice(getBody.indexOf("getRepairCaseContactFolderNamingById(id)"));
    assert.ok(afterQuery.includes('fail(404, "NOT_FOUND"'), "조회 뒤의 404 가 없다");
    assert.equal(afterQuery.includes("fail(403"), false, "조회 뒤에 403 이 있다");
  });

  test("🔴 **발주발행일이 비면 공유폴더를 아예 안 본다** — 저장소 모듈을 부르지 않는다", () => {
    const gateAt = getBody.indexOf('return respond({ status: "no-order-date" });');
    const searchAt = getBody.indexOf("findPurchaseOrderArchiveFolder({");
    assert.ok(gateAt >= 0, "발행일 관문이 없다");
    assert.ok(searchAt > gateAt, "발행일 관문보다 찾기가 먼저다");
    // 🔴 관문은 **조회가 내는 값 하나**를 본다 — 조건을 통로가 다시 짜지 않는다.
    assert.ok(getBody.includes("isFilled(quoteInfo.get(repairCase.id)?.orderIssuedDate)"), getBody);
    // 🔴 이 통로는 내자 정리 표를 제 손으로 읽지 않는다 — 그 일은 조회 하나가 쥔다.
    for (const forbidden of ["drizzle", "db/client", "domesticOrders.", "completedAt", "isNull("]) {
      assert.equal(code.includes(forbidden), false, `조회가 할 일이 통로로 내려왔다: ${forbidden}`);
    }
    // 🔴 설정(루트) 판단이 발행일보다 **앞**이다 — 꺼진 환경에서는 구역이 통째로 안 그려진다.
    assert.ok(
      getBody.indexOf("resolvePurchaseOrderArchiveRoot()") < getBody.indexOf("listQuoteInfoForRepairCases("),
      "꺼진 환경에서 발행일 문장이 먼저 나간다"
    );
  });

  test("🔴 아무것도 만들지 않는다 · 지우지 않는다 — 가져오는 것은 문지기 · 조회 둘 · 읽기 전용 둘뿐", () => {
    assert.deepEqual(importSpecifiers(route), [
      "@/lib/auth/acting-user",
      "@/lib/auth/permission-resolver",
      "@/lib/auth/session",
      "@/lib/config/auth-source",
      "@/lib/db/queries/domestic-orders",
      "@/lib/db/queries/repair-cases",
      "@/lib/domain/quote-folder-link",
      "@/lib/storage/purchase-order-archive",
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
      /mutations/,
      /recordAudit/,
      /require\(/,
      /\bimport\(/,
      /console\./,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 기록 흔적: ${forbidden}`);
    }
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
      /sendFile/,
    ]) {
      assert.equal(forbidden.test(code), false, `내용을 내보내는 흔적: ${forbidden}`);
    }
    // 응답을 만드는 길은 둘뿐이다 — 실패 JSON 과 성공 JSON.
    assert.equal(code.match(/NextResponse\.json\(/g)?.length, 2);
  });

  test("🔴 컨테이너 안 경로 · 전체 공유폴더 주소가 응답에 실리지 않는다", () => {
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_DIR"), false);
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    // 🔴 전체 주소(uncPath)는 **일부러 내지 않는다** — 이 구역에는 [위치 복사]가 없다.
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // archiveRoot 는 선언 · null 판정 · 찾기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.ok(getBody.includes("const archiveRoot = resolvePurchaseOrderArchiveRoot();"));
    assert.ok(getBody.includes("if (archiveRoot === null) {"));
    // 루트가 나가는 자리는 저장소 호출의 입력 하나뿐이다.
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 1);
    // 🔴 응답을 만드는 토막(저장소에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (found.status === "found") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
    // 경로를 이어 붙이는 일도 없다.
    assert.equal(code.includes("node:path"), false);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(code.indexOf("type PurchaseOrderEntryBody"), code.indexOf("const UNOPENABLE"));
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
        "issuedDate",
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

  test("🔴 L/N · S/N 을 통로가 고쳐 쓰지 않는다 — 조회가 준 값을 그대로 넘긴다", () => {
    assert.ok(getBody.includes("lotNumber: repairCase.lotNumber,"));
    assert.ok(getBody.includes("serialNumber: repairCase.serialNumber,"));
    assert.equal(/\.trim\(\)/.test(getBody), false, "통로가 열쇠를 다듬는다");
    assert.equal(/toUpperCase|toLocaleUpperCase/.test(getBody), false, "통로가 열쇠를 접는다");
  });

  test("상태 여섯 — found · multiple · not-found · no-order-date · disabled · failed, 캐시하지 않는다", () => {
    for (const status of [
      'status: "found"',
      'status: "multiple"',
      'status: "not-found"',
      'status: "no-order-date"',
      'status: "disabled"',
      'status: "failed"',
    ]) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("🔴 줄 수 · 기다리기 상한은 저장소 모듈이 쥔다 — 통로가 제 숫자를 들지 않는다", () => {
    assert.equal(/limit\s*:/.test(getBody), false, "통로가 제 상한을 넘긴다");
    assert.equal(/timeoutMs\s*:/.test(getBody), false, "통로가 제 기다리기 상한을 넘긴다");
    assert.ok(getBody.includes("found.truncated"), "「더 있습니다」를 나르지 않는다");
    // 받는 칸이 없다 — 검사할 일도 없다.
    assert.equal(getBody.includes("searchParams"), false, "질의 칸이 생겼다");
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
