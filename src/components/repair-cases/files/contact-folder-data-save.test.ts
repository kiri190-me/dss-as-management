import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  contactFolderDataSaveUrl,
  saveEachToDataFolder,
  saveOneToDataFolder,
  type DataSaveFetch,
} from "./contact-folder-data-save";

/**
 * ============================================================================
 * [DATA에 저장] — 화면 쪽 흐름과 자리 (연락서 조각 12)
 * ============================================================================
 * 꽂기 자체는 lib/storage/contact-folder-data-copy.test.ts 가, 통로의 규율은
 * app/api/attachments/*\/contact-folder/route-source.test.ts 가, 말하는 한 줄은
 * contact-folder-copy-notice.test.ts 가 본다. 여기서는 **어떻게 보내는가**와
 * **단추가 어디에 서는가**를 본다.
 *
 * 못 박는 것:
 *  · 🔴 **여러 개를 고르면 낱개로 각각** — ZIP 이 안 생긴다
 *  · 🔴 **한 건씩 차례로** — 몰아 보내지 않는다
 *  · 🔴 일부만 실패하면 **건마다** 사실대로 돌려준다 · 던지지 않는다
 *  · 🔴 **파일 이름을 보내지 않는다** — 서버가 짓는다
 *  · 🔴 기능이 꺼져 있으면 **단추가 없다**
 *  · 🔴 꽂은 뒤 **공유폴더 구역을 다시 읽는다**(조각 10 의 신호)
 *  · 🔴 **내려받기를 바꾸지 않았다** — 더한 것이다
 * ============================================================================
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function read(...pieces: string[]): string {
  return readFileSync(path.join(here, ...pieces), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말(ZIP …)에 걸리지 않게. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const flowSource = read("contact-folder-data-save.ts");
const flowCode = withoutComments(flowSource);
const listSource = read("StoredAttachmentList.tsx");
const dialogSource = read("ShrinkDownloadDialog.tsx");
const filesScreen = read("FilesScreen.tsx");
const filesPage = read("..", "..", "..", "app", "(app)", "repair-cases", "[id]", "files", "page.tsx");

/** 부른 자리를 적어 두는 가짜 fetch. 동시에 몇 개가 떠 있었는지도 센다. */
function recordingFetch(
  answer: (url: string, index: number) => { ok: boolean; status: number; payload: unknown }
): { fetchImpl: DataSaveFetch; urls: string[]; bodies: (Blob | undefined)[]; maxInFlight: number } {
  const urls: string[] = [];
  const bodies: (Blob | undefined)[] = [];
  let inFlight = 0;
  const state = { maxInFlight: 0 };
  const fetchImpl: DataSaveFetch = async (url, init) => {
    inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, inFlight);
    const index = urls.length;
    urls.push(url);
    bodies.push(init.body);
    // 한 틱 미뤄 둔다 — 몰아 보냈다면 여기서 겹친다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight -= 1;
    const { ok, status, payload } = answer(url, index);
    return { ok, status, json: async () => payload };
  };
  return {
    fetchImpl,
    urls,
    bodies,
    get maxInFlight() {
      return state.maxInFlight;
    },
  };
}

const okCopied = (fileName: string) => ({
  ok: true,
  status: 200,
  payload: { contactFolderCopy: { status: "copied", fileName } },
});

describe("보내는 방식 — 낱개로, 한 건씩 차례로", () => {
  test("🔴 여러 개를 고르면 **낱개로 각각** 간다 — 묶지 않는다", async () => {
    const recorder = recordingFetch((_url, index) => okCopied(`f${index}.jpg`));

    const notes = await saveEachToDataFolder(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      async (item) => ({ attachmentId: item.id }),
      { fetchImpl: recorder.fetchImpl }
    );

    assert.equal(recorder.urls.length, 3, "한 번에 몰아 보냈다");
    assert.deepEqual(recorder.urls, [
      "/api/attachments/a/contact-folder",
      "/api/attachments/b/contact-folder",
      "/api/attachments/c/contact-folder",
    ]);
    assert.equal(notes.length, 3, "결과가 건마다 오지 않는다");
    // 🔴 보낸 것은 첨부 하나씩이다 — 묶음 · 본문이 없다.
    assert.deepEqual(recorder.bodies, [undefined, undefined, undefined]);
  });

  test("🔴 한 건씩 차례로 — 동시에 두 건이 뜨지 않는다", async () => {
    const recorder = recordingFetch((_url, index) => okCopied(`f${index}.jpg`));

    await saveEachToDataFolder([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], async (item) => ({ attachmentId: item.id }), {
      fetchImpl: recorder.fetchImpl,
    });

    assert.equal(recorder.maxInFlight, 1, "몰아 보냈다");
  });

  test("몇 건째인지 알려 준다 — 1 부터 전체까지", async () => {
    const recorder = recordingFetch((_url, index) => okCopied(`f${index}.jpg`));
    const seen: string[] = [];

    await saveEachToDataFolder([{ id: "a" }, { id: "b" }], async (item) => ({ attachmentId: item.id }), {
      fetchImpl: recorder.fetchImpl,
      onProgress: (progress) => seen.push(`${progress.current}/${progress.total}`),
    });

    assert.deepEqual(seen, ["1/2", "2/2"]);
  });

  test("🔴 일부만 실패해도 나머지는 간다 — 결과는 **건마다** 사실대로", async () => {
    const recorder = recordingFetch((_url, index) =>
      index === 1
        ? { ok: false, status: 409, payload: { error: "휴지통에 있는 파일은 내려받을 수 없습니다.", code: "DELETED" } }
        : okCopied(`f${index}.jpg`)
    );

    const notes = await saveEachToDataFolder([{ id: "a" }, { id: "b" }, { id: "c" }], async (item) => ({ attachmentId: item.id }), {
      fetchImpl: recorder.fetchImpl,
    });

    assert.equal(recorder.urls.length, 3, "하나가 막혔다고 멈췄다");
    assert.deepEqual(notes, [
      { status: "copied", fileName: "f0.jpg" },
      { status: "failed", reason: "휴지통에 있는 파일은 내려받을 수 없습니다." },
      { status: "copied", fileName: "f2.jpg" },
    ]);
  });

  test("🔴 줄이기가 실패해도 그 건만 실패다 — 던지지 않는다", async () => {
    const recorder = recordingFetch((_url, index) => okCopied(`f${index}.jpg`));

    const notes = await saveEachToDataFolder(
      [{ id: "a" }, { id: "b" }],
      async (item) => {
        if (item.id === "a") throw new Error("사진을 줄이지 못했습니다.");
        return { attachmentId: item.id, shrunk: { label: "50pct", body: new Blob(["x"]) } };
      },
      { fetchImpl: recorder.fetchImpl }
    );

    assert.equal(notes.length, 2);
    assert.deepEqual(notes[0], { status: "failed", reason: "사진을 줄이지 못했습니다." });
    assert.equal(notes[1].status, "copied");
    // 줄이지 못한 건은 통로를 부르지도 않았다.
    assert.deepEqual(recorder.urls, ["/api/attachments/b/contact-folder?shrunk=50pct"]);
  });

  test("줄여서 꽂을 때는 **줄인 바이트**가 본문이고 이름표만 주소에 붙는다", async () => {
    const recorder = recordingFetch(() => okCopied("파형_50pct.jpg"));
    const blob = new Blob(["작아진 사진"]);

    await saveOneToDataFolder({ attachmentId: "a", shrunk: { label: "50pct", body: blob } }, recorder.fetchImpl);

    assert.deepEqual(recorder.urls, ["/api/attachments/a/contact-folder?shrunk=50pct"]);
    assert.equal(recorder.bodies[0], blob);
  });

  test("🔴 주소에 **파일 이름이 없다** — 이름은 서버가 짓는다", () => {
    assert.equal(contactFolderDataSaveUrl("a1"), "/api/attachments/a1/contact-folder");
    assert.equal(contactFolderDataSaveUrl("a1", "500KB"), "/api/attachments/a1/contact-folder?shrunk=500KB");
    // 주소를 짓는 자리에 파일 이름이 들어갈 칸이 없다.
    assert.equal(/fileName/.test(flowCode), false, "흐름이 파일 이름을 보낸다");
    // id 와 이름표는 둘 다 감싸서 넣는다.
    assert.ok(contactFolderDataSaveUrl("a/b").includes("a%2Fb"), "id 를 그대로 이었다");
  });

  test("던지지 않는다 — 네트워크가 끊겨도, 응답을 못 읽어도 note 하나로 끝난다", async () => {
    const broken: DataSaveFetch = async () => {
      throw new Error("offline");
    };
    const note = await saveOneToDataFolder({ attachmentId: "a" }, broken);
    assert.equal(note.status, "failed");

    const unreadable: DataSaveFetch = async () => ({ ok: true, status: 200, json: async () => ({ hello: 1 }) });
    const second = await saveOneToDataFolder({ attachmentId: "a" }, unreadable);
    assert.equal(second.status, "failed");
    if (second.status !== "failed") throw new Error("unreachable");
    assert.ok(second.reason.length > 0);
  });
});

describe("🔴 묶지 않는다 — ZIP 과 닿는 자리가 없다", () => {
  test("흐름 모듈이 zip-store 를 가져오지 않는다", () => {
    assert.equal(flowCode.includes("zip-store"), false, "묶는 모듈을 가져왔다");
    assert.equal(/\bzip\b/i.test(flowCode), false, "묶는 흔적이 있다");
  });

  test("🔴 목록의 [DATA에 저장]은 묶지도 내려받지도 않는다", () => {
    const start = listSource.indexOf("async function saveToDataFolder(");
    const save = listSource.slice(start, listSource.indexOf("const filterBar =", start));
    assert.ok(save.length > 0, "저장 함수를 못 찾았다");
    for (const forbidden of ["createStoredZip", "uniqueEntryNames", "saveBlobAs", "downloadUrlOf", "document.createElement"]) {
      assert.equal(save.includes(forbidden), false, `내려받기 · 묶기 흔적: ${forbidden}`);
    }
    assert.ok(save.includes("saveEachToDataFolder("), "한 건씩 보내는 길을 안 쓴다");
  });

  test("🔴 줄여받기 창의 [DATA에 저장]도 묶지 않는다", () => {
    const start = dialogSource.indexOf("async function saveToDataFolder(");
    const save = dialogSource.slice(start, dialogSource.indexOf("return (", start));
    assert.ok(save.length > 0, "저장 함수를 못 찾았다");
    for (const forbidden of ["createStoredZip", "uniqueEntryNames", "saveBlobAs"]) {
      assert.equal(save.includes(forbidden), false, `묶기 · 내려받기 흔적: ${forbidden}`);
    }
    assert.ok(save.includes("saveEachToDataFolder("), "한 건씩 보내는 길을 안 쓴다");
    // 🔴 줄이는 쪽은 여전히 브라우저다 — 원본을 서버에서 줄이지 않는다.
    assert.ok(save.includes("shrinkImageBlob("), "브라우저가 줄이지 않는다");
  });

  test("🔴 **내려받기를 바꾸지 않았다** — 여럿이면 여전히 ZIP 하나다", () => {
    const start = listSource.indexOf("async function downloadSelected(");
    const download = listSource.slice(start, listSource.indexOf("async function saveToDataFolder(", start));
    assert.ok(download.includes("createStoredZip(entries)"), "묶어서 받기가 사라졌다");
    assert.ok(download.includes("첨부파일_"), "묶음 이름이 달라졌다");
    // 줄여받기 쪽도 그대로다.
    assert.ok(dialogSource.includes("saveBlobAs(createStoredZip(entries), `줄인사진_${entries.length}건.zip`);"));
  });
});

describe("단추가 서는 자리", () => {
  test("🔴 기능이 꺼져 있으면 단추가 **아예 없다** — 목록 · 묶음 조작 · 줄여받기 창 모두", () => {
    // 그리는 자리가 네 곳이고(표 · 카드 · 격자 · 묶음 조작) 전부 같은 깃발에 묶여 있다.
    assert.equal(
      listSource.match(/\{contactFolderEnabled && \(/g)?.length,
      4,
      "깃발에 안 묶인 자리가 있다(표 · 카드 · 격자 · 묶음 조작)"
    );
    assert.ok(dialogSource.includes("{contactFolderEnabled && ("), "줄여받기 창의 단추가 깃발에 안 묶였다");
    // 기본값은 **꺼짐**이다 — 깃발을 안 넘기면 안 보인다.
    assert.ok(listSource.includes("contactFolderEnabled = false,"), "기본값이 켜짐이다");
    assert.ok(dialogSource.includes("contactFolderEnabled = false,"), "기본값이 켜짐이다");
  });

  test("🔴 Windows 가 아니어도 보인다 — 도우미와 무관하다", () => {
    // 공유폴더 줄의 [열기]는 도우미(dss-folder://)를 쓰지만 이 단추는 서버가 꽂는다.
    for (const forbidden of ["dss-folder", "isWindows", "navigator.userAgent"]) {
      assert.equal(listSource.includes(forbidden), false, `도우미에 묶였다: ${forbidden}`);
      assert.equal(dialogSource.includes(forbidden), false, `도우미에 묶였다: ${forbidden}`);
    }
  });

  test("🔴 인쇄에 찍히지 않는다", () => {
    assert.ok(listSource.includes('className={`print:hidden ${className}`}'), "줄의 단추가 인쇄에 찍힌다");
    const bulk = listSource.slice(listSource.indexOf("{contactFolderEnabled && ("));
    assert.ok(bulk.slice(0, 900).includes("print:hidden"), "묶음 조작의 단추가 인쇄에 찍힌다");
  });

  test("🔴 결과는 화면에 **남는** 알림이다 — 저장 팝업에 싣지 않는다", () => {
    assert.ok(listSource.includes("contactFolderDataSaveNotice(notes)"), "결과를 한 줄로 모으지 않는다");
    assert.ok(listSource.includes("data-contact-folder-data-save-notice"), "알림 칸이 없다");
    assert.ok(dialogSource.includes("data-contact-folder-data-save-notice"), "창에 알림 칸이 없다");
    // 🔴 저장 팝업(0.5 초 뒤 닫힌다)은 이 길에 없다.
    assert.equal(listSource.includes("showSavePopup"), false, "저장 팝업에 실었다");
    assert.equal(dialogSource.includes("showSavePopup"), false, "저장 팝업에 실었다");
  });

  test("🔴 꽂은 뒤 공유폴더 구역을 **다시 읽는다** — 조각 10 이 만든 신호를 쓴다", () => {
    assert.ok(listSource.includes("onSavedToContactFolder?.();"), "목록이 다시 읽으라고 알리지 않는다");
    assert.ok(dialogSource.includes("onSavedToContactFolder?.();"), "창이 다시 읽으라고 알리지 않는다");
    // 파일 관리 화면이 그 신호를 올리기와 **같은 칸**에 꽂는다.
    assert.ok(
      filesScreen.includes("onSavedToContactFolder={() => setContactFolderReloadToken((token) => token + 1)}"),
      "신호를 공유폴더 구역으로 잇지 않았다"
    );
    assert.ok(filesScreen.includes("reloadToken={contactFolderReloadToken}"), "구역이 그 신호를 안 받는다");
  });

  test("깃발은 **서버가** 정한다 — 화면이 설정을 읽지 않는다", () => {
    assert.ok(filesPage.includes("resolveContactFolderArchiveRoot() !== null"), "서버가 깃발을 안 만든다");
    assert.ok(filesPage.includes("contactFolderEnabled={contactFolderEnabled}"), "깃발을 안 내려 준다");
    // 🔴 루트 값(.env)은 화면으로 가지 않는다 — 참/거짓 하나뿐이다.
    assert.equal(filesPage.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "루트 설정 이름이 페이지에 있다");
    assert.equal(listSource.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "화면이 설정을 읽는다");
  });
});
