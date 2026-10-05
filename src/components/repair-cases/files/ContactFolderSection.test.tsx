import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ContactFolderEntryOpenButton, { ContactFolderEntryOpenControl } from "./ContactFolderEntryOpenButton";
import ContactFolderSection, {
  CONTACT_FOLDER_SECTION_EMPTY_TEXT,
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_LOADING_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  ContactFolderSectionView,
  canOpenContactFolderEntry,
  contactFolderEntriesUrl,
  loadContactFolderEntries,
  readContactFolderEntriesAnswer,
  type ContactFolderSectionState,
} from "./ContactFolderSection";

/**
 * ============================================================================
 * 파일 관리 탭의 공유폴더 구역 — 상태 일곱 · 자리 · 인쇄 · 읽기만 (연락서 조각 3)
 * ============================================================================
 * 통로 쪽 규율은 app/api/.../contact-folder/entries/route-source.test.ts 가, 실제 읽기는
 * lib/storage/contact-folder-entries.test.ts 가 본다. 여기서는 **화면이 무엇을 내는가**와
 * **첨부 목록을 건드리지 않는가**를 본다.
 * ============================================================================
 */

const sectionSource = readFileSync(new URL("./ContactFolderSection.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const filesScreen = readFileSync(new URL("./FilesScreen.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const buttonSource = readFileSync(new URL("./ContactFolderEntryOpenButton.tsx", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);
const openFlowSource = readFileSync(new URL("./contact-folder-file-open.ts", import.meta.url), "utf8").replace(
  /\r\n/g,
  "\n"
);

function markup(state: ContactFolderSectionState): string {
  return renderToStaticMarkup(createElement(ContactFolderSectionView, { state, repairCaseId: "case-1" }));
}

const FOLDER = "D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

const foundState = (overrides: Partial<Extract<ContactFolderSectionState, { kind: "found" }>> = {}) =>
  ({
    kind: "found",
    folderName: FOLDER,
    entries: [],
    totalCount: 0,
    truncated: false,
    ...overrides,
  }) satisfies ContactFolderSectionState;

describe("상태 일곱 — 무엇을 보이는가", () => {
  test("🔴 disabled 면 구역을 **아예 안 그린다** — 설정이 없는 환경에서 빈 상자가 늘지 않게", () => {
    assert.equal(markup({ kind: "disabled" }), "");
    // 흐름 쪽에서도 같은 상태가 나온다.
    assert.deepEqual(readContactFolderEntriesAnswer({ status: "disabled" }), { kind: "disabled" });
  });

  test("불러오는 중 — 「불러오는 중…」", () => {
    const html = markup({ kind: "loading" });
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_LOADING_TEXT), html);
    assert.ok(html.includes("공유폴더"), html);
  });

  test("not-found — 「아직 이 건의 폴더가 없습니다」", () => {
    const html = markup({ kind: "not-found" });
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT), html);
  });

  test("found + 비어 있음 — 「폴더가 비어 있습니다」", () => {
    const html = markup(foundState());
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_EMPTY_TEXT), html);
    assert.equal(html.includes("<ul"), false, "빈 폴더인데 목록 틀을 그렸다");
  });

  test("found + 목록 — 줄마다 이름 · 크기 · 수정시각, 폴더는 폴더 표시", () => {
    const html = markup(
      foundState({
        entries: [
          { name: "사진", isDirectory: true, sizeBytes: 0, modifiedAt: "2026-09-08T01:00:00.000Z" },
          { name: "연락서.xlsx", isDirectory: false, sizeBytes: 1024, modifiedAt: "2026-09-08T02:00:00.000Z" },
          { name: "시각없음.pdf", isDirectory: false, sizeBytes: 512 },
        ],
        totalCount: 3,
      })
    );
    assert.ok(html.includes("사진"), html);
    assert.ok(html.includes("연락서.xlsx"), html);
    assert.ok(html.includes("시각없음.pdf"), html);
    // 크기는 첨부 목록과 같은 함수로 적는다(formatBytes).
    assert.ok(html.includes("1.0 KB"), html);
    assert.ok(html.includes("512 B"), html);
    // 폴더 줄은 크기 대신 「폴더」다.
    assert.ok(html.includes("폴더</span>") || html.includes("폴더 ·"), html);
    // 수정 시각은 사람이 읽는 모양이다 — 날것(ISO)이 그대로 나가지 않는다.
    assert.equal(html.includes("2026-09-08T01:00:00.000Z"), false, html);
    assert.ok(html.includes("2026"), html);
    // 찾은 폴더 이름은 머리에 적는다.
    assert.ok(html.includes(FOLDER), html);
  });

  /**
   * 🔴 2026-10-05(조각 4) — 예전에는 「각 줄에 [열기] 단추가 **아직** 없다」였다. 조각 4 가
   * 줄마다 [열기]를 달았으므로 그 시험을 새 사실로 다시 쓴다. 지켜지는 것은 그대로다:
   * **서버 렌더(= Windows 가 아닌 PC)에서는 단추가 하나도 안 그려진다.** 도우미는 Windows
   * PC 에만 설치되므로 휴대폰 · Mac 에서는 눌러도 할 수 있는 일이 없다.
   * 어느 줄이 [열기]를 받는가는 아래 「줄마다 [열기]」 블록이 본다.
   */
  test("🔴 Windows 가 아니면(서버 렌더) 줄의 [열기]가 안 그려진다 — 링크도 아니다", () => {
    const html = markup(
      foundState({ entries: [{ name: "연락서.xlsx", isDirectory: false, sizeBytes: 10 }], totalCount: 1 })
    );
    assert.equal(html.includes("<button"), false, html);
    assert.equal(html.includes("href="), false, html);
    assert.equal(html.includes(">열기<"), false, html);
    // 단추 자리가 생기는 줄인지는 표시로 남는다(아래 블록).
    assert.ok(html.includes("data-contact-folder-entry-openable"), html);
  });

  test("🔴 multiple — 「맞는 폴더가 여럿입니다」, 목록을 내지 않는다", () => {
    const html = markup({ kind: "multiple", folderNames: [FOLDER, "D260908 INVENIA 나중에 또 만든 폴더"] });
    assert.ok(html.includes("맞는 폴더가 여럿입니다"), html);
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_MULTIPLE_TEXT), html);
    // 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 이름만 적는다.
    assert.ok(html.includes("D260908 INVENIA 나중에 또 만든 폴더"), html);
    assert.equal(html.includes(CONTACT_FOLDER_SECTION_EMPTY_TEXT), false, html);
  });

  test("failed — 「공유폴더를 읽지 못했습니다」와 짧은 사유", () => {
    const html = markup({ kind: "failed", reason: "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요)." });
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_FAILED_TEXT), html);
    assert.ok(html.includes("공유폴더에 연결할 수 없습니다"), html);
    // 경고 색이다(muted 가 아니다).
    assert.ok(html.includes("text-amber-700"), html);
  });

  test("🔴 줄 수 상한에 걸리면 잘린 채 「더 있습니다」가 선다", () => {
    const html = markup(
      foundState({
        entries: [
          { name: "1.jpg", isDirectory: false, sizeBytes: 1 },
          { name: "2.jpg", isDirectory: false, sizeBytes: 2 },
        ],
        totalCount: 1200,
        truncated: true,
      })
    );
    assert.ok(html.includes("더 있습니다"), html);
    assert.ok(html.includes("1200"), html);
    assert.ok(html.includes("앞의 2개만"), html);
  });
});

describe("🔴 인쇄에 찍히지 않는다", () => {
  test("그려지는 모든 상태에 print:hidden 이 있다", () => {
    assert.ok(sectionSource.includes("print:hidden"), "print:hidden 이 없다");
    const states: ContactFolderSectionState[] = [
      { kind: "loading" },
      { kind: "not-found" },
      { kind: "multiple", folderNames: [FOLDER] },
      { kind: "failed", reason: "까닭" },
      foundState(),
      foundState({ entries: [{ name: "연락서.xlsx", isDirectory: false, sizeBytes: 1 }], totalCount: 1 }),
    ];
    for (const state of states) {
      assert.ok(markup(state).includes("print:hidden"), state.kind);
    }
  });
});

/**
 * 🔴 2026-10-05(조각 4) — 제목에서 「열지도」를 뺐다. 줄마다 [열기]가 붙었기 때문이다.
 * 🔴 **그러나 여는 길은 그 PC 의 도우미뿐이다** — 아래 금지 목록은 한 줄도 느슨해지지 않았다:
 * 서버가 파일 바이트를 중계하는 길(내려받기 · blob) · 쓰기 · 페이지 이동이 여전히 없다.
 */
describe("🔴 서버가 중계하지 않는다 — 만들지도 올리지도 지우지도 않는다", () => {
  test("원본에 쓰기 · 내려받기 · 페이지 이동 길이 없다", () => {
    const code = sectionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      /method:\s*"POST"/,
      /method:\s*"PUT"/,
      /method:\s*"DELETE"/,
      /FormData/,
      /\bdownload\b/,
      /saveBlobAsDownload/,
      /\.blob\(/,
      /window\.open\(/,
      /location\.(?:assign|replace|href)/,
      /console\./,
      /node:fs/,
      /"server-only"/,
      /@\/lib\/server\//,
    ]) {
      assert.equal(forbidden.test(code), false, `흔적: ${forbidden}`);
    }
    // 부르는 통로는 목록 하나뿐이다.
    assert.equal(code.match(/\/contact-folder\/entries/g)?.length, 1);
  });

  test("맨 아래 [폴더 열기]는 조각 2 의 단추를 **그대로** 쓴다 — 새로 만들지 않았다", () => {
    assert.ok(
      sectionSource.includes('import ContactFolderOpenButton from "@/components/repair-cases/detail/ContactFolderOpenButton";'),
      "조각 2 의 단추를 가져오지 않는다"
    );
    assert.equal(sectionSource.split("<ContactFolderOpenButton").length - 1, 1, "단추가 둘 이상이다");
    // 구역의 **맨 아래**다 — 그 뒤에는 닫는 틀뿐이다.
    const flat = sectionSource.replace(/\s+/g, " ");
    assert.ok(
      flat.includes("<ContactFolderOpenButton repairCaseId={repairCaseId} /> </section>"),
      "단추가 구역 맨 아래가 아니다"
    );
  });

  test("통로 주소는 수리 건 id 를 감싸 만든다", () => {
    assert.equal(contactFolderEntriesUrl("case 1/2"), "/api/repair-cases/case%201%2F2/contact-folder/entries");
  });
});

/**
 * ============================================================================
 * 🔴 줄마다 [열기] — 누를 수 있는 줄에만 단추가 생긴다 (조각 4)
 * ============================================================================
 * 「눌러서 거절당하는 것보다 누를 단추가 없는 것이 낫다」가 이 블록의 전부다.
 * 서버 렌더에서는 단추 자체가 안 그려지므로(Windows 가 아니다) **어느 줄이 단추 자리를
 * 갖는가**를 `data-contact-folder-entry-openable` 표시로 본다. 단추가 실제로 어떻게 생겼는지는
 * 아래 ContactFolderEntryOpenControl 을 직접 그려 본다.
 * 거절 규칙 자체는 lib/domain/quote-folder-file-link.test.ts 가 값으로 본다.
 * ============================================================================
 */
describe("🔴 줄마다 [열기] — 누를 수 있는 줄에만", () => {
  const entry = (name: string, isDirectory = false) => ({ name, isDirectory, sizeBytes: 1 });

  test("허용 목록에 든 파일 줄은 단추 자리를 갖는다", () => {
    for (const name of ["연락서.xlsm", "보고서.pdf", "사진.JPG", "목록.csv", "도면.zip"]) {
      assert.ok(canOpenContactFolderEntry(entry(name)), name);
    }
  });

  test("🔴 폴더 줄에는 [열기] 대신 아무것도 두지 않는다 — 하위 폴더는 범위 밖", () => {
    for (const name of ["사진", "연락서.pdf", "하위.zip"]) {
      assert.equal(canOpenContactFolderEntry(entry(name, true)), false, name);
    }
    const html = markup(
      foundState({ entries: [entry("사진", true), entry("자료.zip", true)], totalCount: 2 })
    );
    assert.equal(html.includes("data-contact-folder-entry-openable"), false, html);
  });

  test("🔴 허용 목록 밖 · 확장자 없는 파일 줄에는 단추 자리가 없다", () => {
    const names = ["설치.exe", "실행.BAT", "바로가기.lnk", "스크립트.ps1", "문서", "보고서.pdf.", "보고서.pdf "];
    for (const name of names) {
      assert.equal(canOpenContactFolderEntry(entry(name)), false, name);
    }
    const html = markup(foundState({ entries: names.map((name) => entry(name)), totalCount: names.length }));
    assert.equal(html.includes("data-contact-folder-entry-openable"), false, html);
    // 이름은 그대로 보인다 — 숨기는 것이 아니라 누를 단추만 없다.
    assert.ok(html.includes("설치.exe"), html);
  });

  test("섞여 있으면 열 수 있는 줄에만 표시가 붙는다", () => {
    const html = markup(
      foundState({
        entries: [entry("사진", true), entry("연락서.xlsm"), entry("설치.exe"), entry("보고서.pdf")],
        totalCount: 4,
      })
    );
    assert.equal(html.match(/data-contact-folder-entry-openable/g)?.length, 2, html);
  });

  test("🔴 폴더 이름을 모르면 아무 줄에도 단추를 두지 않는다 — 주소를 지어낼 수 없다", () => {
    const html = markup(foundState({ folderName: "", entries: [entry("연락서.xlsm")], totalCount: 1 }));
    assert.equal(html.includes("data-contact-folder-entry-openable"), false, html);
  });

  test("🔴 확장자를 세는 자리는 하나다 — 화면이 제 손으로 목록을 적지 않는다", () => {
    assert.ok(sectionSource.includes("isOpenableQuoteFolderFileName"), "순수 판정을 쓰지 않는다");
    // 주석(머리말이 `.exe` 를 예로 든다)을 걷어내고 **코드만** 본다.
    const code = sectionSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["xlsm", "\\.exe", "pdf", 'endsWith\\("\\.', "lastIndexOf"]) {
      assert.equal(new RegExp(forbidden).test(code), false, `화면이 확장자를 직접 센다: ${forbidden}`);
    }
  });
});

describe("🔴 줄의 [열기] 단추 — 그려지는 것", () => {
  const controlMarkup = () =>
    renderToStaticMarkup(
      createElement(ContactFolderEntryOpenControl, { folderName: FOLDER, fileName: "연락서.xlsm" })
    );

  test("단추 하나 · print:hidden · 링크가 아니다", () => {
    const html = controlMarkup();
    assert.ok(html.includes(">열기</button>"), html);
    assert.ok(html.includes("data-contact-folder-entry-open"), html);
    assert.ok(html.includes("print:hidden"), html);
    assert.equal(html.includes("href="), false, html);
  });

  test("🔴 Windows 가 아니면 아무것도 그리지 않는다 — 서버 렌더 · 첫 렌더도 감춘다", () => {
    assert.equal(
      renderToStaticMarkup(
        createElement(ContactFolderEntryOpenButton, { folderName: FOLDER, fileName: "연락서.xlsm" })
      ),
      ""
    );
    assert.ok(buttonSource.includes("const hiddenOnServer = () => false;"));
    assert.ok(buttonSource.includes("useSyncExternalStore(subscribeToNothing, isWindowsDesktopNow, hiddenOnServer)"));
    assert.ok(buttonSource.includes("if (!isWindows) return null;"));
  });

  test("🔴 복사 구현을 새로 만들지 않는다 — 견적서 쪽 길을 그대로 가져다 쓴다", () => {
    assert.ok(buttonSource.includes("runQuoteFolderHelperInstallCommandCopy"));
    for (const forbidden of ["execCommand", "navigator.clipboard.writeText", "console."]) {
      assert.equal(buttonSource.includes(forbidden), false, forbidden);
    }
  });

  test("🔴 서버 사슬을 부르지 않는다 — 그려 볼 수 있어야 한다", () => {
    for (const source of [buttonSource, openFlowSource]) {
      assert.equal(source.includes("@/lib/server/"), false, "서버 모듈을 부른다");
      assert.equal(source.includes('"server-only"'), false, "server-only 를 부른다");
    }
  });
});

describe("응답 읽기 — 알려진 칸만 옮긴다", () => {
  test("found — 모르는 칸은 버리고, 이름 없는 줄은 그 줄만 버린다", () => {
    const state = readContactFolderEntriesAnswer({
      status: "found",
      folderName: FOLDER,
      entries: [
        { name: "연락서.xlsx", isDirectory: false, sizeBytes: 10, modifiedAt: "2026-09-08T02:00:00.000Z", 전체경로: "\\\\NAS01" },
        { isDirectory: false, sizeBytes: 1 },
        { name: "사진", isDirectory: true, sizeBytes: 0 },
      ],
      totalCount: 3,
      truncated: false,
    });
    assert.equal(state?.kind, "found");
    if (state?.kind !== "found") throw new Error("unreachable");
    assert.deepEqual(
      state.entries.map((entry) => entry.name),
      ["연락서.xlsx", "사진"]
    );
    // 🔴 서버가 보낸 모르는 칸은 화면 값에 남지 않는다.
    assert.deepEqual(Object.keys(state.entries[0]).sort(), ["isDirectory", "modifiedAt", "name", "sizeBytes"]);
    assert.deepEqual(Object.keys(state.entries[1]).sort(), ["isDirectory", "name", "sizeBytes"]);
  });

  test("truncated 는 전체 수가 보이는 줄보다 많을 때만 선다", () => {
    const honest = readContactFolderEntriesAnswer({
      status: "found",
      folderName: FOLDER,
      entries: [{ name: "a", isDirectory: false, sizeBytes: 1 }],
      totalCount: 1,
      truncated: true,
    });
    assert.equal(honest?.kind === "found" && honest.truncated, false);
  });

  test("multiple · not-found · failed · 모양이 다른 응답", () => {
    assert.deepEqual(readContactFolderEntriesAnswer({ status: "multiple", folderNames: [FOLDER, 3] }), {
      kind: "multiple",
      folderNames: [FOLDER],
    });
    assert.deepEqual(readContactFolderEntriesAnswer({ status: "not-found" }), { kind: "not-found" });
    assert.deepEqual(readContactFolderEntriesAnswer({ status: "failed", reason: "  " }), {
      kind: "failed",
      reason: "까닭을 알 수 없습니다",
    });
    assert.equal(readContactFolderEntriesAnswer({ status: "무언가" }), null);
    assert.equal(readContactFolderEntriesAnswer(null), null);
    assert.equal(readContactFolderEntriesAnswer([{ status: "found" }]), null);
  });
});

describe("통로 부르기 — 던지지 않는다", () => {
  const ok = (payload: unknown) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(payload),
  });

  test("정상 — 받은 상태를 그대로 쓴다", async () => {
    const urls: string[] = [];
    const state = await loadContactFolderEntries("case-1", (url) => {
      urls.push(url);
      return Promise.resolve(ok({ status: "not-found" }));
    });
    assert.deepEqual(state, { kind: "not-found" });
    assert.deepEqual(urls, ["/api/repair-cases/case-1/contact-folder/entries"]);
  });

  test("네트워크가 끊겨도 던지지 않는다 — failed 한 상태로 끝난다", async () => {
    const state = await loadContactFolderEntries("case-1", () => Promise.reject(new Error("끊김")));
    assert.equal(state.kind, "failed");
    if (state.kind !== "failed") throw new Error("unreachable");
    assert.match(state.reason, /네트워크/);
  });

  test("서버가 거절하면 그 문장을, 읽을 수 없으면 HTTP 번호를", async () => {
    const forbidden = await loadContactFolderEntries("case-1", () =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "권한이 없습니다." }) })
    );
    assert.deepEqual(forbidden, { kind: "failed", reason: "권한이 없습니다." });

    const broken = await loadContactFolderEntries("case-1", () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error("본문 없음")) })
    );
    assert.equal(broken.kind, "failed");
    if (broken.kind !== "failed") throw new Error("unreachable");
    assert.match(broken.reason, /HTTP 500/);
  });

  test("모양이 다른 본문도 던지지 않는다", async () => {
    const state = await loadContactFolderEntries("case-1", () => Promise.resolve(ok({ status: "무언가" })));
    assert.equal(state.kind, "failed");
  });
});

describe("🔴 DB 첨부 목록을 건드리지 않는다 — 나란히 선 형제다", () => {
  test("DB 갈래에만, 정확히 하나, 그리고 **자기 닫는 태그**다(첨부 목록을 감싸지 않는다)", () => {
    assert.equal(filesScreen.split("<ContactFolderSection").length - 1, 1, "구역이 둘 이상이다");
    assert.ok(/<ContactFolderSection[^>]*\/>/.test(filesScreen), "자기 닫는 태그가 아니다");
    assert.equal(filesScreen.includes("</ContactFolderSection>"), false, "무언가를 감싸고 있다");
    assert.ok(filesScreen.includes("<ContactFolderSection repairCaseId={resolved.id} />"), "수리 건 id 를 건네지 않는다");

    const databaseAt = filesScreen.indexOf("function DatabaseFilesScreen");
    const demoAt = filesScreen.indexOf("function DemoFilesScreen");
    const sectionAt = filesScreen.indexOf("<ContactFolderSection");
    assert.ok(databaseAt >= 0 && demoAt >= 0 && sectionAt >= 0);
    assert.ok(databaseAt < sectionAt, "DB 갈래 앞에 있다");
    assert.ok(sectionAt < demoAt, "데모 갈래에 들어갔다");
  });

  test("첨부 목록 · 빈 목록 안내 · 휴지통은 그대로 있고, 구역은 그 뒤에 선다", () => {
    const listAt = filesScreen.indexOf("<StoredAttachmentList");
    const emptyAt = filesScreen.indexOf("아직 이 접수 건에 올라온 파일이 없습니다");
    const trashAt = filesScreen.indexOf("trashedAttachments.length > 0");
    const sectionAt = filesScreen.indexOf("<ContactFolderSection");
    assert.ok(listAt >= 0, "첨부 목록이 사라졌다");
    assert.ok(emptyAt >= 0, "빈 목록 안내가 사라졌다");
    assert.ok(trashAt >= 0, "휴지통이 사라졌다");
    assert.ok(emptyAt < sectionAt && listAt < sectionAt, "첨부 목록이 구역 뒤로 밀렸다");
  });

  test("🔴 서버 컴포넌트가 공유폴더를 읽지 않는다 — 화면이 뜬 뒤 클라이언트가 따로 부른다", () => {
    const page = readFileSync(
      new URL("../../../app/(app)/repair-cases/[id]/files/page.tsx", import.meta.url),
      "utf8"
    );
    for (const forbidden of ["contact-folder", "ContactFolderSection", "findContactFolder", "listContactFolderEntries"]) {
      assert.equal(page.includes(forbidden), false, `서버 컴포넌트가 공유폴더를 읽는다: ${forbidden}`);
    }
    assert.ok(sectionSource.startsWith('"use client";'), "클라이언트 조각이 아니다");
    assert.ok(sectionSource.includes("useEffect("), "화면이 뜬 뒤에 부르지 않는다");
  });

  test("공유폴더가 실패해도 이 구역만 바뀐다 — 그려지는 것이 제 안에서 끝난다", () => {
    const failedHtml = markup({ kind: "failed", reason: "공유폴더를 읽지 못했습니다." });
    for (const attachmentMarkup of ["StoredAttachmentList", "휴지통", "파일 올리기", "되살리기"]) {
      assert.equal(failedHtml.includes(attachmentMarkup), false, failedHtml);
    }
    assert.ok(failedHtml.startsWith("<section"), failedHtml.slice(0, 80));
  });
});

describe("기본 내보내기 — 처음에는 불러오는 중", () => {
  test("효과가 돌기 전(서버 렌더)에는 「불러오는 중…」이다", () => {
    const html = renderToStaticMarkup(createElement(ContactFolderSection, { repairCaseId: "case-1" }));
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_LOADING_TEXT), html);
    assert.ok(html.includes("print:hidden"), html);
  });
});
