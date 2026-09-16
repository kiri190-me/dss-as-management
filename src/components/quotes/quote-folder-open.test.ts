import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { QUOTE_FOLDER_LINK_PREFIX, buildQuoteFolderLink, parseQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_DISABLED_TEXT,
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT,
  QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT,
  QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT,
  QUOTE_FOLDER_HELPER_INSTALL_COMMAND_URL,
  QUOTE_FOLDER_HELPER_MISSING_TEXT,
  QUOTE_FOLDER_MULTIPLE_TEXT,
  QUOTE_FOLDER_NOT_FOUND_TEXT,
  QUOTE_FOLDER_UNC_PATH_COPIED_TEXT,
  QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT,
  isWindowsDesktopClient,
  quoteArchiveFolderUrl,
  readQuoteFolderClientPlatform,
  runQuoteFolderHelperInstallCommandCopy,
  runQuoteFolderOpen,
  runQuoteFolderUncPathCopy,
  type QuoteFolderClientPlatform,
  type QuoteFolderCopy,
  type QuoteFolderHelperStorage,
  type QuoteFolderOpenEnvironment,
  type QuoteFolderOpenOutcome,
} from "./quote-folder-open";

/**
 * ============================================================================
 * 편집 화면의 [폴더 열기] — 폴더 위치 · 주소 열기 · 도우미 감지 · 복사 두 길 (견적서 ④b·④c)
 * ============================================================================
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소 · 복사를 모두 바꿔 끼운다 — 네트워크도 DOM 도
 * 없다. 서버 응답 모양은 ④a·④c 의 두 통로(archive-folder · install-command)를 그대로 흉내 낸다.
 *
 * 불변식 셋:
 *  (a) 알림 · 부른 주소에 루트 값이 없다
 *  (b) 🔴 화면은 설치 파일을 받지 않는다 — 부르는 통로는 archive-folder · install-command 둘뿐
 *  (c) Windows 가 아니면 단추가 없다 — 판단 함수(isWindowsDesktopClient)
 * ============================================================================
 */

type Reply = "THROW" | { status: number; json?: unknown; jsonThrows?: boolean };

const ROOT_NOT_CONFIGURED = "관리자가 공유폴더 주소를 설정해야 합니다.";

/** 붙여넣는 설치 명령 — 실제로는 약 10,300자다. 안에 공유폴더 주소가 싸여 들어간다. */
const INSTALL_COMMAND_BODY = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${"QQBiAGMA".repeat(300)}`;
const INSTALL_COMMAND_OK: Reply = { status: 200, json: { command: INSTALL_COMMAND_BODY } };
const INSTALL_COMMAND_409: Reply = {
  status: 409,
  json: { error: ROOT_NOT_CONFIGURED, code: "HELPER_ROOT_NOT_CONFIGURED" },
};

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
  installCommand?: Reply;
  /** 주소를 연 뒤 창이 초점을 잃는다 — 여는 즉시(sync) 또는 조금 뒤(async). 없으면 무반응. */
  focusLost?: "sync" | "async";
  confirmedBefore?: boolean;
  storage?: "ok" | "getterThrows" | "methodsThrow" | "none";
  openThrows?: boolean;
};

function harness(options: HarnessOptions) {
  const fetched: string[] = [];
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
      throw new Error("SecurityError: access denied");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  const env: QuoteFolderOpenEnvironment = {
    fetchImpl: async (url) => {
      fetched.push(url);
      let reply = options.folder;
      if (url === QUOTE_FOLDER_HELPER_INSTALL_COMMAND_URL) reply = options.installCommand ?? INSTALL_COMMAND_OK;
      if (reply === "THROW") throw new TypeError("Failed to fetch");
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
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
  };

  return {
    env,
    fetched,
    opened,
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
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "disabled" } } });
    assert.equal(outcome.kind, "DISABLED");
    assert.deepEqual(outcome.lines, [{ text: QUOTE_FOLDER_DISABLED_TEXT, tone: "muted" }]);
    assert.equal(outcome.offerHelperInstall, false);
    assert.deepEqual(opened, []);
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

  test("요청 실패 → 까닭(네트워크 · 서버 문장 · HTTP 상태 · 읽을 수 없는 응답) — 주소를 열지 않는다", async () => {
    const cases: { folder: Reply; reason: string }[] = [
      { folder: "THROW", reason: "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)" },
      { folder: { status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } }, reason: "이 작업을 수행할 권한이 없습니다." },
      { folder: { status: 502, jsonThrows: true }, reason: "서버가 요청을 처리하지 못했습니다(HTTP 502)" },
      { folder: { status: 200, json: { status: "found" } }, reason: "서버 응답을 읽지 못했습니다" },
      { folder: { status: 200, json: { status: "other" } }, reason: "서버 응답을 읽지 못했습니다" },
      { folder: { status: 200, jsonThrows: true }, reason: "서버 응답을 읽지 못했습니다" },
    ];
    for (const { folder, reason } of cases) {
      const { outcome, opened, fetched } = await run({ folder });
      assert.equal(outcome.kind, "FAILED", reason);
      assert.deepEqual(texts(outcome), [`폴더를 열지 못했습니다 — ${reason}`]);
      assert.deepEqual(opened, [], reason);
      assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"], reason);
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
    // 무반응 갈래에서도 남는다.
    const quiet = await run({ folder: found({ multipleFolderMatches: true }) });
    assert.ok(texts(quiet.outcome).includes(QUOTE_FOLDER_MULTIPLE_TEXT), texts(quiet.outcome).join(" / "));
  });

  test("브라우저가 주소를 열지 못하면 실패 — 다른 통로를 부르지 않고, 듣기를 푼다", async () => {
    const { outcome, fetched, activeWatchers } = await run({ folder: found(), openThrows: true });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    assert.equal(activeWatchers(), 0);
  });
});

describe("③ 도우미 감지 — 약 2초 안에 창이 초점을 잃으면 도우미가 있다", () => {
  test("🔴 여는 즉시 초점을 잃음 → 「확인됨」 표시 · 다른 통로를 부르지 않는다", async () => {
    const { outcome, store, fetched, activeWatchers } = await run({ folder: found(), focusLost: "sync" });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(outcome.lines, [{ text: `탐색기로 폴더를 엽니다: ${RELATIVE_PATH}`, tone: "normal" }]);
    assert.equal(store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    // 반응은 했지만 탐색기가 뜨지 않았을 수도 있다(확인창에서 취소 · 모르는 주소에도 창을 띄우는 브라우저).
    assert.equal(outcome.offerHelperInstall, true);
    assert.equal(activeWatchers(), 0, "듣기를 풀지 않았다");
  });

  test("🔴 조금 뒤 초점을 잃음 — 시계가 끝나지 않아도 기다림이 끝난다(2초 시계를 건다)", async () => {
    const { outcome, store, delays } = await run({ folder: found(), focusLost: "async" });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
    assert.equal(QUOTE_FOLDER_HELPER_DETECTION_MS, 2000);
    assert.equal(store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
  });

  test("🔴 무반응 + 표시 없음 → 설치 파일을 받지 않고 [설치 명령 복사]로 이끈다", async () => {
    const { outcome, fetched, store, delays } = await run({ folder: found() });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.deepEqual(delays, [2000]);
    // 🔴 이 자리에서 예전에는 설치 파일을 받았다. 이제 부르는 통로는 archive-folder 하나뿐이다.
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    assert.deepEqual(outcome.lines, [
      {
        text: "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — [설치 명령 복사]를 눌러 PowerShell 창에 붙여넣어 주세요. 관리자 권한은 필요 없습니다",
        tone: "warning",
      },
      { text: `열려던 폴더: ${RELATIVE_PATH}`, tone: "muted" },
    ]);
    assert.equal(outcome.lines[0].text, QUOTE_FOLDER_HELPER_MISSING_TEXT);
    assert.equal(outcome.offerHelperInstall, true, "안내만 하고 단추를 내밀지 않았다");
    assert.equal(store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false, "반응이 없었는데 「확인됨」을 적었다");
  });

  test("🔴 무반응 + 표시 있음 → 「없다」고 말하지 않고 단추만 곁에 둔다", async () => {
    const { outcome, fetched } = await run({ folder: found(), confirmedBefore: true });
    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.deepEqual(fetched, ["/api/quotes/q-1/archive-folder"]);
    assert.equal(outcome.offerHelperInstall, true);
    assert.deepEqual(outcome.lines, [{ text: `탐색기로 폴더를 엽니다: ${RELATIVE_PATH}`, tone: "normal" }]);
    assert.ok(!texts(outcome).includes(QUOTE_FOLDER_HELPER_MISSING_TEXT), "반응한 적이 있는데 「없다」고 말한다");
  });

  test("기다림이 끝난 뒤 늦게 온 blur 는 세지 않는다 — 듣기를 풀었다", async () => {
    const h = harness({ folder: found() });
    await runQuoteFolderOpen({ quoteId: "q-1", env: h.env });
    assert.equal(h.activeWatchers(), 0);
    h.fireLateBlur();
    assert.equal(h.store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false);
  });
});

describe("localStorage 가 없거나 던져도 돈다", () => {
  test("🔴 저장소를 꺼내는 일 자체가 던짐 — 초점을 잃으면 그대로 열림, 무반응이면 표시 없는 것으로", async () => {
    const lost = await run({ folder: found(), focusLost: "sync", storage: "getterThrows" });
    assert.equal(lost.outcome.kind, "OPENED");
    const quiet = await run({ folder: found(), storage: "getterThrows" });
    assert.equal(quiet.outcome.kind, "NO_RESPONSE");
  });

  test("getItem · setItem 이 던짐", async () => {
    const lost = await run({ folder: found(), focusLost: "sync", storage: "methodsThrow" });
    assert.equal(lost.outcome.kind, "OPENED");
    const quiet = await run({ folder: found(), storage: "methodsThrow" });
    assert.equal(quiet.outcome.kind, "NO_RESPONSE");
  });

  test("저장소가 없음(null)", async () => {
    assert.equal((await run({ folder: found(), focusLost: "sync", storage: "none" })).outcome.kind, "OPENED");
    assert.equal((await run({ folder: found(), storage: "none" })).outcome.kind, "NO_RESPONSE");
  });
});

describe("🔴 (b) 화면은 설치 파일을 받지 않는다", () => {
  test("[폴더 열기] 를 어느 갈래로 돌려도 설치 파일 통로를 부르지 않는다", async () => {
    const scenarios: HarnessOptions[] = [
      { folder: found(), focusLost: "sync" },
      { folder: found(), focusLost: "async" },
      { folder: found() },
      { folder: found(), confirmedBefore: true },
      { folder: found(), openThrows: true },
      { folder: found({ multipleFolderMatches: true }) },
      { folder: { status: 200, json: { status: "disabled" } } },
      { folder: { status: 200, json: { status: "not-found" } } },
    ];
    for (const options of scenarios) {
      const { fetched } = await run(options);
      for (const url of fetched) {
        assert.ok(!url.includes("/installer"), `설치 파일 통로를 불렀다: ${url}`);
        assert.equal(url, "/api/quotes/q-1/archive-folder", `알지 못하는 주소를 불렀다: ${url}`);
      }
    }
  });

  test("바꿔 끼울 수 있는 환경에 파일을 저장하는 자리가 없다", () => {
    const h = harness({ folder: found() });
    assert.deepEqual(Object.keys(h.env).sort(), ["delay", "fetchImpl", "openLink", "storage", "watchFocusLoss"]);
  });
});

describe("🔴 (a) 알림 · 부른 주소에 루트 값이 없다", () => {
  const leaking = found({ root: LEAKED_UNC_ROOT, uncRoot: LEAKED_UNC_ROOT, archiveDir: LEAKED_CONTAINER_ROOT });
  const scenarios: HarnessOptions[] = [
    { folder: leaking, focusLost: "sync" },
    { folder: leaking },
    { folder: leaking, confirmedBefore: true },
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
        assert.equal(url, "/api/quotes/q-1/archive-folder", `알지 못하는 주소를 불렀다: ${url}`);
      }
    }
  });
});

/**
 * ────────────────────────────────────────────────────────────────────────────
 * ④c — 파일 없이 가는 두 길
 * ────────────────────────────────────────────────────────────────────────────
 * 설치 파일(.cmd)은 Windows 스마트 앱 컨트롤이 막는다(2026-09-16 실측). 화면은 그 파일을
 * 아예 주지 않고(사용자 결정), [위치 복사](도우미 자체를 건너뛴다)와
 * [설치 명령 복사](파일 없이 설치한다) 둘만 낸다.
 */

/** 서버가 `found` 에 실어 주는 전체 주소 — 설정이 있을 때만 붙는다. */
const UNC_PATH = [
  `${BACKSLASH}${BACKSLASH}NAS01${BACKSLASH}견적서보관`,
  "2026년 견적서",
  "DSS 2026-077_ICD 주성 & 100%",
].join(BACKSLASH);

/** 두 갈래 다 막힌 복사 — 거짓을 돌려주는 것과 던지는 것. */
const BLOCKED_COPIES: QuoteFolderCopy[] = [
  () => Promise.resolve(false),
  () => Promise.reject(new Error("NotAllowedError")),
];

/** 무엇을 복사했는지 적는 갈래. */
function recordingCopy(copied: string[]): QuoteFolderCopy {
  return (text) => {
    copied.push(text);
    return Promise.resolve(true);
  };
}

describe("④c ① [위치 복사] — 전체 공유폴더 주소", () => {
  test("🔴 설정이 있으면 찾은 뒤의 모든 결과에 uncPath 가 붙는다 — 알림 줄에는 넣지 않는다", async () => {
    const withPath = found({ uncPath: UNC_PATH });
    const scenarios: { options: HarnessOptions; kind: string }[] = [
      { options: { folder: withPath, focusLost: "sync" }, kind: "OPENED" },
      { options: { folder: withPath, confirmedBefore: true }, kind: "NO_RESPONSE_CONFIRMED" },
      { options: { folder: withPath }, kind: "NO_RESPONSE" },
    ];
    for (const { options, kind } of scenarios) {
      const { outcome } = await run(options);
      assert.equal(outcome.kind, kind);
      assert.equal(outcome.offerHelperInstall, true, kind);
      assert.equal(outcome.uncPath, UNC_PATH, kind);
      assert.ok(!texts(outcome).join("\n").includes("NAS01"), `알림 줄에 전체 주소가 실렸다: ${kind}`);
    }
  });

  test("도우미 주소를 만들 수 없는 폴더 이름이어도 위치는 낸다 — 공유폴더에서 직접 열 수 있게", async () => {
    const { outcome, opened } = await run({
      folder: { status: 200, json: { status: "found", relativePath: "2026/a:b", uncPath: UNC_PATH } },
    });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(opened, []);
    assert.equal(outcome.uncPath, UNC_PATH);
  });

  test("🔴 설정이 없으면 칸이 통째로 빠진다 — 빈 글자 · 다른 모양도 없는 것으로", async () => {
    for (const folder of [found(), found({ uncPath: "" }), found({ uncPath: "   " }), found({ uncPath: 7 })]) {
      const { outcome } = await run({ folder, focusLost: "sync" });
      assert.equal(outcome.kind, "OPENED");
      assert.equal(outcome.uncPath, undefined);
      assert.equal("uncPath" in outcome, false, "없는 칸을 undefined 로 실었다 — 단추가 생긴다");
    }
  });

  test("찾기 전에 끝난 결과에는 없다 — 꺼짐 · 폴더 없음 · 실패", async () => {
    const replies: Reply[] = [
      { status: 200, json: { status: "disabled" } },
      { status: 200, json: { status: "not-found" } },
      { status: 200, json: { status: "failed", reason: "무언가" } },
      "THROW",
    ];
    for (const folder of replies) {
      const { outcome } = await run({ folder });
      assert.equal("uncPath" in outcome, false, outcome.kind);
    }
  });

  test("누르면 전체 주소를 그대로 복사하고 붙여넣는 법을 알린다", async () => {
    const copied: string[] = [];
    const lines = await runQuoteFolderUncPathCopy({ uncPath: UNC_PATH, copy: recordingCopy(copied) });
    assert.deepEqual(copied, [UNC_PATH], "복사한 글자가 전체 주소 그대로가 아니다");
    assert.deepEqual(lines, [{ text: QUOTE_FOLDER_UNC_PATH_COPIED_TEXT, tone: "normal" }]);
    assert.equal(
      QUOTE_FOLDER_UNC_PATH_COPIED_TEXT,
      "폴더 위치를 복사했습니다 — 탐색기 주소창에 붙여넣고 Enter 를 눌러 주세요"
    );
  });

  test("🔴 두 갈래 다 막히면 주소를 줄로 내린다 — 사람이 긁어서 가져간다", async () => {
    for (const copy of BLOCKED_COPIES) {
      const lines = await runQuoteFolderUncPathCopy({ uncPath: UNC_PATH, copy });
      assert.deepEqual(lines, [
        { text: QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT, tone: "warning" },
        { text: UNC_PATH, tone: "muted" },
      ]);
    }
  });
});

describe("④c ② [설치 명령 복사] — 파일 없이 설치하는 길", () => {
  test("받은 한 줄을 그대로 복사한다 — 부른 통로는 install-command 하나", async () => {
    const h = harness({ folder: found() });
    const copied: string[] = [];
    const lines = await runQuoteFolderHelperInstallCommandCopy({
      env: { fetchImpl: h.env.fetchImpl, copy: recordingCopy(copied) },
    });
    assert.deepEqual(h.fetched, ["/api/quote-folder-helper/install-command"]);
    assert.equal(QUOTE_FOLDER_HELPER_INSTALL_COMMAND_URL, "/api/quote-folder-helper/install-command");
    assert.deepEqual(copied, [INSTALL_COMMAND_BODY]);
    assert.deepEqual(lines, [{ text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT, tone: "normal" }]);
    assert.equal(
      QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT,
      "설치 명령을 복사했습니다 — PowerShell 창을 열어 붙여넣고 Enter 를 눌러 주세요. 관리자 권한은 필요 없습니다"
    );
  });

  test("🔴 통로가 실패하면 서버 문장 · 관리자에게 알리라는 줄 — 복사하지 않는다", async () => {
    const cases: { installCommand: Reply; reason: string }[] = [
      { installCommand: INSTALL_COMMAND_409, reason: ROOT_NOT_CONFIGURED },
      { installCommand: "THROW", reason: "서버에 닿지 못했습니다(네트워크 상태를 확인해 주세요)" },
      { installCommand: { status: 500, jsonThrows: true }, reason: "서버가 요청을 처리하지 못했습니다(HTTP 500)" },
      { installCommand: { status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } }, reason: "이 작업을 수행할 권한이 없습니다." },
      { installCommand: { status: 200, json: { command: "  " } }, reason: "서버 응답을 읽지 못했습니다" },
      { installCommand: { status: 200, json: {} }, reason: "서버 응답을 읽지 못했습니다" },
      { installCommand: { status: 200, jsonThrows: true }, reason: "서버 응답을 읽지 못했습니다" },
    ];
    for (const { installCommand, reason } of cases) {
      const h = harness({ folder: found(), installCommand });
      const copied: string[] = [];
      const lines = await runQuoteFolderHelperInstallCommandCopy({
        env: { fetchImpl: h.env.fetchImpl, copy: recordingCopy(copied) },
      });
      assert.deepEqual(
        lines,
        [
          { text: `설치 명령을 받지 못했습니다 — ${reason}`, tone: "warning" },
          { text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT, tone: "muted" },
        ],
        reason
      );
      assert.deepEqual(copied, [], reason);
    }
    assert.equal(QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT, "문제가 이어지면 관리자에게 알려 주세요");
  });

  test("🔴 복사가 막히면 명령을 화면에 쏟지 않는다 — 짧은 안내 한 줄뿐", async () => {
    for (const copy of BLOCKED_COPIES) {
      const h = harness({ folder: found() });
      const lines = await runQuoteFolderHelperInstallCommandCopy({ env: { fetchImpl: h.env.fetchImpl, copy } });
      assert.deepEqual(lines, [{ text: QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT, tone: "warning" }]);
      const shown = texts({ kind: "OPENED", lines, offerHelperInstall: true }).join("\n");
      assert.ok(!shown.includes("EncodedCommand"), "명령 본문이 화면에 나왔다");
      assert.ok(shown.length < 200, `줄이 너무 길다(${shown.length}자)`);
      // 🔴 설치 파일을 주지 않으므로 파일 · [차단 해제] 쪽으로 보내지 않는다.
      for (const gone of ["설치 파일", "차단 해제", "더블클릭"]) {
        assert.ok(!shown.includes(gone), `없앤 길을 안내한다: ${gone}`);
      }
      assert.equal(
        QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT,
        "이 브라우저에서는 자동 복사가 막혀 있습니다 — 설치 명령은 너무 길어 화면에 보여 드릴 수 없습니다. 다른 브라우저에서 다시 시도하시거나, 관리자에게 설치를 부탁해 주세요"
      );
    }
  });
});

describe("🔴 ④c 문구 — 없앤 길을 안내하지 않는다", () => {
  test("도우미가 없을 때 문장 그대로 — [설치 명령 복사]로 이끈다", () => {
    assert.equal(
      QUOTE_FOLDER_HELPER_MISSING_TEXT,
      "이 PC 에 폴더 열기 도우미가 없는 것 같습니다 — [설치 명령 복사]를 눌러 PowerShell 창에 붙여넣어 주세요. 관리자 권한은 필요 없습니다"
    );
    assert.equal(
      QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT,
      "이 브라우저에서는 자동 복사가 막혀 있습니다 — 아래 주소를 직접 긁어 복사해 주세요"
    );
  });

  test("🔴 화면에 나가는 모든 문장에 설치 파일 · 차단 해제 · 하지 말라고 한 길이 없다", () => {
    const shown = [
      QUOTE_FOLDER_DISABLED_TEXT,
      QUOTE_FOLDER_NOT_FOUND_TEXT,
      QUOTE_FOLDER_MULTIPLE_TEXT,
      QUOTE_FOLDER_HELPER_MISSING_TEXT,
      QUOTE_FOLDER_UNC_PATH_COPIED_TEXT,
      QUOTE_FOLDER_UNC_PATH_COPY_BLOCKED_TEXT,
      QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPIED_TEXT,
      QUOTE_FOLDER_HELPER_INSTALL_COMMAND_COPY_BLOCKED_TEXT,
      QUOTE_FOLDER_HELPER_INSTALL_COMMAND_ADMIN_HINT_TEXT,
    ];
    for (const text of shown) {
      // 설치 파일을 주지 않으므로 그 말도 하지 않는다(「차단 해제」 안내도 함께 사라졌다).
      for (const gone of ["설치 파일", "차단 해제", "더블클릭", ".cmd"]) {
        assert.ok(!text.includes(gone), `없앤 길을 안내한다 — '${gone}': ${text}`);
      }
      // 스마트 앱 컨트롤 끄기(되돌릴 수 없다) · 관리자 권한 실행(다른 계정에 조용히 설치된다) ·
      // 공유폴더에서 실행(실측으로 안 된다) — 셋 다 안내하지 않는다.
      for (const forbidden of ["스마트 앱 컨트롤", "관리자 권한으로", "공유폴더에 두고"]) {
        assert.ok(!text.includes(forbidden), `${forbidden}: ${text}`);
      }
    }
    // 「관리자 권한은 필요 없습니다」는 남는다 — 쓰라는 말이 아니라 안 써도 된다는 말이다.
    assert.ok(QUOTE_FOLDER_HELPER_MISSING_TEXT.includes("관리자 권한은 필요 없습니다"));
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
