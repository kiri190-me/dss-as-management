import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * POST /api/attachments/{id}/contact-folder — **[DATA에 저장]**의 규율 (조각 12)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 스트림이 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 것**을 원본 글자로 본다:
 *
 *  · 🔴 **권한이 조회보다 앞** — 내려받기와 **같은 문턱**(VIEW 표)이다
 *  · 🔴 **휴지통 첨부는 거절** — 내려받기와 **같은 판정 함수**가 가린다
 *  · 🔴 **`DATA` 에 꽂는다** — 분류 폴더가 아니다(올리기와 자리가 다르다)
 *  · 🔴 **연락서 폴더를 만들지 않는다** — 만들기 함수를 부르지 않는다
 *  · 🔴 **ZIP 이 없다** — 묶는 것은 브라우저 제약 때문이고 이 길에는 그 제약이 없다
 *  · 🔴 **한 번에 첨부 하나** — 몰아 보내는 칸이 없다
 *  · 🔴 **지우기 · 옮기기 · 덮어쓰기가 한 글자도 없다**
 *  · 🔴 **파일 이름을 클라이언트가 보내지 않는다** — 서버가 짓는다(줄여받기와 같은 함수)
 *  · 🔴 **크기 상한**이 있고 content-length 만 믿지 않는다
 *  · 🔴 응답 · 로그에 **경로 · 루트**가 없다
 *
 * 꽂기 자체(덮어쓰지 않기 · NFC/NFD · `DATA` 만들기)는
 * lib/storage/contact-folder-data-copy.test.ts 가, 화면 쪽 흐름은
 * components/repair-cases/files/contact-folder-data-save.test.ts 가 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const postBody = code.slice(code.indexOf("export async function POST("), code.indexOf("function toNote("));

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("[DATA에 저장] 통로 — 원본으로 지킨다", () => {
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

  test("🔴 권한이 **조회보다 앞**이다 — 내려받기와 같은 문턱(VIEW)", () => {
    const access = postBody.indexOf('resolveAttachmentOwnerAccess("VIEW"');
    const threshold = postBody.indexOf("hasAnyAttachmentOwnerAccess(access)");
    const query = postBody.indexOf("getAttachmentForDownload(");
    const owner = postBody.indexOf("isAttachmentOwnerAccessAllowed(");
    assert.ok(access >= 0, "권한 표를 쓰지 않는다");
    assert.ok(threshold >= 0, "넓은 문턱이 없다");
    assert.ok(query >= 0, "첨부를 조회하지 않는다");
    assert.ok(owner >= 0, "주인별 권한을 보지 않는다");
    assert.ok(access < query, "🔴 권한보다 조회가 앞이다");
    assert.ok(threshold < query, "🔴 넓은 문턱보다 조회가 앞이다");
    assert.ok(query < owner, "주인을 알기 전에 주인별 권한을 묻는다");
    // 🔴 쓰기 권한(CHANGE)을 묻지 않는다 — 내려받기와 **같은** 문턱이어야 한다.
    assert.equal(postBody.includes('resolveAttachmentOwnerAccess("CHANGE"'), false, "문턱이 쓰기로 올라갔다");
    // 🔴 문턱을 넘은 사람에게는 403 이 아니라 404 다(그 ID 가 실재한다는 사실이 새지 않게).
    const ownerBlock = postBody.slice(owner, owner + 400);
    assert.ok(ownerBlock.includes('fail(404, "NOT_FOUND"'), "주인별 권한에서 403 으로 갈라 답한다");
  });

  test("🔴 휴지통 · 검사 차단은 **내려받기와 같은 판정 함수**가 가린다", () => {
    assert.ok(postBody.includes("decideAttachmentDownload({"), "판정 함수를 부르지 않는다");
    // 판정에 넘기는 값이 내려받기와 같다 — 하나라도 빠지면 그 갈래가 조용히 열린다.
    for (const field of ["isDeleted: attachment.isDeleted", "quoteInTrash: attachment.quoteInTrash", "malwareScanStatus:"]) {
      assert.ok(postBody.includes(field), `판정에 ${field} 를 안 넘긴다`);
    }
    assert.ok(postBody.includes("if (!decision.allowed) {"), "판정 결과를 쓰지 않는다");
    // 🔴 라우트가 스스로 휴지통을 가리지 않는다 — if 를 흩어 두면 판정이 둘이 된다.
    assert.equal(/if\s*\(\s*attachment\.isDeleted\s*\)/.test(postBody), false, "판정을 라우트가 또 한다");
    // 판정보다 **먼저** 꽂는 길이 없다.
    const decide = postBody.indexOf("decideAttachmentDownload({");
    const copy = postBody.indexOf("copyIntoContactFolderDataFolder({");
    assert.ok(decide >= 0 && copy >= 0);
    assert.ok(decide < copy, "🔴 판정 전에 꽂는다");
  });

  test("🔴 `DATA` 에 꽂는다 — 분류 폴더가 아니고, 연락서 폴더를 만들지 않는다", () => {
    assert.ok(code.includes("copyIntoContactFolderDataFolder"), "DATA 에 꽂는 함수를 안 쓴다");
    // 🔴 분류 폴더 쪽 길(올리기)과 섞이지 않는다.
    for (const forbidden of ["copyIntoContactFolder(", "contactFolderCategoryFolderName", "attachmentCategoryLabels"]) {
      assert.equal(code.includes(forbidden), false, `분류 폴더 쪽 길이 섞였다: ${forbidden}`);
    }
    // 🔴 폴더를 만드는 길이 없다 — 연락서 폴더는 사람이 [폴더 만들고 열기]로 만든다.
    for (const forbidden of ["createContactFolder", "recordContactFolderCreated", "mkdir"]) {
      assert.equal(code.includes(forbidden), false, `폴더를 만든다: ${forbidden}`);
    }
  });

  test("🔴 묶지 않는다 · 한 번에 첨부 하나다", () => {
    // ZIP 은 브라우저가 연속 내려받기를 막아서 생긴 것이고, 이 길에는 그 제약이 없다.
    for (const forbidden of ["zip", "Zip", "ZIP", "createStoredZip"]) {
      assert.equal(code.includes(forbidden), false, `묶는 흔적: ${forbidden}`);
    }
    // 여러 id 를 한 번에 받는 칸이 없다 — 화면이 한 건씩 차례로 부른다.
    for (const forbidden of ["attachmentIds", "ids:", "JSON.parse", "request.json("]) {
      assert.equal(code.includes(forbidden), false, `몰아 받는 흔적: ${forbidden}`);
    }
    assert.equal(code.match(/getAttachmentForDownload\(/g)?.length, 1, "첨부를 여럿 읽는다");
    assert.equal(code.match(/copyIntoContactFolderDataFolder\(/g)?.length, 1, "꽂는 자리가 하나가 아니다");
  });

  test("🔴 지우기 · 옮기기 · 덮어쓰기가 한 글자도 없다", () => {
    for (const forbidden of [/\bunlink\b/, /\brm\b/, /\brmdir\b/, /\brename\b/, /\btruncate\b/, /\bnode:fs\b/]) {
      assert.equal(forbidden.test(code), false, `흔적: ${forbidden}`);
    }
    // 시스템 창고의 원본도 건드리지 않는다 — 읽기 하나뿐이다.
    assert.ok(code.includes("getAttachmentStorage().read("), "원본을 읽지 않는다");
    for (const forbidden of ["storage.delete(", "storage.commit(", "storage.writeTemp(", "storage.discard("]) {
      assert.equal(code.includes(forbidden), false, `원본을 건드린다: ${forbidden}`);
    }
  });

  test("🔴 줄인 사진 — 이름은 **서버가 짓고**, 상한이 있고, 사진인지 본다", () => {
    // 🔴 클라이언트가 파일 이름을 통째로 보내지 않는다.
    assert.equal(/searchParams\.get\("fileName"\)/.test(code), false, "이름을 받아 쓴다");
    assert.ok(code.includes("shrunkFileName(attachment.originalFileName, shrunk)"), "줄기를 DB 에서 가져오지 않는다");
    assert.ok(code.includes("isShrinkLabel(shrunk)"), "이름표 모양을 보지 않는다");
    // 🔴 상한 — content-length 만 믿지 않고 실제로 센다.
    assert.ok(code.includes("MAX_ATTACHMENT_SIZE_BYTES"), "상한이 없다");
    assert.ok(code.includes("readBodyUpTo(body, MAX_ATTACHMENT_SIZE_BYTES)"), "본문을 상한 없이 읽는다");
    assert.ok(code.includes("if (total > maxBytes) return null;"), "세면서 끊지 않는다");
    // 🔴 앞머리를 보고 사진인지 본다.
    assert.ok(code.includes("looksLikeImage(received)"), "사진인지 보지 않는다");
    // 올리기 통로와 같은 모양이다 — multipart 를 쓰지 않는다.
    assert.equal(code.includes("formData("), false, "multipart 로 받는다");
  });

  test("🔴 감사 기록 — 새로 꽂았을 때만 · 응답과 로그에 경로가 없다", () => {
    assert.ok(code.includes("recordContactFolderFileSaved({"), "기록을 남기지 않는다");
    assert.equal(code.match(/recordContactFolderFileSaved\(/g)?.length, 1, "기록하는 자리가 하나가 아니다");
    // 🔴 `copied` 일 때만 — 같은 내용이 이미 있어 안 쓴 경우에는 새로 생긴 것이 없다.
    const audit = code.indexOf("recordContactFolderFileSaved({");
    const guard = code.lastIndexOf('result.status === "copied"', audit);
    assert.ok(guard >= 0 && guard < audit, "🔴 unchanged 에도 기록을 남긴다");

    // 응답 · 로그에 경로 · 루트가 없다.
    assert.equal(code.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "루트 설정 이름이 통로에 있다");
    assert.equal(code.includes("storedPath,"), false, "저장 경로를 어딘가에 싣는다");
    assert.equal(/reason:\s*[A-Za-z_$][\w$]*\.message/.test(code), false, "오류 message 를 사유로 썼다");
    for (const forbidden of ["error.message", "String(error)", "JSON.stringify(error)"]) {
      assert.equal(code.includes(forbidden), false, `로그에 ${forbidden} 가 들어간다`);
    }
    assert.ok(code.includes("error instanceof Error ? error.name :"), "오류 이름만 적는 모양이 아니다");
    // 나가는 칸은 상태 · 파일 이름 · 막힘 여부 · 사유뿐이다.
    const note = route.slice(route.indexOf("type ContactFolderCopyNote ="), route.indexOf("const CASE_GONE_REASON"));
    assert.equal(/\bfolderName\b/.test(note), false, "폴더 이름까지 싣는다");
    assert.equal(/\bpath\b/i.test(note), false, "경로를 담는 칸이 있다");
  });

  test("🔴 기능이 꺼져 있으면 DB 도 디스크도 보지 않는다", () => {
    const guard = postBody.indexOf("resolveContactFolderArchiveRoot() === null");
    const query = postBody.indexOf("getAttachmentForDownload(");
    assert.ok(guard >= 0, "설정 확인이 없다");
    assert.ok(guard < query, "설정을 보기 전에 DB 를 읽는다");
    // 다만 권한은 그보다 먼저 본다 — 설정 상태조차 아무에게나 알리지 않는다.
    assert.ok(postBody.indexOf("hasAnyAttachmentOwnerAccess(access)") < guard, "🔴 권한보다 설정이 앞이다");
  });

  test("🔴 바꾸는 통로다 — 요청 출처를 확인한다", () => {
    assert.ok(postBody.includes("isTrustedOrigin(request)"), "출처를 보지 않는다");
    assert.ok(postBody.indexOf("isTrustedOrigin(request)") < postBody.indexOf("readSession("), "출처가 뒤에 있다");
  });

  test("연락서 폴더는 **수리 건에만** 있다 — 모델 · 견적서 파일은 거절한다", () => {
    assert.ok(postBody.includes('fail(400, "NOT_REPAIR_CASE_FILE"'), "주인을 가리지 않는다");
    assert.ok(postBody.includes("getRepairCaseContactFolderKeyById("), "인수번호를 읽지 않는다");
    // 🔴 찾는 열쇠는 인수번호 하나다 — 이름 짓는 조회(S/N · 모델)를 끌어오지 않는다.
    assert.equal(code.includes("getRepairCaseContactFolderNamingById"), false, "이름 짓는 조회를 쓴다");
  });
});
