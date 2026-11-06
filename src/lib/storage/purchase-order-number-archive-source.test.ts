import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 번호로 찾는 발주서 폴더 읽기 — 지우지 않는다 · 만들지 않는다 · 내용을 안 읽는다 (2026-11-06)
 * ============================================================================
 * 이웃 purchase-order-archive-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는 시험으로
 * 지켜지지 않는다 — 뒤 조각에서 누군가 지우는 한 줄을 들이면 **앱이 사람의 서류함에서 파일을
 * 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 이 모듈만의 것이 넷 더 있다:
 *  · 🔴 **수리 건 쪽 모듈을 고치지 않았다** — 설정 · 상한 · 느림 사유 · 줄 타입을 그쪽에서
 *    **가져다 쓰고**(두 길이 같은 서류함을 본다), 그쪽 원본에는 이 조각의 이름이 한 글자도 없다.
 *  · 🔴 **폴더 이름 규칙을 다시 짜지 않는다** — 둘째 마디를 읽는 일은 순수 함수 하나다.
 *  · 🔴 **날짜를 읽지 않는다** — 날짜 문법을 두 벌째 적지 않았다(결과에 그 칸도 없다).
 *  · 🔴 **훑기는 폴더 안을 열지 않는다** — 고른 하나만 연다(그것이 NAS 왕복 수다).
 *
 * 읽는 동작 자체는 purchase-order-number-archive.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./purchase-order-number-archive.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
/** 수리 건 쪽 모듈 — 이 조각이 **고치지 않았다**는 것을 그 원본으로 본다. */
const neighbour = readFileSync(new URL("./purchase-order-archive.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("번호로 찾는 발주서 폴더 읽기 — 원본으로 지킨다", () => {
  test("🔵 못 — 원본이 비어 있지 않고, 주석 걷어내기가 실제로 문다", () => {
    assert.ok(source.length > 2000, `원본이 너무 짧다(${source.length})`);
    // 머리말에는 금지 낱말이 까닭과 함께 적혀 있고, 코드에는 없다 — 둘 다 봐야 뜻이 있다.
    assert.ok(source.includes("writeFile"), "머리말이 바뀌었다 — 아래 못을 다시 보라");
    assert.equal(/\bwriteFile\b/.test(code), false);
  });

  test("🔴 지우기 · 옮기기 · 만들기 · 쓰기가 한 글자도 없다", () => {
    for (const forbidden of [
      /\bunlink\b/,
      /\brm\b/,
      /\brmdir\b/,
      /\brename\b/,
      /\btruncate\b/,
      /\bcp\b/,
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bappendFile\b/,
      /\bcreateWriteStream\b/,
      /"wx"/,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 지우기 흔적: ${forbidden}`);
    }
  });

  test("🔴 파일 **내용**을 읽지 않는다 — 이름 · 크기 · 수정 시각뿐이다", () => {
    for (const forbidden of [/\breadFile\b/, /\bcreateReadStream\b/, /\bopen\b\s*\(/, /\bBlob\b/, /\bBuffer\b/]) {
      assert.equal(forbidden.test(code), false, `내용을 읽는 흔적: ${forbidden}`);
    }
    // 크기 · 수정 시각은 **고른 폴더의 남긴 줄에만** 묻는다 — 부르는 자리가 하나다.
    assert.equal(code.match(/statShareFolderEntry\(/g)?.length, 1);
  });

  test("🔴 파일시스템을 직접 가져오지 않는다 — 읽기는 공용 도우미 하나를 거친다", () => {
    assert.deepEqual(
      importedFrom(source),
      [
        "./purchase-order-archive",
        "./share-folder-fs",
        "@/lib/domain/purchase-order-folder-number",
        "@/lib/domain/share-folder-naming",
        "node:path",
      ].sort()
    );
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    assert.equal(code.includes("readdir("), false, "폴더 읽기를 다시 짰다");
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 DB 도 요청 수명 캐시도 모른다 — 그 일은 통로 · 조회가 쥔다", () => {
    for (const forbidden of ["drizzle", "db/client", "queries/", '"react"', "cache(", "domesticOrder"]) {
      assert.equal(code.includes(forbidden), false, `조회가 할 일이 내려왔다: ${forbidden}`);
    }
  });

  test("🔴 **설정은 수리 건 쪽 한 벌**이다 — 두 길이 같은 서류함을 본다", () => {
    // 이 파일은 환경변수를 **제 손으로 읽지 않는다** — 그 함수를 가져다 쓴다.
    assert.equal(code.includes("process.env"), false, "설정을 제 손으로 읽는다");
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_DIR"), false);
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_UNC_ROOT"), false);
    assert.ok(code.includes("resolvePurchaseOrderArchiveRoot()"), "설정 읽기를 가져다 쓰지 않는다");
    // 상한 둘과 느림 사유도 그쪽 숫자 그대로다 — 같은 서류함을 같은 깊이로 훑는다.
    for (const name of [
      "PURCHASE_ORDER_ARCHIVE_ENTRIES_LIMIT",
      "PURCHASE_ORDER_ARCHIVE_TIMEOUT_MS",
      "PURCHASE_ORDER_ARCHIVE_SLOW_REASON",
    ]) {
      assert.ok(code.includes(name), `${name} 를 가져다 쓰지 않는다`);
    }
  });

  test("🔴 **수리 건 쪽 원본에 이 조각의 이름이 한 글자도 없다** — 그 길을 고치지 않았다", () => {
    for (const mine of [
      "purchase-order-number-archive",
      "readPurchaseOrderFolderNumber",
      "purchaseOrderNumberKey",
      "findPurchaseOrderArchiveFolderByNumber",
      "no-po-number",
    ]) {
      assert.equal(neighbour.includes(mine), false, `수리 건 모듈이 바뀌었다: ${mine}`);
    }
    // 🔵 못 — 그 원본을 실제로 읽었다(빈 글자를 상대로 「없다」를 외치지 않게).
    assert.ok(neighbour.includes("export async function findPurchaseOrderArchiveFolder("), "이웃 원본이 바뀌었다");
  });

  test("🔴 폴더 이름 규칙을 다시 짜지 않는다 — 읽는 일은 순수 함수 하나다", () => {
    assert.ok(code.includes("readPurchaseOrderFolderNumber("), "이름을 읽는 함수를 부르지 않는다");
    assert.ok(code.includes("purchaseOrderNumberKey("), "열쇠 만드는 함수를 부르지 않는다");
    // 번호 양식 · 구분 글자 · 금액 꼬리 규칙을 여기에 두 벌째 적지 않는다.
    for (const forbidden of ['"PO', "내자", "외자", 'split("_")', "AMOUNT_TAIL", "normalize("]) {
      assert.equal(code.includes(forbidden), false, `이름 규칙을 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 **날짜를 읽지 않는다** — 날짜 문법이 두 벌이 되지 않았다", () => {
    for (const forbidden of ["issuedDate", "toIssuedDate", "\\d{8}", "readPurchaseOrderFolderName"]) {
      assert.equal(code.includes(forbidden), false, `날짜 읽기가 들어왔다: ${forbidden}`);
    }
  });

  test("🔴 견적서 쪽 연도 폴더 판정을 가져오지 않는다 — 다른 서류함이다", () => {
    for (const forbidden of ["isQuoteArchiveYearFolder", "quote-archive-naming", "내자견적서"]) {
      assert.equal(code.includes(forbidden), false, `견적서 규칙을 끌어왔다: ${forbidden}`);
    }
  });

  test("🔴 훑기는 폴더 **안**을 열지 않는다 — 고른 하나만 연다", () => {
    const scanAt = code.indexOf("async function scan(");
    const readAt = code.indexOf("async function read(");
    assert.ok(scanAt >= 0 && readAt > scanAt, "훑기 · 읽기 토막을 찾지 못했다");
    const scanBody = code.slice(scanAt, code.indexOf("async function listInside("));
    assert.equal(scanBody.includes("listShareFolderDirents("), false, "훑기가 발주 건 폴더 안을 연다");
    // 폴더 안을 여는 자리는 **한 곳**뿐이다.
    assert.equal(code.match(/listShareFolderDirents\(/g)?.length, 1);
  });

  test("🔴 바로 가기를 제 손으로 거르지 않는다 — 공용 도우미가 이미 폴더로 치지 않는다", () => {
    for (const forbidden of ["isSymbolicLink", "lstat", "realpath", "바로 가기", ".lnk"]) {
      assert.equal(code.includes(forbidden), false, `링크 판정을 다시 짰다: ${forbidden}`);
    }
    assert.equal(code.match(/listShareFolderNames\(/g)?.length, 2);
  });

  test("🔴 루트 밖으로 새지 않는다 — 이을 때마다 본다", () => {
    assert.ok(code.includes("assertInsideShareFolderRoot("), "루트 밖 판정이 없다");
    assert.equal(code.match(/assertInsideShareFolderRoot\(/g)?.length, 2, "이어 붙이는 자리마다 보지 않는다");
    assert.ok(code.includes("requireExistingShareFolderRoot("), "루트가 있는지 보지 않는다");
  });

  test("🔴 쓸 수 있는 번호가 아니면 디스크를 보기 **전에** 끝난다", () => {
    assert.ok(code.includes('if (wantedKey === null) return { status: "not-found" };'));
    for (const diskMark of ["withShareFolderTimeout(", "requireExistingShareFolderRoot("]) {
      assert.ok(code.indexOf('return { status: "disabled" };') < code.indexOf(diskMark), diskMark);
    }
    // 열쇠가 없으면 설정 판정보다도 **앞**에서 끝난다.
    assert.ok(code.indexOf('return { status: "not-found" };') < code.indexOf('return { status: "disabled" };'));
  });

  test("🔴 기다리는 시간에는 상한이 있다 — NAS 가 멎어도 요청이 매달리지 않게", () => {
    assert.equal(code.match(/withShareFolderTimeout\(/g)?.length, 1, "상한 없이 기다리는 길이 있다");
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: PURCHASE_ORDER_ARCHIVE_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    assert.ok(code.includes('status: "failed"'));
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 돌려주는 타입에 컨테이너 안 경로를 담는 칸이 없다", () => {
    const result = source.slice(
      source.indexOf("export type PurchaseOrderNumberArchiveResult"),
      source.indexOf("export type FindPurchaseOrderArchiveFolderByNumberInput")
    );
    assert.ok(result.length > 0, "결과 타입을 찾지 못했다");
    const fields = [...new Set([...result.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]))].sort();
    // 🔴 `issuedDate` 가 **없다** — 번호로 찾으므로 날짜를 읽지 않는다(위 시험의 짝).
    assert.deepEqual(fields, ["entries", "relativePath", "status", "totalCount", "truncated"]);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:"]) {
      assert.equal(result.toLowerCase().includes(forbidden), false, `${forbidden} 가 결과 타입에 있다`);
    }
  });

  test("🔴 **하나만** 고른다 — 같은 번호가 둘이면 `multiple` 이고 목록이 안 나간다", () => {
    assert.ok(code.includes('if (candidates.length > 1) return { status: "multiple" };'), code);
    // `multiple` 을 **내는** 자리는 하나뿐이다(타입 선언 한 줄을 빼면). 거기에는 경로도 줄도 없다.
    const bodyAt = code.indexOf("async function findAndRead(");
    assert.ok(bodyAt >= 0);
    assert.equal(code.slice(bodyAt).match(/status: "multiple"/g)?.length, 1);
  });
});
