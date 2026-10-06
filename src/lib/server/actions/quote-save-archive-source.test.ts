import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * [저장]하면 그것만으로 견적서 엑셀이 공유폴더에 들어간다 — **끼운 자리**를 소스로 지킨다
 * ============================================================================
 * 2026-10-06. 실제 동작은 두 곳이 본다:
 *  · 덮어쓰기 자체 — lib/storage/quote-archive.test.ts (임시 폴더에서 파일을 세어 본다)
 *  · 저장 길 전체 — lib/server/services/quote-issue.integration.test.ts (시험 DB)
 *
 * 견적서 서버 액션(server/actions/quotes.ts)은 세션 · 권한 · DB 가 있어야 부를 수 있어
 * 여기서 직접 부르지 않는다. 이 파일이 보는 것은 **바뀌면 안 되는 자리**다(이웃
 * quote-archive-folder-source.test.ts 와 같은 규율이다):
 *
 *  · 🔴 **만들기와 고치기 둘 다**에 붙는다 — 고칠 때마다 마지막 판이 서류함에 있어야 한다
 *  · 🔴 **DB 트랜잭션 바깥**이다 — mutation 이 돌아온 **뒤**, 성공 분기 안
 *  · 🔴 **실패해도 견적서 저장은 되돌아가지 않는다** — 그 토막에 `return` 도 `throw` 도 없다
 *  · 🔴 **로그에 파일 이름 · 폴더 이름 · 경로 · 오류 message 가 없다**
 *  · 🔴 **덮어쓰기는 `QUOTE_FILE` 에만** — 결재본(`SIGNED_PDF`)은 한 글자도 바뀌지 않았다
 *    (사내 견적서 폴더의 파일 2,100 개 가운데 542 개가 사람이 올린 결재본이다)
 *  · 🔴 **지우기를 늘리지 않았다** — `unlink` 는 저장 모듈에 한 군데뿐이고 `rm` · `rename` 은 0
 *  · 🔴 **저장은 감사(EXCEL_EXPORT)를 남기지 않는다** — 그 기록의 뜻은 「받아 갔다」이다
 * ============================================================================
 */

const actionSource = readFileSync(new URL("./quotes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const serviceSource = readFileSync(
  new URL("../services/quote-issue.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const storageSource = readFileSync(
  new URL("../../storage/quote-archive.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const actions = stripComments(actionSource);
const service = stripComments(serviceSource);
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

function bodyOf(source: string, head: string): string {
  const index = source.indexOf(head);
  assert.ok(index >= 0, `${head} 가 없다`);
  return blockAt(source, index);
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const createBody = actions.slice(
  actions.indexOf("export async function createQuoteAction("),
  actions.indexOf("export async function updateQuoteAction(")
);
const updateBody = actions.slice(
  actions.indexOf("export async function updateQuoteAction("),
  actions.indexOf("export async function lookupIntakeForQuoteAction(")
);
/** 저장 뒤 엑셀을 남기는 **한 자리** — 두 액션이 함께 쓴다. */
const afterSaveBody = bodyOf(actions, "async function archiveDocumentAfterSave(");

describe("저장하면 견적서 엑셀이 공유폴더에 — 액션에 끼운 자리", () => {
  test("🔴 만들기와 고치기 **둘 다**에 붙었고, 쓰는 자리는 한 곳이다", () => {
    assert.ok(createBody.includes("await archiveDocumentAfterSave("), "만들기에 없다");
    assert.ok(updateBody.includes("await archiveDocumentAfterSave("), "🔴 고치기에 없다 — 고친 판이 서류함에 안 간다");
    // 선언 1 + 부르기 2. 세 번을 넘으면 규율이 두 벌로 갈라진 것이다.
    assert.equal(occurrences(actions, "archiveDocumentAfterSave"), 3, "부르는 자리가 둘이 아니다");
    // 액션은 견적서 id 와 행위자만 넘긴다 — 공유폴더 위치도 파일 이름도 모른다.
    assert.ok(createBody.includes("await archiveDocumentAfterSave(result.id, auth.actingUser.id);"));
    assert.ok(updateBody.includes("await archiveDocumentAfterSave(updated.id, auth.actingUser.id);"));
  });

  test("🔴 DB 트랜잭션 바깥이다 — mutation 이 돌아온 뒤, 성공 분기 안", () => {
    // 만들기 — createQuote 뒤, `if (result.ok)` 안.
    const created = createBody.indexOf("await createQuote({");
    const createdOk = createBody.indexOf("if (result.ok) {");
    assert.ok(created >= 0 && createdOk >= 0);
    assert.ok(created < createdOk, "mutation 이 성공 분기보다 뒤다");
    assert.ok(blockAt(createBody, createdOk).includes("await archiveDocumentAfterSave("), "🔴 성공 분기 밖이다");

    // 고치기 — updateQuote 뒤, `if (updated.ok)` 안. 🔴 실패한 저장에는 붙지 않는다.
    const updatedCall = updateBody.indexOf("await updateQuote({");
    const updatedOk = updateBody.indexOf("if (updated.ok) {");
    assert.ok(updatedCall >= 0 && updatedOk >= 0, "고치기의 성공 분기가 없다");
    assert.ok(updatedCall < updatedOk, "mutation 이 성공 분기보다 뒤다");
    assert.ok(blockAt(updateBody, updatedOk).includes("await archiveDocumentAfterSave("), "🔴 성공 분기 밖이다");
    assert.equal(occurrences(updateBody, "return updated;"), 1, "고치기의 끝이 하나가 아니다");

    // 액션은 트랜잭션을 열지 않는다 — 파일시스템 작업이 롤백되지 않기 때문이다.
    for (const forbidden of ["db.transaction", "node:fs", "mkdir", "writeFile"]) {
      assert.equal(actions.includes(forbidden), false, `견적서 액션에 ${forbidden} 가 생겼다`);
    }
  });

  test("🔴 실패해도 견적서 저장은 그대로다 — 그 토막에 return 도 throw 도 없다", () => {
    assert.ok(afterSaveBody.includes("try {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    assert.ok(afterSaveBody.includes("} catch (documentError) {"), "catch 가 없다");
    assert.equal(/\breturn\b/.test(afterSaveBody), false, "🔴 엑셀 때문에 저장 결과가 되돌아간다");
    assert.equal(/\bthrow\b/.test(afterSaveBody), false, "던지면 저장이 실패로 뒤집힌다");
    assert.equal(afterSaveBody.includes("ok: false"), false, "엑셀 때문에 저장을 실패로 적는다");
    // 부르는 쪽도 그 값을 보고 흐름을 바꾸지 않는다 — 돌려주는 것이 없다.
    assert.ok(afterSaveBody.includes("Promise<void>") === false, "본문 안이 아니다");
    assert.ok(actions.includes("async function archiveDocumentAfterSave(quoteId: string, actorUserId: string): Promise<void> {"));
  });

  test("🔴 로그에 파일 이름 · 폴더 이름 · 경로 · 오류 message 가 없다", () => {
    const logs = afterSaveBody.slice(afterSaveBody.indexOf("console.error("));
    assert.ok(logs.includes("console.error("), "실패를 아무도 모르게 지나간다");
    assert.ok(logs.includes("quoteId,"), "어느 견적서인지 적지 않는다");
    assert.ok(logs.includes("reason: archived.reason,"), "사유 코드를 적지 않는다");
    for (const forbidden of [
      "QUOTE_ARCHIVE_DIR",
      "relativePath",
      "fileName",
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
    assert.equal(logs.includes("documentError.message"), false, "오류 message 를 로그에 적는다");
    assert.equal(logs.includes("String(documentError)"), false, "오류를 통째로 글자로 만든다");
    assert.equal(/console\.error\([^;]*,\s*documentError\s*\)/.test(logs), false, "오류 객체를 통째로 찍는다");
    // 건너뛴 장(엑셀 전용 · 앱 양식이 없는 종류)은 정상이라 시끄럽게 굴지 않는다.
    assert.ok(afterSaveBody.includes('archived.status === "failed"'), "실패만 적는 가름이 없다");
  });

  test("🔴 액션은 엑셀을 제 손으로 만들지도 꽂지도 않는다 — services 한 자리를 거친다", () => {
    assert.ok(
      actions.includes('import { archiveQuoteDocumentOnSave } from "@/lib/server/services/quote-issue";'),
      "services 에서 가져오는 것이 바뀌었다"
    );
    for (const forbidden of [
      "saveToQuoteArchive",
      "resolveQuoteArchiveRoot",
      "renderQuoteWorkbook",
      "getAttachmentStorage",
      "createAttachmentRecord",
      "recordQuoteExport",
      "quoteArchiveFileName",
    ]) {
      assert.equal(actions.includes(forbidden), false, `액션이 ${forbidden} 를 직접 쓴다`);
    }
  });
});

/*
 * ============================================================================
 * storage 쪽 — 🔴 **덮어쓰기는 `QUOTE_FILE` 에만**
 * ============================================================================
 * 결재본(`SIGNED_PDF`)은 사람이 올린 원본이고 앱이 다시 만들 수 없다. 덮어쓰기를 함수
 * 전체에 켜면 사내 폴더의 결재본 542 장이 전부 덮어쓰기 대상이 된다 — 그 가름을 글자로
 * 못 박는다. 동작은 lib/storage/quote-archive.test.ts 가 임시 폴더에서 본다.
 * ============================================================================
 */

const writeArchiveFileBody = bodyOf(storage, "function writeArchiveFile(");
const overwriteFileBody = bodyOf(storage, "async function overwriteFile(");
const writeNewFileBody = bodyOf(storage, "async function writeNewFile(");
const writeAndCloseBody = bodyOf(storage, "async function writeAndClose(");

describe("덮어쓰기는 견적서 엑셀에만 — 결재본은 지금 그대로", () => {
  test("🔴 종류로 가른다 — `QUOTE_FILE` 만 덮어쓰고 나머지는 예전 길을 탄다", () => {
    assert.ok(writeArchiveFileBody.includes('fileKind === "QUOTE_FILE"'), "가름이 없다");
    assert.ok(writeArchiveFileBody.includes("overwriteFile("), "덮어쓰는 길이 없다");
    assert.ok(writeArchiveFileBody.includes("writeNewFile("), "🔴 예전 길이 사라졌다");
    // 쓰기를 부르는 자리는 하나다 — 저장 길이 둘로 갈라지면 반드시 어긋난다.
    assert.equal(occurrences(storage, "await writeArchiveFile("), 1, "쓰기를 부르는 자리가 하나가 아니다");
  });

  test("🔴 결재본이 타는 길(writeNewFile)은 `wx` 로만 연다 — 덮어쓰기 모드가 없다", () => {
    assert.ok(writeNewFileBody.includes('await open(target, "wx")'), "wx 가 사라졌다");
    assert.equal(writeNewFileBody.includes('"w")'), false, "🔴 결재본 길에 덮어쓰기 모드가 들어왔다");
    // 번호 비켜가기와 상한은 그대로다.
    assert.ok(writeNewFileBody.includes("numberedQuoteArchiveName(fileName, n)"), "번호 비켜가기가 사라졌다");
    assert.ok(writeNewFileBody.includes("QUOTE_ARCHIVE_MAX_NUMBERED_COPIES"), "상한이 사라졌다");
    assert.ok(writeNewFileBody.includes('errorCode(error) === "EEXIST"'), "EEXIST 로 다음 번호로 가지 않는다");
  });

  test("🔴 덮어쓰는 길은 번호를 붙이지 않는다 — 이미 쌓인 ` (2)` 를 열지도 않는다", () => {
    assert.ok(overwriteFileBody.includes('await open(target, "w")'), "덮어쓰기 모드가 없다");
    assert.equal(
      overwriteFileBody.includes("numberedQuoteArchiveName"),
      false,
      "🔴 덮어쓰는 길이 번호 붙은 이름을 만든다"
    );
    assert.equal(
      overwriteFileBody.includes("QUOTE_ARCHIVE_MAX_NUMBERED_COPIES"),
      false,
      "덮어쓰는 길이 상한을 본다"
    );
    // 경로가 루트 밖을 가리키면 쓰지 않는다 — 예전 길과 같은 관문을 지난다.
    assert.ok(overwriteFileBody.includes("assertInsideRoot(root, target)"), "🔴 루트 밖 검사를 건너뛴다");
  });

  test("🔴 지우기를 늘리지 않았다 — `unlink` 는 한 군데, `rm` · `rename` 은 0", () => {
    assert.equal(occurrences(storage, "unlink("), 1, "🔴 지우는 자리가 늘었다");
    assert.ok(writeAndCloseBody.includes("await unlink(target)"), "지우는 자리가 writeAndClose 가 아니다");
    // 🔴 이번에 만든 파일일 때만 치운다 — 이미 있던 파일은 덮어쓸 뿐 지우지 않는다.
    assert.ok(writeAndCloseBody.includes("if (created) await unlink(target)"), "🔴 이미 있던 파일까지 지운다");
    assert.equal(overwriteFileBody.includes("unlink"), false, "덮어쓰는 길이 제 손으로 지운다");
    for (const forbidden of ["rm(", "rmdir(", "rename(", "unlinkSync", "truncate("]) {
      assert.equal(storage.includes(forbidden), false, `저장 모듈에 ${forbidden} 가 생겼다`);
    }
  });

  test("🔴 「내용이 같으면 안 쓴다」가 그대로다 — 덮어쓰기는 내용이 다를 때만 일어난다", () => {
    const saveBody = bodyOf(storage, "async function save(");
    assert.ok(saveBody.includes("await findSameContentFile("), "🔴 같은 내용 건너뛰기가 사라졌다");
    assert.ok(saveBody.includes('status: "unchanged"'), "unchanged 가 사라졌다");
    // 같은 내용 검사가 **쓰기보다 앞**이다 — 뒤로 가면 매번 덮어쓴다.
    assert.ok(
      saveBody.indexOf("await findSameContentFile(") < saveBody.indexOf("await writeArchiveFile("),
      "🔴 같은 내용을 보기 전에 쓴다"
    );
  });
});

/*
 * ============================================================================
 * services 쪽 — 받기와 **같은 도우미**, 바이트도 감사도 없다
 * ============================================================================
 */

const onSaveBody = bodyOf(service, "export async function archiveQuoteDocumentOnSave(");

describe("저장에 딸린 길 — 받기와 같은 도우미를 지난다", () => {
  test("🔴 받기의 ①②③ 도우미를 그대로 쓴다 — 두 벌로 짜지 않았다", () => {
    for (const helper of ["await renderQuoteWorkbook(quote)", "await copyToArchive({", "await placeInExcelSlot({"]) {
      assert.ok(onSaveBody.includes(helper), `${helper} 를 지나지 않는다`);
    }
    // 🔴 공유폴더에 쓰는 것은 견적서 엑셀뿐이다 — 결재본 종류로 쓰지 않는다.
    assert.ok(onSaveBody.includes('fileKind: "QUOTE_FILE"'), "견적서 엑셀로 쓰지 않는다");
    assert.equal(onSaveBody.includes("SIGNED_PDF"), false, "🔴 저장 길이 결재본을 건드린다");
  });

  test("🔴 저장은 감사(EXCEL_EXPORT)를 남기지 않는다 — 받기 쪽 둘은 그대로다", () => {
    assert.equal(onSaveBody.includes("recordQuoteExport"), false, "🔴 저장마다 받기 감사가 쌓인다");
    // 가져오기 1 + 받기 갈래 둘 = 3. 줄면 받기의 감사가 사라진 것이다.
    assert.equal(occurrences(service, "recordQuoteExport"), 3, "🔴 [견적서 받기] 의 감사가 바뀌었다");
  });

  test("🔴 바이트를 돌려주지 않는다 — 저장은 받을 곳이 없다", () => {
    assert.equal(onSaveBody.includes("bytes: workbook,\n      fileName"), false);
    assert.equal(/\bok:\s*true\b/.test(onSaveBody), false, "받기의 응답 모양을 흉내 낸다");
    assert.equal(onSaveBody.includes("contentType"), false, "내려받기용 값을 만든다");
  });

  test("🔴 만들 수 없는 장은 조용히 건너뛴다 — 오류가 아니다", () => {
    assert.ok(onSaveBody.includes("quote.isExcelOnly"), "엑셀 전용 장을 가리지 않는다");
    assert.ok(onSaveBody.includes("canRenderQuoteDocument(quote)"), "앱 양식이 없는 종류를 가리지 않는다");
    assert.ok(onSaveBody.includes('status: "skipped", reason: "EXCEL_ONLY"'), "엑셀 전용이 skipped 가 아니다");
    assert.ok(onSaveBody.includes('status: "skipped", reason: "KIND_NOT_SUPPORTED"'), "종류가 skipped 가 아니다");
    // 🔴 엑셀 전용을 **먼저** 본다 — canRenderQuoteDocument 는 엑셀 전용이면 늘 참이다.
    assert.ok(
      onSaveBody.indexOf("quote.isExcelOnly") < onSaveBody.indexOf("canRenderQuoteDocument(quote)"),
      "🔴 엑셀 전용 장이 앱 양식 길로 샌다"
    );
  });

  test("🔴 던지지 않는다 — 모든 끝이 값이다 · 사유에 경로가 없다", () => {
    assert.equal(/\bthrow\b/.test(onSaveBody), false, "🔴 던지면 견적서 저장이 뒤집힌다");
    assert.ok(onSaveBody.includes("} catch (error) {"), "바깥 catch 가 없다");
    assert.ok(onSaveBody.includes('reason: "UNEXPECTED"'), "예상 밖을 값으로 바꾸지 않는다");
    // 로그는 견적서 id 와 코드뿐이다.
    assert.equal(/console\.error\([^;]*\.message/.test(onSaveBody), false, "오류 message 를 로그에 적는다");
    assert.equal(onSaveBody.includes("relativePath"), false, "로그 · 사유에 경로가 섞인다");
  });

  test("🔴 설정이 비면 공유폴더 쪽은 디스크를 보기 전에 끝난다", () => {
    assert.ok(onSaveBody.includes("input.archiveRoot === undefined ? resolveQuoteArchiveRoot() : input.archiveRoot"));
    // 🔴 blockAt 을 쓰지 않는다 — 이 함수는 인자 타입이 `params: {` 로 시작해 괄호 짝이
    //    몸통이 아니라 그 타입을 집는다. 다음 함수가 시작되기 전까지를 자른다.
    const copyBody = service.slice(
      service.indexOf("async function copyToArchive("),
      service.indexOf("function archiveNamingOf(")
    );
    const guard = copyBody.indexOf('return { status: "disabled" };');
    const work = copyBody.indexOf("await saveToQuoteArchive(");
    assert.ok(guard >= 0, "꺼졌을 때의 길이 없다");
    assert.ok(guard < work, "🔴 설정을 보기 전에 디스크를 건드린다");
  });

  test("🔴 [견적서 받기](issueQuoteFile)의 길은 그대로다", () => {
    const issueBody = bodyOf(service, "export async function issueQuoteFile(");
    assert.ok(issueBody.includes("canRenderQuoteDocument(quote)"), "받기의 관문이 사라졌다");
    assert.ok(
      issueBody.includes("quote.isExcelOnly ? issueAttachedExcel(quote, input) : issueRenderedWorkbook(quote, input)"),
      "받기의 갈래가 바뀌었다"
    );
    const rendered = bodyOf(service, "async function issueRenderedWorkbook(");
    for (const line of [
      "await renderQuoteWorkbook(quote)",
      "await copyToArchive({",
      "await placeInExcelSlot({",
      "await recordQuoteExport({",
      "bytes: workbook,",
    ]) {
      assert.ok(rendered.includes(line), `받기에서 ${line} 가 사라졌다`);
    }
  });
});
