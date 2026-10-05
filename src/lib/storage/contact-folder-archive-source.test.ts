import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 연락서 폴더 — **지우지 않는다 · 덮어쓰지 않는다**를 원본으로 지킨다
 * ============================================================================
 * 「지금은 안 쓴다」는 시험으로 지켜지지 않는다 — 누군가 `rm` 한 줄을 들이면 **앱이
 * 사람의 서류함에서 파일을 지운다.** 그래서 동작이 아니라 **원본 글자**를 본다.
 *
 * ── 🔴 2026-10-05(조각 5) — `mkdir` 만 금지에서 허용으로 옮겼다 ──────────
 * 그 조각이 처음으로 **폴더를 만들었다**(createContactFolder).
 *
 * ── 🔴 2026-10-05(조각 6) — **파일 쓰기**를 열었다 ──────────────────────
 * 이 조각이 처음으로 연락서 폴더에 **파일을 꽂는다**(copyIntoContactFolder). 그래서
 * `writeFile` · `"wx"` · `open(` 금지를 풀었다. 대신 **무엇을 열었는지 이름으로 못 박는다**:
 *  · 파일시스템에서 가져오는 것은 `mkdir` · `open` · `readdir` · `readFile` · `stat`
 *    **다섯뿐**이고 하나씩 까닭이 있다(모듈 머리말).
 *  · 🔴 여는 방식은 **`"wx"` 하나**다 — 덮어쓰는 길(`"w"` · `"a"` · `"r+"`)이 없다.
 *  · 🔴 **지우기 · 옮기기 금지는 한 글자도 느슨하게 하지 않았다** — `unlink` · `rm` ·
 *    `rmdir` · `rename` · `truncate` · `cp` 는 그대로 없어야 한다. 쓰다 실패한 조각을
 *    치우는 길도 들이지 않는다(머리말의 「대가」).
 *  · 🔴 사본 꽂기 쪽에는 **`mkdir` 이 없다** — 이 길은 이미 있는 폴더에만 꽂는다.
 *
 * ── 🔴 2026-10-05(조각 8) — **S/N 훑기를 걷어냈다** ─────────────────────
 * 조각 5 가 만들기 직전에 두었던 「비슷한 폴더 훑기」를 사용자 결정으로 없앴다. 같은
 * 장비가 다시 수리를 오면 S/N · 모델 · L/N 이 같은 폴더가 이미 있는 것이 정상이고, 그때
 * **새 인수번호로 새 폴더가 생겨야** 한다. 남은 안전장치는 「인수번호로 먼저 찾는다」
 * 하나뿐이고, 아래 두 시험이 그것과 **자취가 안 남았음**을 함께 못 박는다.
 * 🔴 **지우기 · 덮어쓰기 금지는 한 글자도 느슨해지지 않았다**(위 두 시험 그대로).
 *
 * ── 🔴 2026-10-05(조각 11) — 만드는 폴더가 **셋**이 되었다 ───────────────
 * 연락서 폴더 · 그 안의 `DATA` · 올린 파일의 분류 폴더. 금지를 푼 것이 아니라 **만드는
 * 자리를 한 곳으로 모은 것**이다:
 *  · 🔴 `mkdir` 을 부르는 자리는 여전히 **하나**다(`makeOneFolder`) — 셋이 전부 그리로
 *    들어온다. 흩어 적으면 `recursive` 가 하나에만 붙거나 EEXIST 를 하나만 잡는다.
 *  · 🔴 **꽂는 길이 만드는 것은 분류 폴더 하나뿐**이다 — 연락서 폴더는 여전히 만들지
 *    않는다(없으면 `no-folder`). 그 사실을 「이름을 짓지 않는다」로도 함께 본다.
 *  · 🔴 `DATA` 는 **곁다리**다 — 못 만들어도 폴더 만들기는 성공이어야 한다(try/catch 로
 *    삼키고 그 토막에 `return` 도 `throw` 도 없다). 실제로 mkdir 을 실패시키는 시험은
 *    짤 수 없어(갓 만든 빈 폴더다) **여기서 원본 글자로** 본다.
 *  · 🔴 **지우기 · 덮어쓰기 금지는 한 글자도 느슨해지지 않았다**(위 두 시험 그대로).
 *
 * 찾기 · 만들기 · 꽂기 동작 자체는 contact-folder-archive.test.ts ·
 * contact-folder-create.test.ts · contact-folder-copy.test.ts ·
 * contact-folder-subfolders.test.ts 가, 이름 · 대조 규칙은
 * domain/contact-folder-naming.test.ts 가 본다.
 * ============================================================================
 */

const source = readFileSync(new URL("./contact-folder-archive.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir · unlink …)에 걸리지 않게. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function importedFrom(text: string): string[] {
  return [...text.matchAll(/\bfrom "([^"]+)";/g)].map((match) => match[1]).sort();
}

/** `index` 부터 시작하는 중괄호 블록 하나를 괄호 짝을 세어 떼어 온다. */
function blockAt(source: string, index: number): string {
  const open = source.indexOf("{", index);
  assert.ok(open >= 0, "블록이 시작되지 않았다");
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("블록이 닫히지 않았다");
}

describe("연락서 폴더 — 원본으로 지킨다", () => {
  test("🔴 지우기 · 옮기기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bcp\b/]) {
      assert.equal(forbidden.test(code), false, `지우기 · 옮기기 흔적: ${forbidden}`);
    }
  });

  test("🔴 덮어쓰는 길이 없다 — 파일은 `wx` 로만 연다 (조각 6)", () => {
    // 여는 자리는 하나뿐이고 그 하나가 `wx` 다. 존재 확인과 쓰기 사이에 틈이 없다.
    assert.equal(code.match(/\bopen\(/g)?.length, 1, "파일을 여는 자리가 하나가 아니다");
    assert.ok(code.includes('await open(target, "wx");'), "`wx` 말고 다른 방식으로 열었다");
    // 🔴 덮어쓰는 플래그는 한 글자도 없다.
    for (const forbidden of ['"w"', '"a"', '"r+"', '"w+"', '"a+"', /\bappendFile\b/, /\bcreateWriteStream\b/]) {
      const test = typeof forbidden === "string" ? code.includes(forbidden) : forbidden.test(code);
      assert.equal(test, false, `덮어쓰기 흔적: ${forbidden}`);
    }
    // 🔴 파일을 쓰는 것은 **연 손잡이**를 통해서다 — fs 의 writeFile 을 직접 부르지 않는다
    //    (아래 가져오기 고정이 그것을 함께 막는다).
    assert.ok(code.includes("await handle.writeFile(bytes);"), "쓰는 자리가 사라졌다");
    assert.equal(/\bawait writeFile\(/.test(code), false, "fs 의 writeFile 을 직접 불렀다");
  });

  test("🔴 사본을 꽂는 길은 **연락서 폴더를 만들지 않는다** — 만드는 것은 분류 폴더 하나뿐이다 (조각 11)", () => {
    const copy = code.slice(code.indexOf("export async function copyIntoContactFolder("), code.indexOf("async function look("));
    assert.ok(copy.length > 0, "사본 꽂기가 없다");
    // 🔴 fs 를 직접 부르지 않는다 — 폴더를 만드는 길은 공용 도우미 하나뿐이다.
    assert.equal(/\bmkdir\b/.test(copy), false, "🔴 꽂는 길이 mkdir 을 직접 부른다");
    // 🔴 그 도우미를 부르는 자리도 **하나**다(분류 폴더). 둘이 되면 무엇을 더 만드는 것이다.
    assert.equal(copy.match(/\bmakeOneFolder\(/g)?.length, 1, "🔴 꽂는 길이 폴더를 둘 이상 만든다");
    assert.ok(copy.includes("async function openCategoryFolder("), "분류 폴더를 여는 자리가 없다");
    // 🔴 그 하나가 **분류 폴더**다 — 연락서 폴더 이름을 짓는 자리가 여기 없다.
    assert.equal(copy.includes("contactFolderName("), false, "🔴 꽂는 길이 연락서 폴더 이름을 짓는다");
    assert.equal(copy.includes("makeDataFolder("), false, "🔴 꽂는 길이 DATA 를 만든다");
    assert.ok(copy.includes('status: "no-folder"'), "폴더가 없을 때 건너뛰지 않는다");
    // 🔴 분류 폴더를 못 써도 실패로 끝내지 않는다 — 폴더 바로 아래로 비켜 간다.
    assert.ok(copy.includes("categoryFolderBlockedByFile: true"), "🔴 막혔을 때 비켜 가는 길이 없다");
    // 🔴 NFC/NFD — 쓰기 전에 디스크의 이름을 접어서 견준다(`wx` 만으로는 못 막는다).
    assert.ok(copy.includes("normalizeShareFolderNameForCompare("), "정규화해 견주지 않는다");
  });

  test("🔴 `DATA` 는 곁다리다 — 못 만들어도 폴더 만들기는 성공이다 (조각 11)", () => {
    const data = blockAt(code, code.indexOf("async function makeDataFolder("));
    assert.ok(data.length > 0, "DATA 를 만드는 자리가 없다");
    // 🔴 무엇이든 여기서 삼킨다 — 밖으로 새어 나가면 폴더 만들기가 실패로 뒤집힌다.
    assert.ok(data.includes("try {"), "감싸지 않았다");
    assert.ok(data.includes("} catch {"), "catch 가 없다");
    assert.equal(/\breturn\b/.test(data), false, "DATA 결과를 밖으로 내보낸다");
    assert.equal(/\bthrow\b/.test(data), false, "🔴 DATA 때문에 폴더 만들기가 실패한다");
    // 🔴 **이번에 만들었을 때만** 부른다 — 이미 있던 폴더(EEXIST · found · multiple)에는 없다.
    assert.equal(code.match(/\bmakeDataFolder\(/g)?.length, 2, "DATA 를 부르는 자리가 하나가 아니다");
    const make = code.slice(code.indexOf("async function make("), code.indexOf("async function makeOneFolder("));
    const created = make.indexOf("await makeOneFolder(target)");
    const dataCall = make.indexOf("await makeDataFolder(");
    const exists = make.indexOf("const again = pickContactFolder(");
    assert.ok(created >= 0 && dataCall >= 0 && exists >= 0);
    assert.ok(created < dataCall, "폴더를 만들기 전에 DATA 를 만든다");
    assert.ok(dataCall < exists, "🔴 이미 있던 폴더를 쓰는 길에서도 DATA 를 만든다");
  });

  test("🔴 폴더를 만드는 자리는 `makeOneFolder` 하나다 — 셋이 전부 그리로 들어온다 (조각 11)", () => {
    const helper = blockAt(code, code.indexOf("async function makeOneFolder("));
    assert.ok(helper.includes("await mkdir(target);"), "도우미가 mkdir 을 부르지 않는다");
    // 연락서 폴더 · DATA · 분류 폴더 — 부르는 자리가 셋이다(정의 한 줄을 뺀 수).
    assert.equal(code.match(/\bmakeOneFolder\(/g)?.length, 4, "폴더를 만드는 자리가 셋이 아니다");
    // 🔴 EEXIST 를 삼키는 자리도 여기 하나다 — 자리가 **폴더인지 파일인지**는 부르는 쪽이 가린다.
    assert.ok(helper.includes('shareFolderErrorCode(error) === "EEXIST"'), "EEXIST 를 도우미가 가리지 않는다");
  });

  test("🔴 파일시스템에서 가져오는 것은 다섯뿐 — 폴더 읽기는 공용 도우미를 거친다", () => {
    assert.deepEqual(importedFrom(source), [
      "./share-folder-fs",
      // 🔴 조각 11 — 분류 폴더 이름의 **타입**만 가져온다(이름표를 읽는 일은 domain 이 한다).
      "@/lib/domain/attachment-category",
      "@/lib/domain/contact-folder-naming",
      "@/lib/domain/share-folder-naming",
      "node:fs/promises",
      "node:path",
    ].sort());
    // 🔴 이름을 적어 못 박는다 — `node:fs/promises` 에서 더 가져오면 여기서 걸린다.
    //    `unlink` · `rename` 을 들이려면 **이 줄부터** 고쳐야 한다.
    assert.ok(
      code.includes('import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";'),
      "가져오는 목록이 바뀌었다"
    );
    assert.equal(code.match(/from "node:fs\/promises"/g)?.length, 1);
    assert.equal(code.match(/\bmkdir\(/g)?.length, 1, "mkdir 을 부르는 자리는 하나뿐이다");
    // 🔴 `recursive` 없이 만든다 — 부모(= 루트)가 없으면 만들지 않고 실패해야 한다.
    //    `readdir` 도 마찬가지로 하위 폴더를 끌어오지 않는다.
    assert.ok(code.includes("await mkdir(target);"), "mkdir 에 옵션이 붙었다");
    for (const forbidden of ["recursive", "require(", "import(", "child_process", "console."]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 서버에서만 도는 모듈이다.
    assert.ok(source.startsWith('import "server-only";'), "server-only 가 맨 앞에 없다");
  });

  test("🔴 루트를 만들지 않는다 — 루트는 「이미 있어야 한다」를 거쳐서만 쓴다", () => {
    assert.ok(code.includes("await requireExistingShareFolderRoot(rawRoot)"));
    // 만들기 · 찾기 두 길이 **같은 함수**로 루트를 확인한다.
    assert.equal(code.match(/requireExistingShareFolderRoot\(/g)?.length, 2);
  });

  test("🔴 만들기 전에 **인수번호로 먼저 찾는다** — 그것이 유일한 안전장치다 (조각 8)", () => {
    // 🔴 조각 11 에서 mkdir 이 도우미 안으로 들어갔다 — 보는 자리를 그 부름으로 옮긴다
    //    (느슨해지지 않았다: 도우미가 mkdir 을 부르는 유일한 자리임을 아래 시험이 본다).
    const make = code.slice(code.indexOf("async function make("), code.indexOf("async function makeOneFolder("));
    const look = make.indexOf("pickContactFolder(naming.intakeNumber, names)");
    const create = make.indexOf("await makeOneFolder(target)");
    assert.ok(look >= 0, "인수번호로 먼저 찾지 않는다");
    assert.ok(create >= 0, "만드는 자리가 없다");
    assert.ok(look < create, "🔴 찾기가 만들기보다 뒤에 있다");
    // 찾아 놓고 만들지 않는다 — 하나면 그것을 쓰고, 여럿이면 만들지 않는다.
    const between = make.slice(look, create);
    assert.ok(between.includes('picked.status === "found"'), "찾아 놓고 그것을 쓰지 않는다");
    assert.ok(between.includes('picked.status === "multiple"'), "여럿일 때 만들지 않는 길이 없다");
    // 🔴 이름은 domain 이 지은 것 그대로 쓴다 — 여기서 새로 짓지 않는다.
    assert.ok(make.includes("contactFolderName(naming)"));
  });

  test("🔴 S/N 훑기를 걷어낸 자취가 코드에 한 글자도 없다 — 되살리지 말 것 (조각 8)", () => {
    // 2026-10-05 사용자 결정. 같은 S/N · 모델 · L/N 의 폴더가 있어도 **새 인수번호면
    // 만든다** — 같은 장비가 다시 수리를 오는 것이 정상이기 때문이다. 까닭 전부는
    // domain/contact-folder-naming.ts 의 「걷어낸 것」 머리말에 있다.
    for (const gone of ["pickSimilarContactFolders", "contactFolderSerialKey", "candidates", "serialNumber"]) {
      assert.equal(code.includes(gone), false, `걷어낸 것이 남아 있다: ${gone}`);
    }
  });

  test("🔴 기다리는 시간에 상한이 있다 — 상한을 넘으면 사유를 돌려준다", () => {
    assert.ok(code.includes("withShareFolderTimeout("), "상한 없이 기다린다");
    assert.ok(code.includes("CONTACT_FOLDER_LOOKUP_TIMEOUT_MS"));
    assert.ok(code.includes("error instanceof ShareFolderTimeout"));
    assert.ok(code.includes("reason: CONTACT_FOLDER_SLOW_REASON"));
  });

  test("🔴 던지지 않는다 — 밖으로 나가는 것은 status 뿐이고, 사유에 경로를 담지 않는다", () => {
    // 내보내는 함수는 다섯뿐이다 — 설정 읽기 · 찾기 · 만들기 · 꽂기(분류 폴더) ·
    // 꽂기(`DATA` — 조각 12). 🔴 **지우기 · 이름 바꾸기를 내보내지 않는다.**
    const exported = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(exported, [
      "copyIntoContactFolder",
      "copyIntoContactFolderDataFolder",
      "createContactFolder",
      "findContactFolder",
      "resolveContactFolderArchiveRoot",
    ]);

    // 네 가지 상태가 모두 있다.
    for (const status of ['status: "disabled"', 'status: "failed"']) {
      assert.ok(code.includes(status), status);
    }
    // fs 오류의 message 를 사유로 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(code.includes("String(error)"), false);
  });

  test("🔴 루트 값(.env)을 로그 · 결과에 싣지 않는다", () => {
    // 환경변수를 읽는 자리는 resolveContactFolderArchiveRoot 한 곳뿐이다.
    assert.equal(code.match(/process\.env/g)?.length, 1);
    assert.equal(code.match(/CONTACT_FOLDER_ARCHIVE_DIR/g)?.length, 1);
  });
});
