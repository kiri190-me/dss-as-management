import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * [진단 Flowchart 관리] 가 **고장 개소 태그로 찾아지고, 태그가 줄마다 보이는가**
 * (2026-11-19 사용자 요청: 「이 내용으로 [진단 Flowchart 관리]에서 검색을 할 수
 * 있도록 해줘.」).
 *
 * ── 왜 그려 보지 않고 원본 글자로 보는가 ────────────────────────────────
 * 이 화면(DiagnosisFlowchartManagementScreen)은 서버 액션을 직접 import 하고, 그
 * 사슬 끝에 `server-only` 가 있다 — components 목록은 react-server 조건 없이 돌므로
 * import 자체가 바로 던진다. 조각 1의 편집기 시험(repair-cases/flowchart/
 * case-flowchart-fault-tags.test.tsx)이 같은 사정으로 쓴 방법을 그대로 쓴다.
 *
 * ── 무엇을 여기서 재고 무엇을 저쪽에서 재는가 ───────────────────────────
 * 태그를 다듬는 규칙(`#` 떼기 · 공백 줄이기)은 unit 목록의 lib/validation/
 * repair-case-flowchart-fault-tags.test.ts 가 **값으로** 잰다. 조회 둘이 태그를
 * 실어 오는지는 db 목록의 lib/db/queries/repair-case-flowcharts.integration.test.ts
 * 가 잰다. 여기서 못 박는 것은 **화면이 그 둘을 제대로 물고 있는가**와, 눌러 보기
 * 전에는 안 보이는 것들이다:
 *
 *  · 🔴 **거르는 함수가 둘이고 사본이다** — matchesSearch(사용중) ·
 *    matchesTrashSearch(휴지통). 한쪽만 고치면 「목록에선 찾아지는데 휴지통에선
 *    안 되는」 반쪽이 되고, 탭을 바꿔 가며 같은 글자를 쳐 보기 전에는 안 보인다.
 *    그래서 **두 몸통이 한 글자도 다르지 않은지**를 직접 맞댄다.
 *  · 🔴 **`#` 를 떼고 견주는가** — 사람은 `#우내` 로 친다. 안 떼면 「분명히 달아
 *    뒀는데 안 나오는」 칸이 된다.
 *  · 🔴 **알약 그리는 자리가 넷**이다(사용중 표·카드, 휴지통 표·카드). 하나만
 *    빠지면 창 폭에 따라 보였다 안 보였다 한다.
 *  · 🔴 **표에 칸을 더하지 않았는가 · min-w 를 안 올렸는가** — 목록은 실제 넘침을
 *    재서 표↔카드를 고르므로(common/responsive-list.tsx) 칸이 늘면 좁은 화면에서
 *    카드로 넘어가는 폭이 바뀐다. 그건 눈으로만 보인다.
 *  · 🔴 **안내 글자(placeholder)에 「고장 개소」가 있는가** — 안 적으면 되는 줄을
 *    아무도 모른다.
 *  · 🔵 **태그가 없는 줄에 빈 알약이 안 생기는가** — 빈 상자를 두면 태그를 단 줄이
 *    하나도 없어도 모든 줄이 높아진다.
 *
 * ── 🔴 주석을 걷어내고 센다 ─────────────────────────────────────────────
 * 이 저장소는 「왜」를 길게 적고 그 글에 함수 이름·낱말이 그대로 들어 있다. 안
 * 걷으면 「화면이 태그를 본다」가 **주석만으로 통과한다.**
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) => readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

function stripComments(source: string): string {
  return source
    // JSX 주석 `{/* ... */}`.
    // 🔴 `{` 와 `/*` 사이에 **줄바꿈을 허용하면 안 된다**(`[ \t]*` 이지 `\s*` 가 아니다).
    // 허용하면 함수 몸통을 여는 `{` 바로 다음 줄에 선 `/** ... */` 머리말이 JSX 주석의
    // 시작으로 읽히고, 거기서부터 **한참 뒤의 진짜 `*/}` 까지 통째로 지워진다 —
    // 실제로 이 시험에서 그 일이 났다(FaultTagPills 의 첫 줄 주석이 5588자를 먹어
    // DiagnosisFlowchartTrashCardList 가 원본에서 사라진 것처럼 보였다).
    .replace(/\{[ \t]*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석(이 파일의 `//` 는 전부 줄 머리에 있다)
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
const count = (source: string, needle: string) => source.split(needle).length - 1;

const rawScreen = read("src/components/diagnosis-flowcharts/DiagnosisFlowchartManagementScreen.tsx");
const screen = stripComments(rawScreen);

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `원본에서 \`${marker}\` 를 못 찾았다 — 이름/모양이 바뀌었으면 시험도 함께 고쳐야 한다`);
  return at;
}

/** `from` 부터 `to` 직전까지 — 주석을 걷어낸 원본 위에서 자른다. */
function region(fromMarker: string, toMarker?: string): string {
  const from = indexOrFail(screen, fromMarker);
  if (!toMarker) return screen.slice(from);
  const to = indexOrFail(screen, toMarker);
  assert.ok(from < to, `\`${fromMarker}\` 가 \`${toMarker}\` 보다 뒤에 있다 — 파일 차례가 바뀌었다`);
  return screen.slice(from, to);
}

// ── 네 자리 ────────────────────────────────────────────────────────────────
// 차례대로: FaultTagPills 정의 → 휴지통 카드 → 사용중 카드 → 화면 본체(표 둘).
const PILLS_DEF = "function FaultTagPills({ tags, searchQuery }";
const TRASH_CARD_LIST = "function DiagnosisFlowchartTrashCardList(";
const ACTIVE_CARD_LIST = "function DiagnosisFlowchartCardList(";
const SCREEN_BODY = "export default function DiagnosisFlowchartManagementScreen(";
const TRASH_TABLE = 'listId="diagnosis-flowchart-trash"';
const ACTIVE_TABLE = 'listId="diagnosis-flowcharts"';

const pillsDefinition = region(PILLS_DEF, TRASH_CARD_LIST);
const trashCard = region(TRASH_CARD_LIST, ACTIVE_CARD_LIST);
const activeCard = region(ACTIVE_CARD_LIST, SCREEN_BODY);
const trashTable = region(TRASH_TABLE, ACTIVE_TABLE);
const activeTable = region(ACTIVE_TABLE);

/**
 * 알약을 그리는 한 줄 — 네 자리가 **글자까지 같아야** 갈릴 길이 없다.
 * 🔴 검색어가 여기까지 와야 「걸린 태그는 접혀 있어도 보인다」가 선다 — 카드 목록
 * 둘은 따로 선 부품이라 prop 으로 받아 내린다.
 */
const PILL_CALL = "<FaultTagPills tags={row.faultTags} searchQuery={searchQuery} />";

/** 거르는 함수 하나의 몸통 — 여는 중괄호부터 끝까지(파라미터에 중괄호가 없어 첫 `{` 가 몸통이다). */
function matcherBody(fromMarker: string, toMarker: string): string {
  const whole = region(fromMarker, toMarker);
  return flat(whole.slice(whole.indexOf("{"))).trim();
}

/**
 * 알약 함수 **안에 중첩된** 함수 하나의 몸통 — 중괄호 짝을 세어 끝을 찾는다.
 * 🔵 알약 함수 전체로 재면 여러 핸들러의 글자가 섞여, 「손잡이가 전파를 막는가」가
 * 엉뚱한 핸들러의 stopPropagation 으로 통과할 수 있다.
 */
function functionBodyAfter(start: string): string {
  const from = indexOrFail(pillsDefinition, start);
  const open = pillsDefinition.indexOf("{", from);
  assert.notEqual(open, -1, `${start} 의 몸통이 안 열린다`);
  let depth = 0;
  for (let i = open; i < pillsDefinition.length; i += 1) {
    if (pillsDefinition[i] === "{") depth += 1;
    else if (pillsDefinition[i] === "}") {
      depth -= 1;
      if (depth === 0) return pillsDefinition.slice(open, i + 1);
    }
  }
  assert.fail(`${start} 의 몸통이 안 닫혔다`);
}

const activeMatcher = matcherBody("function matchesSearch(row: RepairCaseFlowchartManagementRow", "function matchesTrashSearch(");
const trashMatcher = matcherBody("function matchesTrashSearch(row: RepairCaseFlowchartTrashRow", "function formatRetentionLabel(");

describe("진단 Flowchart 관리 — 고장 개소로 찾기", () => {
  test("🔵 먼저 표본 확인 — 거르는 함수 **둘**과 그 몸통이 실제로 이 파일에 있다", () => {
    assert.ok(activeMatcher.startsWith("{"), activeMatcher);
    assert.ok(trashMatcher.startsWith("{"), trashMatcher);
    assert.ok(activeMatcher.length > 50, "사용중 쪽 몸통이 비어 있다 — 아래 검사가 공짜로 통과한다");
    assert.ok(trashMatcher.length > 50, "휴지통 쪽 몸통이 비어 있다 — 아래 검사가 공짜로 통과한다");
  });

  test("🔴 **사용중**이 태그를 본다 — 배열을 하나씩 견준다", () => {
    assert.ok(activeMatcher.includes("row.faultTags.some("), `사용중 거르기가 태그를 안 본다: ${activeMatcher}`);
    // 🔴 이어 붙여 한 글자로 만들지 않는다 — 붙인 자리에 어느 태그에도 없는
    // 글자가 생겨 엉뚱한 줄이 걸린다.
    assert.equal(activeMatcher.includes("faultTags.join("), false, "태그를 이어 붙여 견주고 있다");
  });

  test("🔴 **휴지통**도 태그를 본다 — 한쪽만 고치면 반쪽이 된다", () => {
    assert.ok(trashMatcher.includes("row.faultTags.some("), `휴지통 거르기가 태그를 안 본다: ${trashMatcher}`);
    assert.equal(trashMatcher.includes("faultTags.join("), false, "태그를 이어 붙여 견주고 있다");
  });

  test("🔴 두 몸통이 **한 글자도 다르지 않다** — 사본이 갈리는 순간 반쪽이 된다", () => {
    assert.equal(
      trashMatcher,
      activeMatcher,
      "matchesSearch 와 matchesTrashSearch 의 몸통이 갈렸다 — 한쪽만 고쳤거나, 고치는 김에 다른 규칙을 넣었다"
    );
  });

  test("🔴 `#` 를 붙여 쳐도 찾아진다 — 걸림 판정을 **공용 함수**에 맡긴다", () => {
    for (const [name, body] of [
      ["사용중", activeMatcher],
      ["휴지통", trashMatcher],
    ] as const) {
      assert.ok(
        body.includes("faultTagMatchesQuery(tag, query)"),
        `${name} 쪽이 걸림 판정을 공용 함수에 안 맡긴다 — \`#우내\` 로 치면 한 줄도 안 나온다: ${body}`
      );
    }
    // 🔴 `#` 떼기·대소문자 규칙을 화면이 제 손으로 다시 적으면 저장된 모양과 조용히
    // 갈린다. 규칙 자체는 unit 목록이 값으로 잰다(repair-case-flowchart-fault-tag-display.test.ts).
    assert.ok(
      flat(screen).includes('from "@/lib/domain/repair-case-flowchart-fault-tag-display"'),
      "걸림 판정을 공용 자리에서 안 가져온다"
    );
    assert.equal(/replace\(\/\^#/.test(screen), false, "화면이 `#` 떼는 규칙을 직접 다시 적고 있다");
    assert.equal(screen.includes("normalizeFlowchartFaultTag"), false, "다듬는 함수를 화면이 또 부른다 — 규칙이 두 곳에 산다");
  });

  test("🔴 **거르기와 굵게 표시가 같은 함수**를 본다 — 갈리면 「줄은 나왔는데 걸린 태그가 안 보이는」 모양이 된다", () => {
    const flatScreen = flat(screen);
    // 거르는 쪽 둘 + 알약이 굵게 그릴지 고르는 자리 하나 = 적어도 셋.
    assert.ok(count(flatScreen, "faultTagMatchesQuery(") >= 3, "걸림 판정을 쓰는 자리가 모자라다");
    assert.ok(
      flat(pillsDefinition).includes("faultTagMatchesQuery(tag, searchQuery) ? FAULT_TAG_PILL_MATCHED_CLASS : FAULT_TAG_PILL_CLASS"),
      `알약이 거르기와 다른 규칙으로 굵게 그린다: ${flat(pillsDefinition)}`
    );
  });

  test("🔵 **다른 칸까지 `#` 를 떼지는 않는다** — 제목·고객사는 친 글자 그대로 본다", () => {
    for (const body of [activeMatcher, trashMatcher]) {
      // 칸 여섯을 견주는 줄은 다듬지 않은 `key` 를 쓴다.
      assert.ok(
        body.includes("[row.intakeNumber, row.customerName, row.endUserName, row.modelName, row.serialNumber, row.title].some((field) => (field ?? \"\").toLowerCase().includes(key))"),
        `본래 칸 여섯을 견주는 줄이 바뀌었다: ${body}`
      );
      assert.ok(body.includes("const key = query.trim().toLowerCase();"), "찾는 글을 그대로 쥐는 자리가 사라졌다");
    }
  });

  test("🔵 빈 글자는 **전부 통과**다 — 찾기를 안 하는 상태가 그대로 남아 있다", () => {
    for (const body of [activeMatcher, trashMatcher]) {
      assert.ok(body.includes("if (!key) return true;"), `빈 글자에서 전부 통과가 사라졌다: ${body}`);
    }
  });

  test("🔴 찾기는 여전히 **화면에서** 돈다 — 서버로 옮기지 않았다", () => {
    const flatScreen = flat(screen);
    assert.ok(flatScreen.includes("rows.filter((row) => matchesSearch(row, searchQuery))"), "사용중 거르기가 화면에서 안 돈다");
    assert.ok(flatScreen.includes("trashRows.filter((row) => matchesTrashSearch(row, searchQuery))"), "휴지통 거르기가 화면에서 안 돈다");
  });
});

describe("진단 Flowchart 관리 — 검색 칸의 안내 글자", () => {
  // 🔴 이 파일에는 `placeholder` 가 둘이다 — 만들기 상자의 「인수번호로 검색」과
  // 목록 위의 검색 칸. 앞엣것을 집으면 엉뚱한 글자를 재게 되므로 **검색 칸의
  // onChange 로 자리를 먼저 잡고** 그 뒤의 placeholder 를 집는다.
  const placeholder = (() => {
    const from = indexOrFail(screen, "onChange={(e) => setSearchQuery(e.target.value)}");
    const matched = /placeholder="([^"]*)"/.exec(screen.slice(from));
    assert.ok(matched, "검색 칸의 안내 글자를 못 찾았다");
    return matched[1];
  })();

  test("🔵 먼저 표본 확인 — 본래 적혀 있던 칸들이 그대로다", () => {
    for (const field of ["인수번호", "고객사", "End-User", "모델", "S/N", "Flowchart 이름"]) {
      assert.ok(placeholder.includes(field), `안내 글자에서 「${field}」 가 사라졌다: ${placeholder}`);
    }
  });

  test("🔴 「고장 개소」가 적혀 있다 — 안 적으면 되는 줄을 아무도 모른다", () => {
    assert.ok(placeholder.includes("고장 개소"), `안내 글자에 고장 개소가 없다: ${placeholder}`);
  });
});

describe("진단 Flowchart 관리 — 알약을 그리는 자리 넷", () => {
  test("🔵 먼저 표본 확인 — 네 자리가 실제로 잘렸고 줄마다 이름이 그려진다", () => {
    for (const [name, source] of [
      ["휴지통 카드", trashCard],
      ["사용중 카드", activeCard],
      ["휴지통 표", trashTable],
      ["사용중 표", activeTable],
    ] as const) {
      assert.ok(source.length > 200, `${name} 자리가 거의 비었다 — 자르는 표식이 바뀌었다`);
      assert.ok(source.includes("{row.title}"), `${name} 자리에 Flowchart 이름이 없다`);
    }
  });

  test("🔴 넷 **전부**에 알약이 붙고, 다섯째 자리는 없다", () => {
    for (const [name, source] of [
      ["휴지통 카드", trashCard],
      ["사용중 카드", activeCard],
      ["휴지통 표", trashTable],
      ["사용중 표", activeTable],
    ] as const) {
      assert.equal(count(flat(source), PILL_CALL), 1, `${name} 에 알약이 없거나 둘 이상이다`);
    }
    assert.equal(count(flat(screen), PILL_CALL), 4, "알약을 그리는 자리가 넷이 아니다");
  });

  test("🔴 알약은 **Flowchart 이름 아래**다 — 위에 서면 이름이 밀려 내려간다", () => {
    for (const [name, source] of [
      ["휴지통 카드", trashCard],
      ["사용중 카드", activeCard],
      ["휴지통 표", trashTable],
      ["사용중 표", activeTable],
    ] as const) {
      const flatSource = flat(source);
      assert.ok(flatSource.indexOf("{row.title}") < flatSource.indexOf(PILL_CALL), `${name} 에서 알약이 이름보다 위에 있다`);
    }
  });

  test("🔴 넷이 **같은 한 함수**를 부른다 — 따로 적히면 표와 카드가 갈린다", () => {
    // 🔵 알약의 모양 글자(rounded-full px-2 py-0.5)로는 셀 수 없다 — 상태 배지
    // (사용중/휴지통)가 같은 모양을 쓴다. 고장 개소에만 있는 것으로 센다:
    // 알약 글자 상수를 직접 쓰거나, 배열을 제 손으로 펼치는 자리.
    for (const [name, source] of [
      ["휴지통 카드", trashCard],
      ["사용중 카드", activeCard],
      ["휴지통 표", trashTable],
      ["사용중 표", activeTable],
    ] as const) {
      assert.equal(source.includes("FAULT_TAG_PILL_CLASS"), false, `${name} 이 알약 글자를 직접 쓰고 있다`);
      assert.equal(/faultTags\.map\(/.test(source), false, `${name} 이 태그를 제 손으로 펼치고 있다`);
    }
    // 🔵 반대로 알약 함수 쪽에는 그 둘이 다 있어야 한다 — 없으면 위 검사가 공짜다.
    assert.ok(pillsDefinition.includes("FAULT_TAG_PILL_CLASS"), pillsDefinition);
    assert.ok(/visible\.map\(/.test(pillsDefinition), pillsDefinition);
  });

  test("🔴 **검색어가 카드 목록 둘에까지 내려간다** — 안 내려가면 그쪽만 걸린 태그가 안 보인다", () => {
    const flatScreen = flat(screen);
    // 받는 쪽: 따로 선 부품이라 prop 으로 받아야 한다.
    assert.ok(flat(trashCard).includes("searchQuery: string;"), "휴지통 카드가 검색어를 안 받는다");
    assert.ok(flat(activeCard).includes("searchQuery: string;"), "사용중 카드가 검색어를 안 받는다");
    // 넘기는 쪽: 안 넘기면 받는 쪽이 있어도 늘 빈 글자다.
    assert.ok(
      flatScreen.includes("<DiagnosisFlowchartTrashCardList rows={filteredTrashRows}") &&
        /<DiagnosisFlowchartTrashCardList[^>]*searchQuery=\{searchQuery\}/.test(flatScreen),
      "휴지통 카드에 검색어를 안 넘긴다"
    );
    assert.ok(
      /<DiagnosisFlowchartCardList[^>]*searchQuery=\{searchQuery\}/.test(flatScreen),
      "사용중 카드에 검색어를 안 넘긴다"
    );
  });
});

describe("진단 Flowchart 관리 — 알약 자체", () => {
  const classLiteral = (name: string) => {
    const matched = new RegExp(`const ${name}\\s*=\\s*\\n?\\s*"([^"]+)"`).exec(screen);
    assert.ok(matched, `${name} 을 못 찾았다`);
    return matched[1];
  };
  const pillClass = classLiteral("FAULT_TAG_PILL_CLASS");
  const matchedPillClass = classLiteral("FAULT_TAG_PILL_MATCHED_CLASS");

  test("🔵 먼저 표본 확인 — 알약 함수가 실제로 이 파일에 있다", () => {
    assert.ok(pillsDefinition.includes("function FaultTagPills"), pillsDefinition.slice(0, 120));
    assert.ok(pillClass.length > 50, `알약 글자가 비었다: ${pillClass}`);
    assert.ok(matchedPillClass.length > 50, `걸린 태그의 글자가 비었다: ${matchedPillClass}`);
  });

  test("🔵 태그가 없으면 **아무것도 안 그린다** — 빈 알약도 빈 틈도 없다", () => {
    assert.ok(pillsDefinition.includes("if (tags.length === 0) return null;"), `빈 묶음을 걸러내지 않는다: ${pillsDefinition}`);
    // 🔵 위쪽 여백을 알약 쪽이 쥔다 — 바깥에서 주면 알약이 없는 줄에도 여백만 남는다.
    assert.ok(flat(pillsDefinition).includes('className="mt-1 flex flex-wrap'), `여백·줄바꿈 상자가 바뀌었다: ${flat(pillsDefinition)}`);
  });

  test("🔵 무엇이 줄에 서고 무엇이 메모로 갈지는 **공용 규칙**이 정한다 — 화면은 그리기만 한다", () => {
    const body = flat(pillsDefinition);
    assert.ok(
      body.includes("selectVisibleFaultTags(tags, searchQuery)"),
      `가르는 규칙을 화면이 제 손으로 적고 있다: ${body}`
    );
    // 🔴 화면이 제 손으로 자르면 「걸린 태그는 상한을 넘겨서라도 줄에 선다」가 깨진다.
    assert.equal(/tags\.slice\(/.test(pillsDefinition), false, "화면이 태그를 직접 자른다");
    assert.ok(body.includes("const { visible, hidden } ="), "가른 결과 둘을 다 안 쓴다");
  });

  test("🔴 넘치면 **`+N` 손잡이**가 선다 — 누르면 메모가 뜨고 다시 누르면 닫힌다", () => {
    const body = flat(pillsDefinition);
    assert.ok(body.includes("{hidden.length > 0 && ("), `손잡이를 그리는 자리가 없다: ${body}`);
    assert.ok(body.includes("+{hidden.length}"), "남은 수를 안 적는다 — 몇 개가 더 있는지 알 수 없다");
    assert.ok(body.includes("onClick={toggleMemo}"), "손잡이가 메모를 여닫지 않는다");
    // 다시 누르면 닫는 갈래가 있어야 한다 — 없으면 한 번 열고는 바깥을 눌러야만 닫힌다.
    assert.ok(flat(functionBodyAfter("function toggleMemo(")).includes("if (memoAt) { setMemoAt(null); return; }"), "다시 눌러도 안 닫힌다");
    // 🔴 메모가 떠 있는지는 **줄마다 따로** — 이 함수가 줄마다 서므로 useState 가 곧 줄별 상태다.
    assert.ok(
      body.includes("const [memoAt, setMemoAt] = useState<{ top: number; left: number } | null>(null)"),
      "메모 상태를 줄마다 안 갖는다"
    );
    assert.ok(body.includes("aria-expanded={memoAt !== null}"), "읽는 장치에 떠 있는지 안 알린다");
  });

  test("🔴 손잡이는 `type=\"button\"` 이고 **전파를 막는다** — 표 칸 안에서 다른 동작이 딸려 돈다", () => {
    const body = flat(pillsDefinition);
    assert.ok(body.includes('<button ref={handleRef} type="button"'), `손잡이가 단추가 아니거나 type 이 button 이 아니다: ${body}`);
    assert.ok(flat(functionBodyAfter("function toggleMemo(")).includes("event.stopPropagation();"), "손잡이가 이벤트 전파를 안 막는다");
    // 🔴 메모 안쪽의 click 도 막는다 — portal 은 DOM 상 body 밑이지만 **React 이벤트는
    // 부모 컴포넌트까지 거품이 인다**. 안 막으면 메모를 누른 것이 그 줄을 누른 것이 된다.
    assert.ok(body.includes("onClick={(event) => event.stopPropagation()}"), "메모 안쪽의 click 이 그 줄까지 올라간다");
  });

  test("🔴 메모가 **흐름에서 빠져 있다** — 눌러도 표 폭이 안 변하는 것이 이 변경의 목적이다", () => {
    const body = flat(pillsDefinition);
    // 🔵 표 껍데기(common/responsive-list.tsx)가 스크롤 상자라 그 안에서 absolute 로
    // 띄우면 **잘린다** — 그래서 portal 로 document.body 에 붙이고 fixed 로 띄운다.
    assert.ok(body.includes("createPortal("), `메모를 표 안에 그린다 — 마지막 줄에서 잘린다: ${body}`);
    assert.ok(body.includes("document.body"), "메모를 body 밖에 붙인다");
    assert.ok(body.includes('className="fixed z-50'), "메모가 흐름 안에 있다 — 열면 표가 넓어진다");
    assert.ok(body.includes("style={{ top: memoAt.top, left: memoAt.left"), "손잡이 자리에 안 뜬다");
    assert.ok(flat(screen).includes('import { createPortal } from "react-dom"'), "portal 을 안 가져온다");
    // 🔴 「잘린다」의 근거가 남의 파일에 있다 — 그 근거가 사라지면 이 선택을 다시 재야 한다.
    const responsiveList = read("src/components/common/responsive-list.tsx");
    assert.ok(
      responsiveList.includes("overflow-x-auto rounded-lg border"),
      "표 껍데기의 overflow-x-auto 가 사라졌다 — 메모를 absolute 로 되돌릴 수 있는지 다시 잴 것"
    );
  });

  test("🔴 메모 안에서 `whitespace-normal`·`text-left` 를 **되돌린다**", () => {
    const body = flat(pillsDefinition);
    // 🔵 지금은 body 밑이라 물려받을 것이 없지만, 어느 날 absolute 로 되돌리는 사람이
    // 생기면 표 칸의 nowrap·text-right 가 따라 들어와 글이 늘어나거나 쏠린다.
    assert.ok(body.includes("text-left whitespace-normal"), `메모가 부모 CSS 를 안 되돌린다: ${body}`);
  });

  test("🔴 닫는 길이 **둘**이다 — 바깥 누르기(pointerdown)와 Escape", () => {
    const body = flat(pillsDefinition);
    assert.ok(body.includes('document.addEventListener("pointerdown", closeOnOutside)'), "바깥을 눌러도 안 닫힌다");
    assert.ok(body.includes('document.addEventListener("keydown", closeOnEscape)'), "Escape 로 안 닫힌다");
    assert.ok(body.includes('if (event.key === "Escape") setMemoAt(null);'), "Escape 를 받고도 안 닫는다");
    // 🔵 바깥 감지는 pointerdown, 메모 안쪽은 click — 안쪽까지 pointerdown 으로 받으면
    // 바깥 감지가 먼저 돌아 제 손으로 닫는다(이 저장소의 규칙).
    assert.ok(body.includes("if (memoRef.current?.contains(target)) return;"), "메모 안을 눌러도 닫힌다");
    assert.ok(body.includes("if (handleRef.current?.contains(target)) return;"), "손잡이를 누르면 열자마자 닫힌다");
    // 🔵 좌표를 띄울 때 한 번 재므로, 구르거나 창이 바뀌면 닫아야 엉뚱한 자리에 안 남는다.
    assert.ok(body.includes('window.addEventListener("scroll", closeOnMove, true)'), "굴러도 메모가 따라다닌다");
    assert.ok(body.includes('window.addEventListener("resize", closeOnMove)'), "창 크기가 바뀌어도 메모가 그 자리다");
    // 붙인 것을 떼는 자리가 있어야 한다 — 없으면 줄마다 듣는 사람이 쌓인다.
    assert.ok(body.includes('document.removeEventListener("pointerdown", closeOnOutside)'), "듣는 것을 안 뗀다");
  });

  test("🔵 숨은 태그가 **전부** 메모 안에 선다 — 알약 모양 그대로", () => {
    const body = flat(pillsDefinition);
    assert.ok(body.includes("{hidden.map((tag) => ("), `메모가 숨은 태그를 안 그린다: ${body}`);
    // 줄에 선 알약과 **같은 글자**를 쓴다 — 메모 안이라고 다르게 생기면 안 된다.
    assert.equal(
      count(body, "faultTagMatchesQuery(tag, searchQuery) ? FAULT_TAG_PILL_MATCHED_CLASS : FAULT_TAG_PILL_CLASS"),
      2,
      "줄과 메모의 알약이 다른 글자를 쓴다"
    );
  });

  test("🔵 펴 보이는 수는 **공용 규칙** 쪽에 있다 — 표와 카드가 같은 수를 본다", () => {
    const display = read("src/lib/domain/repair-case-flowchart-fault-tag-display.ts");
    assert.ok(display.includes("export const MAX_VISIBLE_FAULT_TAGS = 3;"), "펴 보이는 수가 바뀌었다 — 시험도 함께 고칠 것");
    assert.equal(screen.includes("MAX_VISIBLE_FAULT_TAGS"), false, "화면이 그 수를 따로 갖는다 — 둘이 갈릴 수 있다");
  });

  test("알약 글자는 조각 1이 편집기에 쓴 **그것 그대로**다", () => {
    assert.ok(
      pillClass.includes("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"),
      `알약 글자가 다르다: ${pillClass}`
    );
  });

  test("🔴 색이 상태 배지와 다르다 — 고장 개소는 **값**이지 상태가 아니다", () => {
    // 🔴 걸린 태그를 굵게 세우는 글자까지 **둘 다** 본다 — 걸렸다는 것을 색으로
    // 말하면 상태 배지처럼 읽힌다(2026-11-19 지시에 그 울타리가 적혀 있다).
    for (const [name, value] of [
      ["평소", pillClass],
      ["걸린 것", matchedPillClass],
    ] as const) {
      assert.ok(value.includes("zinc"), `${name} 알약이 중립 회색이 아니다: ${value}`);
      for (const tone of ["green", "emerald", "amber", "red", "rose", "sky", "blue", "indigo", "violet", "orange", "yellow", "teal"]) {
        assert.equal(value.includes(tone), false, `${name} 알약에 상태 배지 쪽 색이 섞였다(${tone}): ${value}`);
      }
    }
    // 🔴 상태 배지 묶음을 끌어다 쓰지 않는다 — 그 색이 바뀌는 날 값까지 따라 바뀐다.
    assert.equal(flat(pillsDefinition).includes("STATUS_BADGE"), false, "알약이 상태 배지 색을 쓴다");
  });

  test("🔵 걸린 태그는 **눈에 띈다** — 테두리와 굵기로만, 알약 모양은 그대로", () => {
    assert.notEqual(matchedPillClass, pillClass, "걸린 태그가 평소와 똑같이 생겼다 — 어느 것이 걸렸는지 알 수 없다");
    assert.ok(matchedPillClass.includes("font-semibold"), `굵지 않다: ${matchedPillClass}`);
    // 🔵 모양(높이·둥글기·글자 크기)은 같아야 한 줄에 나란히 선다.
    assert.ok(
      matchedPillClass.includes("inline-flex items-center rounded-full px-2 py-0.5 text-xs"),
      `모양이 평소 알약과 다르다: ${matchedPillClass}`
    );
  });

  test("🔵 손잡이도 **알약과 같은 높이**다 — 같은 글자를 쓴다", () => {
    assert.ok(
      flat(pillsDefinition).includes("className={`${FAULT_TAG_PILL_CLASS}"),
      `손잡이가 알약과 다른 글자를 쓴다: ${flat(pillsDefinition)}`
    );
  });

  test("🔴 공용 부품을 새로 만들지 않았다 — 알약 글자는 이 파일이 제 손으로 적는다", () => {
    assert.equal(
      /import[^;]*FaultTagPill/.test(screen),
      false,
      "알약을 다른 파일에서 가져온다 — 이 저장소는 알약 글자를 쓰는 자리마다 적는 방식이다"
    );
    assert.equal(screen.includes("from \"@/components/repair-cases/badges\""), false);
  });
});

describe("진단 Flowchart 관리 — 표를 넓히지 않았다", () => {
  test("🔵 먼저 표본 확인 — 표 둘의 머리칸이 실제로 세어진다", () => {
    assert.ok(count(trashTable, "<th ") > 0, "휴지통 표의 머리칸을 못 셌다");
    assert.ok(count(activeTable, "<th ") > 0, "사용중 표의 머리칸을 못 셌다");
  });

  test("🔴 칸을 새로 더하지 않았다 — 머리칸 수가 그대로다", () => {
    // 휴지통: 인수번호·고객사·모델·S/N·Flowchart 이름·삭제일·보관 기간 + (관리)
    assert.equal(count(trashTable, "<th "), 8, "휴지통 표의 칸 수가 바뀌었다");
    // 사용중: 인수번호·고객사·End-User·모델·S/N·Flowchart 이름·상태·최근 수정일 + (관리)
    assert.equal(count(activeTable, "<th "), 9, "사용중 표의 칸 수가 바뀌었다");
    // 「고장 개소」라는 머리칸은 없어야 한다 — 알약은 이름 칸 **안**에 산다.
    assert.equal(/<th[^>]*>\s*고장 개소/.test(screen), false, "고장 개소 칸이 생겼다");
  });

  test("🔴 min-w 를 안 올렸다 — 올리면 좁은 화면에서 카드로 넘어가는 폭이 바뀐다", () => {
    assert.ok(trashTable.includes('min-w-[880px]'), "휴지통 표의 최소 폭이 바뀌었다");
    assert.ok(activeTable.includes('min-w-[960px]'), "사용중 표의 최소 폭이 바뀌었다");
  });
});
