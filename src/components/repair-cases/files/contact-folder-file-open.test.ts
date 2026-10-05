import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  type QuoteFolderHelperStorage,
} from "@/components/quotes/quote-folder-open";
import {
  QUOTE_FOLDER_FILE_LINK_PREFIX,
  parseQuoteFolderFileLink,
} from "@/lib/domain/quote-folder-file-link";
import {
  CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT,
  CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT,
  CONTACT_FOLDER_FILE_UNOPENABLE_TEXT,
  contactFolderFileRelativePath,
  runContactFolderFileOpen,
  type ContactFolderFileOpenEnvironment,
} from "./contact-folder-file-open";

/**
 * ============================================================================
 * 공유폴더 목록의 [열기] — 주소 만들기 · 도우미 감지 · 늘 설치로 이끌기 (연락서 조각 4)
 * ============================================================================
 * 주소 열기 · 창 이벤트 · 시계 · 저장소를 모두 바꿔 끼운다 — DOM 도 네트워크도 없다.
 *
 * 불변식 넷:
 *  (a) 🔴 **fetch 가 없다** — 서버가 파일을 중계하지 않는다. 여는 것은 그 PC 가 한다.
 *  (b) 🔴 여는 주소는 `openfile/` 접두어이고, 몸통은 **폴더 이름 + 파일 이름**뿐이다.
 *  (c) 🔴 **한 번이라도 열어 본 결과에는 늘 설치로 가는 길**이 붙는다 — 예전 도우미는
 *      openfile 주소를 받으면 조용히 끝난다(exit 2). 화면은 그것을 알 수 없다.
 *  (d) 「도우미 확인됨」 표시는 견적서 · 연락서 폴더 열기와 **같은 열쇠**다(도우미가 한 벌).
 * ============================================================================
 */

const FOLDER = "D260908 INVENIA & 주성 T2RCONT-AD2 WN3947 100% 점검요청";
const FILE = "D260908 연락서 (주)한국 100%.xlsm";

type HarnessOptions = {
  focusLost?: "sync" | "async";
  confirmedBefore?: boolean;
  storage?: "ok" | "getterThrows" | "methodsThrow" | "none";
  openThrows?: boolean;
  watchThrows?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const opened: string[] = [];
  const delays: number[] = [];
  const store = new Map<string, string>();
  if (options.confirmedBefore) store.set(QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "1");
  let listener: (() => void) | null = null;
  let activeWatchers = 0;

  const okStorage: QuoteFolderHelperStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  const throwingStorage: QuoteFolderHelperStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  const env: Partial<ContactFolderFileOpenEnvironment> = {
    openLink: (link) => {
      if (options.openThrows) throw new Error("주소를 열 수 없습니다");
      opened.push(link);
      if (options.focusLost === "sync") listener?.();
    },
    watchFocusLoss: (onLost) => {
      if (options.watchThrows) throw new Error("들을 수 없습니다");
      activeWatchers += 1;
      listener = onLost;
      return () => {
        activeWatchers -= 1;
        listener = null;
      };
    },
    delay: async (ms) => {
      delays.push(ms);
      if (options.focusLost === "async") listener?.();
    },
    storage: () => {
      if (options.storage === "getterThrows") throw new Error("localStorage 접근이 막혔습니다");
      if (options.storage === "none") return null;
      return options.storage === "methodsThrow" ? throwingStorage : okStorage;
    },
  };

  return {
    env,
    opened,
    delays,
    store,
    watchersLeft: () => activeWatchers,
  };
}

function textsOf(lines: readonly { text: string }[]): string[] {
  return lines.map((line) => line.text);
}

describe("여는 주소", () => {
  test("🔴 openfile 접두어 · 몸통은 폴더 이름 + 파일 이름뿐이다", async () => {
    const stage = harness({ focusLost: "sync" });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "OPENED");
    assert.equal(stage.opened.length, 1);
    const link = stage.opened[0];
    assert.ok(link.startsWith(QUOTE_FOLDER_FILE_LINK_PREFIX), link);
    assert.equal(parseQuoteFolderFileLink(link), `${FOLDER}/${FILE}`);
    // 몸통에는 base64url 글자뿐이다 — 명령줄 · 셸을 지나며 해석될 글자가 없다.
    assert.match(link.slice(QUOTE_FOLDER_FILE_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/);
  });

  test("폴더 이름과 파일 이름을 잇는 자리는 하나다", () => {
    assert.equal(contactFolderFileRelativePath(FOLDER, FILE), `${FOLDER}/${FILE}`);
  });

  test("🔴 열 수 없는 이름이면 주소를 만들지 않고 끝난다 — 설치를 권하지도 않는다", async () => {
    for (const fileName of ["설치.exe", "문서", "보고서.pdf.", "하위/연락서.pdf"]) {
      const stage = harness({ focusLost: "sync" });
      const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName, env: stage.env });
      assert.equal(outcome.kind, "FAILED", fileName);
      assert.deepEqual(stage.opened, [], fileName);
      assert.equal(outcome.offerHelperInstall, false, fileName);
      assert.deepEqual(textsOf(outcome.lines), [CONTACT_FOLDER_FILE_UNOPENABLE_TEXT], fileName);
    }
  });

  test("🔴 폴더 이름이 규칙 밖이어도 열지 않는다", async () => {
    const stage = harness({ focusLost: "sync" });
    const outcome = await runContactFolderFileOpen({
      folderName: "..",
      fileName: "연락서.pdf",
      env: stage.env,
    });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(stage.opened, []);
  });
});

describe("도우미 감지", () => {
  test("초점을 잃으면 OPENED — 「확인됨」 표시를 적는다(견적서와 같은 열쇠)", async () => {
    const stage = harness({ focusLost: "sync" });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "OPENED");
    assert.equal(stage.store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    assert.equal(stage.watchersLeft(), 0, "듣기를 풀지 않았다");
  });

  test("조금 뒤에 초점을 잃어도 OPENED — 기다리는 시간은 견적서와 같다", async () => {
    const stage = harness({ focusLost: "async" });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(stage.delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
  });

  test("반응이 없고 표시도 없으면 NO_RESPONSE — 설치로 이끈다", async () => {
    const stage = harness();
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.ok(textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT));
    assert.ok(textsOf(outcome.lines).some((text) => text.includes(FILE)));
  });

  test("반응이 없어도 표시가 있으면 「없다」고 말하지 않는다", async () => {
    const stage = harness({ confirmedBefore: true });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.equal(textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT), false);
  });

  test("브라우저가 주소를 열지 못하면 FAILED — 던지지 않는다", async () => {
    const stage = harness({ openThrows: true });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "FAILED");
    assert.equal(outcome.offerHelperInstall, false);
    assert.equal(stage.watchersLeft(), 0, "듣기를 풀지 않았다");
  });

  test("저장소가 없거나 던져도 돈다 — 표시가 없는 것으로 본다", async () => {
    for (const storage of ["none", "getterThrows", "methodsThrow"] as const) {
      const quiet = harness({ storage });
      assert.equal(
        (await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: quiet.env })).kind,
        "NO_RESPONSE",
        storage
      );
      const lost = harness({ storage, focusLost: "sync" });
      assert.equal(
        (await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: lost.env })).kind,
        "OPENED",
        storage
      );
    }
  });

  test("창 이벤트를 들을 수 없어도 돈다 — 시간만 기다린다", async () => {
    const stage = harness({ watchThrows: true });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.deepEqual(stage.delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
  });
});

describe("🔴 늘 설치로 이끈다 — 예전 도우미는 조용히 끝난다", () => {
  test("열렸든 안 열렸든 결과 줄에 「다시 설치」 한 줄이 들어 있다", async () => {
    for (const options of [
      { focusLost: "sync" as const },
      { focusLost: "async" as const },
      { confirmedBefore: true },
      {},
    ]) {
      const stage = harness(options);
      const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
      assert.ok(
        textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT),
        `${outcome.kind}: ${textsOf(outcome.lines).join(" / ")}`
      );
      assert.equal(outcome.offerHelperInstall, true, outcome.kind);
    }
  });

  test("그 줄은 설치 명령 복사를 가리킨다", () => {
    assert.ok(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT.includes("설치 명령 복사"));
    assert.ok(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT.includes("예전"));
  });
});

describe("🔴 서버를 거치지 않는다", () => {
  test("흐름 원본에 fetch · 내려받기 · 페이지 이동이 없다", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./contact-folder-file-open.ts", import.meta.url), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      "fetch(",
      "/api/",
      ".blob(",
      "download",
      "window.open(",
      "location.assign(",
      "location.href =",
      "location.replace(",
      "console.",
      "node:fs",
      '"server-only"',
      "@/lib/server/",
    ]) {
      assert.equal(code.includes(forbidden), false, `흔적: ${forbidden}`);
    }
    // 주소는 숨은 iframe 으로 연다 — 페이지를 떠나지 않는다.
    assert.ok(source.includes('document.createElement("iframe")'));
  });
});
