import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/**
 * ============================================================================
 * 절차 「코드」가 사람 눈에 안 보인다 (2026-11-05)
 * ============================================================================
 * 사용자 요구: "새 기술 절차를 만들 때, 코드를 적는 칸을 없애줘. 코드가 필요하다고
 * 못 느끼겠어." 이어서 **화면에서도 안 보이게** 하기로 정했다.
 *
 * 🔴 **DB 칸은 그대로다.** `procedure_templates.code` 는 `UNIQUE (code, version)`
 * 으로 판본을 묶는 열쇠이고, 판본 목록 · 게시 · 다음 판 번호 · 「다음 절차」 후보
 * 고르기가 전부 그 값으로 돈다. 그래서 이 시험이 재는 것은 「값이 없는가」가 아니라
 * **「그 값이 글자로 그려지는가」**다.
 *
 * ── 🔴 왜 브라우저가 아니라 소스를 읽는가 ───────────────────────────────
 * 코드 한 줄이 다시 붙어도 **오류가 안 난다.** 그냥 회색 글자 하나가 늘어날 뿐이라
 * 아무도 신고하지 않는다(「이름 (이름)」이 실제로 그렇게 오래 떠 있었다). 브라우저
 * 없이 볼 수 있는 것은 소스뿐이라, 이웃(common/date-input-max-screens.test.ts ·
 * common/save-popup-screens.test.ts)과 같은 방법으로 원본을 글자로 읽는다.
 *
 * ── 🔴 주석을 세면 안 된다 ──────────────────────────────────────────────
 * 이 저장소가 실제로 밟은 함정이다 — 소스 글자로 재는 검사가 **주석 안의** 글자를
 * 세어 셈이 틀어졌다. 여기서는 더 위험하다: 코드를 걷어낸 자리마다 **왜 걷었는지**를
 * 주석으로 적어 두었고, 그 주석에 `procedure_templates.code` 나 `key={s.code}` 같은
 * 글자가 그대로 들어 있다. 걸러내기가 안 돌면 **고쳐 놓고도 빨갛게** 터진다.
 * 걸러내기가 일하고 있다는 증거는 ②절에 값으로 둔다.
 *
 * ── 🔵 `key={s.code}` 는 화면 글자가 아니다 ─────────────────────────────
 * React key 는 같은 줄을 알아보는 **내부 이름**이라 사람 눈에 안 닿는다. 그래서
 * 남겨 둔다. 다만 「남아 있어야 한다」도 ③절에서 값으로 못 박는다 — 이 시험이
 * 「코드를 지워라」로만 읽히면 다음 사람이 key 까지 걷어 목록이 깜빡이게 된다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8");

/**
 * 주석을 걷어낸 소스. JSX 주석 `{/* … *\/}` · 블록 주석 · 줄 주석 셋을 모두 본다
 * (procedure-series-and-version-list.test.tsx 가 쓰는 것과 같은 걸러내기).
 */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 절차 코드를 **글자로 그리는** 자리. JSX 안에서 `{무엇.code}` 한 덩이로 서는 것만
 * 집는다 — `result.code === "CONFLICT"`(서버 결과의 갈래 이름)나 `{ code: x }`
 * (객체 칸)는 화면 글자가 아니므로 안 집힌다.
 *
 * 앞에 `$` 가 붙은 `${…}`(템플릿 문자열)는 제외한다 — 그쪽은 주소를 만드는 자리다.
 */
function paintedCodeExpressions(source: string): { text: string; precededByKey: boolean }[] {
  const found: { text: string; precededByKey: boolean }[] = [];
  for (const match of source.matchAll(/\{\s*[\w$.]*\.code\s*\}/g)) {
    const index = match.index ?? 0;
    if (source[index - 1] === "$") continue;
    found.push({
      text: match[0],
      precededByKey: /key=$/.test(source.slice(Math.max(0, index - 4), index)),
    });
  }
  return found;
}

/** `src/` 아래의 `.tsx` 전부(시험 파일 제외). 슬래시 경로로 돌려준다. */
function tsxFilesUnder(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(new URL(directory, repoUrl), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...tsxFilesUnder(path));
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) found.push(path);
  }
  return found;
}

/**
 * 2026-11-05 에 코드를 걷어낸 화면 일곱. 🔴 **파일마다 몇 군데였는지**를 함께 적는다 —
 * 고친 자리가 몇이었는지가 나중에 「놓친 자리가 있었나」를 되짚는 유일한 기록이다.
 */
const CLEARED_SCREENS: { path: string; removed: number; what: string }[] = [
  { path: "src/components/procedures/ProcedureTemplateListScreen.tsx", removed: 2, what: "표의 이름 아래 한 줄 · 카드의 「코드」 항목" },
  { path: "src/components/procedures/ProcedureTemplateDetailScreen.tsx", removed: 1, what: "제목 아래 한 줄" },
  { path: "src/components/procedures/TechnicalProcedureSeriesList.tsx", removed: 2, what: "표의 이름 아래 한 줄 · 카드의 「코드」 항목" },
  { path: "src/components/procedures/TechnicalProcedureTemplateListScreen.tsx", removed: 4, what: "판별 보기 표·카드 · 휴지통 표·카드" },
  { path: "src/components/procedures/validation/ValidationIssueListScreen.tsx", removed: 1, what: "제목 아래 한 줄" },
  { path: "src/components/procedures/ProcedureVersionList.tsx", removed: 1, what: "안내문의 「(코드)」" },
  { path: "src/components/procedures/editor/CreateTechnicalTemplateForm.tsx", removed: 1, what: "만들기 창의 코드 입력란" },
];

// ══════════════════════════════════════════════════ ① 걷어낸 화면들

describe("🔴 ① 절차 코드를 글자로 그리는 자리가 없다", () => {
  test("🔵 먼저 — 표본이 비지 않았다(일곱 파일을 모두 읽는다)", () => {
    assert.equal(CLEARED_SCREENS.length, 7);
    for (const { path } of CLEARED_SCREENS) {
      assert.ok(read(path).length > 0, `${path}: 못 읽었다 — 파일이 옮겨 갔는가`);
    }
  });

  test("일곱 화면 어디에도 「코드」라는 **항목 이름/글자**가 없다", () => {
    for (const { path, what } of CLEARED_SCREENS) {
      const source = stripComments(read(path));
      assert.ok(!source.includes("코드"), `${path}(${what})에 「코드」 글자가 남아 있다`);
    }
  });

  test("🔴 `{…​.code}` 로 그리는 자리는 **React key 하나뿐**이다", () => {
    const problems: string[] = [];
    for (const { path } of CLEARED_SCREENS) {
      for (const painted of paintedCodeExpressions(stripComments(read(path)))) {
        if (painted.precededByKey) continue;
        problems.push(`${path}: ${painted.text}`);
      }
    }
    assert.deepEqual(problems, [], "절차 코드가 화면 글자로 다시 그려지고 있다");
  });

  test("🔴 절차 화면 **전부**를 본다 — 새 화면이 다시 그리는 것도 막는다", () => {
    const files = tsxFilesUnder("src/components/procedures");
    // 표본 확인 — 읽개가 조용히 망가져 0개를 찾으면 아래가 공짜로 통과한다.
    assert.ok(files.length >= 50, `절차 화면을 ${files.length}개밖에 못 찾았다 — 읽개가 깨졌다`);

    const problems: string[] = [];
    let keyCount = 0;
    for (const path of files) {
      for (const painted of paintedCodeExpressions(stripComments(read(path)))) {
        if (painted.precededByKey) {
          keyCount += 1;
          continue;
        }
        problems.push(`${path}: ${painted.text}`);
      }
    }
    assert.deepEqual(problems, [], "절차 코드를 글자로 그리는 화면이 생겼다");
    // 🔵 key 조차 하나도 못 찾았다면 읽개가 아니라 **정규식**이 깨진 것이다.
    assert.ok(keyCount >= 2, `key={…code} 를 ${keyCount}개밖에 못 찾았다 — 읽개를 의심할 것`);
  });
});

// ══════════════════════════════════════════════════ ② 걸러내기가 실제로 무는가

describe("🔴 ② 주석에 적힌 글자를 세지 않는다", () => {
  test("주석에만 코드가 적힌 파일에서 **0개**가 나온다", () => {
    const path = "src/components/procedures/ProcedureTemplateListScreen.tsx";
    const raw = read(path);
    // 먼저 「무엇을 재는지」 — 이 파일의 **주석에는** 그 글자가 실제로 있다.
    assert.ok(raw.includes("procedure_templates.code"), `${path}: 주석의 그 글자가 사라졌다 — 다른 표본을 고를 것`);
    assert.ok(raw.includes("코드"), `${path}: 주석의 「코드」가 사라졌다 — 다른 표본을 고를 것`);

    const source = stripComments(raw);
    assert.ok(!source.includes("procedure_templates.code"), `${path}: 주석을 안 걷었다`);
    assert.equal(paintedCodeExpressions(source).length, 0, `${path}: 주석 안의 글자를 화면 글자로 셌다`);
  });

  test("주석과 진짜가 섞인 파일에서 **진짜 수만** 센다", () => {
    const path = "src/components/procedures/TechnicalProcedureSeriesList.tsx";
    const raw = read(path);
    // 이 파일은 머리말에도 `key={s.code}` 를 적어 두었고, 진짜 key 는 둘이다.
    const written = (raw.match(/key=\{s\.code\}/g) ?? []).length;
    assert.ok(written >= 3, `${path}: 주석에 적힌 글자가 줄었다 — 다른 표본을 고를 것`);
    assert.equal(paintedCodeExpressions(stripComments(raw)).length, 2, `${path}: 주석을 함께 셌다`);
  });

  test("읽개가 **진짜 코드 표시**를 집기는 하는가 — 옛 모양을 그대로 먹여 본다", () => {
    // 🔴 「없다」 쪽 단언만 두면, 읽개가 아무것도 못 집는 날에도 전부 초록이다.
    const old = '<div className="font-mono text-[10px]">{t.code}</div>';
    const found = paintedCodeExpressions(old);
    assert.equal(found.length, 1, "옛 모양을 못 집는다 — 위의 「없다」가 전부 공짜였다는 뜻이다");
    assert.equal(found[0].precededByKey, false);
    // key 는 집되 **봐준다**.
    assert.deepEqual(paintedCodeExpressions("<tr key={s.code}>").map((p) => p.precededByKey), [true]);
    // 화면 글자가 아닌 것들은 애초에 안 집힌다.
    assert.equal(paintedCodeExpressions('if (result.code === "CONFLICT") {}').length, 0);
    assert.equal(paintedCodeExpressions("href={`/procedures/${t.code}`}").length, 0);
  });
});

// ══════════════════════════════════════════════════ ③ 내부 열쇠는 그대로다

describe("🔴 ③ 걷어낸 것은 **보여 주기뿐**이다", () => {
  test("계열 목록의 React key 는 여전히 code 다 — 여기까지 걷으면 줄이 깜빡인다", () => {
    const source = stripComments(read("src/components/procedures/TechnicalProcedureSeriesList.tsx"));
    assert.equal((source.match(/key=\{s\.code\}/g) ?? []).length, 2, "표와 카드 둘 다 code 를 key 로 써야 한다");
  });

  test("상세는 여전히 code 로 **그 계열의 판**을 모은다", () => {
    const page = stripComments(read("src/app/(app)/procedures/[id]/page.tsx"));
    assert.ok(
      flat(page).includes("listProcedureTemplateVersions(template.code"),
      "판본 목록이 code 말고 다른 것으로 묶이면 계열이 쪼개진다"
    );
  });

  test("편집기는 여전히 code 로 **자기 계열**을 「다음 절차」 후보에서 뺀다", () => {
    const page = stripComments(read("src/app/(app)/procedures/[id]/edit/page.tsx"));
    assert.ok(flat(page).includes("listNextProcedureLinkCandidates(template.code)"), "자기 계열을 빼려면 code 가 필요하다");
  });
});

// ══════════════════════════════════════════════════ ④ 만들기 창

describe("🔴 ④ 새 기술 절차 만들기 — 코드를 **적지도 보내지도 않는다**", () => {
  const PATH = "src/components/procedures/editor/CreateTechnicalTemplateForm.tsx";
  const raw = read(PATH);
  const source = stripComments(raw);

  test("코드 입력란이 없다 — 칸은 셋(이름 · 설비 유형 · 설명)이다", () => {
    assert.equal((source.match(/<label/g) ?? []).length, 3, "칸 수가 달라졌다");
    assert.ok(source.includes("이름 (필수)"), "표본 확인 — 이름 칸은 그대로 있어야 한다");
    assert.ok(!source.includes("코드 (필수)"), "코드 입력란이 남아 있다");
    assert.ok(!/\bsetCode\b/.test(source), "코드 상태가 남아 있다");
  });

  test("🔴 액션에 `code` 를 **안 싣는다** — 화면이 지으면 유일성을 보장할 길이 없다", () => {
    const callStart = source.indexOf("createManualTechnicalProcedureTemplateAction({");
    assert.ok(callStart > 0, "액션을 부르는 자리를 못 찾았다");
    const callEnd = source.indexOf("});", callStart);
    assert.ok(callEnd > callStart, "액션 호출의 끝을 못 찾았다");
    const payload = flat(source.slice(callStart, callEnd));
    // 표본 확인 — 보내는 칸 셋은 그대로다.
    for (const field of ["name,", "equipmentType,", "description:"]) {
      assert.ok(payload.includes(field), `보내는 칸 ${field} 가 사라졌다: ${payload}`);
    }
    assert.ok(!/\bcode\b/.test(payload), `액션에 코드를 싣고 있다: ${payload}`);
  });

  test("[만들기] 단추를 켜는 조건에서도 코드가 빠졌다 — 남았다면 영영 안 켜진다", () => {
    assert.ok(flat(source).includes("const canSubmit = name.trim().length > 0 && !isSubmitting;"));
  });

  test("🔵 그래도 이 파일의 주석은 **왜 없앴는지**를 적고 있다", () => {
    // 🔴 걷어낸 자리에 까닭이 없으면 다음 사람이 「빠뜨린 것」으로 읽고 되돌린다.
    assert.ok(raw.includes("코드가 필요하다고"), "걷어낸 까닭이 파일에 안 적혀 있다");
  });
});
