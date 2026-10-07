import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  type QuoteFolderHelperStorage,
} from "@/components/quotes/quote-folder-open";
import {
  QUOTE_FOLDER_FILE_LINK_PREFIX,
  parseQuoteFolderFileLink,
} from "@/lib/domain/quote-folder-file-link";
import { ContactFolderEntryOpenOutcomeNotice } from "./ContactFolderEntryOpenButton";
import {
  CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT,
  CONTACT_FOLDER_FILE_HELPER_GENERATION,
  CONTACT_FOLDER_FILE_HELPER_KEY,
  CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT,
  CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT,
  CONTACT_FOLDER_FILE_UNOPENABLE_TEXT,
  contactFolderFileOutcomeWithoutHelperOffer,
  contactFolderFileRelativePath,
  readContactFolderFileHelperKnown,
  rememberContactFolderFileHelper,
  runContactFolderFileOpen,
  shouldOfferContactFolderFileHelperInstall,
  type ContactFolderFileOpenEnvironment,
  type ContactFolderFileOpenOutcome,
} from "./contact-folder-file-open";

/**
 * ============================================================================
 * 공유폴더 목록의 [열기] — 주소 만들기 · 도우미 감지 · **안내를 낼지 말지** (연락서 조각 4)
 * ============================================================================
 * 주소 열기 · 창 이벤트 · 시계 · 저장소를 모두 바꿔 끼운다 — DOM 도 네트워크도 없다.
 *
 * 불변식 넷:
 *  (a) 🔴 **fetch 가 없다** — 서버가 파일을 중계하지 않는다. 여는 것은 그 PC 가 한다.
 *  (b) 🔴 여는 주소는 `openfile/` 접두어이고, 몸통은 **폴더 이름 + 파일 이름**뿐이다.
 *  (c) 🔴 설치 안내는 **파일 열기 표시가 없는 PC 에만** 붙는다(2026-10-07). 표시가 있으면
 *      줄도 [설치 명령 복사] 단추도 없다. 표시를 적는 때는 둘뿐 — 초점을 잃었을 때와
 *      사람이 [그만 보기]를 눌렀을 때.
 *  (d) 「도우미 확인됨」 표시(폴더 열기용)는 견적서 · 연락서와 **같은 열쇠** 그대로이고,
 *      파일 열기 표시는 **세대 번호가 붙은 다른 열쇠**다 — 성질이 다른 둘을 함께 본다.
 * ============================================================================
 */

const FOLDER = "D260908 INVENIA & 주성 T2RCONT-AD2 WN3947 100% 점검요청";
const FILE = "D260908 연락서 (주)한국 100%.xlsm";

type HarnessOptions = {
  focusLost?: "sync" | "async";
  confirmedBefore?: boolean;
  /** 이 PC 에 「파일 열기를 아는 도우미가 있다」는 표시가 이미 있다. */
  openFileKnownBefore?: boolean;
  storage?: "ok" | "getterThrows" | "methodsThrow" | "none";
  openThrows?: boolean;
  watchThrows?: boolean;
};

function harness(options: HarnessOptions = {}) {
  const opened: string[] = [];
  const delays: number[] = [];
  const store = new Map<string, string>();
  if (options.confirmedBefore) store.set(QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "1");
  if (options.openFileKnownBefore) store.set(CONTACT_FOLDER_FILE_HELPER_KEY, "1");
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

/** Map 하나를 localStorage 처럼 보이게 한다 — 표시를 직접 읽고 쓰는 함수들을 잴 때 쓴다. */
function fakeStorage(store: Map<string, string>): QuoteFolderHelperStorage {
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
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
  test("초점을 잃으면 OPENED — 표시 **둘 다** 적는다(폴더 열기용 · 파일 열기용)", async () => {
    const stage = harness({ focusLost: "sync" });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "OPENED");
    // 견적서 · 연락서 폴더 열기와 같은 열쇠 — 뜻도 쓰임도 그대로다.
    assert.equal(stage.store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    // 🔴 「이 PC 는 파일 열기를 안다」 — 초점을 잃었다는 것이 그 증거다(설계 c).
    assert.equal(stage.store.get(CONTACT_FOLDER_FILE_HELPER_KEY), "1");
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

/*
 * ============================================================================
 * 🔴 설치 안내를 **낼지 말지** (2026-10-07 사용자 요구)
 * ============================================================================
 * 「파일 열기가 되는 도우미가 이미 깔린 PC 에서는 안내를 안 그린다.」 예전에는 이 블록이
 * 「열렸든 안 열렸든 **늘** 낸다」를 못 박고 있었다 — 그때는 **가를 신호가 없다**고 보았기
 * 때문이다. 신호는 있었다: 예전 도우미는 `openfile` 주소를 받으면 아무 창도 띄우지 않아
 * 초점을 못 뺏고, 새 도우미만 연결 프로그램을 띄워 초점을 가져간다. 그래서 단언을 **지우지
 * 않고** 「표시가 없으면 나온다 · 있으면 안 나온다」 **둘 다 재는 모양**으로 바꿨다.
 * ============================================================================
 */
describe("🔴 설치 안내는 모르는 PC 에만 — 표시가 없으면 나오고, 있으면 줄도 단추도 없다", () => {
  test("표시가 없으면 나온다 — 반응이 없을 때 · 폴더 열기 표시만 있을 때", async () => {
    for (const options of [{}, { confirmedBefore: true }] satisfies HarnessOptions[]) {
      const stage = harness(options);
      const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
      assert.ok(
        textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT),
        `${outcome.kind}: ${textsOf(outcome.lines).join(" / ")}`
      );
      assert.equal(outcome.offerHelperInstall, true, outcome.kind);
    }
  });

  test("🔴 표시가 있으면 **어느 결과에서도** 줄이 없고 단추도 그리지 않는다", async () => {
    for (const options of [
      { openFileKnownBefore: true },
      { openFileKnownBefore: true, focusLost: "sync" as const },
      { openFileKnownBefore: true, focusLost: "async" as const },
      // 🔴 옛 표시가 함께 있어도 마찬가지다 — 새 표시가 「파일 열기를 안다」를 말한다.
      { openFileKnownBefore: true, confirmedBefore: true },
    ] satisfies HarnessOptions[]) {
      const stage = harness(options);
      const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
      assert.equal(
        textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT),
        false,
        `${outcome.kind}: ${textsOf(outcome.lines).join(" / ")}`
      );
      assert.equal(outcome.offerHelperInstall, false, outcome.kind);
    }
  });

  test("🔴 초점을 잃으면 그 자리에서 표시가 적히고 안내도 안 나온다 — 방금 열렸다", async () => {
    for (const focusLost of ["sync", "async"] as const) {
      const stage = harness({ focusLost });
      const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
      assert.equal(outcome.kind, "OPENED", focusLost);
      assert.equal(stage.store.get(CONTACT_FOLDER_FILE_HELPER_KEY), "1", focusLost);
      assert.equal(textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), false, focusLost);
      assert.equal(outcome.offerHelperInstall, false, focusLost);
      // 열리고 있다는 말은 그대로 남는다 — 사라지는 것은 설치 안내뿐이다.
      assert.ok(textsOf(outcome.lines).some((text) => text.includes(FILE)), focusLost);
    }
  });

  test("🔴 설계 e — 반응이 없어도 표시가 있으면 **경고가 아니다**", async () => {
    const stage = harness({ openFileKnownBefore: true });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.equal(textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT), false);
    assert.equal(
      outcome.lines.some((line) => line.tone === "warning"),
      false,
      textsOf(outcome.lines).join(" / ")
    );
  });

  test("🔴 표시가 없는데 열지 못했으면 **경고 그대로다** — 약해지지 않았다", async () => {
    const stage = harness();
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.ok(textsOf(outcome.lines).includes(CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT));
    assert.ok(outcome.lines.some((line) => line.tone === "warning"));
    // 🔴 적지 않았다 — 열린 적이 없는 PC 다.
    assert.equal(stage.store.has(CONTACT_FOLDER_FILE_HELPER_KEY), false);
  });

  test("그 줄은 설치 명령 복사를 가리킨다", () => {
    assert.ok(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT.includes("설치 명령 복사"));
    assert.ok(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT.includes("예전"));
  });
});

describe("🔴 능력별·세대별 표시 — 번호를 올리면 모든 PC 가 다시 묻는다", () => {
  test("세대 번호가 열쇠 이름에 들어간다 · 폴더 열기 표시와 다른 열쇠다", () => {
    assert.equal(CONTACT_FOLDER_FILE_HELPER_GENERATION, 1);
    assert.equal(CONTACT_FOLDER_FILE_HELPER_KEY, "dss.helper.gen1.openfile");
    assert.ok(
      CONTACT_FOLDER_FILE_HELPER_KEY.includes(String(CONTACT_FOLDER_FILE_HELPER_GENERATION)),
      CONTACT_FOLDER_FILE_HELPER_KEY
    );
    // 🔴 옛 열쇠를 **그대로 두었다** — 폴더 열기용이고 성질이 다르다.
    assert.notEqual(CONTACT_FOLDER_FILE_HELPER_KEY, QUOTE_FOLDER_HELPER_CONFIRMED_KEY);
    assert.equal(QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "dss.quoteFolderHelper.confirmed");
  });

  test("🔴 폴더만 열어 본 PC 는 「파일 열기를 안다」가 아니다 — 옛 표시로는 끄지 못한다", () => {
    const store = new Map<string, string>([[QUOTE_FOLDER_HELPER_CONFIRMED_KEY, "1"]]);
    const storage = () => fakeStorage(store);
    assert.equal(readContactFolderFileHelperKnown(storage), false);
    assert.equal(shouldOfferContactFolderFileHelperInstall(storage), true);
  });

  test("표시를 적으면 다음부터 안내를 안 그린다 — [그만 보기]가 하는 일이 이것이다", () => {
    const store = new Map<string, string>();
    const storage = () => fakeStorage(store);
    assert.equal(shouldOfferContactFolderFileHelperInstall(storage), true);
    rememberContactFolderFileHelper(storage);
    assert.equal(store.get(CONTACT_FOLDER_FILE_HELPER_KEY), "1");
    assert.equal(readContactFolderFileHelperKnown(storage), true);
    assert.equal(shouldOfferContactFolderFileHelperInstall(storage), false);
    // 🔴 옛 표시를 건드리지 않는다 — 폴더 열기 흐름은 그대로다.
    assert.equal(store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false);
  });

  test("저장소가 없거나 던져도 던지지 않는다 — 표시가 없는 것으로 본다", () => {
    const missing = () => null;
    const broken = () => {
      throw new Error("SecurityError");
    };
    const refusing = (): QuoteFolderHelperStorage => ({
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    for (const storage of [missing, broken, refusing]) {
      assert.equal(readContactFolderFileHelperKnown(storage), false);
      assert.equal(shouldOfferContactFolderFileHelperInstall(storage), true);
      assert.doesNotThrow(() => rememberContactFolderFileHelper(storage));
    }
  });
});

/*
 * ============================================================================
 * 🔴 [그만 보기] — 눌렀을 때 **그 자리에서** 사라지는 것
 * ============================================================================
 * DOM 이 없으니 누르는 시늉을 하지 않는다. 대신 (1) 표시를 적는 일, (2) 들고 있는 결과에서
 * 안내를 걷어내는 일, (3) 걷어낸 결과를 **실제로 그려 본 모습**을 각각 값으로 잰다.
 * ============================================================================
 */
describe("🔴 [그만 보기] — 표시를 적고 안내를 걷어낸다", () => {
  const offered: ContactFolderFileOpenOutcome = {
    kind: "NO_RESPONSE",
    lines: [
      { text: CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT, tone: "warning" },
      { text: CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT, tone: "muted" },
    ],
    offerHelperInstall: true,
  };

  const notice = (outcome: ContactFolderFileOpenOutcome) =>
    renderToStaticMarkup(
      createElement(ContactFolderEntryOpenOutcomeNotice, {
        outcome,
        copyLines: [],
        copyBusy: false,
        onCopy: () => undefined,
        onDismiss: () => undefined,
      })
    );

  test("걷어내면 줄도 깃발도 없다 — 나머지 줄은 그대로다", () => {
    const quiet = contactFolderFileOutcomeWithoutHelperOffer(offered);
    assert.equal(quiet.offerHelperInstall, false);
    assert.deepEqual(textsOf(quiet.lines), [CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT]);
    // 원래 결과를 고치지 않는다.
    assert.equal(offered.offerHelperInstall, true);
    assert.equal(offered.lines.length, 2);
    // 낼 것이 없으면 그대로 돌려준다.
    assert.equal(contactFolderFileOutcomeWithoutHelperOffer(quiet), quiet);
  });

  test("🔴 그려 보면 — 끄기 전에는 줄과 단추 둘, 끈 뒤에는 **하나도 없다**", () => {
    const before = notice(offered);
    assert.ok(before.includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), before);
    assert.ok(before.includes("data-contact-folder-entry-helper-install-command"), before);
    assert.ok(before.includes("data-contact-folder-entry-helper-dismiss"), before);
    assert.ok(before.includes(CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT), before);

    const after = notice(contactFolderFileOutcomeWithoutHelperOffer(offered));
    assert.equal(after.includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), false, after);
    assert.equal(after.includes("data-contact-folder-entry-helper-install-command"), false, after);
    assert.equal(after.includes("data-contact-folder-entry-helper-dismiss"), false, after);
    // 결과 자체는 남는다 — 사라지는 것은 설치 안내뿐이다.
    assert.ok(after.includes(CONTACT_FOLDER_FILE_HELPER_MISSING_TEXT), after);
  });

  test("🔴 표시가 있어 열린 결과에는 애초에 아무것도 안 그린다", async () => {
    const stage = harness({ openFileKnownBefore: true, focusLost: "sync" });
    const outcome = await runContactFolderFileOpen({ folderName: FOLDER, fileName: FILE, env: stage.env });
    const html = notice(outcome);
    assert.equal(html.includes("data-contact-folder-entry-helper-install-command"), false, html);
    assert.equal(html.includes("data-contact-folder-entry-helper-dismiss"), false, html);
    assert.equal(html.includes(CONTACT_FOLDER_FILE_HELPER_REINSTALL_TEXT), false, html);
  });

  test("단추 글자 — 사람이 끄는 것이라는 말이 들어 있다", () => {
    assert.equal(CONTACT_FOLDER_FILE_HELPER_DISMISS_TEXT, "이 PC 는 최신입니다 — 그만 보기");
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
