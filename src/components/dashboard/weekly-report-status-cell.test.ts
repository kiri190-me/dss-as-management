import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 주간보고 `현 상태` — 🔴 **블록 머리줄의 `수정` 하나로 한꺼번에** (2026-10-05)
 * ============================================================================
 * 같은 날 오전에는 칸마다 `수정`·`취소`·`저장` 이 붙어 있었다. 사용자가
 * 「하나하나 눌러야 해서 번거롭다」고 해서 **고객사 블록 단위**로 바꾼 변경이다.
 * 못 박는 것은 여덟이다.
 *
 *  1. 🔴 **줄마다의 `수정` 버튼이 사라졌다.** 안 고치는 블록의 칸에는 고르개도
 *     버튼도 없고, 못 고치는 사람이 보는 것과 **같은 글자 하나**만 남는다.
 *  2. 🔴 **머리줄 버튼은 고객사 블록에만 넘어간다.** 같은 BlockHeading 을 쓰는
 *     PO 발행 현황·종류별 총합에는 고칠 줄이 없다 — 안 넘기면 안 그려져야 한다.
 *  3. 🔴 **바뀐 줄이 없으면 서버 액션을 아예 부르지 않는다.** 비교 상대는 화면
 *     상태가 아니라 **서버가 방금 그려 준 값**이어야 재시도가 막히지 않는다.
 *  4. 🔴 **한 줄씩 차례로 보낸다.** 한 번 누를 때 여러 건의 워크플로 단계 이동과
 *     이력 쓰기가 일어난다 — 몰아 보내면 서로 기다리다 엉킨다.
 *  5. 🔴 **하나라도 실패하면 닫지도 되돌리지도 않고, 성공 팝업도 안 띄운다.**
 *     SavePopup 은 0.5초 뒤 닫히는 성공 전용 알림이라 오류와 섞여 읽힌다.
 *  6. 🔴 **일부만 성공해도 `router.refresh()` 는 부른다.** 이미 저장된 것이라
 *     화면이 사실과 달라지면 안 된다.
 *  7. 🔴 **버튼 셋은 종이에 찍히지 않는다**(`print:hidden`). 이 화면은 그대로
 *     인쇄해 쓰는 종이다.
 *  8. 🔴 **못 고치는 사람에게는 Provider 자체가 안 그려진다.** 접수 건 id 와
 *     version 을 그 브라우저로 내려보내지 않기 위한 기존 규칙이다.
 *
 * ── 🔴 왜 눌러 보지 않고 원본을 읽는가 ──────────────────────────────────
 * 이 조각들은 **어느 시험 목록에서도 불러올 수 없다**(2026-10-05 실측).
 *   - unit 목록(`--conditions=react-server`)에서는 `next/navigation` 이
 *     그 조건에서 스스로 막힌다(useRouter 를 쓰는 클라이언트 컴포넌트다).
 *   - components 목록(react-server 를 끈다)에서는 이 파일들이 불러오는 서버 액션
 *     사슬 끝의 `server-only` 가 던진다(lib/config/read-source.ts).
 * 애초에 이 저장소의 화면 시험 틀에는 브라우저가 없어 **누르는 시험 자체가
 * 없다**(정적 렌더뿐이다 — NameplateRegionPicker.test.ts 머리말). 그래서 이웃
 * 시험들과 같은 방법으로 원본을 글자로 읽는다
 * (weekly-report-kind-filter-screen.test.ts · weekly-report-width-frame-screen.test.ts).
 *
 * 🔴 **그래서 여기까지가 한계다.** 이 시험이 보는 것은 「그 판정이 코드에 그렇게
 * 적혀 있는가」이지 「눌렀더니 그렇게 되는가」가 아니다. 특히 **「왼쪽 블록을
 * 고치는 중에 오른쪽 블록이 그대로인가」는 글자로 잴 수 없다** — 여기서 볼 수
 * 있는 것은 상태가 Provider 컴포넌트 안에만 있고 모듈 수준에 새어 나가 있지
 * 않다는 사실까지다. 실제로 눌러 보는 것은 사람이 한다.
 *
 * ⚠️ 클래스 이름을 촘촘히 못 박지 않는다. 겨누는 것은 위 여덟이다 — 색이나 여백이
 * 바뀌었다고 깨지면 안 된다. 다만 `print:hidden` 과 고르개의 인쇄 변형들은
 * **겉모습이 아니라 종이에 무엇이 찍히는가**라 그대로 못 박는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 주석을 걷어낸 뒤에 본다. 이 파일들의 머리말은 `수정` · `저장` ·
 * `print:hidden` 을 **글로** 적고 있어, 원본 그대로 세면 설명 문장에 걸린다(이웃
 * weekly-report-width-frame-screen.test.ts 가 같은 자리에서 같은 일을 한다).
 */
const stripComments = (source: string) =>
  source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const blockEditSource = read("src/components/dashboard/WeeklyReportBlockStatusEdit.tsx");
const blockEdit = stripComments(blockEditSource);
const cellSource = read("src/components/dashboard/WeeklyReportStatusCell.tsx");
const cell = stripComments(cellSource);
const screenSource = read("src/components/dashboard/WeeklyReportScreen.tsx");
const screen = stripComments(screenSource);

/**
 * 최상위 함수 한 덩어리만 잘라낸다. 끝은 **맨 왼쪽 칸의 닫는 중괄호 + 줄바꿈**이다 —
 * 인자 자리를 여러 줄로 적으면 그 닫는 중괄호도 0칸에 오므로(`}: {` · `}) {`),
 * 뒤에 줄바꿈이 곧바로 오는 것만이 함수의 끝이다
 * (이웃 weekly-report-kind-filter-screen.test.ts 가 같은 함정을 적어 두었다).
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 2);
}

/**
 * 컴포넌트 **안**에 든 한 덩어리만 잘라낸다. 끝은 **두 칸 들여쓴 닫는 중괄호**다 —
 * 컴포넌트 본문 안의 함수와 분기는 닫는 중괄호가 두 칸에 서고, 그 안쪽의 `}` 는
 * 모두 네 칸 이상 들여쓰여 있다(`} finally {` 도 네 칸이다).
 */
function innerBlock(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 를 찾지 못했다`);
  const end = source.indexOf("\n  }\n", start);
  assert.notEqual(end, -1, `${declaration} 의 끝을 찾지 못했다`);
  return source.slice(start, end + 4);
}

/** 저장을 누르면 도는 덩어리. */
const save = innerBlock(blockEdit, "async function saveBlock() {");
/** 머리줄 버튼 묶음. */
const actions = functionBody(blockEdit, "export function WeeklyReportBlockStatusActions() {");

// ─────────────────────── 1. 🔴 줄마다의 `수정` 버튼이 사라졌다

describe("🔴 줄의 `현 상태` 칸", () => {
  test("칸에는 버튼이 하나도 없다 — 여는 것은 머리줄이다", () => {
    assert.ok(!cell.includes("<button"), cell);
    // `수정` 이라는 글자 자체가 이 파일에서 사라져야 한다(주석은 걷어낸 뒤다).
    assert.ok(!cell.includes("수정"), cell);
  });

  test("칸이 받는 prop 은 자기를 가리키는 id 하나다", () => {
    assert.match(
      flat(cell),
      /export default function WeeklyReportStatusCell\(\{ repairCaseId \}: \{ repairCaseId: string \}\)/
    );
    // version 과 rowStatus 는 Provider 가 줄 목록으로 들고 있다 — 칸이 또 받으면
    // router.refresh() 뒤 새 version 이 한쪽에만 들어온다.
    assert.ok(!cell.includes("version"), cell);
  });

  test("저장하는 길도 자기 state 도 없다 — 전부 Provider 로 갔다", () => {
    for (const moved of ["setWeeklyReportStatusAction", "showSavePopup", "useRouter", "useState"]) {
      assert.ok(!cell.includes(moved), `${moved} 가 칸에 남아 있다`);
    }
  });

  test("🔴 안 고칠 때는 고르개가 없다 — 손이 스쳐도 단계가 옮겨지지 않는다", () => {
    const resting = innerBlock(cell, "if (!isEditing) {");
    assert.ok(!resting.includes("<select"), resting);
    // 고르개는 편집 중일 때만 있다 — 파일 전체에 하나뿐이다.
    assert.equal(cell.match(/<select/g)?.length, 1, cell);
    // 못 고치는 사람이 보는 것과 똑같이 글자만이다.
    assert.match(
      flat(resting),
      /return <>\{rowStatus !== null && weeklyReportRowStatusLabels\[rowStatus\]\}<\/>;/
    );
  });

  test("🔴 분류 안 된 줄에는 글자를 적지 않는다 — 딱지는 부르는 쪽이 그린다", () => {
    const resting = innerBlock(cell, "if (!isEditing) {");
    assert.ok(!resting.includes("rowStatus ?? "), resting);
    assert.ok(!/분류/.test(resting), resting);
  });

  test("🔴 7칸 그대로다 — 집계의 6칸이 아니다", () => {
    assert.match(cell, /WEEKLY_REPORT_ROW_STATUSES\.map\(\(status\) =>/);
    assert.ok(!/\bWEEKLY_REPORT_STATUSES\b/.test(cell), cell);
    // 분류 안 된 줄의 빈 자리도 그대로다 — 아무 칸이나 골라 둔 것처럼 그리면
    // 이미 그 칸인 줄로 읽힌다.
    assert.match(flat(cell), /\{rowStatus === null && <option value="">선택<\/option>\}/);
  });

  test("오류는 **그 줄 아래**에 남는다 — 250줄 표에서 맨 위 알림은 아무도 못 본다", () => {
    assert.match(flat(cell), /\{error && \( <span role="alert"/);
    assert.ok(cell.indexOf("</select>") < cell.indexOf('role="alert"'), cell);
    // 표를 옆으로 밀지 않는다(`<tr>` 이 whitespace-nowrap 이다).
    assert.ok(cell.includes("whitespace-normal"), cell);
  });

  test("고르개는 지금까지와 같은 글자로 찍힌다 — 인쇄 변형 넷이 그대로다", () => {
    for (const variant of [
      "print:appearance-none",
      "print:border-0",
      "print:bg-transparent",
      "print:px-0",
    ]) {
      assert.ok(cell.includes(variant), `${variant} 가 사라졌다`);
    }
  });
});

// ─────────────────────────────── 2. 머리줄 버튼 — 🔴 고객사 블록에만

describe("🔴 머리줄 버튼", () => {
  test("평소 `수정`, 고치는 중에는 `취소`·`저장` 셋뿐이다", () => {
    assert.equal(blockEdit.match(/<button/g)?.length, 3, blockEdit);
    assert.match(flat(actions), /if \(!isEditing\) \{ return \( <button/);
    assert.match(flat(actions), /> 수정 <\/button>/);
    assert.match(flat(actions), /> 취소 <\/button>/);
    assert.match(flat(actions), /\{isSubmitting \? "저장 중\.\.\." : "저장"\}/);
  });

  test("🔴 낭독기용 이름에 고객사명이 들어간다 — sr-only 조각이 아니다", () => {
    for (const label of [
      "aria-label={`${blockLabel} 현 상태 수정`}",
      "aria-label={`${blockLabel} 현 상태 수정 취소`}",
      "aria-label={`${blockLabel} 현 상태 저장`}",
    ]) {
      assert.ok(flat(actions).includes(label), `${label} 이 없다`);
    }
    // sr-only 는 position:absolute 라, 위치 기준이 될 조상이 없으면 표 전체가 창
    // 스크롤을 하나 더 만든다(common/inline-edit-cell-button.ts 의 경고).
    assert.ok(!blockEdit.includes("sr-only"), blockEdit);
  });

  test("보내는 동안 버튼 둘이 잠긴다", () => {
    assert.equal(flat(actions).match(/disabled=\{isSubmitting\}/g)?.length, 2, actions);
  });

  test("🔴 고객사 블록 머리줄에만 넘어간다", () => {
    // 넘기는 자리는 한 곳뿐이고, 그 한 곳도 canEditStatus 일 때만이다.
    assert.equal(screen.match(/actions=/g)?.length, 1, screen);
    assert.ok(
      flat(screen).includes("actions={canEditStatus ? <WeeklyReportBlockStatusActions /> : undefined}"),
      screen
    );
    // 머리줄은 세 자리에서 쓰인다 — 나머지 둘에는 고칠 줄이 없다.
    assert.equal(screen.match(/<BlockHeading/g)?.length, 3, screen);
    assert.ok(!functionBody(screen, "function PoIssuanceBlock(").includes("actions"), screen);
  });

  test("🔴 안 넘기면 아무것도 그려지지 않는다 — 선택적 슬롯이다", () => {
    const heading = functionBody(screen, "function BlockHeading(");
    assert.match(heading, /actions\?: ReactNode;/);
    // 왼쪽 이름 묶음(h3)의 맨 끝이다 — 오른쪽 `총 대수` 와 겹치지 않는 자리.
    assert.ok(heading.indexOf("<h3") < heading.indexOf("{actions}"), heading);
    assert.ok(heading.indexOf("{actions}") < heading.indexOf("</h3>"), heading);
    // 이 줄은 접지 않는다 — 아래 집계와 상세표가 이 줄의 폭에 맞춘다.
    assert.ok(heading.includes("inline-flex shrink-0 items-baseline"), heading);
  });
});

// ──────────────────────────────── 3. 🔴 종이에 단추가 찍히지 않는다

describe("🔴 종이", () => {
  test("버튼 셋의 옷과 그 묶음에 print:hidden 이 있다", () => {
    for (const name of [
      "EDIT_BUTTON_CLASS",
      "CANCEL_BUTTON_CLASS",
      "SAVE_BUTTON_CLASS",
      "ACTIONS_GROUP_CLASS",
    ]) {
      const at = blockEdit.indexOf(`const ${name} =`);
      assert.notEqual(at, -1, `${name} 이 없다`);
      const value = blockEdit.slice(at, blockEdit.indexOf(";", at));
      assert.ok(value.includes("print:hidden"), `${name} 에 print:hidden 이 없다 — ${value}`);
    }
  });

  test("버튼 셋이 그 옷을 입는다 — 한 벌씩", () => {
    for (const name of ["EDIT_BUTTON_CLASS", "CANCEL_BUTTON_CLASS", "SAVE_BUTTON_CLASS"]) {
      assert.equal(blockEdit.match(new RegExp(`className=\\{${name}\\}`, "g"))?.length, 1, name);
    }
  });
});

// ─────────────────── 4. 🔴 저장 — 바뀐 줄만, 한 줄씩 차례로

describe("🔴 저장", () => {
  test("🔴 바뀐 줄만 고른다 — 비교 상대는 서버가 그려 준 값이다", () => {
    assert.match(flat(save), /for \(const row of rows\) \{/);
    assert.match(flat(save), /const selected = selectedById\.get\(row\.id\) \?\? row\.rowStatus \?\? "";/);
    assert.match(
      flat(save),
      /if \(!isWeeklyReportRowStatus\(selected\) \|\| selected === row\.rowStatus\) continue;/
    );
  });

  test("🔴 하나도 없으면 서버 액션을 아예 부르지 않고 닫는다", () => {
    assert.match(flat(save), /if \(changed\.length === 0\) \{ closeEditor\(\); return; \}/);
    // 그 판정이 **보내기보다 앞**이어야 한다. 뒤로 가면 보낸 뒤에 되묻는 꼴이다.
    assert.ok(
      save.indexOf("changed.length === 0") < save.indexOf("setWeeklyReportStatusAction("),
      save
    );
  });

  test("🔴 한 줄씩 차례로다 — 몰아 보내지 않는다", () => {
    assert.match(
      flat(save),
      /for \(const target of changed\) \{ const result = await setWeeklyReportStatusAction\(\{ repairCaseId: target\.id, expectedVersion: target\.version, status: target\.status, \}\);/
    );
    assert.ok(!/Promise\.(all|allSettled|race)/.test(blockEdit), blockEdit);
    // 보낼 곳은 한 군데뿐이다 — 일괄 저장용 새 서버 액션을 만들지 않았다.
    assert.equal(blockEdit.match(/setWeeklyReportStatusAction\(/g)?.length, 1, blockEdit);
  });

  test("🔴 expectedVersion 은 props 의 값이다 — state 에 복사하지 않는다", () => {
    // 복사해 두면 router.refresh() 가 내려준 새 version 을 못 보고 낙관적 잠금에
    // 걸린다. rows 도 rowById 도 매 렌더 props 에서 다시 만든다.
    assert.match(blockEdit, /const rowById = new Map\(rows\.map\(/);
    assert.ok(!/useState[^\n]*\brows\b/.test(blockEdit), blockEdit);
    assert.ok(!/useState[^\n]*version/.test(blockEdit), blockEdit);
  });

  test("🔴 하나라도 실패하면 닫지도 되돌리지도 않고, 성공 팝업도 안 띄운다", () => {
    assert.match(flat(save), /failures\.set\(target\.id, result\.message\); continue;/);
    assert.match(flat(save), /if \(failures\.size > 0\) \{ return; \}/);
    // 그 return 이 팝업과 닫기보다 **앞**이어야 한다.
    assert.ok(save.indexOf("failures.size > 0") < save.indexOf("showSavePopup("), save);
    // 되돌리는 일은 `취소` 하나가 맡는다 — 저장 쪽에는 그 줄이 아예 없다.
    assert.ok(!save.includes("setSelectedById"), save);
  });

  test("🔴 일부만 성공해도 router.refresh() 는 부른다", () => {
    assert.match(flat(save), /if \(savedCount > 0\) router\.refresh\(\);/);
    // refresh 가 실패 분기보다 앞이어야 일부 성공일 때도 화면이 사실과 맞는다.
    assert.ok(save.indexOf("router.refresh()") < save.indexOf("failures.size > 0"), save);
  });

  test("전부 성공하면 몇 건인지 알리고 닫는다", () => {
    const ok = flat(save.slice(save.indexOf("showSavePopup(")));
    assert.ok(ok.includes("${savedCount}건을 변경했습니다."), ok);
    assert.ok(ok.includes("redirectTo: null"), ok);
    assert.match(ok, /closeEditor\(\);/);
  });

  test("보내는 동안 두 번 눌리지 않는다", () => {
    assert.match(flat(save), /if \(isSubmitting\) return;/);
    assert.match(flat(save), /setIsSubmitting\(true\);/);
    assert.match(flat(save), /finally \{ setIsSubmitting\(false\); \}/);
  });
});

// ────────────────────────────── 5. 취소 — 되돌리는 쪽은 여기다

describe("취소", () => {
  test("고른 값과 오류를 전부 버리고 닫는다", () => {
    // 손댄 줄만 들고 있으므로, 비우는 것이 곧 서버 값으로 되돌리는 일이다.
    assert.match(
      flat(innerBlock(blockEdit, "function closeEditor() {")),
      /setSelectedById\(new Map\(\)\); setErrorById\(new Map\(\)\); setIsEditing\(false\);/
    );
    assert.match(flat(innerBlock(blockEdit, "function cancelEditor() {")), /closeEditor\(\);/);
  });

  test("🔴 열 때마다 서버가 방금 그려 준 값에서 다시 시작한다", () => {
    assert.match(
      flat(innerBlock(blockEdit, "function openEditor() {")),
      /setSelectedById\(new Map\(\)\); setErrorById\(new Map\(\)\); setIsEditing\(true\);/
    );
  });

  test("🔴 블록 밖으로 새는 상태가 없다 — 모듈 수준 변수를 두지 않는다", () => {
    // 글자로 잴 수 있는 데까지다(파일 머리말). `let` 이 모듈 꼭대기에 서면 블록
    // 하나를 고칠 때 옆 블록까지 따라 열린다.
    assert.ok(!/^let /m.test(blockEdit), blockEdit);
    assert.ok(!/^var /m.test(blockEdit), blockEdit);
  });
});

// ───────────────────── 6. 부르는 쪽 — 🔴 못 고치는 사람에게는 안 그린다

describe("부르는 쪽(WeeklyReportScreen)", () => {
  test("🔴 canEditStatus 가 거짓이면 Provider 자체를 두르지 않는다", () => {
    const blockBody = functionBody(screen, "function ReportBlock(");
    assert.match(
      flat(blockBody),
      /\{canEditStatus \? \( <WeeklyReportBlockStatusProvider blockLabel=\{block\.customerName\} rows=\{statusRows\}> \{body\} <\/WeeklyReportBlockStatusProvider> \) : \( body \)\}/
    );
    // 줄 목록도 그때만 만든다 — 접수 건 id 와 version 이 그 브라우저로 내려가면
    // 안 된다.
    assert.match(flat(blockBody), /const statusRows = canEditStatus \? block\.rows\.map\(/);
    assert.ok(flat(blockBody).includes(": [];"), blockBody);
  });

  test("못 고치는 사람에게는 칸도 아예 그리지 않는다", () => {
    const statusCell = functionBody(screen, "function StatusCell(");
    assert.match(statusCell, /if \(!canEdit\) \{/);
    assert.ok(
      statusCell.indexOf("if (!canEdit) {") < statusCell.indexOf("<WeeklyReportStatusCell"),
      statusCell
    );
    assert.match(flat(statusCell), /<WeeklyReportStatusCell repairCaseId=\{row\.id\} \/>/);
  });

  test("🔴 거짓이 된 주석이 남아 있지 않다 — 그 자리에는 이제 버튼이 없다", () => {
    // 줄마다 버튼이 있던 시절의 설명들.
    assert.ok(!screenSource.includes("그 자리가 **고르개**가 된다"), screenSource);
    assert.ok(!screenSource.includes("그 글자 옆에 **`수정` 버튼**이 붙고"), screenSource);
    assert.ok(!screenSource.includes("그 옆에 `수정` 버튼을 둔다"), screenSource);
    // 되돌린 경위가 남아 있어야 한다 — 바로 몇 시간 전 결정이 또 바뀐 자리다.
    assert.ok(screenSource.includes("고치는 단위는 칸이 아니라 블록이다"), screenSource);
    for (const source of [blockEditSource, cellSource]) {
      assert.ok(source.includes("2026-10-05 사용자 요청"), source.slice(0, 400));
      assert.ok(source.includes("번거롭다"), source.slice(0, 400));
    }
  });
});
