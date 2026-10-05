import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  QUOTE_FOLDER_HELPER_CONFIRMED_KEY,
  QUOTE_FOLDER_HELPER_DETECTION_MS,
  QUOTE_FOLDER_HELPER_MISSING_TEXT,
  type QuoteFolderHelperStorage,
} from "@/components/quotes/quote-folder-open";
import { QUOTE_FOLDER_LINK_PREFIX, parseQuoteFolderLink } from "@/lib/domain/quote-folder-link";
import {
  contactFolderPlaceAttemptedText,
  contactFolderPlaceDisplayName,
  contactFolderPlaceOpeningText,
  runContactFolderPlaceOpen,
  type ContactFolderPlaceOpenEnvironment,
} from "./contact-folder-place-open";

/**
 * ============================================================================
 * 공유폴더 구역의 [폴더 열기] — **보고 있는 자리**를 연다 (연락서 조각 10)
 * ============================================================================
 * 주소 열기 · 창 이벤트 · 시계 · 저장소를 모두 바꿔 끼운다 — DOM 도 네트워크도 없다.
 *
 * 불변식 넷:
 *  (a) 🔴 **fetch 가 없다** — 폴더 이름은 목록을 받을 때 이미 손에 있고, 그 아래 자리는
 *      사람이 눌러 온 길이다. 서버에 다시 묻지 않는다.
 *  (b) 🔴 여는 주소는 **폴더 쪽 접두어(`open/`)** 이고, 몸통은 루트 아래 상대 경로뿐이다 —
 *      조각 2 가 쓰는 주소와 **같은 모양**이다(마디가 늘었을 뿐).
 *  (c) 🔴 규칙에 어긋나는 경로(`..` · 끝이 점 · 공백 …)면 **주소를 지어내지 않는다.**
 *  (d) 「도우미 확인됨」 표시는 견적서 · 연락서 쪽과 **같은 열쇠**다(도우미가 PC 당 한 벌).
 * ============================================================================
 */

const FOLDER = "D260908 INVENIA & 주성 T2RCONT-AD2 WN3947 100% 점검요청";
const PLACE = `${FOLDER}/사진/2026`;

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

  const env: Partial<ContactFolderPlaceOpenEnvironment> = {
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

  return { env, opened, delays, store, watchersLeft: () => activeWatchers };
}

function textsOf(lines: readonly { text: string }[]): string[] {
  return lines.map((line) => line.text);
}

describe("여는 주소", () => {
  test("🔴 폴더 쪽 주소에 **보고 있는 자리**가 그대로 실린다 — 되읽으면 같은 경로다", async () => {
    const stage = harness({ focusLost: "sync" });
    const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: stage.env });

    assert.equal(stage.opened.length, 1);
    const [link] = stage.opened;
    assert.ok(link.startsWith(QUOTE_FOLDER_LINK_PREFIX), link);
    assert.equal(parseQuoteFolderLink(link), PLACE);
    // 주소에는 base64url 글자만 간다 — 공백 · 한글 · `%` · `&` 가 그대로 새지 않는다.
    assert.match(link.slice(QUOTE_FOLDER_LINK_PREFIX.length), /^[A-Za-z0-9_-]+$/);
    assert.equal(outcome.kind, "OPENED");
  });

  test("맨 위 폴더 하나만 주어도 연다 — 자리가 없을 때의 모양", async () => {
    const stage = harness({ focusLost: "sync" });
    await runContactFolderPlaceOpen({ relativePath: FOLDER, env: stage.env });
    assert.equal(parseQuoteFolderLink(stage.opened[0]), FOLDER);
  });

  test("🔴 규칙 밖 경로는 주소를 지어내지 않는다 — 열지도 않는다", async () => {
    for (const relativePath of [
      `${FOLDER}/..`,
      `${FOLDER}/../../비밀`,
      `${FOLDER}/사진.`,
      `${FOLDER}/사진 `,
      `${FOLDER}//사진`,
      `C:\\${FOLDER}`,
      `\\\\NAS01\\공유\\${FOLDER}`,
      "",
    ]) {
      const stage = harness({ focusLost: "sync" });
      const outcome = await runContactFolderPlaceOpen({ relativePath, env: stage.env });
      assert.equal(outcome.kind, "FAILED", relativePath);
      assert.deepEqual(stage.opened, [], relativePath);
      // 🔴 다시 설치해도 풀릴 일이 아니다 — 설치로 이끌지 않는다.
      assert.equal(outcome.offerHelperInstall, false, relativePath);
      assert.ok(textsOf(outcome.lines)[0].includes("폴더를 열지 못했습니다"), relativePath);
    }
  });

  test("보고 있는 자리의 이름은 길의 맨 뒤 토막이다", () => {
    assert.equal(contactFolderPlaceDisplayName(PLACE), "2026");
    assert.equal(contactFolderPlaceDisplayName(FOLDER), FOLDER);
  });
});

describe("도우미 감지", () => {
  test("초점을 잃으면 열린 것으로 보고 「확인됨」을 적는다", async () => {
    const stage = harness({ focusLost: "async" });
    const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: stage.env });

    assert.equal(outcome.kind, "OPENED");
    assert.deepEqual(textsOf(outcome.lines), [contactFolderPlaceOpeningText("2026")]);
    assert.equal(outcome.offerHelperInstall, true);
    assert.equal(stage.store.get(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), "1");
    assert.deepEqual(stage.delays, [QUOTE_FOLDER_HELPER_DETECTION_MS]);
    // 듣기를 반드시 푼다 — 늦은 blur 가 다음 결과를 흔들지 않게.
    assert.equal(stage.watchersLeft(), 0);
  });

  test("🔴 반응이 없고 표시도 없으면 [설치 명령 복사]로 이끈다", async () => {
    const stage = harness();
    const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: stage.env });

    assert.equal(outcome.kind, "NO_RESPONSE");
    assert.deepEqual(textsOf(outcome.lines), [
      QUOTE_FOLDER_HELPER_MISSING_TEXT,
      contactFolderPlaceAttemptedText("2026"),
    ]);
    assert.equal(outcome.offerHelperInstall, true);
    assert.equal(stage.store.has(QUOTE_FOLDER_HELPER_CONFIRMED_KEY), false, "열리지도 않았는데 확인됨을 적었다");
  });

  test("반응은 없지만 전에 확인된 브라우저면 「없다」고 말하지 않는다", async () => {
    const stage = harness({ confirmedBefore: true });
    const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: stage.env });

    assert.equal(outcome.kind, "NO_RESPONSE_CONFIRMED");
    assert.deepEqual(textsOf(outcome.lines), [contactFolderPlaceOpeningText("2026")]);
    assert.equal(outcome.offerHelperInstall, true);
  });

  test("🔴 저장소 · 듣기 · 열기가 깨져도 던지지 않는다", async () => {
    for (const options of [
      { storage: "getterThrows" as const },
      { storage: "methodsThrow" as const, focusLost: "sync" as const },
      { storage: "none" as const },
      { watchThrows: true },
    ]) {
      const stage = harness(options);
      const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: stage.env });
      assert.ok(outcome.lines.length > 0, JSON.stringify(options));
      assert.equal(stage.opened.length, 1, JSON.stringify(options));
    }

    const broken = harness({ openThrows: true });
    const outcome = await runContactFolderPlaceOpen({ relativePath: PLACE, env: broken.env });
    assert.equal(outcome.kind, "FAILED");
    assert.equal(outcome.offerHelperInstall, false);
    assert.equal(broken.watchersLeft(), 0, "열기가 깨졌는데 듣기가 남았다");
  });
});

describe("🔴 서버를 부르지 않는다 · 페이지를 떠나지 않는다", () => {
  const source = readFileSync(new URL("./contact-folder-place-open.ts", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n"
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("fetch · 서버 사슬 · 쓰기 길이 한 글자도 없다", () => {
    for (const forbidden of [
      /\bfetch\(/,
      /method:\s*"POST"/,
      /method:\s*"PUT"/,
      /method:\s*"DELETE"/,
      /@\/lib\/server\//,
      /"server-only"/,
      /node:fs/,
      /console\./,
      /execCommand/,
      /navigator\.clipboard/,
    ]) {
      assert.equal(forbidden.test(code), false, `흔적: ${forbidden}`);
    }
  });

  test("도우미 주소는 숨은 iframe 으로 — 페이지를 옮기거나 새 창을 열지 않는다", () => {
    assert.ok(code.includes('document.createElement("iframe")'));
    for (const leave of ["location.assign(", "location.href =", "location.replace(", "window.open("]) {
      assert.equal(code.includes(leave), false, `'${leave}' 로 주소를 연다`);
    }
  });

  test("🔴 주소 만들기 규칙을 제 손으로 적지 않는다 — 도메인 함수 하나를 거친다", () => {
    assert.ok(code.includes("buildQuoteFolderLink("), "주소 만들기를 거치지 않는다");
    for (const forbidden of [/btoa\(/, /base64/i, /QUOTE_FOLDER_LINK_PREFIX/, /\.\.\//]) {
      assert.equal(forbidden.test(code), false, `주소 규칙을 또 적는다: ${forbidden}`);
    }
  });
});
