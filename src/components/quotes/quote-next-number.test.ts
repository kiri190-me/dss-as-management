import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QUOTE_NEXT_NUMBER_URL,
  QUOTE_NUMBER_SUGGESTION_HINT_TEXT,
  fetchSuggestedQuoteNumber,
  fillQuoteNumberIfEmpty,
  readSuggestedQuoteNumber,
  type QuoteNextNumberFetch,
} from "./quote-next-number";

/**
 * ============================================================================
 * [새 견적서]의 발행번호 칸에 다음 번호를 미리 적어 둔다 (2026-10-06)
 * ============================================================================
 * 값으로 보는 것(통로에 묻기 · 빈 칸일 때만 채우기)과, 폼이 그 규칙을 제자리에서 부르는지를
 * 원본 글자로 보는 것 둘이다. QuoteEditForm 은 서버 액션을 부르는 클라이언트 컴포넌트라 이
 * 시험 환경에서 그려 볼 수 없어(`server-only`), 이웃 시험(quote-folder-open-screens.test.ts ·
 * quote-excel-autofill-screens.test.ts)과 같은 방법으로 원본을 읽는다.
 *
 * 🔴 지키는 결정 — **제안이지 채번이 아니다**(vendor/dss-core/src/schema/quotes.ts 의
 * quoteNumber 주석): 칸은 여전히 자유 입력이고, 사람이 적은 값을 덮지 않고, 저장할 때 이 값과
 * 견주어 거절하지 않는다. 못 받으면 조용히 빈 칸이다.
 *
 * 불변식 다섯:
 *  ① 새 견적서에서만 묻는다(고치기에서는 묻지 않는다)  ② 빈 칸일 때만 채운다
 *  ③ disabled · failed · 거절 · 네트워크 끊김이면 아무 일도 없다(오류 상자 없음)
 *  ④ 번호 칸이 읽기 전용이 아니다  ⑤ 한 번만 묻는다
 * ============================================================================
 */

// ── 원본 읽기 도우미 ───────────────────────────────────────────────────────

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};
const count = (source: string, needle: string) => source.split(needle).length - 1;

const formSource = read("src/components/quotes/QuoteEditForm.tsx");
const form = flat(formSource);
const moduleSource = read("src/components/quotes/quote-next-number.ts");

const srcDir = fileURLToPath(new URL("src/", repoUrl));
const walkSources = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSources(full, found);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
};
const relativeToSrc = (file: string) => path.relative(srcDir, file).split(path.sep).join("/");

// ── 통로에 묻기 (값) ───────────────────────────────────────────────────────

type Reply = "THROW" | { status: number; json?: unknown; jsonThrows?: boolean };

function harness(reply: Reply) {
  const asked: string[] = [];
  const fetchImpl: QuoteNextNumberFetch = async (url) => {
    asked.push(url);
    if (reply === "THROW") throw new Error("네트워크가 끊겼다");
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.jsonThrows) throw new SyntaxError("JSON 이 아니다");
        return reply.json;
      },
    };
  };
  return { asked, fetchImpl };
}

const READY: Reply = {
  status: 200,
  json: {
    status: "ready",
    quoteNumber: "DSS 2026-096",
    year: 2026,
    sequence: 96,
    folderCount: 106,
    numberedFolderCount: 106,
    highestFolderSequence: 95,
    highestKnownSequence: 95,
  },
};

describe("통로에 한 번 묻는다 — 쓸 수 있는 번호만 돌려준다", () => {
  test("ready 면 그 번호. 🔴 부르는 주소는 견적서 id 가 없는 정적 주소 하나다", async () => {
    const { asked, fetchImpl } = harness(READY);
    assert.equal(await fetchSuggestedQuoteNumber({ fetchImpl }), "DSS 2026-096");
    assert.deepEqual(asked, [QUOTE_NEXT_NUMBER_URL]);
    assert.equal(QUOTE_NEXT_NUMBER_URL, "/api/quotes/next-number");
  });

  test("🔴 ⑤ 한 번 부르면 요청도 한 번이다 — 되풀이하지 않는다", async () => {
    const { asked, fetchImpl } = harness(READY);
    await fetchSuggestedQuoteNumber({ fetchImpl });
    assert.equal(asked.length, 1, `요청이 ${asked.length}번이다`);
  });

  test("🔴 ③ disabled · failed 면 null — 사유를 돌려주지 않는다(알릴 것이 없다)", async () => {
    const disabled = harness({ status: 200, json: { status: "disabled" } });
    assert.equal(await fetchSuggestedQuoteNumber({ fetchImpl: disabled.fetchImpl }), null);

    const failed = harness({
      status: 200,
      json: { status: "failed", reason: "공유폴더가 느려 다음 견적서 번호를 알아내지 못했습니다(번호를 직접 적어 주세요)." },
    });
    assert.equal(await fetchSuggestedQuoteNumber({ fetchImpl: failed.fetchImpl }), null);
  });

  test("🔴 ③ 거절(401 · 403) · 네트워크 끊김 · 읽을 수 없는 본문도 null — 던지지 않는다", async () => {
    for (const reply of [
      { status: 401, json: { error: "로그인이 필요합니다.", code: "UNAUTHENTICATED" } },
      { status: 403, json: { error: "이 작업을 수행할 권한이 없습니다.", code: "FORBIDDEN" } },
      { status: 500, json: { error: "서버 오류" } },
      { status: 200, jsonThrows: true },
      "THROW" as const,
    ]) {
      const { fetchImpl } = harness(reply);
      assert.equal(await fetchSuggestedQuoteNumber({ fetchImpl }), null, JSON.stringify(reply));
    }
  });

  test("모양이 다른 본문은 null — 알려진 칸(status · quoteNumber)만 본다", () => {
    for (const payload of [
      null,
      "DSS 2026-096",
      [],
      {},
      { status: "ready" },
      { status: "ready", quoteNumber: 96 },
      { status: "ready", quoteNumber: "   " },
      { quoteNumber: "DSS 2026-096" },
    ]) {
      assert.equal(readSuggestedQuoteNumber(payload), null, JSON.stringify(payload));
    }
    assert.equal(readSuggestedQuoteNumber({ status: "ready", quoteNumber: " DSS 2026-096 " }), "DSS 2026-096");
  });
});

// ── ② 빈 칸일 때만 채운다 (값) ─────────────────────────────────────────────

describe("🔴 ② 빈 칸일 때만 채운다 — 사람이 적은 값을 덮지 않는다", () => {
  test("빈 칸 · 공백뿐인 칸에는 제안이 들어간다", () => {
    assert.equal(fillQuoteNumberIfEmpty("", "DSS 2026-096"), "DSS 2026-096");
    assert.equal(fillQuoteNumberIfEmpty("   ", "DSS 2026-096"), "DSS 2026-096");
  });

  test("🔴 이미 적힌 값은 그대로다 — 받아 오는 사이에 치기 시작한 한 글자도 지키다", () => {
    assert.equal(fillQuoteNumberIfEmpty("D", "DSS 2026-096"), "D");
    assert.equal(fillQuoteNumberIfEmpty("DSS 2026-077", "DSS 2026-096"), "DSS 2026-077");
    // 사내 번호 체계를 넘겨받지 않는다 — 모양이 달라도 그대로 둔다(승인된 결정).
    assert.equal(fillQuoteNumberIfEmpty("2026-특-003", "DSS 2026-096"), "2026-특-003");
  });
});

// ── 폼이 제자리에서 부르는가 (원본 글자) ───────────────────────────────────

describe("폼에 붙은 자리 — 새 견적서에서만 · 한 번만 · 조용히", () => {
  const effect = sliceBetween(form, "const didAskNextQuoteNumber = useRef(false);", "}, [quote]);");

  test("🔴 ① 새 견적서에서만 묻는다 — 고치기(quote !== null)에서는 곧바로 돌아간다", () => {
    assert.ok(effect.includes("if (quote !== null) return;"), effect);
    // 묻는 곳은 이 효과 하나다 — 다른 자리에서 또 부르지 않는다.
    assert.equal(count(form, "fetchSuggestedQuoteNumber("), 1, "통로를 부르는 곳이 둘이다");
  });

  test("🔴 ⑤ 한 번만 — 깃발을 타이머 안에서 세우고, 의존성은 quote 하나다", () => {
    assert.ok(effect.includes("const timer = setTimeout(() => { if (didAskNextQuoteNumber.current) return; didAskNextQuoteNumber.current = true;"), effect);
    assert.ok(effect.includes("return () => clearTimeout(timer);"), effect);
    assert.ok(form.includes("return () => clearTimeout(timer); }, [quote]);"), "의존성이 quote 하나가 아니다");
  });

  test("🔴 ② 빈 칸일 때만 — 지금 값을 받아 규칙 함수에 넘긴다(효과가 시작될 때의 값이 아니다)", () => {
    assert.ok(
      effect.includes("setQuoteNumber((current) => fillQuoteNumberIfEmpty(current, suggested));"),
      effect
    );
    // 받은 값을 칸에 곧바로 밀어 넣는 길이 없다.
    assert.ok(!effect.includes("setQuoteNumber(suggested)"), "제안을 칸에 곧바로 밀어 넣는다");
  });

  test("🔴 ③ 못 받으면 아무 일도 없다 — 오류 상자 · 알림 · 콘솔이 없다", () => {
    assert.ok(effect.includes("if (suggested === null) return;"), effect);
    for (const noisy of ["showSavePopup", "setSubmitError", "alert(", "console.", "NoticePopup", "tone: \"warning\""]) {
      assert.ok(!effect.includes(noisy), `못 받았을 때 '${noisy}' 로 알린다`);
    }
  });

  test("🔴 저장 쪽은 이 값을 보지 않는다 — 견주어 거절하는 코드가 없다", () => {
    const collect = sliceBetween(form, "function collectFields() {", "async function handleSubmit(");
    for (const name of ["suggestedQuoteNumber", "fetchSuggestedQuoteNumber", "fillQuoteNumberIfEmpty"]) {
      assert.ok(!collect.includes(name), `저장에 실리는 값 셈에 '${name}' 이 끼어 있다`);
    }
    const submit = sliceBetween(form, "async function handleSubmit(", "const disabled = isSubmitting || isConflict;");
    for (const name of ["suggestedQuoteNumber", "fetchSuggestedQuoteNumber", "fillQuoteNumberIfEmpty"]) {
      assert.ok(!submit.includes(name), `저장 길에 '${name}' 이 끼어 있다`);
    }
  });
});

describe("🔴 ④ 번호 칸은 여전히 자유 입력이다", () => {
  const field = sliceBetween(form, '<Field label="발행번호"', '<Field label="발행일자"');

  test("읽기 전용이 아니고, 사람이 친 글자가 그대로 상태로 간다", () => {
    assert.ok(field.includes("onChange={(e) => setQuoteNumber(e.target.value)}"), field);
    assert.ok(!field.includes("readOnly"), "번호 칸이 읽기 전용이다");
    assert.ok(!field.includes("disabled={true}"), "번호 칸이 늘 잠겨 있다");
    // 잠기는 때는 지금까지와 같다 — 저장 중 · 충돌뿐이다.
    assert.ok(field.includes("disabled={disabled}"), field);
  });

  test("고쳐도 된다는 곁말이 칸 아래에 붙고, 고치면 사라진다", () => {
    assert.ok(
      field.includes("{suggestedQuoteNumber !== null && quoteNumber === suggestedQuoteNumber && ("),
      field
    );
    assert.ok(field.includes("{QUOTE_NUMBER_SUGGESTION_HINT_TEXT}"), field);
    assert.ok(QUOTE_NUMBER_SUGGESTION_HINT_TEXT.includes("고치셔도 됩니다"), QUOTE_NUMBER_SUGGESTION_HINT_TEXT);
  });
});

describe("🔴 화면 쪽 조각이다 — 서버 사슬을 부르지 않는다", () => {
  test("모듈은 server-only · DB · 서버 모듈을 가져오지 않는다", () => {
    // 머리말은 서버 쪽 파일을 **가리켜 설명하므로**(어느 결정을 지키는지) 글자만 찾으면 헛걸린다 —
    // 주석을 뺀 원본으로 「무엇을 가져오는가」를 본다(이웃 quote-folder-open-screens.test.ts 와 같다).
    const code = moduleSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    assert.ok(!code.includes("@/lib/server/"), "서버 모듈을 부른다");
    assert.ok(!code.includes('"server-only"'), "server-only 를 부른다");
    assert.ok(!/from "@\/lib\/db\//.test(code), "DB 조회를 부른다");
    // 🔴 제안을 내는 서버 모듈을 화면이 직접 부르지 않는다 — 통로 하나로만 간다.
    assert.ok(!code.includes("quote-number-suggestion"), "서버의 제안 모듈을 직접 부른다");
  });

  test("이 모듈을 쓰는 원본은 편집 화면 하나다", () => {
    const users = walkSources(srcDir)
      .filter((file) => /quote-next-number|fetchSuggestedQuoteNumber|fillQuoteNumberIfEmpty/.test(readFileSync(file, "utf8")))
      .map(relativeToSrc)
      .sort();
    assert.deepEqual(users, ["components/quotes/QuoteEditForm.tsx", "components/quotes/quote-next-number.ts"]);
  });
});
