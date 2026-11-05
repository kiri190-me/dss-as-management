import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  GENERATED_PROCEDURE_CODE_ALPHABET,
  GENERATED_PROCEDURE_CODE_PATTERN,
  GENERATED_PROCEDURE_CODE_PREFIX,
  GENERATED_PROCEDURE_CODE_SUFFIX_LENGTH,
  generateProcedureTemplateCode,
} from "./procedure-template-code";

/**
 * ============================================================================
 * 절차 코드를 **서버가 짓는다** (2026-11-05)
 * ============================================================================
 * 사용자 요구로 새 기술 절차 만들기 창에서 코드 칸이 사라졌다. 코드 자체는 못
 * 없앤다 — `UNIQUE (code, version)` 으로 판본을 묶는 열쇠라, 사람이 안 적으면
 * 서버가 지어야 한다.
 *
 * 🔴 여기서 재는 알맹이는 **유일성**이다. 지은 코드가 겹치면 두 번째 사람이
 * CONFLICT 로 막히는데, 코드 칸이 없는 화면에서는 고칠 거리가 없어 「만들기가
 * 안 된다」로만 보인다. 오류가 아니라 **가끔 안 되는** 종류라 신고도 안 들어온다.
 *
 * ── 🔵 「같은 입력으로 둘을 만들어도 다른가」를 어떻게 재는가 ────────────
 * 날짜만 쓰면 같은 날 만든 둘이 같은 코드를 받는다. 그래서 **같은 `now` 를 주고**
 * 여럿 지어 전부 다른지 본다. 이것이 공짜로 통과하지 않게, 날짜 부분이 전부
 * 같다는 것을 먼저 못 박는다 — 다르면 유일성이 꼬리가 아니라 시계에서 온 것이다.
 *
 * ── 🔵 표본 수를 100으로 둔 까닭 ────────────────────────────────────────
 * 꼬리는 32^6 ≈ 10.7억 가지다. 100개를 뽑아 하나라도 겹칠 확률은 대략
 * 100² / (2 × 10.7억) ≈ 2만분의 1 의 1/10, 곧 **21만 번에 한 번**이다. 수를 더
 * 키우면(예: 5000개) 겹칠 확률이 1%를 넘어 시험이 가끔 빨개진다 — 그건 결함이
 * 아니라 시험이 잘못 만들어진 것이다.
 *
 * ── 🔴 확률에만 기대지 않는다 ───────────────────────────────────────────
 * 위 한 가지만 두면 「무작위처럼 보이는 가짜」(예: 시각 밀리초)도 통과한다. 그래서
 * `crypto.getRandomValues` 를 **가짜로 바꿔** ① 실제로 그것을 부르는가 ② 받은
 * 바이트를 글자로 어떻게 접는가를 값으로 못 박는다. 가짜를 꽂으면 출력이
 * 결정적이라 확률이 끼어들 자리가 없다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/** 블록·줄 주석을 걷어낸 소스. 🔴 주석의 낱말을 코드로 세면 안 된다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * `crypto.getRandomValues` 를 주어진 바이트로 채우는 가짜로 바꾼 뒤 실행한다.
 * Node 의 전역 `crypto` 는 configurable 이라 바꿨다 되돌릴 수 있다
 * (local/intake-idempotency-key.test.ts 가 쓰는 것과 같은 수법).
 */
function withFakeRandomBytes<T>(bytes: number[], run: () => T): { value: T; callCount: number } {
  const originalCrypto = globalThis.crypto;
  let callCount = 0;
  Object.defineProperty(globalThis, "crypto", {
    value: {
      getRandomValues: (array: Uint8Array) => {
        callCount += 1;
        for (let i = 0; i < array.length; i += 1) array[i] = bytes[i % bytes.length];
        return array;
      },
    },
    configurable: true,
  });
  try {
    return { value: run(), callCount };
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
  }
}

/** 2026-11-05 15:00 KST — 같은 날 안의 한 시각. */
const NOON_KST = new Date("2026-11-05T06:00:00.000Z");

/** 소스에 적힌 `GENERATED_CODE_ATTEMPTS` 의 값. 못 찾으면 0 — 단언이 그 자리에서 터진다. */
function attemptsConstantInSource(flatSource: string): number {
  const match = /const GENERATED_CODE_ATTEMPTS = (\d+);/.exec(flatSource);
  return match === null ? 0 : Number(match[1]);
}

describe("🔵 먼저 — 무엇으로 짓는지를 못 박는다", () => {
  test("글자는 **서른둘**이고 헷갈리는 넷(I · L · O · U)이 없다", () => {
    assert.equal(GENERATED_PROCEDURE_CODE_ALPHABET.length, 32, "32개(2^5)가 아니면 바이트를 접을 때 치우침이 생긴다");
    assert.equal(new Set(GENERATED_PROCEDURE_CODE_ALPHABET).size, 32, "같은 글자가 두 번 들어 있다");
    for (const confusing of ["I", "L", "O", "U"]) {
      assert.ok(!GENERATED_PROCEDURE_CODE_ALPHABET.includes(confusing), `헷갈리는 글자 ${confusing} 가 들어 있다`);
    }
  });

  test("꼬리 길이와 앞머리", () => {
    assert.equal(GENERATED_PROCEDURE_CODE_SUFFIX_LENGTH, 6);
    assert.equal(GENERATED_PROCEDURE_CODE_PREFIX, "TECH");
  });

  test("모양 자(PATTERN)가 실제로 문다 — 틀린 모양을 받아 주면 아래가 전부 공짜다", () => {
    assert.match("TECH-20261105-K7M2QX", GENERATED_PROCEDURE_CODE_PATTERN);
    assert.doesNotMatch("TECH-20261105-K7M2Q", GENERATED_PROCEDURE_CODE_PATTERN, "꼬리가 다섯 글자인데 통과했다");
    assert.doesNotMatch("TECH-2026115-K7M2QX", GENERATED_PROCEDURE_CODE_PATTERN, "날짜가 일곱 자리인데 통과했다");
    assert.doesNotMatch("TECH-20261105-K7M2QI", GENERATED_PROCEDURE_CODE_PATTERN, "뺀 글자 I 가 통과했다");
    assert.doesNotMatch("7", GENERATED_PROCEDURE_CODE_PATTERN, "손으로 적던 옛 코드가 통과했다");
  });
});

describe("🔴 지은 코드는 **유일하다** — 같은 입력으로 둘을 만들어도 다르다", () => {
  test("같은 시각으로 백 개를 지으면 백 개가 모두 다르다", () => {
    const codes = Array.from({ length: 100 }, () => generateProcedureTemplateCode(NOON_KST));

    // 🔵 표본 확인 — 실제로 백 개를 쥐고 있다.
    assert.equal(codes.length, 100);
    // 🔴 그리고 **날짜 부분은 전부 같다.** 여기가 갈리면 유일성이 꼬리가 아니라
    //    시계에서 온 것이고, 같은 날 두 번 만들 때의 겹침은 하나도 못 막는다.
    const dayParts = new Set(codes.map((c) => c.split("-")[1]));
    assert.deepEqual([...dayParts], ["20261105"], "같은 시각을 줬는데 날짜 부분이 갈렸다");

    assert.equal(new Set(codes).size, 100, "같은 시각으로 지은 코드가 겹쳤다");
  });

  test("두 번 불러 나온 값이 서로 다르다 — 결정적이면 여기서 바로 터진다", () => {
    assert.notEqual(generateProcedureTemplateCode(NOON_KST), generateProcedureTemplateCode(NOON_KST));
  });

  test("모두 제 모양이고, 꼬리는 정해진 글자로만 이뤄진다", () => {
    for (const code of Array.from({ length: 100 }, () => generateProcedureTemplateCode(NOON_KST))) {
      assert.match(code, GENERATED_PROCEDURE_CODE_PATTERN, `모양이 틀렸다: ${code}`);
      for (const ch of code.split("-")[2]) {
        assert.ok(GENERATED_PROCEDURE_CODE_ALPHABET.includes(ch), `${code}: 글자표에 없는 ${ch} 가 나왔다`);
      }
    }
  });
});

describe("🔴 무작위는 crypto 에서 온다 — 가짜를 꽂아 값으로 확인한다", () => {
  test("getRandomValues 를 **실제로** 부르고, 받은 바이트를 글자로 접는다", () => {
    // 0 → 글자표의 0번, 31 → 31번. 그리고 32·255 로 **아래 5비트만 쓴다**는 것을 본다:
    // 32 & 31 === 0 이고 255 & 31 === 31 이다.
    const { value, callCount } = withFakeRandomBytes([0, 31, 32, 255, 1, 30], () =>
      generateProcedureTemplateCode(NOON_KST)
    );
    assert.equal(callCount, 1, "crypto.getRandomValues 를 안 불렀다 — 다른 데서 무작위를 얻고 있다");

    const a = GENERATED_PROCEDURE_CODE_ALPHABET;
    assert.equal(value, `TECH-20261105-${a[0]}${a[31]}${a[0]}${a[31]}${a[1]}${a[30]}`);
    // 🔵 윗비트를 안 버렸다면 글자표 밖으로 나가 undefined 가 섞인다.
    assert.ok(!value.includes("undefined"), "바이트를 0~31 로 안 접었다");
  });

  test("가짜를 두 번 꽂으면 **같은 값**이 나온다 — 꼬리가 정말 그 바이트에서 온다는 증거", () => {
    const first = withFakeRandomBytes([5, 5, 5, 5, 5, 5], () => generateProcedureTemplateCode(NOON_KST)).value;
    const second = withFakeRandomBytes([5, 5, 5, 5, 5, 5], () => generateProcedureTemplateCode(NOON_KST)).value;
    assert.equal(first, second);
    assert.equal(first, `TECH-20261105-${GENERATED_PROCEDURE_CODE_ALPHABET[5].repeat(6)}`);
  });
});

describe("🔴 날짜는 **KST** 다 — 호스트가 UTC 로 서도 하루가 안 밀린다", () => {
  test("UTC 로는 전날인 시각(00:00~09:00 KST)에도 그날 날짜가 박힌다", () => {
    // 2026-11-05 01:00 KST = 2026-11-04 16:00 UTC. UTC 날짜를 쓰면 1104 가 된다.
    const earlyMorningKst = new Date("2026-11-04T16:00:00.000Z");
    const code = generateProcedureTemplateCode(earlyMorningKst);
    assert.equal(code.split("-")[1], "20261105", "UTC 날짜가 박혔다 — 새벽에 만든 절차가 전날로 적힌다");
  });

  test("날이 바뀌면 날짜 부분도 바뀐다 — 표본이 고정값이 아니라는 확인", () => {
    const nextDay = generateProcedureTemplateCode(new Date("2026-11-06T06:00:00.000Z"));
    assert.equal(nextDay.split("-")[1], "20261106");
  });
});

/**
 * 여기서부터는 **쓰는 자리의 배선**을 원본 글자로 읽는다. 값으로 재려면 DB 가
 * 필요하고(그쪽은 db 목록의 통합 시험 몫이다), 배선이 끊기면 오류가 아니라
 * **조용히 옛 동작**으로 돌아가는 종류라 그대로 두면 아무도 못 잡는다.
 *
 * 🔴 주석을 걷어낸 뒤에 센다 — 이 저장소는 주석의 낱말 때문에 셈이 틀린 적이
 * 여러 번 있다. 걷어내기가 일하고 있다는 증거는 아래 마지막 단언이다.
 */
describe("🔴 서버가 짓는 자리 — mutation 배선", () => {
  const MUTATION_PATH = "src/lib/db/mutations/procedure-templates.ts";
  const raw = read(MUTATION_PATH);
  const source = stripComments(raw);
  const flat = source.replace(/\s+/g, " ");

  test("🔵 먼저 — 주석 걷어내기가 실제로 문다", () => {
    // 머리말에만 있고 코드에는 없는 글자. 있으면 걷어내기가 안 돈 것이다.
    assert.ok(raw.includes("사용자 요구로 만들기 창에서 코드 칸이 사라졌다"), "표본이 사라졌다 — 다른 글자를 고를 것");
    assert.ok(!source.includes("사용자 요구로 만들기 창에서 코드 칸이 사라졌다"), "주석을 안 걷었다");
  });

  test("짓는 함수를 **여기서** 부른다 — 액션이나 화면이 아니다", () => {
    assert.match(source, /import \{ generateProcedureTemplateCode \} from "@\/lib\/domain\/procedure-template-code";/);
    assert.ok(
      flat.includes("const code = codeWasSupplied ? suppliedCode : generateProcedureTemplateCode();"),
      "코드를 안 받았을 때 짓는 줄이 없다"
    );
  });

  test("🔴 받아 온 코드는 **그대로 쓴다** — 들여오기가 제 코드를 잃으면 안 된다", () => {
    // 엑셀 들여오기는 아예 다른 함수(createDraftProcedureTemplateFromImport)이고,
    // 그쪽은 이번 변경에서 한 글자도 안 바뀌었다. 그 사실을 여기서 못 박아 둔다.
    assert.ok(flat.includes("code: extracted.code,"), "들여오기가 제 코드를 안 쓴다");
    assert.ok(
      flat.includes("const codeWasSupplied = input.code !== undefined && input.code !== null;"),
      "「안 준 것」과 「빈 글자를 준 것」을 가르는 줄이 없다"
    );
    // 빈 글자를 주면 **짓지 않고 막는다**. 둘을 뭉개면 빠뜨린 쪽이 조용히 성공한다.
    assert.ok(
      flat.includes('if (codeWasSupplied && suppliedCode.length === 0) { return { ok: false, code: "INVALID_INPUT"'),
      "빈 코드를 막는 줄이 없다"
    );
  });

  test("🔴 유일 제약에 걸리면 **다시 지어 재시도**한다 — 지은 코드일 때만", () => {
    assert.ok(flat.includes("const attempts = codeWasSupplied ? 1 : GENERATED_CODE_ATTEMPTS;"), "재시도 횟수를 가르는 줄이 없다");
    assert.ok(flat.includes("for (let attempt = 1; attempt <= attempts; attempt += 1)"), "재시도 고리가 없다");
    assert.ok(flat.includes("if (!isPgUniqueViolation(err)) throw err;"), "유일 제약 말고는 삼키면 안 된다");
    assert.ok(flat.includes("if (attempt === attempts) return conflict();"), "마지막 시도에서 끝내는 줄이 없다");
    // 🔴 트랜잭션을 고리 **안에서** 연다 — 유일 제약에 걸린 트랜잭션은 그 자리에서
    //    중단되어 같은 트랜잭션 안에서 다시 INSERT 할 수 없다.
    const loopStart = flat.indexOf("for (let attempt = 1; attempt <= attempts; attempt += 1)");
    assert.ok(loopStart >= 0);
    assert.ok(
      flat.indexOf("return await db.transaction(", loopStart) > loopStart,
      "트랜잭션이 고리 바깥에 있다 — 두 번째 시도가 죽은 트랜잭션에서 돈다"
    );
    assert.ok(attemptsConstantInSource(flat) >= 2, "재시도 횟수가 1 이면 고리가 있으나 마나다");
  });
});
