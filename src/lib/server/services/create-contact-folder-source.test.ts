import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 접수 때 연락서 폴더 만들기 — **끼운 자리**를 소스로 지킨다 (연락서 조각 7)
 * ============================================================================
 * 접수 서비스(services/create-repair-case.ts)는 세션 · DB · 워크플로가 있어야 부를 수
 * 있어 여기서 직접 부르지 않는다(실제 동작은 create-contact-folder.integration.test.ts 가
 * 시험 DB 와 mkdtemp 임시 폴더에서 본다). 이 파일이 보는 것은 **바뀌면 안 되는 자리**다:
 *
 *  · 🔴 **EXCEL_IMPORT 에서는 돌지 않는다** — 부르는 자리가 `INTERACTIVE` 문 안에 하나뿐
 *  · 🔴 **DB 트랜잭션 바깥**이다 — `if (result.ok)` 블록 안, mutation 이 돌아온 **뒤**
 *  · 🔴 **접수 결과를 뒤집지 않는다** — 그 토막에 `return` 도 `throw` 도 없다
 *  · 🔴 **메일과 서로 모른다** — try 가 따로다. 하나가 실패해도 다른 하나는 돈다
 *  · 🔴 **로그에 경로 · 루트 · 폴더 이름이 없다**
 *  · 🔴 **「인수번호로 먼저 찾기」를 건너뛰지 않는다** — 만들기는 storage 한 자리에만 있다
 *  · 감사 기록은 **이번에 만들었을 때만** 남긴다
 *
 * 폴더를 만드는 일 자체(인수번호로 먼저 찾기 · 루트를 안 만들기)는
 * lib/storage/contact-folder-create.test.ts 가, 지우기 금지는
 * lib/storage/contact-folder-archive-source.test.ts 가 원본으로 본다.
 * ============================================================================
 */

const intakeSource = readFileSync(new URL("./create-repair-case.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const folderSource = readFileSync(new URL("./create-contact-folder.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const intake = stripComments(intakeSource);
const folder = stripComments(folderSource);

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

const INTERACTIVE_GUARD = 'if (input.logContext === "INTERACTIVE") {';

const folderCallIndex = intake.indexOf("await createContactFolderForIntake(");
const mailCallIndex = intake.indexOf("await sendIntakeNotificationMail(");
/** 연락서 폴더를 부르는 토막 — 그것을 감싼 `INTERACTIVE` 문 하나. */
const folderBlock = blockAt(intake, intake.lastIndexOf(INTERACTIVE_GUARD, folderCallIndex));
/** 메일 토막 — 건드리지 않았음을 보기 위해서만 쓴다. */
const mailBlock = blockAt(intake, intake.lastIndexOf(INTERACTIVE_GUARD, mailCallIndex));
/** 접수가 확정된 뒤의 후처리가 모두 들어 있는 블록. */
const okBlock = blockAt(intake, intake.indexOf("if (result.ok) {"));

describe("접수 때 연락서 폴더 — 끼운 자리", () => {
  test("🔴 EXCEL_IMPORT 에서는 돌지 않는다 — 부르는 자리가 INTERACTIVE 문 안에 하나뿐이다", () => {
    assert.ok(folderCallIndex >= 0, "연락서 폴더를 부르는 자리가 없다");
    assert.equal(occurrences(intake, "createContactFolderForIntake("), 1, "부르는 자리가 둘 이상이다");
    assert.ok(folderBlock.includes("await createContactFolderForIntake("), "INTERACTIVE 문 밖에서 부른다");
    assert.equal(folderBlock.includes("EXCEL_IMPORT"), false, "이관에서도 도는 길이 생겼다");
    // 이관 경로가 이 토막에 닿지 않는다는 것을 한 번 더 — 문의 조건이 그 글자 그대로다.
    assert.ok(intake.lastIndexOf(INTERACTIVE_GUARD, folderCallIndex) >= 0);
  });

  test("🔴 DB 트랜잭션 바깥이다 — mutation 이 돌아온 뒤, `if (result.ok)` 블록 안", () => {
    const mutation = intake.indexOf("await createRepairCase(");
    const ok = intake.indexOf("if (result.ok) {");
    assert.ok(mutation >= 0 && ok >= 0);
    assert.ok(mutation < ok, "접수 mutation 이 성공 분기보다 뒤다");
    assert.ok(ok < folderCallIndex, "🔴 폴더 만들기가 성공 분기보다 앞이다");
    assert.ok(okBlock.includes("await createContactFolderForIntake("), "🔴 성공 분기 밖에서 폴더를 만든다");
    // 이 서비스는 트랜잭션을 열지 않는다 — 파일시스템 작업이 롤백되지 않기 때문이다.
    for (const forbidden of ["db.transaction", "tx.", "node:fs", "mkdir"]) {
      assert.equal(intake.includes(forbidden), false, `접수 서비스에 ${forbidden} 가 생겼다`);
    }
    assert.equal(folder.includes("db.transaction"), false, "후처리 모듈이 트랜잭션을 연다");
    // 폴더 만들기를 mutation 의 인자로 넘기지 않는다(트랜잭션 안으로 들어가는 유일한 길).
    assert.equal(
      intake.slice(intake.indexOf("await createRepairCase("), ok).includes("ContactFolder"),
      false,
      "🔴 폴더 만들기가 mutation 인자로 들어갔다"
    );
  });

  test("🔴 폴더를 못 만들어도 접수는 성공이다 — 그 토막에 return 도 throw 도 없다", () => {
    assert.ok(folderBlock.includes("try {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    assert.ok(folderBlock.includes("} catch (folderError) {"), "catch 가 없다");
    assert.equal(/\breturn\b/.test(folderBlock), false, "🔴 폴더 때문에 접수가 되돌아간다");
    assert.equal(/\bthrow\b/.test(folderBlock), false, "던지면 접수가 실패로 뒤집힌다");
    assert.equal(folderBlock.includes("ok: false"), false, "폴더 때문에 접수를 실패로 적는다");
    assert.equal(folderBlock.includes("markIdempotencyKeyFailed"), false, "폴더 때문에 멱등 키를 실패로 적는다");
    // 성공 분기 전체에 빠져나가는 길이 없다 — 끝은 늘 아래의 `return result;` 하나다.
    assert.equal(/\breturn\b/.test(okBlock), false, "성공 분기에서 먼저 빠져나가는 길이 생겼다");
    assert.ok(intake.slice(folderCallIndex).includes("return result;"), "접수 결과를 그대로 돌려주지 않는다");
  });

  test("🔴 메일과 서로 모른다 — 하나가 실패해도 다른 하나는 돈다", () => {
    assert.ok(intake.includes("await sendIntakeNotificationMail({ repairCaseId: result.id });"), "메일 호출이 바뀌었다");
    assert.equal(mailBlock.includes("createContactFolderForIntake"), false, "메일 토막 안에서 폴더를 만든다");
    assert.equal(folderBlock.includes("sendIntakeNotificationMail"), false, "폴더 토막이 메일을 안다");
    assert.ok(mailCallIndex < folderCallIndex, "메일보다 앞으로 끼어들었다");
    // try 가 둘이다 — 하나의 catch 가 둘을 함께 삼키면 「서로 모른다」가 깨진다.
    assert.ok(mailBlock.includes("} catch (mailError) {"), "메일 쪽 catch 가 바뀌었다");
  });

  test("🔴 로그에 경로 · 루트 · 폴더 이름이 없다 — 사유 코드와 수리 건 id 뿐이다", () => {
    assert.ok(folderBlock.includes("console.error("), "실패를 아무도 모르게 지나간다");
    for (const forbidden of ["CONTACT_FOLDER_ARCHIVE_DIR", "folderName", "uncPath", "relativePath", "root"]) {
      assert.equal(folderBlock.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    // 잡은 오류의 message 를 적지 않는다 — fs 오류에는 경로가 들어 있다.
    assert.equal(folderBlock.includes("folderError.message"), false, "오류 message 를 로그에 적는다");
    assert.equal(folderBlock.includes("String(folderError)"), false, "오류를 통째로 글자로 만든다");
    assert.equal(/console\.error\([^;]*,\s*folderError\s*\)/.test(folderBlock), false, "오류 객체를 통째로 찍는다");
    // 후처리 모듈은 스스로 로그를 남기지 않는다 — 부르는 쪽이 한 자리에서 적는다.
    assert.equal(folder.includes("console."), false, "후처리 모듈이 로그를 찍는다");
    // 모듈이 돌려주는 사유도 늘 모듈이 정한 상수다(fs 오류 message 가 아니다).
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(folder), false, "오류 message 를 사유로 썼다");
    assert.equal(folder.includes("String(error)"), false, "오류를 통째로 사유에 담는다");
  });

  test("🔴 「먼저 찾기」를 건너뛰지 않는다 — 만들기 규율은 storage 한 자리뿐이다", () => {
    // 폴더를 만드는 길은 storage 의 createContactFolder 하나다.
    assert.ok(folder.includes("await createContactFolder({"), "storage 를 거치지 않는다");
    // 🔴 인수번호가 같은 폴더가 여럿이면 만들지 않는다 — 그 결과를 받아 넘긴다.
    assert.ok(folder.includes('created.status === "multiple"'), "🔴 여럿 결과를 받지 않는다");
    assert.ok(folder.includes('created.status === "found"'), "🔴 이미 있다는 결과를 받지 않는다");
    // 판정을 다시 짜지 않는다 — 다시 짜는 순간 두 벌이 되어 갈라진다.
    for (const forbidden of ["node:fs", "mkdir", "readdir", "pickContactFolder"]) {
      assert.equal(folder.includes(forbidden), false, `후처리 모듈이 ${forbidden} 를 직접 쓴다`);
    }
    // 🔴 걷어낸 S/N 훑기의 자취가 없다(조각 8) — 되살리지 말 것.
    for (const gone of ["pickSimilarContactFolders", "contactFolderSerialKey", "candidates"]) {
      assert.equal(folder.includes(gone), false, `걷어낸 것이 남아 있다: ${gone}`);
    }
    // storage 에서 가져오는 것은 둘뿐이다(만들기 · 루트 읽기) — 파일을 쓰지 않는다.
    assert.ok(
      folder.includes(
        'import { createContactFolder, resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";'
      ),
      "storage 에서 가져오는 것이 바뀌었다"
    );
    assert.equal(folder.includes("copyIntoContactFolder"), false, "🔴 올리기 쪽 일(파일 꽂기)을 가져왔다");
    assert.equal(folder.includes("writeFile"), false, "🔴 파일을 쓴다");
    // 지우기는 여전히 한 글자도 없다.
    for (const forbidden of ["unlink", "rmdir", "rm(", "rename("]) {
      assert.equal(folder.includes(forbidden), false, `🔴 지우기(${forbidden})가 생겼다`);
    }
  });

  test("🔴 설정이 비면 아무 일도 하지 않는다 — DB 도 디스크도 보지 않는다", () => {
    const guard = folder.indexOf("resolveContactFolderArchiveRoot()");
    const query = folder.indexOf("getRepairCaseContactFolderNamingById(");
    const create = folder.indexOf("await createContactFolder({");
    assert.ok(guard >= 0, "설정 확인이 없다");
    assert.ok(guard < query, "설정을 보기 전에 DB 를 읽는다");
    assert.ok(guard < create, "설정을 보기 전에 디스크를 건드린다");
    assert.ok(folder.slice(guard).includes('return { status: "disabled" };'), "꺼져 있어도 무언가 한다");
  });

  test("감사 기록은 **이번에 만들었을 때만** 남긴다 — 조각 5 와 같은 모양", () => {
    assert.ok(folder.includes('from "@/lib/db/mutations/contact-folders"'), "조각 5 의 기록을 쓰지 않는다");
    assert.equal(occurrences(folder, "recordContactFolderCreated("), 1, "기록을 남기는 자리가 둘 이상이다");
    const createdBlock = blockAt(folder, folder.indexOf('if (created.status === "created") {'));
    assert.ok(createdBlock.includes("await recordContactFolderCreated({"), "🔴 만들었는데 기록이 없다");
    for (const field of ["actorUserId:", "repairCaseId:", "folderName:"]) {
      assert.ok(createdBlock.includes(field), `기록에 ${field} 가 없다`);
    }
    // 기록에 실패해도 폴더를 지우지 않는다 — 사람의 서류함이다.
    assert.ok(createdBlock.includes('status: "audit-failed"'), "기록 실패를 숨긴다");
  });

  test("🔴 던지지 않는다 — 결과를 돌려주고, 부르는 쪽이 로그만 남긴다", () => {
    const body = folder.slice(folder.indexOf("export async function createContactFolderForIntake("));
    assert.equal(/\bthrow\b/.test(body), false, "후처리 모듈이 던진다");
    assert.ok(body.includes("} catch {"), "예상 못 한 오류를 잡는 자리가 없다");
  });
});
