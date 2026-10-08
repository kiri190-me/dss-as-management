import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 「1. 수리 관련」 서류함 — 🔴 **읽기만 한다** · 바이트는 브라우저로 안 나간다 (2026-10-08)
 * ============================================================================
 * 이 모듈에 `readFile` 이 생겼다(2026-10-08 — 가리킨 서류를 이 건의 연락서 폴더로
 * 가져오기). 이웃 repair-docs-entries.ts 는 「파일을 여는 일은 그 PC 의 도우미가 한다」며
 * 내용 읽기를 **일부러 두지 않았고**, 그 규율을 한 칸 넓힌 것이다. 넓힌 칸이 더 벌어지지
 * 않게 **원본 글자**로 못 박는다:
 *
 *  · 🔴 **쓰기 · 만들기 · 지우기 · 옮기기가 한 글자도 없다** — 운영에서 이 볼륨은
 *       읽기 전용으로 붙어 있다.
 *  · 🔴 **내보내는 길이 없다** — 스트림 · `Content-Disposition` · Response · base64 가
 *       한 글자도 없다. 읽은 바이트는 **다른 폴더에 쓰러** 갈 뿐이다.
 *  · 🔴 **`stat` 이 `readFile` 보다 앞**이다 — 상한은 읽기 전에 걸려야 뜻이 있다.
 *  · 🔴 경로 규칙과 걷기를 **베끼지 않았다** — 목록 통로가 쓰는 두 함수를 그대로 부른다.
 *  · 🔴 사유 글귀에 경로 구분자가 없다.
 *
 * 읽는 동작 자체는 repair-docs-file-read.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./repair-docs-archive.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("수리 서류함 — 원본으로 지킨다", () => {
  test("🔴 쓰기 · 만들기 · 지우기 · 옮기기가 한 글자도 없다 — 운영에서 읽기 전용 볼륨이다", () => {
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
      /\bchmod\b/,
      /\butimes\b/,
      /"wx"/,
      /\bopen\(/,
    ]) {
      assert.equal(forbidden.test(code), false, `쓰기 · 지우기 흔적: ${forbidden}`);
    }
    // 파일시스템에서 가져오는 것은 읽는 둘뿐이다.
    const fsImport = source.match(/import \{([^}]*)\} from "node:fs\/promises";/);
    assert.ok(fsImport, "node:fs/promises 를 가져오는 줄이 없다");
    assert.deepEqual(
      fsImport[1].split(",").map((name) => name.trim()).filter((name) => name !== "").sort(),
      ["readFile", "stat"]
    );
  });

  test("🔴 바이트를 **내보내는 길**이 없다 — 내려받기 · 미리보기 · 스트림이 없다", () => {
    for (const forbidden of [
      "createReadStream",
      "ReadableStream",
      "Content-Disposition",
      "NextResponse",
      "new Response",
      "toString(\"base64\")",
      "Blob",
      "fetch(",
    ]) {
      assert.equal(code.includes(forbidden), false, `바이트를 내보내는 흔적: ${forbidden}`);
    }
    // 읽는 함수가 하나이고, 부르는 자리도 하나다.
    assert.equal(code.match(/\breadFile\(/g)?.length, 1, "readFile 을 부르는 자리가 하나가 아니다");
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 `stat` 이 `readFile` 보다 **앞**이다 — 상한은 읽기 전에 걸려야 뜻이 있다", () => {
    const readOneAt = code.indexOf("async function readOne(");
    assert.ok(readOneAt > 0, "읽는 함수가 없다");
    const body = code.slice(readOneAt);
    const statAt = body.indexOf("await stat(");
    const sizeAt = body.indexOf("info.size > maxBytes");
    const readAt = body.indexOf("await readFile(");
    assert.ok(statAt >= 0 && sizeAt > statAt, "재지 않고 읽는다");
    assert.ok(readAt > sizeAt, "🔴 상한을 보기 전에 읽는다");
    // 상한은 첨부와 **같은 값**이다 — 숫자를 따로 적지 않았다.
    assert.ok(code.includes("export const REPAIR_DOCS_FILE_MAX_BYTES = MAX_ATTACHMENT_SIZE_BYTES;"));
    assert.equal(/= *20 *\* *1024/.test(code), false, "상한 숫자를 베껴 적었다");
  });

  test("🔴 실행 파일 · 경로 규칙 · 걷기를 **베끼지 않았다** — 있는 것을 그대로 부른다", () => {
    assert.ok(code.includes("isExecutableExtension(extension)"), "실행 파일 판정을 안 쓴다");
    assert.ok(code.includes("normalizeFileExtension("), "확장자 뽑기를 안 쓴다");
    assert.ok(code.includes("checkQuoteFolderRelativePath(input.relativePath)"), "경로 검사를 안 쓴다");
    assert.ok(code.includes("findRepairDocsEntry({"), "목록 통로와 같은 걷기를 안 쓴다");
    assert.ok(code.includes("assertInsideShareFolderRoot(root, target,"), "울타리를 한 번 더 안 본다");
    // 목록을 베껴 적은 자리가 없다.
    for (const forbidden of ["EXECUTABLE_EXTENSIONS", '".exe"', '"xlsm"', "readdir", "listShareFolderDirents"]) {
      assert.equal(code.includes(forbidden), false, `규칙을 베껴 적었다: ${forbidden}`);
    }
    // 🔴 검사가 **디스크를 보기 전**이다.
    const body = code.slice(code.indexOf("export async function readRepairDocsFile("));
    assert.ok(body.indexOf("checkQuoteFolderRelativePath(") < body.indexOf("findRepairDocsEntry("));
    assert.ok(body.indexOf("isExecutableExtension(") < body.indexOf("findRepairDocsEntry("));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로가 없다", () => {
    assert.ok(code.includes('status: "failed"'));
    assert.ok(code.includes('status: "rejected"'));
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    for (const forbidden of ["String(error)", "JSON.stringify(error)", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 사유 글귀에 경로 구분자가 없다.
    for (const match of source.matchAll(/_REASON =\s*\n?\s*"([^"]*)"/g)) {
      assert.equal(/[\\/]/.test(match[1]), false, `사유에 경로 구분자가 있다: ${match[1]}`);
    }
  });

  test("🔴 상한을 안 거치고 기다리는 길이 없다", () => {
    assert.ok(code.includes("export const REPAIR_DOCS_FILE_READ_TIMEOUT_MS = 15000;"));
    assert.equal(code.match(/withShareFolderTimeout\(/g)?.length, 1, "상한을 씌우는 자리가 하나가 아니다");
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
  });
});
