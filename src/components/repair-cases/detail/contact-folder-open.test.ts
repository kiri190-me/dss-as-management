import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { QUOTE_FOLDER_LINK_PREFIX, parseQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  QUOTE_FOLDER_HELPER_MISSING_TEXT,
  type QuoteFolderHelperStorage,
} from "@/components/quotes/quote-folder-open";
import {
  CONTACT_FOLDER_DISABLED_TEXT,
  CONTACT_FOLDER_HELPER_MISSING_TEXT,
  CONTACT_FOLDER_MULTIPLE_TEXT,
  CONTACT_FOLDER_NOT_FOUND_TEXT,
  contactFolderUrl,
  runContactFolderCreateAndOpen,
  runContactFolderOpen,
  type ContactFolderCreateEnvironment,
  type ContactFolderOpenOutcome,
} from "./contact-folder-open";

/**
 * ============================================================================
 * 수리 건 상세의 [폴더 열기] — 결과별 문장 · 주소 열기 · 도우미 감지 (연락서 조각 2)
 * ============================================================================
 * fetch · 주소 열기 · 창 이벤트 · 시계 · 저장소를 모두 바꿔 끼운다 — 네트워크도 DOM 도 없다.
 * 서버 응답 모양은 통로(api/repair-cases/{id}/contact-folder)를 그대로 흉내 낸다.
 *
 * 불변식 넷:
 *  (a) 🔴 **[폴더 열기]는 아무것도 만들지 않는다** — GET 하나뿐이고, 없으면 「아직
 *      없습니다」다. 만드는 것은 **사람이 한 번 더 누르는** [폴더 만들고 열기]뿐이다
 *      (이 파일 아래쪽 「조각 5」 묶음이 그것을 본다)
 *  (b) 🔴 **여럿이면 열지 않는다** — 앱이 고르지 않는다(견적서 쪽과 다른 점)
 *  (c) 알림 · 부른 주소에 루트 값이 없다
 *  (d) 「도우미 확인됨」 표시는 견적서 쪽과 **같은 열쇠**다 — 도우미가 한 벌이기 때문이다
 * ============================================================================
 */

type Reply = "THROW" | { status: number; json?: unknown; jsonThrows?: boolean };

const CASE_ID = "11111111-2222-4333-8444-555555555555";
const FOLDER_URL = contactFolderUrl(CASE_ID);

/** 공백 · 한글 · `&` · `%` 가 든 실제 모양의 폴더 이름(연락서 루트에는 연도 폴더가 없다). */
const FOLDER_NAME = "D260908 INVENIA & 주성 T2RCONT-AD2 WN3947 100% 점검요청";

const BACKSLASH = String.fromCharCode(92);
/** 서버가 실수로 끼워 보냈다고 치는 값들 — 알림 · 주소 어디에도 나오면 안 된다. */
const LEAKED_UNC_ROOT = `${BACKSLASH}${BACKSLASH}NAS01${BACKSLASH}연락서보관`;
const LEAKED_CONTAINER_ROOT = "/data/contact-folder-root";

/** 설정된 전체 주소 — [위치 복사]가 쓸 값. 🔴 서버 설정이 있을 때만 응답에 붙는다. */
const UNC_PATH = `${BACKSLASH}${BACKSLASH}NAS01${BACKSLASH}연락서${BACKSLASH}2. 연락서`;

function found(extra: Record<string, unknown> = {}): Reply {
  return {
    status: 200,
    json: { status: "found", relativePath: FOLDER_NAME, folderName: FOLDER_NAME, ...extra },
  };
}

type HarnessOptions = {
  folder: Reply;
  /** POST(만들기)의 답. 주지 않으면 만들기를 부르는 순간 시험이 깨진다. */
  create?: Reply;
  /** 주소를 연 뒤 창이 초점을 잃는다 — 여는 즉시(sync) 또는 조금 뒤(async). 없으면 무반응. */
  focusLost?: "sync" | "async";
  confirmedBefore?: boolean;
  storage?: "ok" | "getterThrows" | "methodsThrow" | "none";
  openThrows?: boolean;
  watchThrows?: boolean;
};

/** 답 하나를 응답 모양으로 — GET · POST 가 같은 틀을 쓴다. */
function reply(answer: Reply) {
  if (answer === "THROW") throw new TypeError("Failed to fetch");
  return {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    json: async () => {
      if (answer.jsonThrows) throw new SyntaxError("Unexpected token <");
      return answer.json;
    },
  };
}

function harness(options: HarnessOptions) {
  const fetched: string[] = [];
  const posted: string[] = [];
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

  const env: ContactFolderCreateEnvironment = {
    fetchImpl: async (url) => {
      fetched.push(url);
      return reply(options.folder);
    },
    /** 🔴 만들기는 **다른 자리**다 — 읽기 흐름이 이것을 부르면 시험이 잡아낸다. */
    createImpl: async (url) => {
      posted.push(url);
      if (options.create === undefined) throw new Error("만들기를 부르면 안 되는 시험에서 불렀다");
      return reply(options.create);
    },
    openLink: (link) => {
      if (options.openThrows) throw new Error("blocked");
      opened.push(link);
      if (options.focusLost === "sync") listener?.();
    },
    watchFocusLoss: (onLost) => {
      if (options.watchThrows) throw new Error("addEventListener is not a function");
      listener = onLost;
      activeWatchers += 1;
      return () => {
        listener = null;
        activeWatchers -= 1;
      };
    },
    delay: async (ms) => {
      delays.push(ms);
      if (options.focusLost === "async") listener?.();
    },
    storage: () => {
      if (options.storage === "getterThrows") throw new Error("SecurityError");
      if (options.storage === "none") return null;
      return options.storage === "methodsThrow" ? throwingStorage : okStorage;
    },
  };

  return {
    env,
    fetched,
    posted,
    opened,
    delays,
    store,
    watchersLeft: () => activeWatchers,
  };
}

type Bench = {
  outcome: ContactFolderOpenOutcome;
  fetched: string[];
  posted: string[];
  opened: string[];
  delays: number[];
  store: Map<string, string>;
  watchersLeft: () => number;
};

async function run(options: HarnessOptions): Promise<Bench> {
  const bench = harness(options);
  const outcome = await runContactFolderOpen({ repairCaseId: CASE_ID, env: bench.env });
  return { outcome, ...bench };
}

/** [폴더 만들고 열기] 한 번 — POST 한 뒤 (만들었으면) 열기 흐름까지 탄다. */
async function runCreate(options: HarnessOptions): Promise<Bench> {
  const bench = harness(options);
  const outcome = await runContactFolderCreateAndOpen({ repairCaseId: CASE_ID, env: bench.env });
  return { outcome, ...bench };
}

function textOf(outcome: ContactFolderOpenOutcome): string {
  return outcome.lines.map((line) => line.text).join("\n");
}

describe("부르는 통로 — 🔴 GET 하나뿐이고 폴더를 만들지 않는다", () => {
  test("수리 건 id 로 만든 주소 하나만 부른다", async () => {
    const { fetched } = await run({ folder: found(), focusLost: "sync" });
    assert.deepEqual(fetched, [FOLDER_URL]);
    assert.equal(FOLDER_URL, `/api/repair-cases/${CASE_ID}/contact-folder`);
  });

  test("id 는 주소에 안전하게 싸인다", () => {
    assert.equal(contactFolderUrl("a/b?c"), "/api/repair-cases/a%2Fb%3Fc/contact-folder");
  });
});

describe("결과별 문장", () => {
  test("disabled — 설정이 없다. 흐린 결, 단추를 내밀지 않는다", async () => {
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "disabled" } } });
    assert.equal(outcome.kind, "DISABLED");
    assert.deepEqual(outcome.lines, [{ text: CONTACT_FOLDER_DISABLED_TEXT, tone: "muted" }]);
    assert.equal(outcome.offerHelperInstall, false);
    assert.deepEqual(opened, [], "열려고 했다");
  });

  test("🔴 not-found — 「아직 없습니다」로 끝난다. 만들지 않고 단추 하나를 내밀 뿐이다", async () => {
    const { outcome, opened, posted } = await run({ folder: { status: 200, json: { status: "not-found" } } });
    assert.equal(outcome.kind, "NOT_FOUND");
    assert.deepEqual(outcome.lines, [{ text: CONTACT_FOLDER_NOT_FOUND_TEXT, tone: "warning" }]);
    assert.equal(outcome.offerHelperInstall, false);
    // 🔴 만든 것이 아니라 **만들 수 있다**는 표시다 — 누르는 것은 사람이다.
    assert.equal(outcome.offerCreate, true);
    assert.deepEqual(posted, [], "읽기 흐름이 만들었다");
    assert.deepEqual(opened, []);
  });

  test("🔴 multiple — 열지 않는다. 이름을 그대로 보여 사람이 정리하게 한다", async () => {
    const names = [FOLDER_NAME, "D260908 INVENIA(옛것)"];
    const { outcome, opened } = await run({
      folder: { status: 200, json: { status: "multiple", folderNames: names } },
    });
    assert.equal(outcome.kind, "MULTIPLE");
    assert.equal(outcome.lines[0].text, CONTACT_FOLDER_MULTIPLE_TEXT);
    assert.equal(outcome.lines[0].tone, "warning");
    assert.deepEqual(
      outcome.lines.slice(1),
      names.map((name) => ({ text: name, tone: "muted" }))
    );
    assert.deepEqual(opened, [], "🔴 앱이 하나를 골라 열었다");
    assert.equal(outcome.offerHelperInstall, false);
  });

  test("failed — 서버가 준 짧은 사유를 그대로 전한다", async () => {
    const reason = "공유폴더가 느려 응답이 없습니다(잠시 뒤 다시 시도하세요).";
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "failed", reason } } });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes(reason), textOf(outcome));
    assert.deepEqual(opened, []);
  });

  test("failed — 사유가 비었으면 빈 줄을 내지 않는다", async () => {
    const { outcome } = await run({ folder: { status: 200, json: { status: "failed", reason: "   " } } });
    assert.ok(textOf(outcome).includes("까닭을 알 수 없습니다"), textOf(outcome));
  });

  test("found — 폴더 이름을 보이고 주소를 연다", async () => {
    const { outcome, opened } = await run({ folder: found(), focusLost: "sync" });
    assert.equal(outcome.kind, "OPENED");
    assert.ok(textOf(outcome).includes(`탐색기로 폴더를 엽니다: ${FOLDER_NAME}`), textOf(outcome));
    assert.equal(opened.length, 1);
    assert.ok(opened[0].startsWith(QUOTE_FOLDER_LINK_PREFIX));
    assert.equal(parseQuoteFolderLink(opened[0]), FOLDER_NAME);
  });
});

describe("요청 자체가 실패할 때 — 던지지 않는다", () => {
  test("네트워크가 끊겼다", async () => {
    const { outcome } = await run({ folder: "THROW" });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes("서버에 닿지 못했습니다"), textOf(outcome));
  });

  test("권한이 없다(403) — 서버 문장을 그대로 전한다", async () => {
    const { outcome } = await run({
      folder: { status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } },
    });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes("이 작업을 수행할 권한이 없습니다."), textOf(outcome));
  });

  test("없는 수리 건(404) — 서버 문장 그대로", async () => {
    const { outcome } = await run({
      folder: { status: 404, json: { error: "해당 수리 건을 찾을 수 없습니다.", code: "NOT_FOUND" } },
    });
    assert.ok(textOf(outcome).includes("해당 수리 건을 찾을 수 없습니다."), textOf(outcome));
  });

  test("본문을 읽지 못했다 — HTTP 번호로 말한다", async () => {
    const { outcome } = await run({ folder: { status: 500, jsonThrows: true } });
    assert.ok(textOf(outcome).includes("HTTP 500"), textOf(outcome));
  });

  test("모양이 다른 200 응답 — 알아듣지 못했다고 말한다", async () => {
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "허허" } } });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes("서버 응답을 읽지 못했습니다"), textOf(outcome));
    assert.deepEqual(opened, []);
  });

  test("found 인데 상대 경로 칸이 없다 — 알아듣지 못했다고 말한다", async () => {
    const { outcome, opened } = await run({ folder: { status: 200, json: { status: "found" } } });
    assert.equal(outcome.kind, "FAILED");
    assert.deepEqual(opened, []);
  });

  test("도우미 주소로 만들 수 없는 이름 — 열지 않고 알린다", async () => {
    const { outcome, opened } = await run({
      folder: { status: 200, json: { status: "found", relativePath: `..${BACKSLASH}밖으로`, folderName: "밖으로" } },
    });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes("도우미 주소로 만들 수 없습니다"), textOf(outcome));
    assert.deepEqual(opened, []);
  });

  test("브라우저가 주소를 열지 못했다", async () => {
    const { outcome } = await run({ folder: found(), openThrows: true });
    assert.equal(outcome.kind, "FAILED");
    assert.ok(textOf(outcome).includes("브라우저가 폴더 열기 주소를 열지 못했습니다"), textOf(outcome));
  });
});

describe("도우미 감지 — 초점을 잃는가", () => {
  test("곧바로 초점을 잃으면 OPENED · 「확인됨」 표시를 적는다", async () => {
    const { outcome, store } = await run({ folder: found(), focusLost: "sync" });
    assert.equal(outcome.kind, "OPENED");
    assert.equal(outcome.offerHelperInstall, true);
    assert.equal(store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
  });

  test("조금 뒤에 잃어도 OPENED — 기다리는 시간은 견적서 쪽과 같은 값", async () => {
    const { outcome, delays } = await run({ folder: found(), focusLost: "async" });
    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
  });

  test("반응이 없고 표시도 없으면 — 도우미가 없는 것으로 보고 설치로 이끈다", async () => {
    const { outcome } = await run({ folder: found() });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.equal(outcome.offerHelperInstall, true);
    assert.ok(textOf(outcome).includes(CONTACT_FOLDER_HELPER_MISSING_TEXT), textOf(outcome));
    assert.ok(textOf(outcome).includes(`열려던 폴더: ${FOLDER_NAME}`), textOf(outcome));
  });

  test("🔴 설치 안내 문장은 견적서 쪽과 같은 한 벌 — 설치되는 도우미가 같기 때문", () => {
    assert.equal(CONTACT_FOLDER_HELPER_MISSING_TEXT, QUOTE_FOLDER_HELPER_MISSING_TEXT);
  });

  test("반응은 없지만 전에 확인된 브라우저면 「없다」고 말하지 않는다", async () => {
    const { outcome } = await run({ folder: found(), confirmedBefore: true });
    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.equal(outcome.offerHelperInstall, true);
    assert.ok(!textOf(outcome).includes("도우미가 없는 것 같습니다"), textOf(outcome));
  });

  test("🔴 「확인됨」 표시는 견적서 쪽과 같은 열쇠를 쓴다 — 도우미는 PC 당 한 벌이다", async () => {
    const { store } = await run({ folder: found(), focusLost: "sync" });
    assert.deepEqual([...store.keys()], [QUOTE_FOLDER_HELPER_CONFIRMED_KEY]);
  });

  test("저장소가 던져도 돈다 — 꺼내기 · 메서드 · 없음", async () => {
    for (const storage of ["getterThrows", "methodsThrow", "none"] as const) {
      const { outcome } = await run({ folder: found(), focusLost: "sync", storage });
      assert.equal(outcome.kind, "OPENED", storage);
    }
    for (const storage of ["getterThrows", "methodsThrow", "none"] as const) {
      const { outcome } = await run({ folder: found(), storage });
      assert.equal(outcome.kind, "NO_RESPONSE", storage);
    }
  });

  test("창 이벤트를 걸 수 없어도 돈다 — 시간만 기다린다", async () => {
    const { outcome, opened } = await run({ folder: found(), watchThrows: true });
    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.equal(opened.length, 1);
  });

  test("끝나면 듣기를 푼다 — 늦은 blur 는 세지 않는다", async () => {
    for (const focusLost of [undefined, "sync", "async"] as const) {
      const { watchersLeft } = await run({ folder: found(), focusLost });
      assert.equal(watchersLeft(), 0, String(focusLost));
    }
  });
});

describe("🔴 전체 주소(uncPath) — 설정이 있을 때만, 알림 줄에는 넣지 않는다", () => {
  test("설정이 있으면 결과에 붙는다 — 줄에는 안 나온다", async () => {
    for (const focusLost of [undefined, "sync"] as const) {
      const { outcome } = await run({ folder: found({ uncPath: UNC_PATH }), focusLost });
      assert.equal(outcome.uncPath, UNC_PATH);
      assert.equal(textOf(outcome).includes(UNC_PATH), false, "알림 줄에 전체 주소가 있다");
    }
  });

  test("설정이 없으면 칸 자체가 없다 — 빈 글자도 없는 것으로 본다", async () => {
    const { outcome } = await run({ folder: found(), focusLost: "sync" });
    assert.equal("uncPath" in outcome, false);
    const blank = await run({ folder: found({ uncPath: "   " }), focusLost: "sync" });
    assert.equal("uncPath" in blank.outcome, false);
  });

  test("열지 못한 결과에도 붙는다 — [위치 복사]로 갈 수 있게", async () => {
    const { outcome } = await run({ folder: found({ uncPath: UNC_PATH }), openThrows: true });
    assert.equal(outcome.kind, "FAILED");
    assert.equal(outcome.uncPath, UNC_PATH);
  });

  test("찾지 못한 결과에는 붙지 않는다", async () => {
    const { outcome } = await run({ folder: { status: 200, json: { status: "not-found", uncPath: UNC_PATH } } });
    assert.equal("uncPath" in outcome, false);
  });
});

describe("🔴 알려지지 않은 칸은 알림까지 오지 않는다 — 루트가 새지 않는다", () => {
  test("서버가 루트를 끼워 보내도 줄 · 주소 어디에도 없다", async () => {
    const { outcome, opened } = await run({
      folder: found({ root: LEAKED_CONTAINER_ROOT, uncRoot: LEAKED_UNC_ROOT, archiveDir: LEAKED_CONTAINER_ROOT }),
      focusLost: "sync",
    });
    const everything = `${textOf(outcome)}\n${JSON.stringify(outcome)}\n${opened.join("\n")}`;
    assert.equal(everything.includes(LEAKED_CONTAINER_ROOT), false, everything);
    assert.equal(everything.includes("NAS01"), false, everything);
  });
});

/**
 * ============================================================================
 * [폴더 만들고 열기] — 🔴 사람이 **한 번 더 누른** 그때만 (조각 5)
 * ============================================================================
 * 불변식 넷:
 *  (a) 🔴 읽기 흐름은 **절대 만들지 않는다** — POST 를 부르면 하네스가 던진다
 *  (b) 🔴 만들었거나 이미 있었을 때만 **열기 흐름**을 탄다
 *  (c) 🔴 인수번호가 같은 폴더가 **여럿**이면 열지도 만들지도 않고 이름만 보인다
 *  (d) 🔴 만들기 단추를 다시 내미는 것은 `not-found` 뿐이다
 *
 * 🔴 **걷어낸 것**(조각 8 · 2026-10-05): 서버가 S/N 으로 「비슷한 폴더」를 훑어 돌려주던
 * 상태와 그 안내 문구. 아래 「자취가 없다」가 화면 쪽 원본을 글자로 본다.
 * ============================================================================
 */

describe("🔴 저절로 만들지 않는다", () => {
  test("읽기 흐름([폴더 열기])은 만들기를 부르지 않는다 — 없다고만 말한다", async () => {
    const { outcome, posted } = await run({ folder: { status: 200, json: { status: "not-found" } } });
    assert.equal(outcome.kind, "NOT_FOUND");
    assert.deepEqual(posted, [], "읽기 흐름이 폴더를 만들었다");
  });

  test("🔴 만들기 단추를 내미는 것은 not-found 뿐이다", async () => {
    const notFound = await run({ folder: { status: 200, json: { status: "not-found" } } });
    assert.equal(notFound.outcome.offerCreate, true);

    const others: Reply[] = [
      { status: 200, json: { status: "disabled" } },
      { status: 200, json: { status: "multiple", folderNames: [FOLDER_NAME] } },
      { status: 200, json: { status: "failed", reason: "공유폴더가 느립니다" } },
      found(),
    ];
    for (const folder of others) {
      const { outcome } = await run({ folder, focusLost: "sync" });
      assert.notEqual(outcome.offerCreate, true, `${outcome.kind} 에 만들기 단추가 붙었다`);
    }
  });
});

describe("만들고 바로 연다", () => {
  test("created — 같은 주소로 POST 한 뒤 열기 흐름을 탄다", async () => {
    const { outcome, posted, fetched, opened } = await runCreate({
      folder: found(),
      create: { status: 200, json: { status: "created", folderName: FOLDER_NAME } },
      focusLost: "sync",
    });

    assert.deepEqual(posted, [FOLDER_URL], "만들기를 한 번만 부른다");
    assert.deepEqual(fetched, [FOLDER_URL], "만든 뒤 위치를 다시 묻는다");
    assert.equal(outcome.kind, "OPENED");
    assert.equal(outcome.lines[0].text, `연락서 폴더를 만들었습니다: ${FOLDER_NAME}`);
    assert.ok(textOf(outcome).includes(`탐색기로 폴더를 엽니다: ${FOLDER_NAME}`), textOf(outcome));
    assert.equal(opened.length, 1);
    assert.equal(parseQuoteFolderLink(opened[0]), FOLDER_NAME);
    // 열렸으니 만들기 단추는 더 내밀지 않는다.
    assert.notEqual(outcome.offerCreate, true);
  });

  test("found — 누르는 사이에 생겼다. 만들지 않았다고 적고 그대로 연다", async () => {
    const { outcome, opened } = await runCreate({
      folder: found(),
      create: { status: 200, json: { status: "found", folderName: FOLDER_NAME } },
      focusLost: "sync",
    });

    assert.equal(outcome.kind, "OPENED");
    assert.ok(outcome.lines[0].text.includes("이미 폴더가 있어 새로 만들지 않았습니다"), outcome.lines[0].text);
    assert.equal(opened.length, 1);
  });

  test("만든 뒤 도우미가 없으면 — 설치로 이끄는 줄이 그대로 따라온다", async () => {
    const { outcome } = await runCreate({
      folder: found({ uncPath: UNC_PATH }),
      create: { status: 200, json: { status: "created", folderName: FOLDER_NAME } },
    });

    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.equal(outcome.offerHelperInstall, true);
    assert.equal(outcome.uncPath, UNC_PATH);
    assert.ok(textOf(outcome).includes("연락서 폴더를 만들었습니다"), textOf(outcome));
    assert.ok(textOf(outcome).includes(CONTACT_FOLDER_HELPER_MISSING_TEXT), textOf(outcome));
  });
});

describe("🔴 만들지 않는 결과들 — 열지도 않는다", () => {
  test("multiple — 열지 않고 이름만 보인다", async () => {
    const names = [FOLDER_NAME, "D260908 INVENIA(옛것)"];
    const { outcome, opened } = await runCreate({
      folder: found(),
      create: { status: 200, json: { status: "multiple", folderNames: names } },
    });

    assert.equal(outcome.kind, "MULTIPLE");
    assert.equal(outcome.lines[0].text, CONTACT_FOLDER_MULTIPLE_TEXT);
    assert.deepEqual(opened, []);
    assert.notEqual(outcome.offerCreate, true);
  });

  test("disabled · failed — 사유를 그대로 전한다", async () => {
    const disabled = await runCreate({ folder: found(), create: { status: 200, json: { status: "disabled" } } });
    assert.equal(disabled.outcome.kind, "DISABLED");
    assert.deepEqual(disabled.outcome.lines, [{ text: CONTACT_FOLDER_DISABLED_TEXT, tone: "muted" }]);

    const reason = "같은 이름의 파일이 자리를 차지하고 있어 폴더를 만들 수 없습니다.";
    const failed = await runCreate({
      folder: found(),
      create: { status: 200, json: { status: "failed", reason } },
    });
    assert.equal(failed.outcome.kind, "FAILED");
    assert.ok(textOf(failed.outcome).includes(reason), textOf(failed.outcome));
    assert.deepEqual(failed.opened, []);
  });
});

describe("만들기가 막혔을 때 — 서버 문장을 그대로 전한다", () => {
  test("권한이 없다(403) · 잠긴 건(409) · 없는 건(404)", async () => {
    const replies: Array<{ status: number; error: string; code: string }> = [
      { status: 403, error: "이 수리 건에 연락서 폴더를 만들 권한이 없습니다.", code: "FORBIDDEN" },
      { status: 409, error: "출하 완료로 잠긴 수리 건에는 연락서 폴더를 만들 수 없습니다.", code: "CASE_LOCKED" },
      { status: 404, error: "해당 수리 건을 찾을 수 없습니다.", code: "NOT_FOUND" },
      {
        status: 500,
        error: "연락서 폴더는 만들었지만 기록을 남기지 못했습니다. 관리자에게 알려 주세요.",
        code: "AUDIT_FAILED",
      },
    ];
    for (const { status, error, code } of replies) {
      const { outcome, opened } = await runCreate({
        folder: found(),
        create: { status, json: { error, code } },
      });
      assert.equal(outcome.kind, "FAILED", code);
      assert.ok(textOf(outcome).includes(error), textOf(outcome));
      assert.deepEqual(opened, [], code);
      assert.notEqual(outcome.offerCreate, true, code);
    }
  });

  test("네트워크가 끊겼다 · 모양이 다른 응답", async () => {
    const thrown = await runCreate({ folder: found(), create: "THROW" });
    assert.equal(thrown.outcome.kind, "FAILED");
    assert.ok(textOf(thrown.outcome).includes("서버에 닿지 못했습니다"), textOf(thrown.outcome));

    const odd = await runCreate({ folder: found(), create: { status: 200, json: { status: "허허" } } });
    assert.equal(odd.outcome.kind, "FAILED");
    assert.ok(textOf(odd.outcome).includes("서버 응답을 읽지 못했습니다"), textOf(odd.outcome));

    // 만들었다면서 이름이 없다 — 알아듣지 못했다고 말한다(열지 않는다).
    const nameless = await runCreate({ folder: found(), create: { status: 200, json: { status: "created" } } });
    assert.equal(nameless.outcome.kind, "FAILED");
    assert.deepEqual(nameless.opened, []);
  });
});
