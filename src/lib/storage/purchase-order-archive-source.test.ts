import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 발주서 폴더 읽기 — 지우지 않는다 · 만들지 않는다 · 내용을 안 읽는다 (2026-10-12)
 * ============================================================================
 * 이웃 quote-archive-product-folders-source.test.ts 와 같은 규율이다. 「지금은 안 쓴다」는
 * 시험으로 지켜지지 않는다 — 뒤 조각에서 누군가 지우는 한 줄을 들이면 **앱이 사람의
 * 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * 여기에 이 모듈만의 것이 넷 더 있다:
 *  · 🔴 **폴더 이름 규칙을 다시 짜지 않는다** — 날짜 · L/N · S/N 을 읽는 일은 순수 함수 하나다
 *    (domain/purchase-order-folder-name.ts). 여기에 두 벌째 적으면 외자를 거르는 기준이 갈린다.
 *  · 🔴 **견적서 쪽 연도 폴더 판정을 가져오지 않는다** — 다른 서류함이라 이름 규칙이 다르다.
 *  · 🔴 **훑기는 폴더 안을 열지 않는다** — 고른 하나만 연다(그것이 NAS 왕복 수다).
 *  · 🔴 **바로 가기를 제 손으로 거르지 않는다** — 공용 도우미가 이미 폴더로 치지 않는다.
 *
 * 읽는 동작 자체는 purchase-order-archive.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./purchase-order-archive.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

describe("발주서 폴더 읽기 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 만들기 · 쓰기가 한 글자도 없다", () => {
    for (const forbidden of [/\bmkdir\b/, /\bwriteFile\b/, /\bappendFile\b/, /\bcreateWriteStream\b/, /"wx"/]) {
      assert.equal(forbidden.test(code), false, `쓰기 흔적: ${forbidden}`);
    }
    // 다른 서류함의 저장 · 폴더 만들기 쪽 이름도 가져오지 않는다.
    for (const forbidden of ["saveToQuoteArchive", "createQuoteArchiveFolder", "copyInto"]) {
      assert.equal(code.includes(forbidden), false, `쓰기 쪽 이름을 가져왔다: ${forbidden}`);
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
        "./share-folder-fs",
        "@/lib/domain/purchase-order-folder-name",
        "@/lib/domain/share-folder-naming",
        "node:path",
      ].sort()
    );
    for (const forbidden of ["node:fs", "fs/promises", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 폴더를 읽는 일을 다시 짜지 않는다.
    assert.equal(code.includes("readdir("), false, "폴더 읽기를 다시 짰다");
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 DB 도 요청 수명 캐시도 모른다 — 그 일은 통로 · 조회가 쥔다", () => {
    for (const forbidden of ["drizzle", "db/client", "queries/", '"react"', "cache(", "domesticOrder"]) {
      assert.equal(code.includes(forbidden), false, `조회가 할 일이 내려왔다: ${forbidden}`);
    }
  });

  test("🔴 폴더 이름 규칙을 다시 짜지 않는다 — 읽는 일은 순수 함수 하나다", () => {
    assert.ok(code.includes("readPurchaseOrderFolderName("), "이름을 읽는 함수를 부르지 않는다");
    assert.ok(code.includes("purchaseOrderProductKey("), "열쇠 만드는 함수를 부르지 않는다");
    // 날짜 · 구분 글자 · 금액 꼬리 규칙을 여기에 두 벌째 적지 않는다.
    for (const forbidden of ["내자", "외자", "\\d{8}", "normalize(", "toIssuedDate", "AMOUNT_TAIL"]) {
      assert.equal(code.includes(forbidden), false, `이름 규칙을 베꼈다: ${forbidden}`);
    }
  });

  test("🔴 견적서 쪽 연도 폴더 판정을 가져오지 않는다 — 다른 서류함이다", () => {
    for (const forbidden of ["isQuoteArchiveYearFolder", "quote-archive-naming", "내자견적서", "YEAR_FOLDER"]) {
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
    // 폴더 이름을 모으는 길은 공용 도우미 하나다 — 맨 위 켜(연도)와 그 아래 두 번뿐이다.
    assert.equal(code.match(/listShareFolderNames\(/g)?.length, 2);
  });

  test("🔴 루트 밖으로 새지 않는다 — 이을 때마다 본다", () => {
    assert.ok(code.includes("assertInsideShareFolderRoot("), "루트 밖 판정이 없다");
    assert.equal(code.match(/assertInsideShareFolderRoot\(/g)?.length, 2, "이어 붙이는 자리마다 보지 않는다");
    assert.ok(code.includes("requireExistingShareFolderRoot("), "루트가 있는지 보지 않는다");
  });

  test("🔴 설정이 없으면 디스크를 보기 **전에** 끝난다", () => {
    for (const diskMark of ["withShareFolderTimeout(", "requireExistingShareFolderRoot("]) {
      assert.ok(code.indexOf('return { status: "disabled" };') < code.indexOf(diskMark), diskMark);
    }
    // 열쇠가 비면 그보다도 **앞**에서 끝난다 — 빈 열쇠로 훑으면 남의 발주서가 걸린다.
    assert.ok(code.indexOf('return { status: "not-found" };') < code.indexOf('return { status: "disabled" };'));
    assert.ok(code.includes("if (wantedKey === null) return { status: \"not-found\" };"));
    // 설정을 읽는 자리는 **한 곳**이다.
    assert.equal(code.match(/process\.env/g)?.length, 1);
    assert.equal(code.match(/PURCHASE_ORDER_ARCHIVE_DIR/g)?.length, 1);
    // 🔴 도우미 설치본에만 심기는 UNC 루트는 이 파일이 읽지 않는다.
    assert.equal(code.includes("PURCHASE_ORDER_ARCHIVE_UNC_ROOT"), false);
  });

  test("🔴 기다리는 시간에는 상한이 있다 — NAS 가 멎어도 요청이 매달리지 않게", () => {
    assert.equal(code.match(/withShareFolderTimeout\(/g)?.length, 1, "상한 없이 기다리는 길이 있다");
    assert.ok(code.includes("PURCHASE_ORDER_ARCHIVE_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: PURCHASE_ORDER_ARCHIVE_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    assert.ok(code.includes('status: "failed"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 돌려주는 타입에 컨테이너 안 경로를 담는 칸이 없다", () => {
    const result = source.slice(
      source.indexOf("export type PurchaseOrderArchiveResult"),
      source.indexOf("export type FindPurchaseOrderArchiveFolderInput")
    );
    assert.ok(result.length > 0, "결과 타입을 찾지 못했다");
    // `| { status: "failed"; reason: string }` 처럼 한 줄에 접힌 갈래는 줄 머리가 `|` 라
    // 여기 안 잡힌다 — 잡히는 것은 `found` 가 싣는 칸들이다(그것이 이 시험의 알맹이다).
    const fields = [...new Set([...result.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]))].sort();
    assert.deepEqual(fields, ["entries", "issuedDate", "relativePath", "status", "totalCount", "truncated"]);
    for (const forbidden of ["root", "absolute", "fullpath", "uncpath", "dir:"]) {
      assert.equal(result.toLowerCase().includes(forbidden), false, `${forbidden} 가 결과 타입에 있다`);
    }

    const entry = source.slice(
      source.indexOf("export type PurchaseOrderArchiveEntry"),
      source.indexOf("export type PurchaseOrderArchiveResult")
    );
    const entryFields = [...entry.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1]).sort();
    assert.deepEqual(entryFields, ["isDirectory", "modifiedAtMs", "name", "sizeBytes"]);
  });

  test("🔴 **하나만** 고른다 — 날짜가 같으면 `multiple` 이고 목록이 안 나간다", () => {
    assert.ok(code.includes('if (latest.length > 1) return { status: "multiple" };'), code);
    // `multiple` 을 **내는** 자리는 하나뿐이다(타입 선언 한 줄을 빼면). 거기에는 경로도 줄도 없다.
    const bodyAt = code.indexOf("async function findAndRead(");
    assert.ok(bodyAt >= 0);
    assert.equal(code.slice(bodyAt).match(/status: "multiple"/g)?.length, 1);
  });
});
