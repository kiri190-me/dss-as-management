import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 접수와 함께 올라온 **수리 의뢰서** — 끼운 자리를 원본으로 지킨다 (2026-10-19)
 * ============================================================================
 * 접수 서비스는 세션 · DB · 워크플로가 있어야 부를 수 있어 여기서 직접 부르지
 * 않는다(꽂기 동작 자체는 이웃 save-intake-repair-request.test.ts 가 임시 폴더에서
 * 본다). 이 파일이 보는 것은 **바뀌면 조용히 사고가 되는 자리**다:
 *
 *  · 🔴 **메일이 파일보다 먼저 나가지 않는다** — 차례가 폴더 → 의뢰서 → 메일이다.
 *  · 🔴 **서버 디스크에 한 바이트도 쓰지 않는다** — 그래서 지울 임시본이 없다.
 *  · 🔴 **첨부 표(`attachments`)에 행을 만들지 않는다** — 디스크에 없을 파일의
 *    기록만 남기면 눌러도 안 열리는 줄이 된다.
 *  · 🔴 **지우는 코드가 한 글자도 없다** — 메일이 실패해도 꽂은 파일이 남는다.
 *  · 🔴 **파일이 없으면 지금과 똑같이 돈다** — 선택 기능이다.
 *  · 🔴 **무슨 일이 있어도 접수는 성공한다** — 그 토막에 return 도 throw 도 없다.
 *  · 🔴 **받아도 되는 파일인지는 접수를 만들기 전에** 가린다.
 *  · 🔴 화면은 **초안(localStorage)에 파일을 담지 않는다.**
 *
 * 차례 자체(네 토막의 순서)는 이웃 create-contact-folder-source.test.ts 가 토막을
 * 갈라 한 번 더 본다 — 여기서는 **파일 쪽 규율**을 본다.
 * ============================================================================
 */

const intakeSource = readFileSync(new URL("./create-repair-case.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const saveSource = readFileSync(new URL("./save-intake-repair-request.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const actionSource = readFileSync(
  new URL("../actions/create-repair-case.ts", import.meta.url),
  "utf8"
).replace(/\r\n/g, "\n");
const mailSource = readFileSync(new URL("./send-intake-mail.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const formSource = readFileSync("src/components/repair-cases/new/IntakeFormInner.tsx", "utf8").replace(/\r\n/g, "\n");

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(unlink · 첨부 표 …)에 걸리지 않게. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const intake = stripComments(intakeSource);
const save = stripComments(saveSource);
const action = stripComments(actionSource);
const mail = stripComments(mailSource);
const form = stripComments(formSource).replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

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

const repairCallIndex = intake.indexOf("await saveIntakeRepairRequest(");
const mailCallIndex = intake.indexOf("await sendIntakeNotificationMail(");
const folderCallIndex = intake.indexOf("await createContactFolderForIntake(");
/** 수리 의뢰서를 꽂는 토막 — 「붙였고 폴더가 섰는가」 문 하나(catch 까지). */
const repairBlock = blockAt(intake, intake.indexOf("if (input.repairRequest && contactFolderReady) {"));

describe("수리 의뢰서 — 메일보다 먼저 서류함에 들어간다", () => {
  test("🔴 폴더 → 의뢰서 → 메일. 메일이 파일보다 먼저 나가는 길이 없다", () => {
    assert.ok(repairCallIndex >= 0, "수리 의뢰서를 꽂는 자리가 없다");
    assert.equal(occurrences(intake, "await saveIntakeRepairRequest("), 1, "꽂는 자리가 둘 이상이다");
    assert.ok(folderCallIndex < repairCallIndex, "🔴 폴더를 만들기 전에 꽂는다 — 꽂을 자리가 없다");
    assert.ok(repairCallIndex < mailCallIndex, "🔴 메일이 파일보다 먼저 나간다");
    // 메일을 부르는 자리도 하나다 — 둘이면 한쪽이 파일보다 앞설 수 있다.
    assert.equal(occurrences(intake, "await sendIntakeNotificationMail("), 1, "메일을 부르는 자리가 둘 이상이다");
  });

  test("🔴 폴더가 `created` · `found` 일 때만 꽂는다 — 공통 서류와 같은 판정을 쓴다", () => {
    assert.ok(
      intake.includes("if (input.repairRequest && contactFolderReady) {"),
      "🔴 폴더가 선 것을 보지 않고 꽂는다"
    );
  });

  test("🔴 메일의 첨부는 **폴더 결과와 무관하다** — 공유폴더가 꺼져 있어도 메일로는 나간다", () => {
    const mailBlock = intake.slice(mailCallIndex, intake.indexOf("} catch (mailError) {"));
    assert.ok(mailBlock.includes("repairRequestAttachment:"), "메일에 의뢰서를 싣지 않는다");
    assert.equal(mailBlock.includes("contactFolderReady"), false, "🔴 폴더가 서야만 첨부가 나간다");
    assert.equal(mailBlock.includes("saveIntakeRepairRequest"), false, "메일 토막이 꽂기를 부른다");
  });
});

describe("수리 의뢰서 — 서버에 남지 않는다", () => {
  test("🔴 접수 서비스가 이 파일을 디스크에 쓰지 않는다 — 지울 임시본이 없다", () => {
    // 🔴 `getAttachmentStorage()` 는 **읽기 하나**로만 쓰인다(종류 공통 서류가 저장된
    //    원본을 읽는다). 쓰는 길이 하나라도 생기면 「서버에 안 남는다」가 깨진다.
    assert.equal(occurrences(intake, "getAttachmentStorage()"), 1, "저장소를 쓰는 자리가 늘었다");
    assert.ok(intake.includes("getAttachmentStorage().read("), "저장소를 읽기로 쓰지 않는다");
    for (const forbidden of ["writeTemp", "commit(", "discard(", ".write(", "storage.delete", "node:fs", "mkdir"]) {
      assert.equal(intake.includes(forbidden), false, `🔴 접수 서비스에 ${forbidden} 가 생겼다`);
    }
    // 꽂기 모듈도 제 손으로 파일시스템을 열지 않는다 — storage 한 자리를 거친다.
    assert.equal(save.includes("node:fs"), false, "꽂기 모듈이 파일시스템을 직접 연다");
    assert.ok(save.includes("await copyIntoContactFolder({"), "storage 를 거치지 않는다");
  });

  test("🔴 지우는 코드가 한 글자도 없다 — 메일이 실패해도 꽂은 파일이 남는다", () => {
    for (const forbidden of ["unlink", "rmdir", "rm(", "rename(", "truncate"]) {
      assert.equal(save.includes(forbidden), false, `🔴 꽂기 모듈에 ${forbidden} 가 생겼다`);
      assert.equal(repairBlock.includes(forbidden), false, `🔴 꽂는 토막에 ${forbidden} 가 생겼다`);
    }
    // 메일 뒤에 「되돌리기」가 붙지 않았다 — 메일 토막이 꽂기를 모른다.
    const afterMail = intake.slice(mailCallIndex);
    assert.equal(afterMail.includes("saveIntakeRepairRequest"), false, "🔴 메일 뒤에 파일을 다시 건드린다");
    assert.equal(afterMail.includes("unlink"), false, "메일 뒤에 지우는 길이 있다");
  });

  test("🔴 첨부 표(attachments)에 행을 만들지 않는다 — 눌러도 안 열리는 줄을 만들지 않는다", () => {
    for (const forbidden of ["createAttachmentRecord", "db/mutations/attachments", "attachmentId"]) {
      assert.equal(save.includes(forbidden), false, `🔴 꽂기 모듈이 ${forbidden} 를 쓴다`);
      assert.equal(repairBlock.includes(forbidden), false, `🔴 꽂는 토막이 ${forbidden} 를 쓴다`);
    }
    assert.equal(intake.includes("createAttachmentRecord"), false, "🔴 접수 서비스가 첨부 행을 만든다");
    // 🔴 감사 기록도 남기지 않는다 — 그 함수는 첨부 id 를 요구한다(없는 첨부를 가리킨다).
    assert.equal(repairBlock.includes("recordContactFolderFileSaved"), false, "없는 첨부를 가리키는 기록을 남긴다");
    assert.equal(save.includes("db/mutations"), false, "꽂기 모듈이 DB 를 건드린다");
    assert.equal(save.includes("db.transaction"), false, "꽂기 모듈이 트랜잭션을 연다");
  });

  test("🔴 폴더 이름을 글자로 박지 않는다 — 분류 이름표 한 자리에서 나온다", () => {
    assert.ok(save.includes("category: INTAKE_REPAIR_REQUEST_CATEGORY"), "분류를 넘기지 않는다");
    // 🔴 폴더 이름이 될 수 있는 **글자 그대로의 이름표**가 없다. 사람에게 보이는
    //    사유 문장("수리 의뢰서를 공유폴더에 …")은 폴더 이름이 아니므로 따옴표까지
    //    맞춰 본다 — 그래야 「이름표를 베껴 적었나」만 걸린다.
    assert.equal(save.includes('"수리 의뢰서"'), false, "🔴 폴더 이름을 글자로 적었다");
    assert.equal(save.includes("attachmentCategoryLabels"), false, "🔴 이름표를 제 손으로 풀어 쓴다");
    assert.equal(save.includes("copyIntoContactFolderCommonFolder"), false, "`공통` 에 꽂는다");
    assert.equal(save.includes("copyIntoContactFolderDataFolder"), false, "`DATA` 에 꽂는다");
  });
});

describe("수리 의뢰서 — 없으면 지금과 똑같이 돈다", () => {
  test("🔴 안 붙이면 꽂기를 **아예 부르지 않는다**", () => {
    assert.ok(repairBlock.includes("await saveIntakeRepairRequest("), "조건 밖에서 꽂는다");
    // 조건이 `input.repairRequest` 하나에 걸려 있다 — 없으면 토막 전체를 건너뛴다.
    assert.ok(intake.includes("if (input.repairRequest && contactFolderReady) {"), "조건이 바뀌었다");
  });

  test("🔴 안 붙이면 메일에 첨부 칸이 **붙지 않는다** — 서명 그림만 나간다", () => {
    // 폈다 접는 모양(`...(input.repairRequest ? { … } : {})`)이라 칸 자체가 안 생긴다.
    assert.ok(intake.includes("...(input.repairRequest"), "🔴 의뢰서가 없어도 첨부 칸이 붙는다");
    // 메일 쪽도 없을 때는 **서명 배열 그대로**다 — 새 배열을 만들지 않는다.
    // (줄바꿈에 걸리지 않게 공백을 한 칸으로 접어 본다.)
    const mailOneLine = mail.replace(/\s+/g, " ");
    assert.ok(
      mailOneLine.includes("params.repairRequestAttachment ? [...images, params.repairRequestAttachment] : images"),
      "🔴 의뢰서가 없을 때 서명 배열을 그대로 쓰지 않는다"
    );
  });

  test("🔴 EXCEL_IMPORT 는 이 파일을 받을 길이 없다 — 꽂기도 메일도 대화형 문 안이다", () => {
    const interactive = blockAt(intake, intake.indexOf('if (input.logContext === "INTERACTIVE") {'));
    assert.ok(interactive.includes("await saveIntakeRepairRequest("), "대화형 문 밖에서 꽂는다");
    assert.equal(interactive.includes("EXCEL_IMPORT"), false, "이관에서도 도는 길이 생겼다");
  });
});

describe("수리 의뢰서 — 접수는 무슨 일이 있어도 성공한다", () => {
  test("🔴 꽂기가 실패해도 접수가 되돌아가지 않는다 — 그 토막에 return 도 throw 도 없다", () => {
    assert.ok(repairBlock.includes("try {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    assert.ok(repairBlock.includes("} catch (repairRequestError) {"), "catch 가 없다");
    assert.equal(/\breturn\b/.test(repairBlock), false, "🔴 파일 때문에 접수가 되돌아간다");
    assert.equal(/\bthrow\b/.test(repairBlock), false, "던지면 접수가 실패로 뒤집힌다");
    assert.equal(repairBlock.includes("ok: false"), false, "파일 때문에 접수를 실패로 적는다");
    assert.equal(repairBlock.includes("markIdempotencyKeyFailed"), false, "파일 때문에 멱등 키를 실패로 적는다");
  });

  test("🔴 꽂기 모듈이 던지지 않는다 — 결과를 값으로 돌려준다", () => {
    const body = save.slice(save.indexOf("export async function saveIntakeRepairRequest("));
    assert.equal(/\bthrow\b/.test(body), false, "꽂기 모듈이 던진다");
    assert.ok(body.includes("} catch {"), "예상 못 한 오류를 잡는 자리가 없다");
  });

  test("🔴 로그에 파일 이름 · 폴더 이름 · 경로가 없다 — 상태 코드와 수리 건 id 뿐이다", () => {
    const logs = repairBlock.slice(repairBlock.indexOf("console.error("));
    assert.ok(logs.includes("console.error("), "실패를 아무도 모르게 지나간다");
    assert.ok(logs.includes("repairCaseId: result.id,"), "어느 수리 건인지 적지 않는다");
    for (const forbidden of [
      "fileName",
      "folderName",
      "intakeNumber",
      "reason",
      "root",
      "CONTACT_FOLDER_ARCHIVE_DIR",
    ]) {
      assert.equal(logs.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    assert.equal(logs.includes("repairRequestError.message"), false, "오류 message 를 로그에 적는다");
    assert.equal(logs.includes("String(repairRequestError)"), false, "오류를 통째로 글자로 만든다");
    assert.equal(save.includes("console."), false, "꽂기 모듈이 로그를 찍는다");
  });
});

describe("수리 의뢰서 — 받아도 되는 파일인지 접수를 만들기 전에 가린다", () => {
  test("🔴 검사가 접수 서비스를 부르기 **전**이다 — 거절돼도 접수가 생기지 않는다", () => {
    const check = action.indexOf("checkIntakeRepairRequestFile({");
    const create = action.indexOf("return createRepairCaseWithIdempotency({");
    assert.ok(check >= 0, "파일 검사가 없다");
    assert.ok(create >= 0);
    assert.ok(check < create, "🔴 접수를 만든 뒤에 파일을 가린다");
    // 로그인 뒤다 — 로그인하지 않은 요청이 어떤 파일이 통과하는지 알 수 없다.
    assert.ok(action.indexOf("await readSession()") < check, "로그인 확인보다 파일을 먼저 본다");
  });

  test("🔴 잣대를 새로 짓지 않는다 — 올리기 통로와 같은 함수를 부른다", () => {
    assert.ok(action.includes('from "@/lib/domain/intake-repair-request"'), "검사 함수를 쓰지 않는다");
    assert.ok(action.includes("MAX_ATTACHMENT_SIZE_BYTES"), "크기 상한을 제 손으로 적었다");
    // 🔴 브라우저가 보낸 형식(type)을 보지 않는다 — 정본은 확장자에서 나온다.
    assert.equal(/picked\.type/.test(action), false, "🔴 브라우저가 보낸 MIME 을 믿는다");
  });

  test("🔴 실물 바이트로 다시 잰다 — 브라우저가 알려 준 크기만 믿지 않는다", () => {
    assert.ok(action.includes("await picked.arrayBuffer()"), "실물 바이트를 읽지 않는다");
    assert.ok(action.includes("picked.size > MAX_ATTACHMENT_SIZE_BYTES"), "알려 준 크기로 먼저 자르지 않는다");
    // 바이트를 넘기는 쪽도 디스크를 거치지 않는다.
    assert.equal(action.includes("node:fs"), false, "🔴 액션이 파일을 디스크에 쓴다");
    assert.equal(action.includes("writeTemp"), false, "🔴 액션이 임시 파일을 만든다");
  });
});

describe("수리 의뢰서 — 접수 화면의 배선", () => {
  test("🔴 같은 요청에 실린다 — 단추 한 번이 요청 하나다", () => {
    assert.ok(
      form.includes("await createRepairCaseAction(input, idempotencyKey, repairRequest)"),
      "🔴 파일을 접수와 따로 보낸다"
    );
    assert.ok(form.includes('repairRequest.set("file", repairRequestFile)'), "FormData 에 담지 않는다");
    // 🔴 base64 로 부풀려 보내지 않는다.
    assert.equal(form.includes("toString(\"base64\")"), false, "base64 로 보낸다");
    assert.equal(form.includes("readAsDataURL"), false, "base64 로 보낸다");
  });

  test("🔴 초안(localStorage)에 파일을 담지 않는다", () => {
    // 초안에 담으면 새로고침한 뒤 「붙어 있는 줄 알았는데 안 간」 파일이 생긴다.
    assert.equal(/updateDraft\([^)]*repairRequest/.test(form), false, "🔴 파일을 초안에 담는다");
    assert.equal(/setField\("repairRequest/.test(form), false, "🔴 파일을 초안에 담는다");
    assert.ok(form.includes("useState<File | null>(null)"), "화면 state 로 들고 있지 않다");
  });

  test("🔴 고르는 창의 형식 목록을 손으로 적지 않는다 — 허용목록에서 뽑는다", () => {
    assert.ok(form.includes("ATTACHMENT_EXTENSION_RULES"), "허용목록을 쓰지 않는다");
    assert.ok(
      form.includes("isExtensionAllowedForCategory(extension, INTAKE_REPAIR_REQUEST_CATEGORY)"),
      "분류가 받는 형식을 묻지 않는다"
    );
    assert.equal(/accept="[^"]*\.pdf/.test(form), false, "🔴 받는 형식을 글자로 박았다");
  });

  test("접수가 끝나면 고른 파일을 비운다 — 다음 건에 지난 의뢰서가 따라가지 않게", () => {
    assert.ok(form.includes("clearRepairRequestFile()"), "비우는 길이 없다");
    const afterClear = form.slice(form.indexOf("clear();\n"));
    assert.ok(afterClear.includes("clearRepairRequestFile();"), "저장 뒤에 비우지 않는다");
  });
});
