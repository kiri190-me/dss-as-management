import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 새 견적서를 저장할 때 공유폴더 폴더 만들기 — **끼운 자리**를 소스로 지킨다 (2026-10-06)
 * ============================================================================
 * 견적서 서버 액션(server/actions/quotes.ts)은 세션 · 권한 · DB 가 있어야 부를 수 있어
 * 여기서 직접 부르지 않는다. 폴더를 만드는 일 자체(루트를 안 만들기 · 본 번호로 먼저 찾기 ·
 * 파일을 한 자도 안 쓰기)는 lib/storage/quote-archive-create-folder.test.ts 가 임시
 * 폴더에서 보고, 이름 규칙은 lib/domain/quote-archive-naming.test.ts 가 본다.
 *
 * 이 파일이 보는 것은 **바뀌면 안 되는 자리**다(접수 때 연락서 폴더를 만드는
 * services/create-contact-folder-source.test.ts 와 같은 규율이다):
 *
 *  · 🔴 **DB 트랜잭션 바깥**이다 — mutation 이 돌아온 **뒤**, `if (result.ok)` 블록 안
 *  · 🔴 **폴더를 못 만들어도 견적서 저장은 성공이다** — 그 토막에 `return` 도 `throw` 도 없고
 *    끝은 늘 `return result;` 하나다
 *  · 🔴 **고치기(updateQuoteAction)에는 붙지 않는다** — 이번 범위는 만들기뿐이다
 *  · 🔴 **로그에 폴더 이름 · 경로 · 오류 message 가 없다**
 *  · 🔴 폴더 만들기는 **storage 한 자리**를 거친다 — 액션이 제 손으로 mkdir 하지 않는다
 *  · 🔴 그 자리가 **파일을 쓰지 않는다** — 저장(saveToQuoteArchive)의 쓰기 길을 타지 않는다
 * ============================================================================
 */

const actionSource = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const storageSource = readFileSync(
  new URL("../../storage/quote-archive.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const actions = stripComments(actionSource);
const storage = stripComments(storageSource);

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

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const folderCallIndex = actions.indexOf("await createQuoteArchiveFolder({");
/** 만들기 액션 하나 — 고치기 액션이 시작되기 전까지. */
const createBody = actions.slice(
  actions.indexOf("export async function createQuoteAction("),
  actions.indexOf("export async function updateQuoteAction(")
);
/** 고치기 액션 하나 — 조회 액션이 시작되기 전까지. */
const updateBody = actions.slice(
  actions.indexOf("export async function updateQuoteAction("),
  actions.indexOf("export async function lookupIntakeForQuoteAction(")
);
/** 저장이 확정된 뒤의 후처리가 모두 들어 있는 블록. */
const okBlock = blockAt(actions, actions.indexOf("if (result.ok) {"));

describe("새 견적서를 저장할 때 공유폴더 폴더 — 끼운 자리", () => {
  test("🔴 DB 트랜잭션 바깥이다 — mutation 이 돌아온 뒤, `if (result.ok)` 블록 안", () => {
    assert.ok(folderCallIndex >= 0, "폴더를 만드는 자리가 없다");
    const mutation = actions.indexOf("await createQuote({");
    const ok = actions.indexOf("if (result.ok) {");
    assert.ok(mutation >= 0 && ok >= 0);
    assert.ok(mutation < ok, "mutation 이 성공 분기보다 뒤다");
    assert.ok(ok < folderCallIndex, "🔴 폴더 만들기가 성공 분기보다 앞이다");
    assert.ok(okBlock.includes("await createQuoteArchiveFolder({"), "🔴 성공 분기 밖에서 폴더를 만든다");
    // 액션은 트랜잭션을 열지 않는다 — 파일시스템 작업이 롤백되지 않기 때문이다.
    for (const forbidden of ["db.transaction", "tx.", "node:fs", "mkdir", "writeFile"]) {
      assert.equal(actions.includes(forbidden), false, `견적서 액션에 ${forbidden} 가 생겼다`);
    }
    // 폴더 만들기를 mutation 의 인자로 넘기지 않는다(트랜잭션 안으로 들어가는 유일한 길).
    assert.equal(
      actions.slice(actions.indexOf("await createQuote({"), ok).includes("ArchiveFolder"),
      false,
      "🔴 폴더 만들기가 mutation 인자로 들어갔다"
    );
  });

  test("🔴 폴더를 못 만들어도 견적서 저장은 성공이다 — 그 토막에 return 도 throw 도 없다", () => {
    assert.ok(okBlock.includes("try {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    assert.ok(okBlock.includes("} catch (folderError) {"), "catch 가 없다");
    assert.equal(/\breturn\b/.test(okBlock), false, "🔴 폴더 때문에 저장 결과가 되돌아간다");
    assert.equal(/\bthrow\b/.test(okBlock), false, "던지면 저장이 실패로 뒤집힌다");
    assert.equal(okBlock.includes("ok: false"), false, "폴더 때문에 저장을 실패로 적는다");
    // 끝은 늘 하나다 — 폴더 결과와 상관없이 mutation 의 결과를 그대로 돌려준다.
    assert.ok(createBody.slice(createBody.indexOf("if (result.ok) {")).includes("return result;"));
    assert.equal(occurrences(createBody, "return result;"), 1, "저장 결과를 돌려주는 자리가 둘 이상이다");
    // DB 오류 쪽 catch 는 그대로다 — 폴더 때문에 생긴 catch 와 섞이지 않았다.
    assert.ok(createBody.includes('console.error("createQuoteAction: unexpected DB error", err);'));
    assert.ok(createBody.includes('code: "DATABASE_UNAVAILABLE"'), "DB 오류 처리가 사라졌다");
  });

  test("🔴 고치기에는 붙지 않는다 — 폴더를 만드는 자리는 만들기 액션 하나뿐이다", () => {
    assert.equal(occurrences(actions, "createQuoteArchiveFolder"), 2, "가져오기 + 부르기 둘이 아니다");
    assert.ok(createBody.includes("await createQuoteArchiveFolder({"), "만들기 액션에 없다");
    assert.equal(updateBody.includes("createQuoteArchiveFolder"), false, "🔴 고치기에도 붙었다");
    // 지우기 · 되살리기 · 완전 삭제 쪽도 건드리지 않았다.
    const trash = actions.slice(actions.indexOf("export async function deleteQuoteAction("));
    assert.equal(trash.includes("createQuoteArchiveFolder"), false, "휴지통 쪽에도 붙었다");
  });

  test("🔴 로그에 폴더 이름 · 경로 · 오류 message 가 없다 — 견적서 id 와 상태 코드뿐이다", () => {
    const logs = okBlock.slice(okBlock.indexOf("console.error("));
    assert.ok(logs.includes("console.error("), "실패를 아무도 모르게 지나간다");
    assert.ok(logs.includes("quoteId: result.id,"), "어느 견적서인지 적지 않는다");
    assert.ok(logs.includes("status: folder.status,"), "상태 코드를 적지 않는다");
    for (const forbidden of [
      "QUOTE_ARCHIVE_DIR",
      "relativePath",
      "folderName",
      "uncPath",
      "root",
      "customerName",
      "serialNumber",
      "faultDescription",
      "naming",
    ]) {
      assert.equal(logs.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    assert.equal(logs.includes("folderError.message"), false, "오류 message 를 로그에 적는다");
    assert.equal(logs.includes("String(folderError)"), false, "오류를 통째로 글자로 만든다");
    assert.equal(/console\.error\([^;]*,\s*folderError\s*\)/.test(logs), false, "오류 객체를 통째로 찍는다");
    // 정상 상태 셋은 조용히 지나간다.
    for (const quiet of ['folder.status !== "created"', 'folder.status !== "found"', 'folder.status !== "disabled"']) {
      assert.ok(okBlock.includes(quiet), `정상 상태를 가리지 않는다: ${quiet}`);
    }
  });

  test("🔴 폴더를 만드는 규율은 storage 한 자리뿐 — 액션은 이름도 짓지 않는다", () => {
    assert.ok(
      actions.includes('import { createQuoteArchiveFolder } from "@/lib/storage/quote-archive";'),
      "storage 에서 가져오는 것이 바뀌었다"
    );
    // 액션이 폴더 · 파일 이름을 제 손으로 짓지 않는다 — 재료만 넘긴다.
    for (const forbidden of [
      "quoteArchiveFolderName",
      "quoteArchiveYearFolderName",
      "quoteArchiveFileName",
      "saveToQuoteArchive",
      "resolveQuoteArchiveRoot",
    ]) {
      assert.equal(actions.includes(forbidden), false, `액션이 ${forbidden} 를 직접 쓴다`);
    }
    // 이름 재료는 한 자리에서 모은다 — 🔴 꼬리가 되는 신고증상이 빠지면 안 된다.
    const naming = blockAt(actions, actions.indexOf("function archiveNamingOfFields("));
    for (const field of [
      "quoteNumber: fields.quoteNumber,",
      "kind: fields.kind,",
      "customerName: fields.customerNameText,",
      "modelName: fields.modelNameText,",
      "lotNumber: fields.lotNumberText,",
      "serialNumber: fields.serialNumberText,",
      "faultDescription: fields.faultDescriptionText,",
    ]) {
      assert.ok(naming.includes(field), `이름 재료에 ${field} 가 없다`);
    }
    assert.ok(okBlock.includes("naming: archiveNamingOfFields(validation.data),"), "재료를 다른 데서 모은다");
    assert.ok(okBlock.includes("quoteDate: validation.data.quoteDate,"), "연도 폴더를 정할 발행일자가 없다");
  });
});

/*
 * ============================================================================
 * storage 쪽 — **폴더만 만든다**(파일을 쓰지 않는다)
 * ============================================================================
 * 실제 동작은 lib/storage/quote-archive-create-folder.test.ts 가 임시 폴더에서 본다.
 * 여기서는 그 함수가 **저장(파일 쓰기)의 길을 타지 않는다**는 것을 원본 글자로 지킨다 —
 * 같은 모듈 안에 파일을 쓰는 함수들이 있어서, 한 줄만 섞여 들어와도 조용히 깨진다.
 * ============================================================================
 */

/** 폴더만 만드는 함수의 몸통 — 그 다음 도우미가 시작되기 전까지. */
const makeFolderBody = storage.slice(
  storage.indexOf("async function makeFolder("),
  storage.indexOf("function requireExistingRoot(")
);
const createFolderBody = blockAt(storage, storage.indexOf("export async function createQuoteArchiveFolder("));

describe("폴더만 만드는 길 — 파일을 쓰지 않는다", () => {
  test("🔴 파일을 쓰는 길을 한 줄도 타지 않는다", () => {
    assert.ok(makeFolderBody.length > 0, "폴더만 만드는 함수가 없다");
    for (const forbidden of [
      "writeNewFile",
      "findSameContentFile",
      "hasSameBytes",
      "open(",
      "writeFile",
      "unlink",
      "rm(",
      "rename(",
      "bytes",
      "numberedQuoteArchiveName",
      "quoteArchiveFileName",
      "quoteArchiveSignedPdfFileName",
    ]) {
      assert.equal(makeFolderBody.includes(forbidden), false, `폴더만 만드는 길에 ${forbidden} 가 들어왔다`);
      assert.equal(createFolderBody.includes(forbidden), false, `들머리에 ${forbidden} 가 들어왔다`);
    }
  });

  test("🔴 폴더를 만드는 코드는 저장과 **한 벌**이다 — 새로 짜지 않았다", () => {
    // mkdir 을 직접 부르지 않고 저장이 쓰는 도우미를 그대로 쓴다.
    assert.equal(occurrences(makeFolderBody, "findOrCreateFolder("), 2, "연도 폴더 · 견적서 폴더 둘이 아니다");
    assert.equal(makeFolderBody.includes("mkdir("), false, "🔴 mkdir 을 직접 부른다(두 벌이 됐다)");
    // 🔴 루트를 만들지 않는다 — 저장과 같은 관문을 지난다.
    assert.ok(makeFolderBody.includes("await requireExistingRoot("), "🔴 루트 관문을 건너뛴다");
    // 🔴 찾기는 본 번호로 한다(꼬리를 보지 않는다) — 기존 폴더를 그대로 쓴다.
    assert.ok(makeFolderBody.includes("matchesQuoteArchiveFolder(name, input.naming.quoteNumber)"), "찾기 규칙이 바뀌었다");
    assert.ok(makeFolderBody.includes("isQuoteArchiveYearFolder(name, year)"), "연도 폴더 찾기가 바뀌었다");
  });

  test("🔴 던지지 않는다 — 설정이 비면 디스크를 보기 전에 `disabled` 로 끝난다", () => {
    assert.equal(/\bthrow\b/.test(createFolderBody), false, "들머리가 던진다");
    const guard = createFolderBody.indexOf('return { status: "disabled" };');
    const work = createFolderBody.indexOf("await makeFolder(");
    assert.ok(guard >= 0, "설정이 비었을 때의 길이 없다");
    assert.ok(guard < work, "🔴 설정을 보기 전에 디스크를 건드린다");
    // 사유는 늘 모듈이 정한 짧은 문장이다 — fs 오류의 message 를 쓰지 않는다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(makeFolderBody), false, "오류 message 를 사유로 썼다");
    assert.equal(createFolderBody.includes("String(error)"), false, "오류를 통째로 사유에 담는다");
  });
});
