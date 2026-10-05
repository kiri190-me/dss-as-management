import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildQuoteFolderFileLink, parseQuoteFolderFileLink } from "@/lib/domain/quote-folder-file-link";
import ContactFolderEntryOpenButton, { ContactFolderEntryOpenControl } from "./ContactFolderEntryOpenButton";
import ContactFolderPlaceOpenButton, { ContactFolderPlaceOpenControl } from "./ContactFolderPlaceOpenButton";
import { contactFolderFileRelativePath } from "./contact-folder-file-open";
import ContactFolderSection, {
  CONTACT_FOLDER_SECTION_EMPTY_TEXT,
  CONTACT_FOLDER_SECTION_FAILED_TEXT,
  CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT,
  CONTACT_FOLDER_SECTION_LOADING_TEXT,
  CONTACT_FOLDER_SECTION_MULTIPLE_TEXT,
  CONTACT_FOLDER_SECTION_NOT_FOUND_TEXT,
  ContactFolderSectionView,
  canOpenContactFolderEntry,
  contactFolderEntriesUrl,
  contactFolderParentPath,
  contactFolderPathSegments,
  contactFolderPlacePath,
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

  /**
   * 🔴 2026-10-05(조각 10) — 맨 아래 단추가 **보고 있는 자리**를 열게 됐다. 맨 위에서는
   * 조각 2 의 단추를 **그대로** 쓰고(폴더가 없을 때 [폴더 만들고 열기]가 거기 달려 있다),
   * 하위 폴더에서만 그 자리를 여는 단추가 선다. 지켜지는 것은 그대로다: 조각 2 의 단추를
   * 새로 만들지 않았고, 구역의 **맨 아래**이며, 둘 가운데 하나만 선다.
   */
  test("맨 아래 [폴더 열기] — 맨 위는 조각 2 의 단추 그대로, 하위 폴더에서는 그 자리를 연다", () => {
    assert.ok(
      sectionSource.includes('import ContactFolderOpenButton from "@/components/repair-cases/detail/ContactFolderOpenButton";'),
      "조각 2 의 단추를 가져오지 않는다"
    );
    assert.equal(sectionSource.split("<ContactFolderOpenButton").length - 1, 1, "단추가 둘 이상이다");
    assert.equal(sectionSource.split("<ContactFolderPlaceOpenButton").length - 1, 1, "자리 단추가 둘 이상이다");
    // 구역의 **맨 아래**다 — 그 뒤에는 닫는 틀뿐이고, 둘 중 하나만 그려진다.
    const flat = sectionSource.replace(/\s+/g, " ");
    assert.ok(
      flat.includes(
        '{atTop || placePath === "" ? ( <ContactFolderOpenButton repairCaseId={repairCaseId} /> ) : ' +
          "( <ContactFolderPlaceOpenButton relativePath={placePath} /> )} </section>"
      ),
      "단추가 구역 맨 아래가 아니거나 자리에 따라 갈리지 않는다"
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
    // 🔴 2026-10-05(조각 10) — 「다시 읽어라」 신호 하나가 늘었다. 건네는 것은 여전히 **값 둘**
    //    뿐이고, 구역이 첨부 목록 쪽으로 무언가를 돌려주는 길은 없다.
    assert.ok(
      filesScreen.includes("<ContactFolderSection repairCaseId={resolved.id} reloadToken={contactFolderReloadToken} />"),
      "수리 건 id · 다시 읽기 신호를 건네지 않는다"
    );

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
    // 🔴 **디스크를 두드리는 길이 하나도 없다** — NAS 가 느린 날 이 탭이 통째로 안 뜨면 안 된다.
    for (const forbidden of [
      "ContactFolderSection",
      "findContactFolder",
      "listContactFolderEntries",
      "createContactFolder",
      "copyIntoContactFolder",
      "requireExistingShareFolderRoot",
      "readdir",
    ]) {
      assert.equal(page.includes(forbidden), false, `서버 컴포넌트가 공유폴더를 읽는다: ${forbidden}`);
    }
    // 🔴 2026-10-05(조각 12) — 예전에는 「`contact-folder` 라는 글자가 아예 없다」로 보았다.
    //    이제 페이지가 **설정 하나**를 읽는다(공유폴더 기능이 켜졌는가 — [DATA에 저장] 단추를
    //    그릴지 정하는 깃발). 🔴 그것은 `process.env` 를 보는 것이고 **디스크를 건드리지
    //    않는다** — 위 금지 목록은 한 글자도 느슨해지지 않았고, 대신 그 한 자리만 열어 둔다.
    assert.deepEqual(
      [...page.matchAll(/\b(resolve|find|create|copyInto|list)[A-Za-z]*ContactFolder[A-Za-z]*\b/g)]
        .map((match) => match[0])
        .filter((name, index, all) => all.indexOf(name) === index),
      ["resolveContactFolderArchiveRoot"],
      "공유폴더를 만지는 자리가 「설정 읽기」 하나가 아니다"
    );
    assert.ok(page.includes("resolveContactFolderArchiveRoot() !== null"), "설정을 참/거짓으로만 쓰지 않는다");
    // 🔴 루트 값(.env)은 화면으로 가지 않는다.
    assert.equal(page.includes("CONTACT_FOLDER_ARCHIVE_DIR"), false, "루트 설정 이름이 페이지에 있다");

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

/**
 * ============================================================================
 * 🔴 (가) 하위 폴더 안으로 들어간다 (조각 10)
 * ============================================================================
 * 폴더 줄을 눌러 들어가고, 길 표시 · [위로]로 돌아 나온다. 들어갈 수 있는 **깊이 · 줄 수 ·
 * 기다리는 시간**의 상한과 경로 거절은 서버 쪽이 쥔다(lib/storage/contact-folder-entries.test.ts ·
 * route-source.test.ts). 여기서는 **화면이 무엇을 내는가**만 본다.
 * ============================================================================
 */
describe("🔴 하위 폴더 안으로 — 길 표시 · 들어가기 · 돌아 나오기", () => {
  const entry = (name: string, isDirectory = false) => ({ name, isDirectory, sizeBytes: 1 });
  const placeMarkup = (
    insidePath: string,
    state: ContactFolderSectionState = foundState({ entries: [entry("사진", true), entry("연락서.xlsm")], totalCount: 2 }),
    onNavigate?: (next: string) => void
  ) =>
    renderToStaticMarkup(
      createElement(ContactFolderSectionView, {
        state,
        repairCaseId: "case-1",
        insidePath,
        ...(onNavigate === undefined ? {} : { onNavigate }),
      })
    );

  test("통로 주소 — 맨 위는 조각 3 때와 **한 글자도 같고**, 자리가 있을 때만 ?path 가 붙는다", () => {
    assert.equal(contactFolderEntriesUrl("case-1"), "/api/repair-cases/case-1/contact-folder/entries");
    assert.equal(contactFolderEntriesUrl("case-1", ""), "/api/repair-cases/case-1/contact-folder/entries");
    assert.equal(
      contactFolderEntriesUrl("case-1", "사진/2026"),
      "/api/repair-cases/case-1/contact-folder/entries?path=%EC%82%AC%EC%A7%84%2F2026"
    );
    // 🔴 수상한 값도 그대로 싣지 않는다 — 감싸서 보내고, 거절은 서버가 한다.
    assert.equal(
      contactFolderEntriesUrl("case-1", "../비밀"),
      "/api/repair-cases/case-1/contact-folder/entries?path=..%2F%EB%B9%84%EB%B0%80"
    );
  });

  test("길 · 한 칸 위 · 루트 아래 상대 경로를 세는 순수 함수들", () => {
    assert.deepEqual(contactFolderPathSegments(""), []);
    assert.deepEqual(contactFolderPathSegments("사진"), ["사진"]);
    assert.deepEqual(contactFolderPathSegments("사진//2026/"), ["사진", "2026"]);
    assert.equal(contactFolderParentPath("사진/2026"), "사진");
    assert.equal(contactFolderParentPath("사진"), "");
    assert.equal(contactFolderParentPath(""), "");
    assert.equal(contactFolderPlacePath(FOLDER, ""), FOLDER);
    assert.equal(contactFolderPlacePath(FOLDER, "사진/2026"), `${FOLDER}/사진/2026`);
    // 🔴 폴더 이름을 모르면 빈 글자다 — 주소를 지어내지 않는다.
    assert.equal(contactFolderPlacePath("", "사진"), "");
  });

  test("맨 위에서는 길 표시도 [위로]도 없다 — 조각 3 때 그대로다", () => {
    const html = placeMarkup("", undefined, () => undefined);
    assert.equal(html.includes("data-contact-folder-trail"), false, html);
    assert.equal(html.includes("data-contact-folder-up"), false, html);
    // 폴더 이름은 머리에 그대로 적힌다.
    assert.ok(html.includes(FOLDER), html);
  });

  test("🔴 길 표시가 맞게 그려진다 — 토막마다 돌아가는 단추, 지금 자리는 단추가 아니다", () => {
    const html = placeMarkup("사진/2026", undefined, () => undefined);
    assert.ok(html.includes("data-contact-folder-trail"), html);
    assert.ok(html.includes(FOLDER), html);
    assert.ok(html.includes("사진"), html);
    assert.ok(html.includes("2026"), html);
    assert.ok(html.indexOf(FOLDER) < html.indexOf("사진"), "길 차례가 뒤바뀌었다");
    // 되돌아갈 수 있는 토막은 **맨 위 · 사진** 둘이고, 지금 자리(2026)는 단추가 아니다.
    assert.equal(html.match(/data-contact-folder-trail-step/g)?.length, 2, html);
    assert.ok(html.includes('aria-current="true"'), html);
    assert.ok(html.includes("data-contact-folder-up"), html);
    assert.ok(html.includes(">위로</button>"), html);
    // 🔴 링크가 아니다 — 눌러도 페이지를 떠나지 않는다.
    assert.equal(html.includes("href="), false, html);
  });

  test("🔴 폴더 이름을 모를 때(실패)도 길과 [위로]는 남는다 — 돌아 나올 길이 있어야 한다", () => {
    const html = placeMarkup("사진/2026", { kind: "failed", reason: "공유폴더를 읽지 못했습니다." }, () => undefined);
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_FAILED_TEXT), html);
    assert.ok(html.includes("맨 위 폴더"), html);
    assert.ok(html.includes("data-contact-folder-up"), html);
  });

  test("🔴 들어갈 길(onNavigate)이 없으면 누를 수 있는 것이 하나도 생기지 않는다", () => {
    const html = placeMarkup("사진");
    assert.equal(html.includes("<button"), false, html);
    assert.equal(html.includes("data-contact-folder-enter"), false, html);
    assert.equal(html.includes("data-contact-folder-trail-step"), false, html);
    assert.equal(html.includes("data-contact-folder-up"), false, html);
    // 길 자체는 보인다 — 어디에 있는지는 알아야 한다.
    assert.ok(html.includes("data-contact-folder-trail"), html);
  });

  test("🔴 폴더 줄만 눌린다 — 파일 줄은 그대로 글자다", () => {
    const html = placeMarkup(
      "",
      foundState({ entries: [entry("사진", true), entry("OLD", true), entry("연락서.xlsm")], totalCount: 3 }),
      () => undefined
    );
    assert.equal(html.match(/data-contact-folder-enter/g)?.length, 2, html);
    // 파일 이름은 단추 밖에 그대로 있다.
    assert.ok(html.includes("연락서.xlsm"), html);
  });

  test("🔴 누르면 지금 자리에 이름을 이어 부른다 — 들어가고, 토막으로 돌아가고, 위로", () => {
    const asked: string[] = [];
    const html = placeMarkup(
      "사진",
      foundState({ entries: [entry("2026", true)], totalCount: 1 }),
      (next) => asked.push(next)
    );
    assert.ok(html.includes("data-contact-folder-enter"), html);

    // 그려진 것만으로는 누를 수 없으므로, 같은 셈을 값으로 확인한다.
    const insidePath = "사진";
    assert.equal([...contactFolderPathSegments(insidePath), "2026"].join("/"), "사진/2026");
    assert.equal(contactFolderParentPath("사진/2026"), "사진");
    assert.deepEqual(asked, []);
  });

  test("🔴 하위 폴더에서도 줄의 [열기]가 산다 — 폴더 경로에 자리가 이어져 들어간다", () => {
    const html = placeMarkup(
      "사진/2026",
      foundState({ entries: [entry("연락서.xlsm"), entry("설치.exe")], totalCount: 2 }),
      () => undefined
    );
    // 열 수 있는 줄에만 단추 자리가 생긴다(허용 목록은 조각 4 그대로다).
    assert.equal(html.match(/data-contact-folder-entry-openable/g)?.length, 1, html);

    // 🔴 도우미가 받는 주소에 **여러 마디 경로**가 그대로 들어간다 — 되읽어 같은 값이 나온다.
    const placePath = contactFolderPlacePath(FOLDER, "사진/2026");
    const relative = contactFolderFileRelativePath(placePath, "연락서.xlsm");
    assert.equal(relative, `${FOLDER}/사진/2026/연락서.xlsm`);
    const link = buildQuoteFolderFileLink(relative);
    assert.ok(link !== null, "하위 폴더 파일의 주소를 만들지 못했다");
    assert.equal(parseQuoteFolderFileLink(link), relative);
  });

  test("🔴 빈 폴더 · 잘림은 자리에 맞는 말로", () => {
    const empty = placeMarkup("사진", foundState(), () => undefined);
    assert.ok(empty.includes(`>${CONTACT_FOLDER_SECTION_INSIDE_EMPTY_TEXT}<`), empty);
    assert.equal(empty.includes(`>${CONTACT_FOLDER_SECTION_EMPTY_TEXT}<`), false, empty);
    assert.ok(markup(foundState()).includes(`>${CONTACT_FOLDER_SECTION_EMPTY_TEXT}<`), "맨 위 말이 바뀌었다");
  });

  test("🔴 인쇄에는 그대로 안 찍힌다 — 길 표시가 생겨도", () => {
    assert.ok(placeMarkup("사진/2026", undefined, () => undefined).includes("print:hidden"));
  });

  test("🔴 하위 폴더에서 여는 단추도 Windows 가 아니면 아무것도 그리지 않는다", () => {
    assert.equal(
      renderToStaticMarkup(createElement(ContactFolderPlaceOpenButton, { relativePath: `${FOLDER}/사진` })),
      ""
    );
    const control = renderToStaticMarkup(
      createElement(ContactFolderPlaceOpenControl, { relativePath: `${FOLDER}/사진` })
    );
    assert.ok(control.includes(">폴더 열기</button>"), control);
    assert.ok(control.includes("data-contact-folder-place-open"), control);
    assert.ok(control.includes("print:hidden"), control);
    assert.equal(control.includes("href="), false, control);
    // 🔴 서버 렌더에서는 구역 안에도 단추가 하나도 안 그려진다(위 Windows 가림과 같다).
    assert.equal(placeMarkup("사진/2026", undefined, () => undefined).includes("data-contact-folder-place-open"), false);
  });
});

/**
 * ============================================================================
 * 🔴 (나) 올린 뒤 바로 보인다 (조각 10)
 * ============================================================================
 * 올리기가 끝나면 이 구역을 **다시 읽는다**. 🔴 DB 첨부 목록을 갱신하는 방식(router.refresh)은
 * 한 글자도 바뀌지 않았고, 다시 읽기는 이 구역 안에서 끝난다 — 실패해도 올리기 결과 알림을
 * 건드릴 수 없다(건드릴 길이 없다).
 * ============================================================================
 */
describe("🔴 올린 뒤 바로 보인다 — 다시 읽기", () => {
  const uploadBody = filesScreen.slice(
    filesScreen.indexOf("async function handleUpload"),
    filesScreen.indexOf("  return (", filesScreen.indexOf("async function handleUpload"))
  );

  test("올리기가 끝나면 DB 목록을 다시 받는 **그 자리에서** 공유폴더도 다시 읽는다", () => {
    assert.ok(uploadBody.length > 0, "handleUpload 를 찾지 못했다");
    const uploadedAt = uploadBody.indexOf("if (uploaded > 0) {");
    const refreshAt = uploadBody.indexOf("router.refresh();", uploadedAt);
    const reloadAt = uploadBody.indexOf("setContactFolderReloadToken(");
    assert.ok(uploadedAt >= 0 && refreshAt >= 0, "올린 뒤 목록을 다시 받는 자리가 사라졌다");
    assert.ok(reloadAt > refreshAt, "공유폴더 구역에 다시 읽으라고 알리지 않는다");
    // 🔴 DB 목록 갱신 방식은 그대로다 — 화면에서 지어내지 않고 서버에서 다시 받는다.
    assert.ok(filesScreen.includes("const router = useRouter();"));
    assert.equal(uploadBody.match(/setContactFolderReloadToken\(/g)?.length, 1, "여러 번 알린다");
    assert.ok(filesScreen.includes("setContactFolderReloadToken((token) => token + 1);"));
  });

  test("🔴 올리기 결과 알림을 건드리지 않는다 — 알린 뒤에는 아무 말도 지우지 않는다", () => {
    const reloadAt = uploadBody.indexOf("setContactFolderReloadToken(");
    assert.ok(uploadBody.indexOf("showSavePopup({") < reloadAt, "알림보다 먼저 다시 읽으라고 한다");
    // 알린 **뒤**(올리기 묶음이 끝날 때까지)에는 알림을 건드리는 곳이 없다. 그 뒤의
    // `catch` 는 올리기 자체가 깨졌을 때의 길이고, 다시 읽기는 저 구역 안에서 끝난다.
    const afterReload = uploadBody.slice(reloadAt, uploadBody.indexOf("} catch {", reloadAt));
    assert.ok(afterReload.length > 0, "올리기 묶음의 끝을 찾지 못했다");
    assert.equal(afterReload.includes("setStatusMessage("), false, "다시 읽으라고 한 뒤에 알림을 건드린다");
    assert.equal(afterReload.includes("showSavePopup("), false, "다시 읽으라고 한 뒤에 팝업을 또 띄운다");
    // 🔴 구역이 올리기 화면 쪽으로 무언가를 돌려주는 길이 없다 — 받는 것은 값 둘뿐이다.
    assert.ok(
      sectionSource.includes("export default function ContactFolderSection({\n  repairCaseId,\n  reloadToken = 0,\n}: {"),
      "구역이 받는 것이 값 둘이 아니다"
    );
    for (const forbidden of ["onReload", "onLoaded", "onError", "setStatusMessage"]) {
      assert.equal(sectionSource.includes(forbidden), false, `구역이 바깥 상태를 건드린다: ${forbidden}`);
    }
  });

  test("🔴 다시 읽어도 보고 있던 자리는 그대로다 — 맨 위로 튕기지 않는다", () => {
    const effect = sectionSource.slice(
      sectionSource.indexOf("  useEffect(() => {"),
      sectionSource.indexOf("}, [repairCaseId, insidePath, reloadToken]);")
    );
    assert.ok(effect.length > 0, "다시 읽는 효과를 찾지 못했다");
    assert.ok(effect.includes("loadContactFolderEntries(repairCaseId, undefined, insidePath)"), effect);
    // 🔴 다시 읽기가 자리를 건드리지 않는다.
    assert.equal(effect.includes("setPlace("), false, "다시 읽으면서 자리를 옮긴다");
    // 자리를 옮기는 곳은 사람이 누르는 한 곳뿐이다.
    assert.equal(sectionSource.match(/setPlace\(/g)?.length, 1, "자리를 옮기는 곳이 여럿이다");
    assert.ok(sectionSource.includes("onNavigate={(next) => setPlace({ repairCaseId, path: next })}"));
  });

  test("🔴 다시 읽기가 실패해도 던지지 않는다 — 이 구역만 「읽지 못했습니다」가 된다", async () => {
    const state = await loadContactFolderEntries("case-1", () => Promise.reject(new Error("끊김")), "사진/2026");
    assert.equal(state.kind, "failed");
    const html = renderToStaticMarkup(
      createElement(ContactFolderSectionView, {
        state,
        repairCaseId: "case-1",
        insidePath: "사진/2026",
        onNavigate: () => undefined,
      })
    );
    assert.ok(html.includes(CONTACT_FOLDER_SECTION_FAILED_TEXT), html);
    // 올리기 쪽 말은 이 구역이 그리지 않는다.
    for (const uploadMarkup of ["올렸습니다", "파일 올리기", "휴지통"]) {
      assert.equal(html.includes(uploadMarkup), false, html);
    }
  });

  test("다시 읽을 때도 같은 자리를 묻는다 — 주소에 그 자리가 실린다", async () => {
    const urls: string[] = [];
    await loadContactFolderEntries(
      "case-1",
      (url) => {
        urls.push(url);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: "not-found" }) });
      },
      "사진"
    );
    assert.deepEqual(urls, ["/api/repair-cases/case-1/contact-folder/entries?path=%EC%82%AC%EC%A7%84"]);
  });
});
