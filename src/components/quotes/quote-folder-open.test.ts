import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_FOLDER_LINK_PREFIX, buildQuoteFolderLink, parseQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_DISABLED_TEXT,
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  QUOTE_FOLDER_HELPER_INSTALLER_FALLBACK_FILE_NAME,
  QUOTE_FOLDER_HELPER_INSTALLER_URL,
  QUOTE_FOLDER_HELPER_MISSING_FAILED_TEXT,
  QUOTE_FOLDER_MULTIPLE_TEXT,
  QUOTE_FOLDER_NOT_FOUND_TEXT,
  isWindowsDesktopClient,
  quoteArchiveFolderUrl,
  quoteFolderHelperInstalledText,
  quoteFolderHelperRedownloadedText,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallerDownload,
  runQuoteFolderOpen,
  type QuoteFolderClientPlatform,
  type QuoteFolderHelperStorage,
  type QuoteFolderOpenEnvironment,
  type QuoteFolderOpenOutcome,
} from "./quote-folder-open";

/**
 * ============================================================================
 * 편집 화면의 [폴더 열기] — 폴더 위치 · 주소 열기 · 도우미 감지 · 설치 파일 (견적서 ④b)
 * ============================================================================
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소 · 파일 저장을 모두 바꿔 끼운다 — 네트워크도
 * DOM 도 없다. 서버 응답 모양은 ④a 의 두 통로(archive-folder · installer route)를 그대로 흉내 낸다.
 *
 * 불변식 셋:
 *  (a) 알림 · 부른 주소에 루트 값이 없다
 *  (b) 자동 내려받기는 「확인됨」 표시가 없을 때, 한 번 누를 때 한 번만
 *  (c) Windows 가 아니면 단추가 없다 — 판단 함수(isWindowsDesktopClient)
 * ============================================================================
 */

type Reply =
  | "THROW"
  | { status: number; json?: unknown; jsonThrows?: boolean; headers?: Record<string, string>; blobThrows?: boolean };

const INSTALLER_OK: Reply = {
  status: 200,
  headers: { "Content-Disposition": 'attachment; filename="install-dss-folder-helper.cmd"' },
};
const ROOT_NOT_CONFIGURED = "관리자가 공유폴더 주소를 설정해야 합니다.";
const INSTALLER_409: Reply = { status: 409, json: { error: ROOT_NOT_CONFIGURED, code: "HELPER_ROOT_NOT_CONFIGURED" } };

/** 공백 · 한글 · `&` · `%` 가 든 실제 모양의 상대 경로. */
const RELATIVE_PATH = "2026년 견적서/DSS 2026-077_ICD 주성 & 100%";

function found(extra: Record<string, unknown> = {}): Reply {
  return { status: 200, json: { status: "found", relativePath: RELATIVE_PATH, multipleFolderMatches: false, ...extra } };
}

const BACKSLASH = String.fromCharCode(92);
/** 서버가 실수로 루트를 끼워 보냈다고 치는 값들 — 알림 · 주소 어디에도 나오면 안 된다. */
const LEAKED_UNC_ROOT = `${BACKSLASH}${BACKSLASH}NAS01${BACKSLASH}견적서보관`;
const LEAKED_CONTAINER_ROOT = "/data/quote-archive-root";

type HarnessOptions = {
  folder: Reply;
  installer?: Reply;
  /** 주소를 연 뒤 창이 초점을 잃는다 — 여는 즉시(sync) 또는 조금 뒤(async). 없으면 무반응. */
  focusLost?: "sync" | "async";
  confirmedBefore?: boolean;
  storage?: "ok" | "getterThrows" | "methodsThrow" | "none";
  saveThrows?: boolean;
  openThrows?: boolean;
};

function harness(options: HarnessOptions) {
  const fetched: string[] = [];
  const opened: string[] = [];
  const saved: { fileName: string; size: number }[] = [];
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
      throw new Error("SecurityError: access denied");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  const env: QuoteFolderOpenEnvironment = {
    fetchImpl: async (url) => {
      fetched.push(url);
      const reply = url === QUOTE_FOLDER_HELPER_INSTALLER_URL ? (options.installer ?? INSTALLER_OK) : options.folder;
      if (reply === "THROW") throw new TypeError("Failed to fetch");
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        headers: new Headers(reply.headers ?? {}),
        blob: async () => {
          if (reply.blobThrows) throw new TypeError("network error");
          return new Blob(["@echo off"]);
        },
        json: async () => {
          if (reply.jsonThrows) throw new SyntaxError("Unexpected token <");
          return reply.json;
        },
      };
    },
    openLink: (link) => {
      if (options.openThrows) throw new Error("blocked");
      opened.push(link);
      if (options.focusLost === "sync") listener?.();
      if (options.focusLost === "async") setTimeout(() => listener?.(), 0);
    },
    watchFocusLoss: (onLost) => {
      listener = onLost;
      activeWatchers += 1;
      return () => {
        listener = null;
        activeWatchers -= 1;
      };
    },
    delay: (ms) => {
      delays.push(ms);
      // 초점을 잃는 시험에서는 시계가 끝나지 않는다 — 기다림이 초점 잃기로 끝나야 통과한다.
      return options.focusLost ? new Promise<void>(() => {}) : Promise.resolve();
    },
    storage: () => {
      switch (options.storage ?? "ok") {
        case "ok":
          return okStorage;
        case "getterThrows":
          throw new Error("SecurityError: localStorage is not available");
        case "methodsThrow":
          return throwingStorage;
        case "none":
          return null;
      }
    },
    save: (blob, fileName) => {
      if (options.saveThrows) throw new Error("save failed");
      saved.push({ fileName, size: blob.size });
    },
  };

  return {
    env,
    fetched,
    opened,
    saved,
    delays,
    store,
    activeWatchers: () => activeWatchers,
    /** 기다림이 끝난 뒤에 늦게 온 blur. */
    fireLateBlur: () => listener?.(),
  };
}

async function run(options: HarnessOptions, quoteId = "q-1") {
  const h = harness(options);
  const outcome = await runQuoteFolderOpen({ quoteId, env: h.env });
  return { ...h, outcome };
}

const texts = (outcome: QuoteFolderOpenOutcome) => outcome.lines.map((line) => line.text);

describe("① 폴더 위치를 묻는다", () => {
  test("그 견적서의 archive-folder 를 GET 으로 부른다 — id 는 주소 인코딩", async () => {
    const { fetched } = await run({ folder: { status: 200, json: { status: "disabled" } } });
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    assert.equal(quoteArchiveFolderUrl("a/b"), "/api/quotes/a%2Fb/archive-folder");
  });

  test("disabled → 「공유폴더 저장이 꺼져 있습니다」(흐림) · 주소를 열지 않는다", async () => {
    const { outcome, opened, saved } = await run({ folder: { status: 200, json: { status: "disabled" } } });
    assert.equal(outcome.kind, "DISABLED");
    assert.deepEqual(outcome.lines, [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }]);
    assert.equal(outcome.offerInstallerDownload, false);
    assert.deepEqual(opened, []);
    assert.deepEqual(saved, []);
  });

  test("not-found → [견적서 받기]를 먼저 누르라고", async () => {
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "not-found" } } });
    assert.equal(outcome.kind, "NOT_FOUND");
    assert.deepEqual(outcome.lines, [{ text: QUOTE_FOLDER_NOT_FOUND_TEXT, tone: "warning" }]);
    assert.equal(
      QUOTE_FOLDER_NOT_FOUND_TEXT,
      "아직 공유폴더에 이 견적서의 폴더가 없습니다 — [견적서 받기]를 먼저 눌러 주세요"
    );
    assert.deepEqual(opened, []);
  });

  test("failed → 서버의 사유 그대로", async () => {
    const reason = "견적서 폴더 이름에 탐색기 도우미가 열 수 없는 글자가 있습니다. 공유폴더에서 직접 열어 주세요.";
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "failed", reason } } });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(outcome.lines, [{ text: `폴더를 열지 못했습니다 — ${reason}`, tone: "warning" }]);
    assert.deepEqual(opened, []);
    const blank = await run({ folder: { status: 200, json: { status: "failed", reason: "  " } } });
    assert.deepEqual(texts(blank.outcome), ["폴더를 열지 못했습니다 — 까닭을 알 수 없습니다"]);
  });

  test("요청 실패 → 까닭(네트워크 · 서버 문장 · HTTP 상태 · 읽을 수 없는 응답) — 주소도 설치 파일도 없다", async () => {
    const cases: { folder: Reply; reason: string }[] = [
      { folder: "THROW", reason: "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)" },
      { folder: { status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } }, reason: "이 작업을 수행할 권한이 없습니다." },
      { folder: { status: 502, jsonThrows: true }, reason: "서버가 요청을 처리하지 못했습니다(HTTP 502)" },
      { folder: { status: 200, json: { status: "found" } }, reason: "서버 응답을 읽지 못했습니다" },
      { folder: { status: 200, json: { status: "other" } }, reason: "서버 응답을 읽지 못했습니다" },
      { folder: { status: 200, jsonThrows: true }, reason: "서버 응답을 읽지 못했습니다" },
    ];
    for (const { folder, reason } of cases) {
      const { outcome, opened, fetched, saved } = await run({ folder });
      assert.equal(outcome.kind, "FAILED", reason);
      assert.deepEqual(texts(outcome), [`폴더를 열지 못했습니다 — ${reason}`]);
      assert.deepEqual(opened, [], reason);
      assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"], reason);
      assert.deepEqual(saved, [], reason);
    }
  });

  test("서버가 준 경로가 도우미 규칙 밖이면 주소를 만들지 않는다", async () => {
    for (const relativePath of ["../밖", "C:/Windows", "2026/a:b"]) {
      const { outcome, opened } = await run({ folder: { status: 200, json: { status: "found", relativePath } } });
      assert.equal(outcome.kind, "FAILED", relativePath);
      assert.deepEqual(opened, [], relativePath);
    }
  });
});

describe("② found → 페이지를 떠나지 않고 도우미 주소를 연다", () => {
  test("buildQuoteFolderLink 로 만든 주소 하나 — 되읽으면 그 상대 경로", async () => {
    const { opened } = await run({ folder: found(), focusLost: "sync" });
    assert.deepEqual(opened, [buildQuoteFolderLink(RELATIVE_PATH)]);
    assert.ok(opened[0].startsWith(QUOTE_FOLDER_LINK_PREFIX), opened[0]);
    assert.equal(parseQuoteFolderLink(opened[0]), RELATIVE_PATH);
  });

  test("여러 폴더가 맞으면 「이름순 첫째를 엽니다」 주의 줄", async () => {
    const { outcome } = await run({ folder: found({ multipleFolderMatches: true }), focusLost: "sync" });
    assert.deepEqual(outcome.lines, [
      { text: `탐색기로 폴더를 엽니다: ${RELATIVE_PATH}`, tone: "normal" },
      { text: QUOTE_FOLDER_MULTIPLE_TEXT, tone: "warning" },
    ]);
    assert.equal(QUOTE_FOLDER_MULTIPLE_TEXT, "맞는 폴더가 여럿이라 이름순 첫째를 엽니다 — 폴더를 확인해 주세요");
    // 무반응 · 설치 파일을 받은 갈래에서도 남는다.
    const quiet = await run({ folder: found({ multipleFolderMatches: true }) });
    assert.ok(texts(quiet.outcome).includes(QUOTE_FOLDER_MULTIPLE_TEXT), texts(quiet.outcome).join(" / "));
  });

  test("브라우저가 주소를 열지 못하면 실패 — 설치 파일을 받지 않고, 듣기를 푼다", async () => {
    const { outcome, fetched, activeWatchers } = await run({ folder: found(), openThrows: true });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    assert.equal(activeWatchers(), 0);
  });
});

describe("③ 도우미 감지 — 약 2초 안에 창이 초점을 잃으면 도우미가 있다", () => {
  test("🔴 여는 즉시 초점을 잃음 → 「확인됨」 표시 · 설치 파일을 받지 않는다", async () => {
    const { outcome, store, saved, fetched, activeWatchers } = await run({ folder: found(), focusLost: "sync" });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(outcome.lines, [{ text: `탐색기로 폴더를 엽니다: ${RELATIVE_PATH}`, tone: "normal" }]);
    assert.equal(store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    assert.deepEqual(saved, []);
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    // 반응은 했지만 탐색기가 뜨지 않았을 수도 있다(확인창에서 취소 · 모르는 주소에도 창을 띄우는 브라우저).
    assert.equal(outcome.offerInstallerDownload, true);
    assert.equal(activeWatchers(), 0, "듣기를 풀지 않았다");
  });

  test("🔴 조금 뒤 초점을 잃음 — 시계가 끝나지 않아도 기다림이 끝난다(2초 시계를 건다)", async () => {
    const { outcome, store, saved, delays } = await run({ folder: found(), focusLost: "async" });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
    assert.equal(QUOTE_FOLDER_HELPER_DETECTION_MS, 2000);
    assert.equal(store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    assert.deepEqual(saved, []);
  });

  test("🔴 무반응 + 표시 없음 → 설치 파일을 곧바로 한 번 받고, 더블클릭하라고 알린다", async () => {
    const { outcome, fetched, saved, store, delays } = await run({ folder: found() });
    assert.equal(outcome.kind, "NO_RESPONSE_INSTALLER_SAVED");
    assert.deepEqual(delays, [2000]);
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder", "/api/quote-folder-helper/installer"]);
    assert.deepEqual(saved, [{ fileName: "install-dss-folder-helper.cmd", size: "@echo off".length }]);
    assert.deepEqual(outcome.lines, [
      {
        text: "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — 설치 파일(install-dss-folder-helper.cmd)을 받았습니다. 한 번 더블클릭해 설치한 뒤 [폴더 열기]를 다시 눌러 주세요",
        tone: "warning",
      },
      { text: `열려던 폴더: ${RELATIVE_PATH}`, tone: "muted" },
    ]);
    assert.equal(outcome.lines[0].text, quoteFolderHelperInstalledText("install-dss-folder-helper.cmd"));
    assert.equal(outcome.offerInstallerDownload, false);
    assert.equal(store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false, "반응이 없었는데 「확인됨」을 적었다");
  });

  test("🔴 무반응 + 표시 있음 → 받지 않고 [설치 파일 다시 받기]만 내민다", async () => {
    const { outcome, fetched, saved } = await run({ folder: found(), confirmedBefore: true });
    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"], "설치 파일을 불렀다");
    assert.deepEqual(saved, []);
    assert.equal(outcome.offerInstallerDownload, true);
    assert.deepEqual(outcome.lines, [{ text: `탐색기로 폴더를 엽니다: ${RELATIVE_PATH}`, tone: "normal" }]);
  });

  test("기다림이 끝난 뒤 늦게 온 blur 는 세지 않는다 — 듣기를 풀었다", async () => {
    const h = harness({ folder: found() });
    await runQuoteFolderOpen({ quoteId: "q-1", env: h.env });
    assert.equal(h.activeWatchers(), 0);
    h.fireLateBlur();
    assert.equal(h.store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false);
  });

  test("🔴 409 → 서버 문장을 그대로 한 줄로", async () => {
    const { outcome, saved } = await run({ folder: found(), installer: INSTALLER_409 });
    assert.equal(outcome.kind, "NO_RESPONSE_INSTALLER_FAILED");
    assert.deepEqual(saved, []);
    assert.deepEqual(outcome.lines, [
      { text: QUOTE_FOLDER_HELPER_MISSING_FAILED_TEXT, tone: "warning" },
      { text: ROOT_NOT_CONFIGURED, tone: "warning" },
      { text: `열려던 폴더: ${RELATIVE_PATH}`, tone: "muted" },
    ]);
  });

  test("설치 파일 실패 — 네트워크 · 연결 끊김 · 브라우저 저장 실패", async () => {
    const cases: { options: Partial<HarnessOptions>; reason: string }[] = [
      { options: { installer: "THROW" }, reason: "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)" },
      { options: { installer: { status: 200, blobThrows: true } }, reason: "설치 파일을 받는 중에 연결이 끊겼습니다" },
      { options: { saveThrows: true }, reason: "설치 파일을 받았지만 브라우저가 저장하지 못했습니다" },
      { options: { installer: { status: 500, jsonThrows: true } }, reason: "서버가 요청을 처리하지 못했습니다(HTTP 500)" },
    ];
    for (const { options, reason } of cases) {
      const { outcome } = await run({ folder: found(), ...options });
      assert.equal(outcome.kind, "NO_RESPONSE_INSTALLER_FAILED", reason);
      assert.deepEqual(texts(outcome).slice(0, 2), [QUOTE_FOLDER_HELPER_MISSING_FAILED_TEXT, reason]);
    }
  });

  test("이름을 싣지 않은 응답이면 서버와 같은 기본 이름", async () => {
    const { saved } = await run({ folder: found(), installer: { status: 200 } });
    assert.deepEqual(
      saved.map((file) => file.fileName),
      [QUOTE_FOLDER_HELPER_INSTALLER_FALLBACK_FILE_NAME]
    );
    assert.equal(QUOTE_FOLDER_HELPER_INSTALLER_FALLBACK_FILE_NAME, "install-dss-folder-helper.cmd");
  });
});

describe("localStorage 가 없거나 던져도 돈다", () => {
  test("🔴 저장소를 꺼내는 일 자체가 던짐 — 초점을 잃으면 그대로 열림, 무반응이면 표시 없는 것으로(받는다)", async () => {
    const lost = await run({ folder: found(), focusLost: "sync", storage: "getterThrows" });
    assert.equal(lost.outcome.kind, "OPENED");
    const quiet = await run({ folder: found(), storage: "getterThrows" });
    assert.equal(quiet.outcome.kind, "NO_RESPONSE_INSTALLER_SAVED");
    assert.equal(quiet.saved.length, 1);
  });

  test("getItem · setItem 이 던짐", async () => {
    const lost = await run({ folder: found(), focusLost: "sync", storage: "methodsThrow" });
    assert.equal(lost.outcome.kind, "OPENED");
    const quiet = await run({ folder: found(), storage: "methodsThrow" });
    assert.equal(quiet.outcome.kind, "NO_RESPONSE_INSTALLER_SAVED");
  });

  test("저장소가 없음(null)", async () => {
    assert.equal((await run({ folder: found(), focusLost: "sync", storage: "none" })).outcome.kind, "OPENED");
    assert.equal((await run({ folder: found(), storage: "none" })).outcome.kind, "NO_RESPONSE_INSTALLER_SAVED");
  });
});

describe("🔴 (a) 알림 · 부른 주소에 루트 값이 없다", () => {
  const leaking = found({ root: LEAKED_UNC_ROOT, uncRoot: LEAKED_UNC_ROOT, archiveDir: LEAKED_CONTAINER_ROOT });
  const scenarios: HarnessOptions[] = [
    { folder: leaking, focusLost: "sync" },
    { folder: leaking },
    { folder: leaking, confirmedBefore: true },
    { folder: leaking, installer: INSTALLER_409 },
  ];

  test("응답에 루트가 끼어 있어도 줄 · 주소 · 부른 통로 어디에도 없다", async () => {
    for (const options of scenarios) {
      const { outcome, opened, fetched } = await run(options);
      const shown = texts(outcome).join("\n");
      for (const leaked of [LEAKED_UNC_ROOT, "NAS01", LEAKED_CONTAINER_ROOT, BACKSLASH]) {
        assert.ok(!shown.includes(leaked), `알림에 '${leaked}' 가 있다: ${shown}`);
        assert.ok(!fetched.join("\n").includes(leaked), `부른 주소에 '${leaked}' 가 있다`);
      }
      // 주소는 상대 경로 하나만 나른다.
      assert.deepEqual(opened.map(parseQuoteFolderLink), [RELATIVE_PATH]);
      for (const url of fetched) {
        assert.ok(
          url === "/api/quotes/q-1/archive-folder" || url === "/api/quote-folder-helper/installer",
          `알지 못하는 주소를 불렀다: ${url}`
        );
      }
    }
  });
});

describe("[설치 파일 다시 받기] — 사람이 눌러서", () => {
  test("받으면 더블클릭 안내 한 줄", async () => {
    const h = harness({ folder: found() });
    const lines = await runQuoteFolderHelperInstallerDownload({ env: { fetchImpl: h.env.fetchImpl, save: h.env.save } });
    assert.deepEqual(lines, [
      { text: quoteFolderHelperRedownloadedText("install-dss-folder-helper.cmd"), tone: "normal" },
    ]);
    assert.deepEqual(h.fetched, ["/api/quote-folder-helper/installer"]);
    assert.equal(h.saved.length, 1);
  });

  test("🔴 409 → 서버 문장 그대로 · 네트워크 실패 → 까닭", async () => {
    const refused = harness({ folder: found(), installer: INSTALLER_409 });
    assert.deepEqual(await runQuoteFolderHelperInstallerDownload({ env: { fetchImpl: refused.env.fetchImpl, save: refused.env.save } }), [
      { text: `설치 파일을 받지 못했습니다 — ${ROOT_NOT_CONFIGURED}`, tone: "warning" },
    ]);
    assert.deepEqual(refused.saved, []);
    const offline = harness({ folder: found(), installer: "THROW" });
    const lines = await runQuoteFolderHelperInstallerDownload({ env: { fetchImpl: offline.env.fetchImpl, save: offline.env.save } });
    assert.equal(lines[0].tone, "warning");
    assert.ok(lines[0].text.includes("서버에 닿지 못했습니다"), lines[0].text);
  });
});

describe("🔴 (c) Windows 인가 — 순수 함수", () => {
  const CHROME_WINDOWS =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/140.0.0.0`;
  const FIREFOX_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";
  const CHROME_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const SAFARI_MAC =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
  const ANDROID_DESKTOP_MODE =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const SAFARI_IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0";
  const WINDOWS_PHONE =
    "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14977";

  const client = (
    userAgent: string,
    platform: string,
    data: { platform: string; mobile: boolean } | null = null
  ): QuoteFolderClientPlatform => ({
    userAgent,
    platform,
    userAgentDataPlatform: data?.platform ?? null,
    userAgentDataMobile: data?.mobile ?? null,
  });

  test("Windows PC — Chrome · Edge(userAgentData) · Firefox(없음)", () => {
    assert.equal(isWindowsDesktopClient(client(CHROME_WINDOWS, "Win32", { platform: "Windows", mobile: false })), true);
    assert.equal(isWindowsDesktopClient(client(EDGE_WINDOWS, "Win32", { platform: "Windows", mobile: false })), true);
    assert.equal(isWindowsDesktopClient(client(FIREFOX_WINDOWS, "Win32")), true);
    // platform 이 비어 있어도 userAgent 로
    assert.equal(isWindowsDesktopClient(client(FIREFOX_WINDOWS, "")), true);
  });

  test("Mac — Chrome · Safari", () => {
    assert.equal(isWindowsDesktopClient(client(CHROME_MAC, "MacIntel", { platform: "macOS", mobile: false })), false);
    assert.equal(isWindowsDesktopClient(client(SAFARI_MAC, "MacIntel")), false);
  });

  test("Android — 휴대폰 · 「데스크톱 사이트」로 바꾼 휴대폰", () => {
    assert.equal(isWindowsDesktopClient(client(CHROME_ANDROID, "Linux armv81", { platform: "Android", mobile: true })), false);
    assert.equal(
      isWindowsDesktopClient(client(ANDROID_DESKTOP_MODE, "Linux armv81", { platform: "Android", mobile: false })),
      false
    );
  });

  test("iPhone · iPad(데스크톱 모드는 Mac 으로 보인다)", () => {
    assert.equal(isWindowsDesktopClient(client(SAFARI_IPHONE, "iPhone")), false);
    assert.equal(isWindowsDesktopClient(client(SAFARI_MAC, "MacIntel")), false);
  });

  test("Linux", () => {
    assert.equal(isWindowsDesktopClient(client(FIREFOX_LINUX, "Linux x86_64")), false);
    assert.equal(isWindowsDesktopClient(client(ANDROID_DESKTOP_MODE, "Linux x86_64", { platform: "Linux", mobile: false })), false);
  });

  test("Windows 라고 적혀도 휴대 기기면 아니다 · 모르면 아니다", () => {
    assert.equal(isWindowsDesktopClient(client(WINDOWS_PHONE, "Win32")), false);
    assert.equal(isWindowsDesktopClient(client(CHROME_WINDOWS, "Win32", { platform: "Windows", mobile: true })), false);
    assert.equal(isWindowsDesktopClient(client("", "")), false);
  });

  test("navigator 모양에서 값을 꺼낸다 — 없는 칸은 빈 값", () => {
    assert.deepEqual(readQuoteFolderClientPlatform({}), {
      userAgent: "",
      platform: "",
      userAgentDataPlatform: null,
      userAgentDataMobile: null,
    });
    assert.deepEqual(
      readQuoteFolderClientPlatform({
        userAgent: CHROME_WINDOWS,
        platform: "Win32",
        userAgentData: { platform: "Windows", mobile: false },
      }),
      client(CHROME_WINDOWS, "Win32", { platform: "Windows", mobile: false })
    );
  });
});
