import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { browserCopyTextEnvironment, copyText, type CopyTextEnvironment } from "./copy-text";

/**
 * ============================================================================
 * 공용 복사 — 두 갈래 (copy-text.ts)
 * ============================================================================
 * 두 갈래를 모두 바꿔 끼워 DOM 없이 본다. 보는 것은 셋이다:
 *  (a) 첫째 갈래(clipboard API)가 되면 둘째는 부르지 않는다
 *  (b) 첫째가 **없거나 던지면** 둘째로 넘어간다 — http 로 연 NAS 가 바로 이 경우다
 *  (c) 둘 다 안 되면 false — 던지지 않는다(부르는 쪽이 다음 길을 낸다)
 * ============================================================================
 */

const SECRET = String.fromCharCode(92, 92) + "NAS01" + String.fromCharCode(92) + "견적서보관";

function spy() {
  const clipboard: string[] = [];
  const selection: string[] = [];
  return { clipboard, selection };
}

describe("(a) 첫째 갈래 — navigator.clipboard", () => {
  test("되면 true · 둘째 갈래를 부르지 않는다", async () => {
    const seen = spy();
    const env: CopyTextEnvironment = {
      clipboardWrite: async (text) => {
        seen.clipboard.push(text);
      },
      selectionCopy: (text) => {
        seen.selection.push(text);
        return true;
      },
    };
    assert.equal(await copyText(SECRET, env), true);
    assert.deepEqual(seen.clipboard, [SECRET]);
    assert.deepEqual(seen.selection, [], "첫째가 됐는데 둘째까지 불렀다");
  });
});

describe("(b) 첫째가 없거나 던지면 둘째 갈래로", () => {
  test("🔴 첫째가 아예 없다(null) — http 로 연 NAS", async () => {
    const seen = spy();
    assert.equal(
      await copyText(SECRET, {
        clipboardWrite: null,
        selectionCopy: (text) => {
          seen.selection.push(text);
          return true;
        },
      }),
      true
    );
    assert.deepEqual(seen.selection, [SECRET]);
  });

  test("첫째가 던진다(권한 거절) — 같은 글자로 둘째를 부른다", async () => {
    const seen = spy();
    assert.equal(
      await copyText(SECRET, {
        clipboardWrite: () => Promise.reject(new Error("NotAllowedError")),
        selectionCopy: (text) => {
          seen.selection.push(text);
          return true;
        },
      }),
      true
    );
    assert.deepEqual(seen.selection, [SECRET]);
  });
});

describe("(c) 둘 다 안 되면 false — 던지지 않는다", () => {
  test("둘째가 false 를 돌려준다", async () => {
    assert.equal(await copyText(SECRET, { clipboardWrite: null, selectionCopy: () => false }), false);
  });

  test("첫째가 던지고 둘째도 false", async () => {
    assert.equal(
      await copyText(SECRET, {
        clipboardWrite: () => Promise.reject(new Error("NotAllowedError")),
        selectionCopy: () => false,
      }),
      false
    );
  });

  test("🔴 둘째가 던져도(document 가 없다) 던지지 않고 false", async () => {
    assert.equal(
      await copyText(SECRET, {
        clipboardWrite: null,
        selectionCopy: () => {
          throw new ReferenceError("document is not defined");
        },
      }),
      false
    );
  });

  test("첫째가 던지고 둘째도 던진다", async () => {
    assert.equal(
      await copyText(SECRET, {
        clipboardWrite: () => Promise.reject(new Error("NotAllowedError")),
        selectionCopy: () => {
          throw new Error("execCommand is not a function");
        },
      }),
      false
    );
  });
});

describe("브라우저 기본값 — 부를 때 만든다", () => {
  test("clipboard API 가 없는 곳에서는 첫째 갈래가 null · 꺼내는 일 자체는 던지지 않는다", () => {
    const env = browserCopyTextEnvironment();
    assert.equal(env.clipboardWrite, null, "이 시험 환경에는 navigator.clipboard 가 없다");
    assert.equal(typeof env.selectionCopy, "function");
  });

  test("부르는 쪽이 한 갈래만 바꿔 끼울 수 있다", async () => {
    const seen = spy();
    // 둘째만 바꿔 끼운다 — 첫째는 브라우저 기본값(이 환경에서는 null)이다.
    assert.equal(
      await copyText("짧은 글자", {
        selectionCopy: (text) => {
          seen.selection.push(text);
          return true;
        },
      }),
      true
    );
    assert.deepEqual(seen.selection, ["짧은 글자"]);
  });
});
