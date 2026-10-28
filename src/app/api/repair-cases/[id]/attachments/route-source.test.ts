import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  USED_PARTS_CASE_LOCKED_MESSAGE,
  isUsedPartsBlockedByShipmentLock,
  resolveUsedPartsWriteGate,
} from "@/lib/auth/repair-case-used-parts-authorization";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/attachments — **차례**를 소스로 지킨다 (연락서 조각 6)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 스트림이 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 차례**를 원본 글자로 본다.
 *
 * 2026-10-05 조각 6 이 이 통로에 **공유폴더 사본**을 덧붙였다. 덧붙인 것이지 끼워 넣은
 * 것이 아니라는 사실을 여기서 못 박는다:
 *  · 🔴 파일 이동(commit) → **DB(행 + 감사)** → **그 다음에** 공유폴더 — 이 차례다
 *  · 🔴 공유폴더 쪽이 무슨 일을 겪어도 **올리기는 201** 이다(그 함수에 `fail(` 이 없다)
 *  · 🔴 설정이 비면 **DB 도 디스크도 보지 않는다**
 *  · 🔴 이 통로는 공유폴더에 **폴더를 만들지 않는다 · 지우지 않는다**
 *  · 🔴 응답에 공유폴더 루트 · 절대 경로가 없다
 *  · 🔴 **로그에도** 오류를 통째로 찍지 않는다(조각 8) — fs 오류의 message 에는 전체
 *    경로가 들어 있어, 통째로 찍으면 운영 로그에 사내 폴더 구조가 남는다
 *
 * 꽂기 자체(덮어쓰지 않기 · NFC/NFD · 길이 상한)는 lib/storage/contact-folder-copy.test.ts 가,
 * 지우기 금지는 lib/storage/contact-folder-archive-source.test.ts 가 원본으로 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게.
 *
 * 🔴 2026-10-28 뒤로는 이것이 **꼭 필요하다.** 그날 걷어낸 잠금 관문의 글자가
 * (`if (target.isLocked) {` · `CASE_LOCKED`) 머리말에 **인용으로 그대로 남아 있어서**,
 * 날것으로 세면 「아직 막고 있다」로 읽힌다.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const code = withoutComments(route);
/** 공유폴더 사본 함수 하나만 — 그 안의 규율이 POST 본문 때문에 흐려지지 않게. */
const copyBody = code.slice(
  code.indexOf("async function copyToContactFolder("),
  code.indexOf("export async function POST(")
);
const postBody = code.slice(code.indexOf("export async function POST("));

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("첨부 올리기 통로 — 차례를 소스로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 차례: 파일 이동 → DB(행 + 감사) → **그 다음에** 공유폴더 사본", () => {
    const commit = postBody.indexOf("await storage.commit(");
    const record = postBody.indexOf("await createAttachmentRecord(");
    const share = postBody.indexOf("await copyToContactFolder(");
    assert.ok(commit >= 0, "파일 이동이 없다");
    assert.ok(record >= 0, "DB 기록이 없다");
    assert.ok(share >= 0, "공유폴더 사본이 없다");
    // 원래 있던 차례(4 → 5)는 그대로다.
    assert.ok(commit < record, "🔴 DB 가 파일 이동보다 앞이다");
    // 🔴 이번 조각이 더한 차례 — 뒤집으면 주인 없는 사본이 사람의 서류함에 남는다.
    assert.ok(record < share, "🔴 공유폴더 사본이 DB 보다 앞이다");
  });

  test("🔴 공유폴더 사본이 실패해도 올리기는 성공한다 — 그 자리에 `fail(` 도 `throw` 도 없다", () => {
    assert.ok(copyBody.length > 0, "공유폴더 사본 함수가 없다");
    assert.equal(/\bfail\(/.test(copyBody), false, "공유폴더 때문에 올리기를 거절한다");
    assert.equal(/\bthrow\b/.test(copyBody), false, "던지면 201 이 깨진다");
    assert.ok(copyBody.includes("} catch (error) {"), "감싸지 않았다 — 무엇이든 새어 나오면 안 된다");
    // 사본을 부른 뒤에는 거절이 없다 — 그 줄 다음은 바로 201 이다.
    const afterShare = postBody.slice(postBody.indexOf("await copyToContactFolder("));
    assert.equal(/\bfail\(/.test(afterShare), false, "사본 뒤에 거절하는 길이 생겼다");
    assert.ok(afterShare.includes("{ status: 201 }"), "201 로 끝나지 않는다");
  });

  test("🔴 설정이 비면 아무 일도 하지 않는다 — DB 도 디스크도 보지 않는다", () => {
    const guard = copyBody.indexOf("resolveContactFolderArchiveRoot() === null");
    const query = copyBody.indexOf("getRepairCaseContactFolderKeyById(");
    const read = copyBody.indexOf("storage.read(");
    assert.ok(guard >= 0, "설정 확인이 없다");
    assert.ok(guard < query, "설정을 보기 전에 DB 를 읽는다");
    assert.ok(guard < read, "설정을 보기 전에 파일을 읽는다");
    assert.ok(copyBody.slice(guard).includes("return null;"), "꺼져 있어도 무언가 한다");
  });

  test("🔴 이 통로는 공유폴더에 폴더를 만들지 않는다 · 지우지 않는다", () => {
    // 만들기(createContactFolder)는 사람이 [폴더 만들고 열기]를 누른 그때만 돈다.
    assert.equal(code.includes("createContactFolder"), false, "🔴 올리기가 폴더를 만든다");
    assert.equal(code.includes("recordContactFolderCreated"), false);
    // 공유폴더를 다루는 것은 꽂기 하나뿐이다.
    assert.deepEqual(
      [...code.matchAll(/\b(copyIntoContactFolder|findContactFolder|createContactFolder)\b/g)]
        .map((match) => match[1])
        .filter((name, index, all) => all.indexOf(name) === index),
      ["copyIntoContactFolder"]
    );
    // 공유폴더 쪽 파일시스템을 직접 부르지 않는다 — 모든 일은 storage 모듈을 거친다.
    for (const forbidden of ["node:fs", "unlink", "rmdir", "rename(", "writeFile"]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
  });

  test("🔴 응답에 공유폴더 루트 · 절대 경로가 없다 — 나가는 것은 파일 이름과 짧은 사유뿐", () => {
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "루트 설정 이름이 통로에 있다");
    assert.equal(code.includes("relativePath"), false);
    assert.equal(code.includes("uncPath"), false);
    // 사유에 fs 오류의 message 를 쓰지 않는다 — 경로가 들어 있다.
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    assert.equal(copyBody.includes("String(error)"), false);
    // 응답 칸은 상태와 파일 이름뿐이다.
    const note = route.slice(route.indexOf("type ContactFolderCopyNote ="), route.indexOf("const CONTACT_FOLDER_COPY_CASE_GONE_REASON"));
    assert.equal(/\bfolderName\b/.test(note), false, "폴더 이름까지 싣는다");
    assert.equal(/\bpath\b/i.test(note), false, "경로를 담는 칸이 있다");
  });

  test("🔴 로그에도 오류를 통째로 찍지 않는다 — fs 오류의 message 에 전체 경로가 있다 (조각 8)", () => {
    // 🔴 이 자리는 연락서 사본 쪽 하나뿐이다. 첨부 임시 저장 · 파일 이동 · 기록 생성의
    //    기존 로그는 이 시험의 울타리 밖이다(copyBody 만 본다).
    assert.ok(copyBody.includes("console.error("), "실패를 아무도 모르게 지나간다");
    assert.equal(
      /console\.error\([^;]*,\s*error\s*\)/.test(copyBody),
      false,
      "🔴 오류 객체를 통째로 찍는다 — message 에 사내 폴더 경로가 들어 있다"
    );
    for (const forbidden of ["error.message", "String(error)", "JSON.stringify(error)"]) {
      assert.equal(copyBody.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    // 남기는 것은 오류 **이름**과 수리 건 id 뿐이다(조각 7 의 접수 후처리와 같은 모양).
    assert.ok(copyBody.includes("error instanceof Error ? error.name :"), "오류 이름만 적는 모양이 아니다");
    assert.ok(copyBody.includes("repairCaseId: input.repairCaseId,"), "어느 수리 건인지 적지 않는다");
    // 사내 폴더 구조를 알려 주는 값들은 로그 자리에 없다.
    for (const forbidden of ["storedPath", "CONTACT_FOLDER_ARCHIVE_DIR", "folderName"]) {
      assert.equal(
        copyBody.slice(copyBody.indexOf("console.error(")).includes(forbidden),
        false,
        `로그에 ${forbidden} 가 들어간다`
      );
    }
  });

  test("🔴 DB 에 「어느 파일이 어느 첨부의 사본인가」를 적지 않는다", () => {
    // 공유폴더 사본 뒤에 DB 를 건드리는 길이 없다 — 그것을 적는 순간 지우기 동기화가 따라온다.
    const afterShare = postBody.slice(postBody.indexOf("await copyToContactFolder("));
    for (const forbidden of ["createAttachmentRecord", "db.", "update(", "insert("]) {
      assert.equal(afterShare.includes(forbidden), false, `사본 뒤에 DB 를 건드린다: ${forbidden}`);
    }
  });
});

/**
 * ============================================================================
 * 🔴 출하 완료로 잠긴 건에도 올리고 · 지우고 · 되살리고 · 돌려 저장한다
 *    (2026-10-28 사용자 결정 — 같은 날 두 번에 나눠 정해졌다)
 * ============================================================================
 * 그날 전까지 **넷** 다 `repair_cases.is_locked` 로 막혀 있었다.
 *
 * ① 아침 — 사용자의 말은 「출하 완료된 건에도 [파일관리] 탭에서 파일 올리기는 할 수
 *    있도록 해줘」였고, **잘못 올린 것을 치울 길이 없으면 올리기만 푸는 것이 쓸모가
 *    없어서** 휴지통행 · 되살리기까지 함께 풀었다(올리기 route.ts ·
 *    lib/db/mutations/attachment-trash.ts 머리말).
 * ② 그 뒤 — 같은 탭의 **사진 회전 저장**만 막힌 채 남은 것을 보고 정했다:
 *    「**같은 탭인데 하나만 막히면 이상하다**」. 🔴 회전은 **원본을 덮어쓰고 되돌릴 수
 *    없다** — 사용자가 그 점을 알고 골랐다(api/attachments/[id]/rotation/route.ts ·
 *    lib/db/mutations/attachment-rotation.ts 머리말에 잃는 것이 적혀 있다).
 *
 * 🔴 **잠금이 되살아나면 여기서 깨진다.** 다만 「없다」만 세는 시험은 표본이 비어도
 * 조용히 통과하므로, 없다고 말하기 전에 **무엇을 읽고 있는지** 먼저 못 박는다.
 *
 * 🔴 **같이 풀려 버린 것이 없는지도 본다.** 사용 부품 잠금(auth/repair-case-used-parts-
 * authorization.ts)은 **그대로 막아야 한다** — 사용자가 말한 것이 아니고, 거기까지
 * 열리면 이미 출하된 건의 부품 집계가 조용히 바뀐다. 2026-10-28 현재 아직 살아 있는
 * 잠금은 **다섯**이다 — 워크플로 전이 · 수동 단계 세우기 · 결재 요청 · 사용 부품 ·
 * 연락서 폴더 만들기(목록은 이 통로 route.ts 머리말).
 *
 * (휴지통행 · 되살리기의 **실제 동작**은 DB 가 있어야 재므로
 *  mutations/attachment-trash.integration.test.ts 가 같은 결정으로 뒤집혀 있다. 회전 쪽은
 *  db 시험이 아예 없다. 여기서는 그 판정이 소스에서 사라졌다는 사실만 본다.)
 * ============================================================================
 */

const trashSource = withoutComments(
  readFileSync(new URL("../../../../../lib/db/mutations/attachment-trash.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  )
);
/** 회전 저장 — 통로(본문을 받기 전의 문)와 기록(트랜잭션 안의 문) 양쪽을 본다. */
const rotationRouteSource = withoutComments(
  readFileSync(new URL("../../../attachments/[id]/rotation/route.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  )
);
const rotationMutationSource = withoutComments(
  readFileSync(new URL("../../../../../lib/db/mutations/attachment-rotation.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  )
);

describe("출하 잠금 — 첨부 넷이 풀렸고 나머지 다섯은 그대로다 (2026-10-28)", () => {
  test("🔴 올리기 통로에 잠금 관문이 없다 — 그 자리에 다른 관문들은 그대로 있다", () => {
    // 먼저 「무엇을 읽고 있는가」 — 이 둘이 없으면 통로를 잘못 읽은 것이고, 아래 「없다」는
    // 공짜로 통과한다.
    assert.ok(postBody.includes("getAttachmentUploadTarget(repairCaseId)"), "대상 조회가 없다");
    assert.ok(postBody.includes('fail(404, "CASE_NOT_FOUND"'), "건 존재 관문이 없다");

    assert.equal(/CASE_LOCKED/.test(code), false, "🔴 잠금 관문이 되살아났다");
    assert.equal(/\bisLocked\b/.test(code), false, "🔴 조회가 주는 잠금 값을 다시 보고 있다");
    assert.equal(
      /\b409\b/.test(code),
      false,
      "409 가 생겼다 — 잠금 관문이 돌아온 것이라면 2026-10-28 결정을 뒤집은 것이다"
    );
  });

  test("🔴 푼 것은 잠금 하나뿐이다 — 나머지 관문이 본문을 받기 전에 차례대로 선다", () => {
    const marks = [
      "isTrustedOrigin(request)",
      "await readSession()",
      "resolveActingUserForSession(session)",
      'actingUser.approvalStatus !== "APPROVED"',
      'hasPermission(actingUser, "repairCases.files", "WRITE")',
      "getAttachmentUploadTarget(repairCaseId)",
      "isAttachmentCategory(category)",
      "normalizeFileExtension(originalFileName)",
      "MAX_ATTACHMENT_SIZE_BYTES",
    ];
    let previous = -1;
    for (const mark of marks) {
      const at = postBody.indexOf(mark);
      assert.ok(at >= 0, `관문이 사라졌다: ${mark}`);
      assert.ok(at > previous, `차례가 어긋났다: ${mark}`);
      previous = at;
    }
    // 🔴 전부 **본문을 받기 전**이다. 막힐 사람에게서 20MB 를 받아 놓고 버리지 않는다.
    const writeTemp = postBody.indexOf("storage.writeTemp(");
    assert.ok(writeTemp > previous, "관문보다 먼저 본문을 받는다");
    // 넓은 문턱은 한 번뿐이고, 읽기 권한으로는 올릴 수 없다.
    assert.equal(postBody.match(/hasPermission\(/g)?.length, 1);
    assert.equal(postBody.includes('"READ"'), false, "올리기가 READ 로 통과한다");
  });

  test("🔴 휴지통행 · 되살리기도 같은 날 풀렸다 — 견적서 쪽 잠금은 그대로다", () => {
    // 무엇을 읽고 있는가 — 두 함수가 그대로 있어야 아래 「없다」가 뜻을 갖는다.
    assert.ok(trashSource.includes("export async function softDeleteAttachment("), "지우기 함수가 없다");
    assert.ok(trashSource.includes("export async function restoreAttachment("), "되살리기 함수가 없다");

    assert.equal(/caseIsLocked/.test(trashSource), false, "🔴 접수 건 잠금 판정이 되살아났다");
    assert.equal(/CASE_LOCKED/.test(trashSource), false, "🔴 접수 건 잠금 코드가 되살아났다");

    // 🔴 함께 풀린 것이 없다 — 견적서 잠금(둘 다)과 두 번 누르기 방어는 그대로다.
    assert.equal(
      trashSource.match(/guardQuoteOwner\(tx, current, \{ adding: (?:true|false) \}\)/g)?.length,
      2,
      "견적서 쪽 잠금이 함께 풀렸다"
    );
    for (const kept of ["QUOTE_IN_TRASH", "SLOT_OCCUPIED", "ALREADY_IN_STATE"]) {
      assert.ok(trashSource.includes(kept), `함께 사라졌다: ${kept}`);
    }
  });

  test("🔴 사진 회전 저장도 풀렸다 — 통로와 기록 **양쪽**에 잠금 문이 없다", () => {
    // 🔴 양쪽을 다 봐야 한다. 기록(mutation)만 풀고 통로를 두면 **본문을 받기 전에**
    //    막혀 아무것도 달라지지 않는다 — 실제로 지시서가 기록 쪽만 가리키고 있었다.
    // 먼저 「무엇을 읽고 있는가」.
    assert.ok(rotationRouteSource.includes("getAttachmentForRotation(attachmentId)"), "회전 통로를 잘못 읽었다");
    assert.ok(
      rotationMutationSource.includes("export async function recordAttachmentRotation("),
      "회전 기록 함수를 잘못 읽었다"
    );

    assert.equal(/CASE_LOCKED/.test(rotationRouteSource), false, "🔴 회전 통로의 잠금 문이 되살아났다");
    assert.equal(/caseLocked/.test(rotationRouteSource), false, "🔴 회전 통로가 잠금 값을 다시 보고 있다");
    assert.equal(/CASE_LOCKED/.test(rotationMutationSource), false, "🔴 회전 기록의 잠금 문이 되살아났다");
    assert.equal(/caseIsLocked/.test(rotationMutationSource), false, "🔴 회전 기록이 잠금 값을 다시 읽는다");

    // 🔴 함께 열린 문이 없다 — 되돌릴 수 없는 쓰기를 지키는 것들은 그대로다.
    for (const kept of ["CHANGED", "DELETED", "QUOTE_IN_TRASH", "guardQuoteAttachmentChange("]) {
      assert.ok(rotationMutationSource.includes(kept), `회전 기록에서 함께 사라졌다: ${kept}`);
    }
    // 「그 사이 바뀌었는가」는 잠금이 풀린 뒤 **더 중요해졌다**(출하된 건에서도 경합이 난다).
    assert.ok(
      rotationMutationSource.includes("eq(attachments.checksumSha256, params.previous.checksumSha256)"),
      "🔴 체크섬 잠금이 사라졌다 — 뒤에 누른 사람이 앞사람의 결과를 소리 없이 지운다"
    );
    // 통로 쪽에서도 내보내기 판정 · 권한 문턱은 그대로다.
    for (const kept of ["decideAttachmentDownload({", "hasAnyAttachmentOwnerAccess(access)", "swapStoredFiles("]) {
      assert.ok(rotationRouteSource.includes(kept), `회전 통로에서 함께 사라졌다: ${kept}`);
    }
  });

  test("🔴 사용 부품 잠금은 같이 풀리지 않았다 — 가져온 건만 예외인 채 그대로다", () => {
    // 2026-09-17 사용자 결정(그 파일의 '규칙 2')이고, 2026-10-28 결정의 대상이 아니었다.
    assert.equal(isUsedPartsBlockedByShipmentLock(true, false), true, "🔴 잠긴 건의 사용 부품이 열렸다");
    assert.equal(isUsedPartsBlockedByShipmentLock(true, true), false, "가져온 건 예외가 사라졌다");
    assert.equal(isUsedPartsBlockedByShipmentLock(false, false), false);

    const gate = resolveUsedPartsWriteGate({
      canWriteUsedParts: true,
      hasPartRequestHistory: false,
      isShipmentLocked: true,
      isLegacyImportedCase: false,
    });
    assert.equal(gate.ok, false, "🔴 잠긴 건에 사용 부품을 적을 수 있게 됐다");
    if (gate.ok) throw new Error("unreachable");
    assert.equal(gate.code, "CASE_LOCKED");
    assert.equal(gate.message, USED_PARTS_CASE_LOCKED_MESSAGE);
  });
});
