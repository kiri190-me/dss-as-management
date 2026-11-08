import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { DATE_INPUT_MAX, DATETIME_LOCAL_INPUT_MAX } from "./date-input-limits";

/**
 * ============================================================================
 * 날짜 칸 스물넷이 모두 연도 상한을 들고 있는가 (2026-11-05)
 * ============================================================================
 * `<input type="date">` 는 `max` 가 없으면 **연도 칸이 여섯 자리를 받는다** —
 * `202611` 을 치면 연도가 그대로 차고 월로 넘어가지도 않는다(까닭과 실측은
 * date-input-limits.ts 머리말). 그래서 모든 날짜 칸이 `max={DATE_INPUT_MAX}` 를
 * 들어야 한다.
 *
 * 🔵 **`<input type="datetime-local">` 넷도 같은 결함이고 같은 날 함께 고쳤다.**
 * 처음 이 시험을 만들 때는 그쪽을 「범위 밖」으로 두고 **안 집는다**고 단언했는데,
 * 곧바로 결재권 위임 화면에서 재 보니 `202611-11-05 오전 10:21` 로 똑같이 깨졌다.
 * 🔴 그 단언은 **값이 맞아서 영영 초록으로 통과하고 있었다** — 초록 ✔ 옆에 적힌
 * 「이번 범위가 아니다」라는 거짓말만 남는 모양이다. 지우지 않고 **뒤집었다**:
 * 이제 그 넷도 세고, `DATETIME_LOCAL_INPUT_MAX` 를 드는지까지 본다.
 *
 * 🔴 **두 상수는 섞여도 오류가 안 난다.** `datetime-local` 의 `max` 는 시각이 있어야
 * 브라우저가 받고, `date` 의 `max` 는 시각이 있으면 안 받는다 — 뒤바꿔 주면 그 칸의
 * 상한이 **통째로 무시되어** 고치기 전(여섯 자리)으로 조용히 돌아간다. 그래서 「max 가
 * 있는가」가 아니라 **「어느 칸이 어느 상수를 드는가」**를 칸마다 따로 못 박는다.
 *
 * 🔴 **빠뜨려도 아무 오류가 안 난다.** 그 칸만 조용히 여섯 자리를 받고, 신고가
 * 들어오기 전에는 아무도 모른다. 브라우저 없이 볼 수 있는 것은 소스뿐이라
 * 이웃(save-popup-screens.test.ts · file-drop-screens.test.ts)과 같은 방법으로
 * 원본을 글자로 읽는다.
 *
 * ── 🔴 주석을 세면 안 된다 ──────────────────────────────────────────────
 * 이 저장소에서 실제로 밟은 함정이다 — 소스 글자로 재는 검사가 **주석 안의**
 * `type="date"` 를 세어 셈이 틀어졌다. 여기서 세는 날짜 칸 스물 가운데 넷은
 * 주석에도 같은 글자가 적힌 파일에 있고, DomesticOrderListScreen.tsx 는 **주석에만**
 * 있다(날짜 칸이 하나도 없다).
 *
 * 걸러내는 방법은 「`type="date"` 앞에 `//` 가 있나」 같은 줄 단위 어림이 아니다.
 * stripComments() 가 소스를 처음부터 한 글자씩 걸으면서 **문자열은 통째로 건너뛰고**
 * (그 안의 `//` 는 주석이 아니다 — `"https://…"`), 주석만 같은 길이의 공백으로
 * 바꿔 치운다. 길이와 줄바꿈을 그대로 두는 것은 오류 글이 가리키는 줄 번호가 원본과
 * 어긋나지 않게 하기 위해서다. 그 뒤 `<input … >` 덩어리를 괄호 짝으로 잘라낸다.
 *
 * 🔴 **「있어야 한다」 쪽 검사는 주석만으로도 영영 통과한다** — 그래서 거꾸로도
 * 재야 한다. 아래 세 가지가 그 몫이다:
 *   ① 파일마다 **몇 개**인지를 못 박는다(COUNTS). 읽개가 조용히 망가져 0개를 찾으면
 *      바로 터진다. 칸이 실제로 늘면 이 수도 함께 고쳐라 — 그래야 「읽개가 깨진 것」과
 *      「칸이 는 것」이 갈린다.
 *   ② 주석에만 있는 파일에서 **0개**가 나오는지 본다(걸러내기가 실제로 무는가).
 *   ③ 주석과 진짜가 섞인 파일에서 **진짜 수만** 나오는지 본다.
 *
 * ── 🔵 `type="date"` 라는 글자를 찾지 않는다 ─────────────────────────────
 * 고객 안내 현황의 칸 하나는 `type={column.valueKind === "date" ? "date" : "text"}`
 * 다 — 글자로 찾는 grep 에는 **안 걸린다.** 그래서 `type=` 에 적힌 식을 통째로 뽑아
 * 그 안에 어느 **문자열**이 들어 있는지로 가른다: `"date"` 면 날짜 칸,
 * `"datetime-local"` 이면 일시 칸이다. 둘은 **다른 문자열**이라 서로를 집지 않는다
 * (`"datetime-local"` 안에는 `"date"` 가 없다 — `date` 뒤에 닫는 따옴표가 없기
 * 때문이다). 그 성질에 기대고 있으므로 아래에서 값으로 한 번 확인한다.
 * ============================================================================
 */

/** `src/` 아래의 `.tsx` 전부. 슬래시 경로로 돌려준다(윈도에서도 같은 글자). */
function tsxFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...tsxFilesUnder(path));
    // 시험 파일은 화면이 아니다 — 거기 적힌 가짜 칸까지 규칙으로 묶을 일이 없다.
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) found.push(path);
  }
  return found;
}

/**
 * 문자열(`"` `'` `` ` ``)을 통째로 건너뛴 **다음 자리**를 돌려준다. 문자열이 아니면 null.
 * 템플릿의 `${ … }` 안은 다시 코드라 중괄호 짝을 맞춰 끝을 찾는다 — 안 그러면
 * `` `${a ? `x` : `y`}` `` 에서 안쪽 백틱을 끝으로 잘못 읽는다.
 * (save-popup-screens.test.ts 의 skipAtomic 에서 주석 갈래만 뺀 것이다. 여기서는
 * 주석을 「건너뛰는」 것이 아니라 「지워야」 해서 둘을 나눠 둔다.)
 */
function skipString(text: string, i: number): number | null {
  const ch = text[i];
  if (ch === '"' || ch === "'") {
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] === "\\") {
        j += 1;
        continue;
      }
      if (text[j] === ch) return j + 1;
    }
    return text.length;
  }
  if (ch === "`") {
    for (let j = i + 1; j < text.length; j += 1) {
      if (text[j] === "\\") {
        j += 1;
        continue;
      }
      if (text[j] === "`") return j + 1;
      if (text[j] === "$" && text[j + 1] === "{") {
        let depth = 1;
        let k = j + 2;
        while (k < text.length && depth > 0) {
          const next = skipString(text, k);
          if (next !== null) {
            k = next;
            continue;
          }
          if (text[k] === "{") depth += 1;
          else if (text[k] === "}") depth -= 1;
          k += 1;
        }
        j = k - 1;
      }
    }
    return text.length;
  }
  return null;
}

/**
 * 주석을 **같은 길이의 공백**으로 바꾼 소스를 돌려준다(줄바꿈은 남긴다 — 줄 번호가
 * 어긋나면 오류 글이 엉뚱한 줄을 가리킨다). 문자열 안의 `//` `/*` 는 주석이 아니므로
 * 문자열을 먼저 건너뛴다.
 */
function stripComments(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const stringAfter = skipString(source, i);
    if (stringAfter !== null) {
      out += source.slice(i, stringAfter);
      i = stringAfter - 1;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i);
      const end = newline < 0 ? source.length : newline;
      out += " ".repeat(end - i);
      i = end - 1;
      continue;
    }
    if (source[i] === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? source.length : close + 2;
      out += source.slice(i, end).replace(/[^\n]/g, " ");
      i = end - 1;
      continue;
    }
    out += source[i];
  }
  return out;
}

/**
 * `<input` 바로 뒤에서 시작해 그 태그를 닫는 `>` 자리를 돌려준다. 못 찾으면 -1.
 * 중괄호 안(`onChange={(e) => …}`)의 `>` 는 태그의 끝이 아니므로 깊이를 센다.
 */
function tagEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const stringAfter = skipString(code, i);
    if (stringAfter !== null) {
      i = stringAfter - 1;
      continue;
    }
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

/** `<input … >` 덩어리에서 `type=` 에 적힌 식을 글자로 뽑는다. 없으면 null. */
function typeExpression(tag: string): string | null {
  // `maxLength` · `aria-…type` 따위에 걸리지 않게 앞 글자를 본다.
  const match = /(?<![\w-])type\s*=/.exec(tag);
  if (match === null) return null;
  let i = match.index + match[0].length;
  while (i < tag.length && /\s/.test(tag[i])) i += 1;
  const stringAfter = skipString(tag, i);
  if (stringAfter !== null) return tag.slice(i, stringAfter);
  if (tag[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < tag.length; j += 1) {
    const inner = skipString(tag, j);
    if (inner !== null) {
      j = inner - 1;
      continue;
    }
    if (tag[j] === "{") depth += 1;
    else if (tag[j] === "}") {
      depth -= 1;
      if (depth === 0) return tag.slice(i, j + 1);
    }
  }
  return null;
}

/**
 * 날짜를 받는 칸의 갈래. 갈래마다 **드는 상수가 다르다** — 바꿔 주면 브라우저가
 * 상한을 통째로 무시하므로, 세는 단계에서부터 갈라 둔다.
 */
type DateInputKind = "date" | "datetime-local";

/** 갈래마다 들어야 하는 상수의 **이름**(소스에 글자로 적혀 있는지 본다). */
const EXPECTED_CONSTANT: Record<DateInputKind, string> = {
  date: "DATE_INPUT_MAX",
  "datetime-local": "DATETIME_LOCAL_INPUT_MAX",
};

/** 한 파일의 날짜 칸 전부(갈래 둘을 함께). `line` 은 **원본 파일의** 줄 번호다. */
function dateInputsIn(path: string): { line: number; tag: string; kind: DateInputKind }[] {
  const code = stripComments(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
  const found: { line: number; tag: string; kind: DateInputKind }[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const stringAfter = skipString(code, i);
    if (stringAfter !== null) {
      i = stringAfter - 1;
      continue;
    }
    if (!code.startsWith("<input", i)) continue;
    if (/[\w$]/.test(code[i + 6] ?? "")) continue; // `<inputSomething` 은 다른 조각이다
    const end = tagEnd(code, i + 6);
    assert.ok(end >= 0, `${path}: <input 의 닫는 > 를 못 찾았다`);
    const tag = code.slice(i, end + 1);
    const type = typeExpression(tag);
    // 줄 번호는 **여는 `<input` 자리**로 센다 — 닫는 `>` 로 세면 여러 줄짜리 칸에서
    // 오류 글이 태그의 끝을 가리켜, 고칠 자리를 찾는 사람이 한 번 헤맨다.
    const openedAt = i;
    i = end;
    if (type === null) continue;
    // 🔴 **일시를 먼저 본다.** 두 글자는 서로를 안 집지만(`"datetime-local"` 안에
    //    `"date"` 는 없다), 차례에 기대지 않도록 둘 다 집히면 아래에서 터뜨린다 —
    //    한 칸이 두 갈래면 어느 상수를 들어야 하는지 말할 수 없기 때문이다.
    const isDateTimeLocal = /(?:"datetime-local"|'datetime-local')/.test(type);
    const isDate = /(?:"date"|'date')/.test(type);
    assert.ok(!(isDate && isDateTimeLocal), `${path}: 한 칸의 type 에 두 갈래가 함께 적혀 있다`);
    if (!isDate && !isDateTimeLocal) continue;
    found.push({
      line: code.slice(0, openedAt).split("\n").length,
      tag,
      kind: isDateTimeLocal ? "datetime-local" : "date",
    });
  }
  return found;
}

/** 한 파일에서 갈래별로 몇 개인가. 0인 갈래는 적지 않는다. */
function countsIn(path: string): Partial<Record<DateInputKind, number>> {
  const counts: Partial<Record<DateInputKind, number>> = {};
  for (const { kind } of dateInputsIn(path)) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

/**
 * 파일마다 날짜 칸이 **몇 개**인가. 2026-11-05 에 센 값이다.
 *
 * 🔴 날짜 칸을 더했으면 이 수도 함께 고쳐라. 고치기 귀찮다고 이 절을 지우면, 읽개가
 * 조용히 망가져 0개를 찾는 날에도 아래 「모두 max 를 들었다」가 **빈 표본으로 통과한다.**
 */
const COUNTS: Record<string, Partial<Record<DateInputKind, number>>> = {
  // 고객 안내 현황의 수기 칸 — type 이 식이라 글자 grep 에는 안 걸린다.
  "src/components/customer-portal/CustomerPortalScreen.tsx": { date: 1 },
  "src/components/domestic-orders/DomesticOrderDueDatesCell.tsx": { date: 1 },
  // 🔴 2026-11-08 에 생긴 칸 — 납기요청일 **행마다** 적는 납품일(회차별 납품 편집).
  "src/components/domestic-orders/DomesticOrderDeliveriesCell.tsx": { date: 1 },
  // 🔴 2026-11-08 에 하나에서 **둘**이 되었다 — 납기요청일 묶음의 한 줄 안에
  //    납기일 칸과 납품일 칸이 나란히 선다(사용자 결정 1: 1번 줄 ↔ 1번 줄).
  //    🔵 그 대신 **따로 서 있던 납품일 칸이 없어졌다** — 그래서 둘이지 셋이 아니다.
  "src/components/domestic-orders/DomesticOrderEditForm.tsx": { date: 2 },
  "src/components/domestic-orders/DomesticOrderTextCell.tsx": { date: 1 },
  "src/components/quotes/QuoteEditForm.tsx": { date: 1 },
  "src/components/repair-cases/detail/DomesticOrderDatesSection.tsx": { date: 2 },
  // 인수일 · 고객 요청 납기일 · 사내 목표 검수 완료일 · 사내 목표 완료일 · 실제 출하일
  "src/components/repair-cases/detail/edit/IntakeInfoEditForm.tsx": { date: 5 },
  // 접수 화면의 「일정」 넷(실제 출하일은 접수 때 없다)
  "src/components/repair-cases/new/IntakeFormInner.tsx": { date: 4 },
  // 보고서의 날짜 칸 하나를 이 조각이 혼자 그린다 — 부르는 자리는 여럿이다.
  "src/components/repair-cases/report/service-report/ServiceReportField.tsx": { date: 1 },
  // 발생 년월일은 「날짜」와 「직접 적기」로 갈리고, 날짜 쪽만 센다.
  "src/components/repair-cases/report/service-report/ServiceReportHeaderFields.tsx": { date: 1 },
  "src/components/repair-cases/work-history/ActivityFilterPanel.tsx": { date: 2 },
  // 🔵 2026-11-05 에 더해진 일시 칸 넷 — 위임 기간의 시작/끝 두 쌍이다.
  //    처음에는 「범위 밖」으로 두고 세지 않았다(머리말의 그 대목).
  "src/components/users/ApprovalRouteDelegationSection.tsx": { "datetime-local": 2 },
  "src/components/users/DelegationSection.tsx": { "datetime-local": 2 },
};

/** 갈래별 합계. 「적어도 이만큼은 찾아야 한다」의 바닥값이다. */
const TOTAL: Record<DateInputKind, number> = {
  date: 0,
  "datetime-local": 0,
};
for (const counts of Object.values(COUNTS)) {
  for (const [kind, count] of Object.entries(counts)) {
    TOTAL[kind as DateInputKind] += count;
  }
}

describe("🔴 날짜 칸의 연도는 네 자리다 — max 를 빠뜨린 칸이 없는가", () => {
  test("상한은 자릿수만 묶는 값이다 — 업무 상한으로 좁히면 먼 미래 납기일이 막힌다", () => {
    assert.equal(DATE_INPUT_MAX, "9999-12-31");
    // 연도 네 자리 + 월 두 자리 + 일 두 자리. 이 자릿수가 곧 브라우저가 받는 자릿수다.
    assert.match(DATE_INPUT_MAX, /^\d{4}-\d{2}-\d{2}$/);

    // 🔴 상수 파일에 React 가 들어오면 서버 컴포넌트가 이 값을 읽을 때 클라이언트
    //    참조가 된다(repair-cases/due-date-near.ts 머리말과 같은 까닭).
    const limits = readFileSync("src/components/common/date-input-limits.ts", "utf8");
    assert.ok(!/^\s*import\s/m.test(stripComments(limits)), "상수 파일이 무언가를 부른다");
    assert.ok(!stripComments(limits).includes('"use client"'), '상수 파일에 "use client" 가 붙었다');
  });

  test("🔴 일시 칸의 상한은 **시각까지** 있다 — 날짜 쪽 값을 주면 통째로 무시된다", () => {
    assert.equal(DATETIME_LOCAL_INPUT_MAX, "9999-12-31T23:59");
    // 연도 네 자리 … 그리고 그날의 끝 시각. 시각이 없으면 이 칸이 값을 안 받는다.
    assert.match(DATETIME_LOCAL_INPUT_MAX, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // 🔴 **둘은 서로 다른 값이어야 한다.** 같아지면 어느 한쪽 칸이 반드시 틀린 모양의
    //    상한을 들게 되고, 그 칸은 오류 없이 고치기 전(여섯 자리)으로 돌아간다.
    assert.notEqual(DATE_INPUT_MAX, DATETIME_LOCAL_INPUT_MAX);
    // 🔵 다만 **같은 날**이다 — 한쪽만 고쳐 두 칸의 상한이 다른 날이 되지 않게.
    assert.ok(
      DATETIME_LOCAL_INPUT_MAX.startsWith(`${DATE_INPUT_MAX}T`),
      "두 상한이 다른 날을 가리킨다 — 바꿀 때는 둘을 같이 바꾼다"
    );
    // 🔴 한쪽 이름이 다른 쪽 이름에 **안 들어가야** 한다. 아래에서 「이 칸이 저 상수를
    //    들지 않았는가」를 글자 포함으로 재기 때문에, 한쪽이 다른 쪽의 부분 문자열이면
    //    그 단언이 영영 통과한다.
    assert.ok(!EXPECTED_CONSTANT["datetime-local"].includes(EXPECTED_CONSTANT.date));
    assert.ok(!EXPECTED_CONSTANT.date.includes(EXPECTED_CONSTANT["datetime-local"]));
    // 같은 까닭으로 type 글자 둘도 서로를 안 집어야 한다(읽개가 기대고 있는 성질).
    assert.ok(!/(?:"date")/.test('"datetime-local"'));
  });

  test("🔴 모든 날짜 칸이 **제 갈래의** 상수를 든다 — 빠뜨림도 뒤바뀜도 잡는다", () => {
    const problems: string[] = [];
    const counted: Record<DateInputKind, number> = { date: 0, "datetime-local": 0 };
    for (const path of tsxFilesUnder("src")) {
      for (const { line, tag, kind } of dateInputsIn(path)) {
        counted[kind] += 1;
        const mine = EXPECTED_CONSTANT[kind];
        const theirs = EXPECTED_CONSTANT[kind === "date" ? "datetime-local" : "date"];
        const hasMine = tag.includes(mine);
        // 🔴 제 상수가 있어도 **남의 상수가 함께 있으면** 안 된다 — 한 칸이 두 상한을
        //    들 수는 없고, 그런 모양은 거의 언제나 베껴 오다 반만 고친 자국이다.
        const hasTheirs = tag.includes(theirs);
        if (hasMine && !hasTheirs) continue;
        // 🔴 **무엇이 틀렸는지를 갈라 적는다.** 「없다」와 「뒤바뀌었다」는 고치는
        //    손이 다른데, 뒤바뀐 칸을 「없다」고 말하면 상한이 멀쩡히 적혀 있는 줄을
        //    보며 「있는데 왜?」로 한참 헤맨다(실제로 한 번 그랬다).
        const what = hasTheirs
          ? hasMine
            ? `상한 둘을 함께 든다(${mine} + ${theirs})`
            : `뒤바뀌었다 — ${mine} 자리에 ${theirs} 를 들었다`
          : `상한이 없다 — ${mine} 을 들어야 한다`;
        problems.push(`${path}:${line} (${kind}) ${what}`);
      }
    }
    // 표본이 비어서 공짜로 통과하지 않게 — 읽개가 제대로 돌면 갈래마다 이만큼은 찾는다.
    for (const kind of ["date", "datetime-local"] as const) {
      assert.ok(
        counted[kind] >= TOTAL[kind],
        `${kind} 칸을 ${counted[kind]}개밖에 못 찾았다(${TOTAL[kind]}개는 있어야 한다) — 읽개가 깨졌다`
      );
    }
    assert.deepEqual(
      problems,
      [],
      "갈래와 상한이 안 맞는 칸이 있다 — 그 칸은 오류 없이 연도를 여섯 자리로 받는다"
    );
  });

  test("🔴 파일마다 갈래별 개수까지 못 박는다 — 읽개가 0개를 찾는 날에 바로 터지게", () => {
    const counts: Record<string, Partial<Record<DateInputKind, number>>> = {};
    for (const path of tsxFilesUnder("src")) {
      const found = countsIn(path);
      if (Object.keys(found).length > 0) counts[path] = found;
    }
    assert.deepEqual(
      counts,
      COUNTS,
      "날짜 칸의 자리나 수가 달라졌다 — 더한 것이면 COUNTS 도 함께 고칠 것"
    );
  });
});

describe("🔴 주석에 적힌 글자를 세지 않는다", () => {
  test("주석에만 있는 파일은 0개다 — 걸러내기가 실제로 무는가", () => {
    const path = "src/components/domestic-orders/DomesticOrderListScreen.tsx";
    const raw = readFileSync(path, "utf8");
    // 먼저 「무엇을 재는지」를 못 박는다 — 글자가 아예 없으면 0개는 공짜다.
    assert.ok(raw.includes('type="date"'), `${path}: 주석의 그 글자가 사라졌다 — 다른 표본을 고를 것`);
    assert.equal(dateInputsIn(path).length, 0, `${path}: 주석 안의 글자를 날짜 칸으로 셌다`);
  });

  test("주석과 진짜가 섞인 파일은 진짜만 센다", () => {
    const path = "src/components/domestic-orders/DomesticOrderTextCell.tsx";
    const raw = readFileSync(path, "utf8");
    // 이 파일은 머리말·편집칸 주석에 같은 글자가 여러 번 적혀 있고, 진짜 칸은 하나다.
    const written = (raw.match(/type="date"/g) ?? []).length;
    assert.ok(written >= 4, `${path}: 주석에 적힌 글자가 줄었다 — 다른 표본을 고를 것`);
    assert.equal(dateInputsIn(path).length, 1, `${path}: 주석을 함께 셌다`);
  });

  test("문자열 안의 `//` 를 주석으로 읽지 않는다 — 그러면 뒤의 칸이 통째로 사라진다", () => {
    const stripped = stripComments('const a = "https://x"; <input type="date" /> // 주석\n');
    assert.ok(stripped.includes('type="date"'), "문자열 안의 // 를 주석 시작으로 읽었다");
    assert.ok(!stripped.includes("주석"), "진짜 주석이 안 걷혔다");
    // 길이와 줄 수는 그대로다 — 오류 글의 줄 번호가 원본과 맞아야 한다.
    assert.equal(stripped.length, 'const a = "https://x"; <input type="date" /> // 주석\n'.length);
  });
});

describe("🔴 글자가 아니라 type 에 적힌 식을 본다", () => {
  test("type 이 삼항인 칸도 날짜 칸으로 센다 — grep 에는 안 걸리는 자리다", () => {
    const path = "src/components/customer-portal/CustomerPortalScreen.tsx";
    // 이 파일의 **코드에는** 글자로 적힌 날짜 칸이 없다. 있으면 아래 1개가 삼항을
    // 읽어서 나온 것인지 글자를 읽어서 나온 것인지 갈 수 없다.
    // 🔵 주석까지 세면 안 된다 — 이 자리를 설명하는 주석에 그 글자가 들어가는
    //    순간 이 단언이 터진다(2026-11-05 에 실제로 한 번 그렇게 터졌다).
    const code = stripComments(readFileSync(path, "utf8"));
    assert.ok(!code.includes('type="date"'), `${path}: 글자로 적힌 날짜 칸이 생겼다 — 이 시험을 다시 볼 것`);
    const found = dateInputsIn(path);
    assert.equal(found.length, 1, `${path}: 식으로 적힌 날짜 칸을 못 찾았다`);
    // 🔴 글자 칸일 때는 max 가 붙으면 안 된다 — type 과 같은 조건으로 갈려야 한다.
    assert.match(found[0].tag, /max=\{column\.valueKind === "date" \? DATE_INPUT_MAX : undefined\}/);
  });

  /**
   * 🔴 **이 절은 2026-11-05 에 뒤집혔다.** 전에는 이름이 「datetime-local 은 집지
   * 않는다 — 이번 범위가 아니다」였고 `length === 0` 을 재며 **초록으로 통과했다.**
   * 단언은 맞았지만 이름에 적힌 설명이 거짓이 됐다 — 같은 날 브라우저로 재 보니
   * 일시 칸도 연도를 여섯 자리로 받고 있었기 때문이다. 지우지 않고 **반대 방향으로**
   * 고쳐, 이제는 그 넷을 **세고** 제 상수를 드는지까지 본다.
   */
  test("datetime-local 도 갈래를 갈라 센다 — 날짜 칸과 다른 상수를 들어야 한다", () => {
    for (const path of [
      "src/components/users/ApprovalRouteDelegationSection.tsx",
      "src/components/users/DelegationSection.tsx",
    ]) {
      const raw = readFileSync(path, "utf8");
      assert.ok(raw.includes('type="datetime-local"'), `${path}: 표본이 사라졌다`);
      const found = dateInputsIn(path);
      assert.equal(found.length, 2, `${path}: 일시 칸 둘(시작/끝)을 못 찾았다`);
      for (const { line, kind, tag } of found) {
        // 🔴 갈래가 "date" 로 읽히면 아래 상수 단언이 엉뚱한 것을 재게 된다.
        assert.equal(kind, "datetime-local", `${path}:${line}: 갈래를 잘못 읽었다`);
        assert.ok(tag.includes("DATETIME_LOCAL_INPUT_MAX"), `${path}:${line}: 일시 상한이 없다`);
        // 🔴 날짜 쪽 상수를 들면 시각이 없어 브라우저가 상한을 통째로 무시한다.
        assert.ok(!tag.includes("{DATE_INPUT_MAX}"), `${path}:${line}: 날짜 칸 상수를 들었다`);
      }
    }
  });
});
