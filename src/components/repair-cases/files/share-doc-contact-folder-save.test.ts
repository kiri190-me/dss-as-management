import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { contactFolderShareDocSaveNotice } from "./contact-folder-copy-notice";
import {
  saveShareDocToContactFolder,
  shareDocContactFolderSaveUrl,
  type ShareDocSaveFetch,
} from "./share-doc-contact-folder-save";

/**
 * ============================================================================
 * [연락서 폴더에 저장] — 화면 쪽 흐름 (2026-10-08)
 * ============================================================================
 * fetch 를 바꿔 끼워 **네트워크 없이 값으로** 잰다. 못 박는 것:
 *  · 🔴 가리킨 자리는 `?path=` 로 가고 **싸진다**(공백 · 한글 · `/` 가 섞인 경로다)
 *  · 🔴 **던지지 않는다** — 네트워크가 끊겨도 서버가 거절해도 note 하나로 끝난다
 *  · 🔴 **몸통을 보내지 않는다** — 바이트는 브라우저를 지나지 않는다
 *  · 🔴 모르는 모양의 응답은 「넣었습니다」가 되지 않는다
 *  · 결과 문장이 `DATA` · 올리기와 **갈라져 있다**(어느 폴더를 열어야 하는지 알게)
 * ============================================================================
 */

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE = "2. 인수시 서류/MB 인수시 체크시트.xlsx";

function fetchReturning(payload: unknown, init: { ok?: boolean; status?: number } = {}): {
  impl: ShareDocSaveFetch;
  calls: { url: string; method: string }[];
} {
  const calls: { url: string; method: string }[] = [];
  const impl: ShareDocSaveFetch = async (url, requestInit) => {
    calls.push({ url, method: requestInit.method });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => payload,
    };
  };
  return { impl, calls };
}

describe("① 통로 주소 — 가리킨 자리는 `?path=` 로 가고 싸인다", () => {
  test("건 id 와 경로를 둘 다 싼다 — 공백 · 한글 · `/` 가 섞여 있다", () => {
    const url = shareDocContactFolderSaveUrl(CASE_ID, SOURCE);
    assert.ok(url.startsWith(`/api/repair-cases/${CASE_ID}/share-docs/contact-folder?path=`), url);
    // 날것 그대로 붙이지 않는다 — 공백도 `/` 도 싸여 있어야 한다.
    assert.equal(url.includes(" "), false, url);
    assert.equal(url.includes(SOURCE), false, url);
    assert.equal(decodeURIComponent(url.split("?path=")[1]), SOURCE);
  });
});

describe("② 🔴 몸통을 보내지 않는다 — 바이트는 브라우저를 지나지 않는다", () => {
  test("POST 한 번, 그리고 그것이 전부다", async () => {
    const { impl, calls } = fetchReturning({ contactFolderCopy: { status: "copied", fileName: "체크시트.xlsx" } });
    const note = await saveShareDocToContactFolder({ repairCaseId: CASE_ID, relativePath: SOURCE }, impl);

    assert.deepEqual(note, { status: "copied", fileName: "체크시트.xlsx" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, shareDocContactFolderSaveUrl(CASE_ID, SOURCE));
  });
});

describe("③ 🔴 던지지 않는다 — 무슨 일이 나도 note 하나로 끝난다", () => {
  test("네트워크가 끊기면 사유를 돌려준다", async () => {
    const impl: ShareDocSaveFetch = async () => {
      throw new Error("offline");
    };
    const note = await saveShareDocToContactFolder({ repairCaseId: CASE_ID, relativePath: SOURCE }, impl);
    assert.equal(note.status, "failed");
    assert.equal(note.status === "failed" && note.reason.includes("네트워크"), true, JSON.stringify(note));
  });

  test("서버가 거절하면 **서버 문장 그대로** 보여 준다", async () => {
    const { impl } = fetchReturning(
      { error: "실행 파일은 연락서 폴더에 넣을 수 없습니다.", code: "EXECUTABLE_FILE" },
      { ok: false, status: 400 }
    );
    const note = await saveShareDocToContactFolder({ repairCaseId: CASE_ID, relativePath: SOURCE }, impl);
    assert.deepEqual(note, { status: "failed", reason: "실행 파일은 연락서 폴더에 넣을 수 없습니다." });
  });

  test("거절에 문장이 없으면 HTTP 상태를 적는다", async () => {
    const { impl } = fetchReturning(null, { ok: false, status: 413 });
    const note = await saveShareDocToContactFolder({ repairCaseId: CASE_ID, relativePath: SOURCE }, impl);
    assert.equal(note.status, "failed");
    assert.equal(note.status === "failed" && note.reason.includes("413"), true, JSON.stringify(note));
  });

  test("🔴 모르는 모양이면 「넣었습니다」가 되지 않는다", async () => {
    const { impl } = fetchReturning({ contactFolderCopy: { status: "넣음" } });
    const note = await saveShareDocToContactFolder({ repairCaseId: CASE_ID, relativePath: SOURCE }, impl);
    assert.equal(note.status, "failed");
  });
});

describe("④ 결과 문장 — 사람이 **어느 폴더를 열어야 하는지** 알 수 있다", () => {
  test("넣었다 · 이미 있다 · 폴더가 없다 · 여럿이다를 갈라 말한다", () => {
    const copied = contactFolderShareDocSaveNotice([{ status: "copied", fileName: "체크시트.xlsx" }]);
    assert.equal(copied?.tone, "success");
    assert.ok(copied?.text.includes("공통"), copied?.text);
    assert.ok(copied?.text.includes("체크시트.xlsx"), copied?.text);

    const unchanged = contactFolderShareDocSaveNotice([{ status: "unchanged", fileName: "체크시트.xlsx" }]);
    assert.equal(unchanged?.tone, "success");
    assert.ok(unchanged?.text.includes("이미 있어"), unchanged?.text);

    const none = contactFolderShareDocSaveNotice([{ status: "no-folder" }]);
    assert.equal(none?.tone, "error");
    // 🔴 만드는 길을 가리킨다 — 앱은 연락서 폴더를 만들지 않는다.
    assert.ok(none?.text.includes("폴더 만들고 열기"), none?.text);

    const many = contactFolderShareDocSaveNotice([{ status: "multiple" }]);
    assert.equal(many?.tone, "error");
    assert.ok(many?.text.includes("여럿"), many?.text);
  });

  test("🔴 `공통` 자리를 파일이 막았으면 **그 사실을 말한다**", () => {
    const blocked = contactFolderShareDocSaveNotice([
      { status: "copied", fileName: "체크시트.xlsx", categoryFolderBlockedByFile: true },
    ]);
    assert.ok(blocked?.text.includes("공통 자리에 같은 이름의 파일"), blocked?.text);
  });

  test("🔴 [DATA에 저장] · 올리기와 **말이 겹치지 않는다**", async () => {
    const { contactFolderDataSaveNotice, contactFolderCopyNotice } = await import("./contact-folder-copy-notice");
    const note = [{ status: "copied" as const, fileName: "체크시트.xlsx" }];
    const texts = [
      contactFolderShareDocSaveNotice(note)?.text,
      contactFolderDataSaveNotice(note)?.text,
      contactFolderCopyNotice(note)?.text,
    ];
    assert.equal(new Set(texts).size, 3, JSON.stringify(texts));
  });
});
