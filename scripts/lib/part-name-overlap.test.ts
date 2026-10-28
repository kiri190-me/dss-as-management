import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import {
  SQUEEZE_LABELS,
  SQUEEZE_LEVELS,
  cannotMeasureLine,
  displayWidth,
  formatOverlapTable,
  formatUnmatchedSamples,
  isMeasurable,
  padLeft,
  padRight,
  squeezeName,
  tallyNames,
  tallyOverlap,
  unmatchedSamples,
} from "./part-name-overlap";

/**
 * ============================================================================
 * 겹침을 **세는 규칙**의 시험 (조각 C0)
 * ============================================================================
 * 재는 도구의 셈이 틀리면 **설계 결정이 틀린다** — 「이름으로 묶어도 된다/안 된다」를
 * 그 수 하나로 정하기 때문이다. 그런데 그 수는 운영 자료를 봐야 나오는 수라 아무도
 * 눈으로 검산할 수 없다. 그래서 셈만 떼어 값으로 못 박는다.
 *
 * ── 🔴 이름은 전부 **지어낸 것**이다 ────────────────────────────────────
 * 실제 부품명·고객사·품번을 시험에 적지 않는다. 이 저장소는 공개 저장소로 나가는
 * 조각들과 코드를 나눠 쓰고, 한 번 적힌 글자는 이력에 영영 남는다.
 *
 * ── 🔴 **표본이 비어서 공짜로 통과하는 일**을 먼저 막는다 ───────────────
 * 아래 첫 묶음이 「무엇을 재고 있는지」를 단언한다. 표본이 비거나, 세 단계가 전부
 * 같은 답을 내서 사다리가 아무 일도 안 하고 있으면 그 자리에서 깨진다 — 그 둘이
 * 바로 이런 시험이 조용히 무력해지는 길이다.
 * ============================================================================
 */

/**
 * A/S 사용 부품 줄 — 🔴 **줄마다 하나씩**이다(묶기 전). 같은 이름이 두 줄 있는 것도
 * 일부러다: 줄 수가 분자·분모에 제대로 실리는지 재려면 1 대 1 이면 안 된다.
 */
const AS_ROWS = [
  "ダミー基板",
  "ダミー基板",
  "ABC-100",
  "ダミーコンデンサー",
  "ＡＢＣ100",
  "-",
] as const;

/**
 * 재고 관리 부품 칸의 글자들. 일부러 **같은 물건을 다른 표기로** 적어 둔다 —
 * 반각 가타카나 · 붙임표 없는 품번 · 장음 없는 표기, 그리고 빈칸 대신 적힌 `-`.
 */
const INVENTORY_VALUES = ["ﾀﾞﾐｰ基板", "ABC100", "ダミーコンデンサ", "-", "ダミー基板"] as const;

const AS_NAMES = tallyNames([...AS_ROWS]);

describe("무엇을 재고 있는가 — 표본이 비어 공짜로 통과하지 않게", () => {
  test("표본이 실제로 들어 있다 (줄 · 서로 다른 이름 · 재고 관리 글자)", () => {
    assert.equal(AS_ROWS.length, 6);
    assert.equal(AS_NAMES.length, 5, "서로 다른 이름이 다섯 가지여야 한다");
    assert.equal(INVENTORY_VALUES.length, 5);
  });

  test("🔴 사다리가 실제로 일한다 — 누를수록 더 겹친다(단조 증가하고, 끝이 처음보다 많다)", () => {
    const matched = SQUEEZE_LEVELS.map(
      (level) => tallyOverlap({ asNames: AS_NAMES, inventoryValues: [...INVENTORY_VALUES], level }).matchedNames
    );
    assert.deepEqual(matched, [1, 2, 4], "글자 그대로 1 → 눌러서 2 → 더 눌러서 4");
    for (let i = 1; i < matched.length; i += 1) {
      assert.ok(matched[i] >= matched[i - 1], "누른 단계가 앞 단계보다 적게 맞을 수는 없다");
    }
    assert.ok(matched[matched.length - 1] > matched[0], "세 단계가 전부 같은 답이면 이 시험은 아무것도 재지 않는다");
  });

  test("단계와 이름표가 한 짝이다 — 이름표 없는 단계로는 화면에 못 찍는다", () => {
    assert.deepEqual([...SQUEEZE_LEVELS], ["literal", "fold", "merge"]);
    for (const level of SQUEEZE_LEVELS) {
      assert.ok(SQUEEZE_LABELS[level].trim() !== "", `${level} 의 이름표가 비어 있다`);
    }
  });
});

describe("squeezeName — 무엇을 누르나", () => {
  test("세 단계 모두 앞뒤 공백을 떼고, `-` 만 적힌 칸을 「없음」으로 본다", () => {
    for (const level of SQUEEZE_LEVELS) {
      assert.equal(squeezeName(level, "  Dummy Board  "), level === "literal" ? "Dummy Board" : "dummyboard");
      assert.equal(squeezeName(level, "-"), "", "붙임표만 적힌 칸은 값이 아니다");
      assert.equal(squeezeName(level, "－－"), "", "전각 붙임표도 같다");
      assert.equal(squeezeName(level, "   "), "");
    }
  });

  test("literal — 가운데 공백도 대소문자도 전각도 **그대로** 둔다", () => {
    assert.equal(squeezeName("literal", "Dummy Board"), "Dummy Board");
    assert.notEqual(squeezeName("literal", "ＡＢＣ100"), squeezeName("literal", "ABC100"));
    assert.notEqual(squeezeName("literal", "ﾀﾞﾐｰ基板"), squeezeName("literal", "ダミー基板"));
  });

  test("fold — 공백 · 대소문자 · 전각반각 셋을 누른다", () => {
    assert.equal(squeezeName("fold", "Dummy Board"), squeezeName("fold", "DUMMYBOARD"));
    assert.equal(squeezeName("fold", "ＡＢＣ100"), squeezeName("fold", "abc100"));
    assert.equal(squeezeName("fold", "ﾀﾞﾐｰ基板"), squeezeName("fold", "ダミー基板"));
    // 🔴 여기까지는 장음도 붙임표도 **안 누른다** — 그것이 다음 단계와의 차이다.
    assert.notEqual(squeezeName("fold", "ダミーコンデンサー"), squeezeName("fold", "ダミーコンデンサ"));
    assert.notEqual(squeezeName("fold", "ABC-100"), squeezeName("fold", "ABC100"));
  });

  test("🔴 merge — 장음과 **ASCII 붙임표**까지 누른다 (품번의 `-` 가 사라진다)", () => {
    assert.equal(squeezeName("merge", "ダミーコンデンサー"), squeezeName("merge", "ダミーコンデンサ"));
    assert.equal(squeezeName("merge", "ABC-100"), squeezeName("merge", "abc100"));
    assert.equal(squeezeName("merge", "ＡＢＣ−100"), squeezeName("merge", "ABC100"), "전각 빼기표도 같다");
  });
});

describe("tallyNames — 서로 다른 이름과 줄 수", () => {
  test("적힌 글자 그대로 묶고, 처음 나온 차례를 지킨다", () => {
    assert.deepEqual(tallyNames(["나", "가", "나"]), [
      { text: "나", rows: 2 },
      { text: "가", rows: 1 },
    ]);
  });

  test("🔴 여기서는 **누르지 않는다** — 분모가 미리 눌리면 「글자 그대로」가 거짓말이 된다", () => {
    assert.equal(tallyNames(["ABC100", "ＡＢＣ100"]).length, 2);
  });

  test("빈 목록은 빈 목록이다", () => {
    assert.deepEqual(tallyNames([]), []);
  });
});

describe("tallyOverlap — 분자 · 분모 · 맞대지 못한 것", () => {
  const forLevel = (level: (typeof SQUEEZE_LEVELS)[number]) =>
    tallyOverlap({ asNames: AS_NAMES, inventoryValues: [...INVENTORY_VALUES], level });

  test("literal — 글자가 똑같은 한 가지만 맞는다(그 이름이 두 줄이다)", () => {
    assert.deepEqual(forLevel("literal"), {
      level: "literal",
      asNames: 4,
      asRows: 5,
      droppedNames: 1,
      droppedRows: 1,
      inventoryValues: 4,
      inventoryKeys: 4,
      matchedNames: 1,
      matchedRows: 2,
    });
  });

  test("fold — 전각으로 적힌 품번이 하나 더 붙는다", () => {
    const tally = forLevel("fold");
    assert.equal(tally.matchedNames, 2);
    assert.equal(tally.matchedRows, 3);
    assert.equal(tally.asNames, 4, "분모는 그대로다");
    assert.equal(tally.inventoryKeys, 3, "반각 가타카나 표기가 한 열쇠로 묶인다");
  });

  test("merge — 장음·붙임표가 갈라 놓은 둘이 더 붙어 전부 맞는다", () => {
    const tally = forLevel("merge");
    assert.equal(tally.matchedNames, 4);
    assert.equal(tally.matchedRows, 5);
    assert.equal(tally.asNames, 4);
  });

  test("🔴 `-` 는 양쪽에 다 있어도 **맞은 것으로 세지 않는다** — 빈 열쇠끼리 붙는 공짜 겹침을 막는다", () => {
    for (const level of SQUEEZE_LEVELS) {
      const tally = tallyOverlap({ asNames: tallyNames(["-", "-"]), inventoryValues: ["-"], level });
      assert.equal(tally.matchedNames, 0);
      assert.equal(tally.asNames, 0, "맞댄 이름이 하나도 없다");
      assert.deepEqual([tally.droppedNames, tally.droppedRows], [1, 2]);
      assert.equal(tally.inventoryKeys, 0);
    }
  });

  test("줄 수가 분자에 실린다 — 많이 쓰인 이름이 맞으면 matchedRows 가 그만큼 는다", () => {
    const tally = tallyOverlap({
      asNames: tallyNames(["가", "가", "가", "나"]),
      inventoryValues: ["가"],
      level: "literal",
    });
    assert.equal(tally.matchedNames, 1);
    assert.equal(tally.matchedRows, 3);
    assert.equal(tally.asRows, 4);
  });

  test("재고 관리 쪽 중복은 한 번만 센다", () => {
    const tally = tallyOverlap({
      asNames: tallyNames(["가"]),
      inventoryValues: ["가", "가", "나"],
      level: "literal",
    });
    assert.equal(tally.inventoryValues, 2);
    assert.equal(tally.inventoryKeys, 2);
  });
});

describe("isMeasurable — 「못 쟀다」와 「0% 겹친다」를 가른다", () => {
  test("🔴 재고 관리 쪽이 비면 **잴 수 없다** — 0% 라고 말하면 안 된다", () => {
    const tally = tallyOverlap({ asNames: AS_NAMES, inventoryValues: [], level: "merge" });
    assert.equal(tally.matchedNames, 0);
    assert.equal(isMeasurable(tally), false);
  });

  test("🔴 A/S 쪽이 비어도 잴 수 없다", () => {
    const tally = tallyOverlap({ asNames: [], inventoryValues: [...INVENTORY_VALUES], level: "merge" });
    assert.equal(isMeasurable(tally), false);
  });

  test("🔴 양쪽에 값이 있는데 하나도 안 맞는 것은 **잰 것**이다(0% 가 사실이다)", () => {
    const tally = tallyOverlap({ asNames: tallyNames(["가"]), inventoryValues: ["나"], level: "merge" });
    assert.equal(tally.matchedNames, 0);
    assert.equal(isMeasurable(tally), true);
  });
});

describe("unmatchedSamples — 안 겹친 것의 본보기", () => {
  test("양쪽에서 뽑는다 — 한쪽만 보면 왜 안 맞는지 모른다", () => {
    const samples = unmatchedSamples({
      asNames: AS_NAMES,
      inventoryValues: [...INVENTORY_VALUES],
      level: "fold",
      limit: 10,
    });
    assert.deepEqual(samples.asOnly, [
      { text: "ABC-100", rows: 1 },
      { text: "ダミーコンデンサー", rows: 1 },
    ]);
    assert.deepEqual(samples.inventoryOnly, ["ダミーコンデンサ"]);
  });

  test("A/S 쪽은 줄 수 많은 것부터 — 드문 표기가 앞에 서면 사람이 거꾸로 읽는다", () => {
    const samples = unmatchedSamples({
      asNames: tallyNames(["드문것", "흔한것", "흔한것", "흔한것"]),
      inventoryValues: ["전혀다른것"],
      level: "literal",
      limit: 10,
    });
    assert.deepEqual(samples.asOnly.map((item) => item.text), ["흔한것", "드문것"]);
  });

  test("limit 을 넘겨 주지 않는다 — 0 이면 아무것도 안 뽑는다", () => {
    const one = unmatchedSamples({
      asNames: AS_NAMES,
      inventoryValues: [...INVENTORY_VALUES],
      level: "fold",
      limit: 1,
    });
    assert.deepEqual(one.asOnly.map((item) => item.text), ["ABC-100"]);

    const none = unmatchedSamples({
      asNames: AS_NAMES,
      inventoryValues: [...INVENTORY_VALUES],
      level: "fold",
      limit: 0,
    });
    assert.deepEqual(none, { asOnly: [], inventoryOnly: [] });
  });

  test("🔴 열쇠가 빈 이름은 「안 겹친 것」에 섞이지 않는다 — 맞대지 못한 것이지 안 맞은 것이 아니다", () => {
    const samples = unmatchedSamples({
      asNames: tallyNames(["-", "진짜이름"]),
      inventoryValues: ["-"],
      level: "merge",
      limit: 10,
    });
    assert.deepEqual(samples.asOnly.map((item) => item.text), ["진짜이름"]);
    assert.deepEqual(samples.inventoryOnly, []);
  });

  test("재고 관리 쪽은 적힌 글자를 보여 준다 — 눌린 열쇠를 보여 주면 저쪽에 없는 글자가 된다", () => {
    const samples = unmatchedSamples({
      asNames: tallyNames(["전혀다른것"]),
      inventoryValues: ["ﾀﾞﾐｰ基板"],
      level: "fold",
      limit: 10,
    });
    assert.deepEqual(samples.inventoryOnly, ["ﾀﾞﾐｰ基板"]);
  });
});

describe("표의 자리 맞추개 — 한글은 두 칸을 먹는다", () => {
  test("🔴 `String.length` 로 맞추면 틀린다 — 그래서 자를 따로 둔다", () => {
    assert.equal("가나".length, 2, "자바스크립트는 글자 수로 둘이라고 한다");
    assert.equal(displayWidth("가나"), 4, "터미널에서는 네 칸이다");
    assert.notEqual(displayWidth("가나"), "가나".length, "둘이 같으면 이 자는 아무 일도 안 하고 있다");
  });

  test("좁은 글자 · 넓은 글자를 가른다", () => {
    assert.equal(displayWidth("abc 12"), 6);
    assert.equal(displayWidth("·"), 1, "가운뎃점은 한 칸이다 — 넓은 범위에 넣으면 이름표가 밀린다");
    assert.equal(displayWidth("ダミー"), 6);
    assert.equal(displayWidth("基板"), 4);
    assert.equal(displayWidth("ＡＢ"), 4, "전각 영문자");
    assert.equal(displayWidth(""), 0);
  });

  test("맞춘 뒤의 **칸 수**가 시킨 만큼이다 (글자 수가 아니라)", () => {
    for (const text of ["가나", "abcd", "ダミー基板", "1"]) {
      for (const columns of [10, 20]) {
        assert.equal(displayWidth(padLeft(text, columns)), columns, `padLeft(${text}, ${columns})`);
        assert.equal(displayWidth(padRight(text, columns)), columns, `padRight(${text}, ${columns})`);
      }
    }
  });

  test("🔴 칸보다 넓으면 **자르지 않는다** — 수를 자르면 거짓이 된다", () => {
    assert.equal(padLeft("1234567", 3), "1234567");
    assert.equal(padRight("가나다", 3), "가나다");
  });

  test("어느 쪽에 붙이는가", () => {
    assert.equal(padLeft("7", 3), "  7");
    assert.equal(padRight("7", 3), "7  ");
  });
});

describe("표를 글자로 만든다 — 운영에서 딱 한 번 도는 도구라 여기서 깨져야 한다", () => {
  const buckets = [
    { label: "품명", values: [...INVENTORY_VALUES] },
    { label: "교산 품번", values: ["ZZ-9"] },
  ];

  test("제목 한 줄 + 머리글 한 줄 + 칸마다 한 줄 + 맞대지 못한 이름 한 줄", () => {
    const block = formatOverlapTable({ title: "전체", asNames: AS_NAMES, buckets });
    assert.equal(block.unmeasured, 0);
    assert.equal(block.lines.length, 1 + 1 + buckets.length + 1);
    assert.match(block.lines[0], /전체 — 서로 다른 이름 5가지/);
    for (const level of SQUEEZE_LEVELS) {
      assert.ok(block.lines[1].includes(SQUEEZE_LABELS[level]), `머리글에 ${level} 이름표가 없다`);
    }
    assert.match(block.lines[2], /품명/);
    assert.match(block.lines[2], /4\/4/, "더 눌러서 네 가지가 다 맞는다 — 분자/분모를 함께 찍는다");
    assert.match(block.lines[4], /맞대지 못한 이름/, "`-` 한 가지가 분모에서 빠졌다");
  });

  test("🔴 머리글과 값 줄의 **칸 수**가 같다 — 한글 이름표가 섞여도 자리가 밀리지 않는다", () => {
    const block = formatOverlapTable({
      title: "전체",
      // 🔵 맞대지 못하는 이름(`-`)을 뺀다 — 그 알림 줄은 표의 칸을 쓰지 않는다.
      asNames: tallyNames(["ダミー基板", "ABC-100"]),
      buckets,
    });
    const widths = block.lines.slice(1).map((line) => displayWidth(line));
    assert.equal(widths.length, 1 + buckets.length);
    assert.equal(new Set(widths).size, 1, `줄마다 너비가 다르다: ${widths.join(", ")}`);
  });

  test("🔴 맞댈 것이 없는 칸은 비율이 아니라 **못 쟀다**로 센다", () => {
    const block = formatOverlapTable({
      title: "전체",
      asNames: AS_NAMES,
      buckets: [{ label: "빈 칸", values: ["-", "   "] }],
    });
    assert.equal(block.unmeasured, 1);
    assert.ok(
      block.lines.some((line) => line.includes("못 쟀다")),
      "못 쟀다는 말이 표 안에 제자리에 있어야 한다"
    );
    assert.ok(!block.lines.some((line) => line.includes("0.0%")), "0.0% 로 찍으면 「안 겹친다」로 읽힌다");
  });

  test("🔴 맞댈 이름이 없으면 표를 그리지 않는다", () => {
    const block = formatOverlapTable({ title: "이식분", asNames: [], buckets });
    assert.equal(block.unmeasured, 1);
    assert.equal(block.lines.length, 2);
    assert.ok(block.lines[1].includes("못 쟀다"));
  });

  test("눌러서 빈 글자가 되는 이름이 있으면 그 사실을 적는다", () => {
    const block = formatOverlapTable({
      title: "전체",
      asNames: tallyNames(["진짜이름", "-"]),
      buckets: [{ label: "품명", values: ["진짜이름"] }],
    });
    assert.ok(
      block.lines.some((line) => line.includes("맞대지 못한 이름")),
      "분모에서 빠진 이름이 있으면 말해야 한다"
    );
  });

  test("못 쟀다는 줄의 글자를 한 곳에서 만든다", () => {
    assert.equal(cannotMeasureLine("무엇", "까닭"), "  ? 무엇 — 못 쟀다 (까닭)");
    const block = formatOverlapTable({ title: "이식분", asNames: [], buckets });
    assert.equal(block.lines[1], cannotMeasureLine("이식분", "맞댈 이름이 한 가지도 없다"));
  });

  test("본보기는 양쪽 묶음을 각각 적는다 (없으면 「없다」로)", () => {
    const lines = formatUnmatchedSamples({
      title: "어느 칸과도",
      asNames: AS_NAMES,
      bucket: { label: "품명", values: [...INVENTORY_VALUES] },
      limit: 20,
    });
    assert.match(lines[0], /안 겹친 본보기/);
    assert.ok(lines.some((line) => line.includes("A/S 사용 부품: 없다")), "더 눌러서는 전부 맞는 표본이다");
    assert.ok(lines.some((line) => line.includes("재고 관리 품명: 없다")));

    const some = formatUnmatchedSamples({
      title: "어느 칸과도",
      asNames: tallyNames(["안맞는이름", "안맞는이름"]),
      bucket: { label: "품명", values: ["저쪽이름"] },
      limit: 20,
    });
    assert.ok(some.some((line) => line.includes("2줄  안맞는이름")));
    assert.ok(some.some((line) => line.includes("저쪽이름")));
  });
});

/**
 * 🔴 **이 도구에는 쓰는 길이 없어야 한다.** 재려고 만든 도구에 쓰는 자리가 하나라도
 * 생기면 언젠가 누가 그 자리를 넓힌다 — 그리고 그 도구는 운영 DB 에 대고 돌린다.
 *
 * 🔴 **주석을 먼저 뗀다.** 이 저장소의 머리말은 「INSERT·UPDATE·DELETE 를 한 줄도
 *    쓰지 않는다」처럼 **금지하는 글자 자체를 적어 둔다.** 날것으로 세면 그 머리말
 *    때문에 언제나 깨지고, 그러면 사람이 검사를 지운다. 아래 첫 단언이 **주석 떼기가
 *    실제로 일하고 있는지**를 먼저 잰다 — 날것에는 있고 뗀 뒤에는 없어야 한다.
 */
describe("🔴 check-part-name-overlap.ts 에 쓰는 길이 없다", () => {
  const SCRIPT = "scripts/check-part-name-overlap.ts";
  const raw = readFileSync(path.join(process.cwd(), SCRIPT), "utf8");
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  test("주석 떼기가 실제로 일한다 — 날것에는 금지어가 있고, 뗀 뒤에는 없다", () => {
    assert.ok(raw.length > 0, `${SCRIPT} 를 읽지 못했다`);
    assert.ok(raw.includes("INSERT"), "머리말에 금지어가 적혀 있어야 이 검사가 뜻이 있다");
    assert.ok(stripped.length > 0, "주석을 떼었더니 아무것도 안 남았다 — 떼기가 깨졌다");
    assert.ok(!stripped.includes("INSERT"), "주석 떼기가 머리말을 못 걷어냈다");
  });

  test("코드에 쓰는 문장도 쓰는 호출도 없다", () => {
    for (const forbidden of ["INSERT", "UPDATE", "DELETE", ".insert(", ".update(", ".delete("]) {
      assert.ok(!stripped.includes(forbidden), `${SCRIPT} 에 「${forbidden}」 가 있다 — 이 도구는 읽기만 한다`);
    }
  });

  test("읽는 통로는 있다 — 검사가 빈 파일에 대고 통과하지 않는다", () => {
    assert.ok(stripped.includes(".select("), "읽는 문장조차 없으면 이 도구는 아무것도 안 하고 있다");
    assert.ok(stripped.includes("fetchInventoryParts"), "재고 관리에 묻는 자리가 없다");
  });
});
