import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/domestic-orders/{id}/purchase-order-folder/entries
 * — 번호를 **서버가 꺼낸다** · 열쇠 하나 · 목록만 · 경로 비노출 (2026-11-06)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB 가 필요하다). 찾기 · 읽기 자체는
 * lib/storage/purchase-order-number-archive.test.ts 가, 번호를 고르는 순수 함수는
 * lib/domain/domestic-order-purchase-order-archive.test.ts 가 본다.
 *
 * 여기서 못 박는 것은 여덟이다:
 *  · 🔴 **번호를 요청에서 받지 않는다** — 받는 것은 내자 줄의 id 하나이고, 발주서번호는
 *    서버가 그 줄에서 꺼낸다. 번호를 받으면 내자 정리를 볼 수 있는 사람이 **아무 번호나
 *    넣어 남의 발주 건 폴더**(다른 고객사의 발주서 · 금액)를 들여다볼 수 있다.
 *  · 🔴 열쇠는 `domesticOrders.view` READ **하나**이고 **조회보다 앞**이다(견적서 열쇠를 묻지
 *    않는다). 🔴 2026-11-12(둘째)에 메뉴 키에서 조회 잎으로 내려왔다 — 같은 날부터 이 통로가
 *    내주는 것을 그리는 [발주서] 탭도 그 잎으로 가려진다
 *  · 🔴 쓸 수 있는 번호가 없으면 **디스크를 보지 않는다**(설정 판정은 그보다도 앞이다)
 *  · 🔴 **발주발행일로 문을 열지 않는다** — 수리 건 통로와 다른 한 가지라, 그 조건이 코드에
 *    **한 글자도** 없어야 한다(머리말에는 까닭이 길게 적혀 있다)
 *  · 🔴 **만들지 않는다 · 지우지 않는다** — mkdir · 쓰기 · 삭제 · 쓰기 메서드가 없다
 *  · 🔴 **파일 바이트를 중계하지 않는다** — 목록만 낸다
 *  · 🔴 응답 타입에 **절대 경로를 담는 칸이 없다**
 *  · 🔴 맞는 폴더가 **여럿이면 목록도 경로도 내지 않는다**
 *
 * 🔴 **주석을 걷어낸 뒤에 센다** — 이 통로의 머리말은 금지 사항을 낱말 그대로 설명한다
 * (「searchParams 도 본문 읽기도 없다」 · 「발주발행일로 문을 열지 않는다」). 걷어내지 않으면
 * 「없다」를 재는 시험이 **주석 때문에 빨개진다.**
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 수리 건 쪽 통로 — 같은 서류함을 여는 이웃이다. 문장을 견준다. */
const repairRoute = readFileSync(
  new URL("../../../../repair-cases/[id]/purchase-order-folder/entries/route.ts", import.meta.url),
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

describe("기타건 발주서 공유폴더 통로 — 소스로 지킨다", () => {
  test("🔵 못 — 원본이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
    assert.ok(route.length > 2000, `원본이 너무 짧다(${route.length})`);
    assert.ok(getBody.length > 500, `GET 몸통을 못 찾았다(${getBody.length})`);
    // 머리말에는 금지 낱말이 그대로 적혀 있고, 코드에는 없다 — 둘 다 확인해야 「없다」가 뜻을 갖는다.
    assert.ok(route.includes("searchParams"), "머리말이 바뀌었다 — 이 못을 다시 보라");
    assert.equal(code.includes("searchParams"), false);
    assert.ok(repairRoute.includes("findPurchaseOrderArchiveFolder("), "이웃 통로 원본을 못 읽었다");
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
    assert.ok(getBody.includes("purchaseOrderNumber: lookup.purchaseOrderNumber,"), getBody);
    assert.equal(code.match(/purchaseOrderNumber/g)?.length, 2, "번호가 다른 자리에서도 쓰인다");
    // 번호를 고르는 일은 순수 함수 한 벌이다 — 통로가 제 손으로 고르지 않는다.
    assert.ok(getBody.includes("const lookup = resolveDomesticOrderPurchaseOrderArchiveLookup(row);"));
    assert.equal(
      code.match(/resolveDomesticOrderPurchaseOrderArchiveLookup/g)?.length,
      2,
      "들여오고 한 번 부르는 것이 전부가 아니다"
    );
  });

  test("🔴 순서: 저장 모드 → 세션 → 계정 · 승인 → domesticOrders.view READ → 줄 → 루트 → 번호 → 읽기 → 규칙", () => {
    const marks = [
      'getAuthSource() !== "database"',
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      // 🔴 2026-11-12(둘째)에 메뉴 키 → **조회 잎**으로 내려왔다. 이 통로가 내주는 것을
      //    그리는 탭(기타건 상세의 [발주서])이 같은 날부터 그 잎으로 가려진다 — 둘이 같은
      //    열쇠여야 「탭은 열리는데 폴더만 안 열린다」가 안 생긴다. 메뉴 키로 되돌리면
      //    조회를 닫고 수정만 열어 둔 역할에게 이 통로가 탭보다 넓어진다.
      'hasPermission(actingUser, "domesticOrders.view", "READ")',
      "await getDomesticOrderDetail(id)",
      "resolvePurchaseOrderArchiveRoot()",
      "resolveDomesticOrderPurchaseOrderArchiveLookup(row)",
      "findPurchaseOrderArchiveFolderByNumber({",
      "isQuoteFolderRelativePath(found.relativePath)",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = indexOrFail(getBody, mark);
      assert.ok(at > previous, `순서가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 열쇠는 **하나**다 — 발주서는 내자 영역이 답한다(견적서 열쇠를 묻지 않는다).
    assert.equal(getBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(getBody.includes('"quotes"'), false, "견적서 열쇠를 물었다");
    assert.equal(getBody.includes('"WRITE"'), false);
  });

  test("🔴 쓸 수 있는 번호가 없으면 **디스크를 보지 않는다** — 설정 판정은 그보다 앞이다", () => {
    const root = indexOrFail(getBody, "if (archiveRoot === null) {");
    const noNumber = indexOrFail(getBody, 'return respond({ status: "no-po-number" });');
    const read = indexOrFail(getBody, "await findPurchaseOrderArchiveFolderByNumber({");
    assert.ok(root < noNumber && noNumber < read, "자리가 어긋났다");
  });

  test("🔴 **발주발행일로 문을 열지 않는다** — 그 조건이 코드에 한 글자도 없다", () => {
    // 🔵 못 — 머리말에는 까닭이 적혀 있고(수리 건 통로와 다른 한 가지다), 코드에는 없다.
    assert.ok(route.includes("발주발행일"), "머리말이 바뀌었다 — 이 못을 다시 보라");
    for (const forbidden of ["orderIssuedDate", "no-order-date", "issuedDate", "listQuoteInfoForRepairCases"]) {
      assert.equal(code.includes(forbidden), false, `날짜 조건이 들어왔다: ${forbidden}`);
    }
    // 🔴 수리 건 통로에는 그 조건이 **그대로 있다** — 저쪽을 고치지 않았다는 증거다.
    assert.ok(repairRoute.includes('return respond({ status: "no-order-date" });'), "수리 건 통로가 바뀌었다");
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
      "@/lib/domain/domestic-order-purchase-order-archive",
      "@/lib/domain/quote-folder-link",
      "@/lib/storage/purchase-order-archive",
      "@/lib/storage/purchase-order-number-archive",
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
    for (const forbidden of ["readPurchaseOrderFolderNumber", "purchaseOrderNumberKey", 'split("_")', "내자"]) {
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
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_DIR"), false);
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_UNC_ROOT"), false);
    assert.equal(code.includes("process.env"), false);
    // 🔴 전체 주소(uncPath)는 일부러 내지 않는다 — 이 구역에는 [위치 복사]가 없다.
    assert.equal(code.includes("uncPath"), false);
    assert.equal(code.includes("quote-folder-helper"), false);
    // archiveRoot 는 선언 · null 판정 · 읽기 입력 세 번만 나온다.
    assert.equal(getBody.match(/archiveRoot/g)?.length, 3);
    assert.equal(getBody.match(/root: archiveRoot,/g)?.length, 1);
    assert.equal(getBody.match(/\broot\b\s*:/g)?.length, 1);
    // 🔴 응답을 만드는 토막(저장소에게 물은 **뒤**)에는 루트라는 낱말이 아예 없다.
    const responding = getBody.slice(getBody.indexOf('if (found.status === "found") {'));
    assert.ok(responding.length > 0);
    assert.equal(/root/i.test(responding), false, responding);
  });

  test("🔴 응답 타입에 절대 경로를 담는 칸이 없다 — 나가는 칸은 정해진 열뿐이다", () => {
    const types = code.slice(
      code.indexOf("type PurchaseOrderEntryBody"),
      code.indexOf("const UNOPENABLE_FOLDER_REASON")
    );
    assert.ok(types.includes('status: "found"'), types);
    for (const forbidden of ["root", "absolutepath", "archivedir", "dir:", "fullpath", "uncpath"]) {
      assert.equal(types.toLowerCase().includes(forbidden), false, `${forbidden} 가 응답 타입에 있다`);
    }
    const fields = [...types.matchAll(/(\w+)\??:/g)].map((match) => match[1]);
    // 🔴 `issuedDate` 가 **없다** — 번호로 찾으므로 폴더 이름의 날짜를 읽지 않는다.
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
      getBody.includes('if (found.status === "multiple") {\n    return respond({ status: "multiple" });\n  }'),
      getBody.slice(getBody.indexOf('found.status === "multiple"'), getBody.indexOf('found.status === "multiple"') + 200)
    );
    // 줄을 내보내는 자리는 **found 일 때 하나뿐**이다.
    assert.equal(getBody.match(/found\.entries\.map\(/g)?.length, 1);
    assert.ok(
      getBody.indexOf('if (found.status === "found") {') < getBody.indexOf("found.entries.map("),
      "found 를 확인하기 전에 줄을 내보낸다"
    );
  });

  test("상태 여섯 — found · multiple · not-found · no-po-number · disabled · failed", () => {
    for (const status of [
      'status: "found"',
      'status: "multiple"',
      'status: "not-found"',
      'status: "no-po-number"',
      'status: "disabled"',
      'status: "failed"',
    ]) {
      assert.ok(getBody.includes(status), status);
    }
    assert.ok(route.includes('NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } })'));
  });

  test("폴더 이름이 도우미 주소 규칙 밖이면 수리 건 통로와 **같은 문장**으로 알린다", () => {
    const reason = "발주서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";
    assert.ok(route.includes(reason), "문장이 바뀌었다");
    assert.ok(repairRoute.includes(reason), "이웃 통로의 문장이 바뀌었다 — 두 자리가 다른 말을 한다");
    // 규칙은 도우미 주소가 쓰는 그 함수 하나다 — 통로가 제 손으로 세지 않는다.
    assert.ok(getBody.includes("if (!isQuoteFolderRelativePath(found.relativePath)) {"));
  });

  test("전역 보안 헤더와 같은 이름의 헤더를 붙이지 않는다", () => {
    for (const name of GLOBAL_HEADERS) {
      assert.equal(route.includes(`"${name}"`), false, name);
      assert.ok(nextConfig.includes(`"${name}"`), `next.config.ts 의 전역 헤더 목록이 바뀌었다: ${name}`);
    }
  });
});
