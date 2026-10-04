import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 주간보고 가로폭 — 폭 스타일이 걸리는 자리는 본문 하나뿐이다
 * ============================================================================
 * 값(40~100 · 격자 1% · 단추 5%)은 도메인 시험이 못 박는다
 * (lib/domain/weekly-report-table-width.test.ts). **여기서 보는 것은 한 가지
 * 사실뿐**이다 — 폭 스타일이 본문에만 걸리고, 조절 바에는 걸리지 않는다.
 *
 * ── 왜 이 하나를 지키는가 ───────────────────────────────────────────────
 * 조절 바에도 같은 폭을 걸어 두면, 폭을 줄일 때 **조절 바 자체가 좁아지며
 * 가운데로 끌려온다.** 그러면 끌고 있는 손잡이가 커서 밑에서 달아난다 —
 * 2026-10-04 실측으로 100%에서 왼쪽으로 20px 끌었는데 트랙이 반대로 99px 달아나
 * 89%(있어야 할 값은 92~93%)로 튀었고, 조금 더 끌면 끝까지 가 버렸다.
 * 「조절 바도 본문과 같은 폭 안에 두는 편이 보기 좋다」며 되돌리면 그 고장이
 * 그대로 돌아온다. 이 시험이 그때 깨진다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 이 상자가 감싸는 WeeklyReportScreen 은 서버 컴포넌트 사슬이라 통째로 렌더할 수
 * 없다(이웃 weekly-report-kind-filter-screen.test.ts 머리말에 까닭이 적혀 있다).
 * 같은 방법으로 원본을 글자로 읽는다.
 *
 * ⚠️ **클래스 이름을 촘촘히 못 박지 않는다.** 겨누는 것은 「폭 스타일이 어디에
 * 걸려 있는가」 하나다 — 배경색이나 모서리가 바뀌었다고 깨지면 안 된다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const frameSource = read("src/components/dashboard/WeeklyReportWidthFrame.tsx");

/**
 * 🔴 주석을 걷어낸 뒤에 센다. 이 파일의 머리말과 조절 바 위 주석은 `print:hidden`
 * 도 `widthStyle` 도 **글로** 적고 있어, 원본 그대로 세면 설명 문장에 걸린다.
 */
const frame = frameSource
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

describe("주간보고 가로폭 — 폭 스타일이 걸리는 자리", () => {
  test("폭 스타일을 쓰는 요소는 하나뿐이고, 그것이 본문을 감싼 요소다", () => {
    assert.equal(
      frame.match(/style=\{widthStyle\}/g)?.length,
      1,
      "폭 스타일이 걸린 요소가 하나가 아니다"
    );
    // 그 하나가 children 을 감싼 쪽인지까지 본다 — 「하나뿐」만으로는 조절 바에만
    // 남기고 본문에서 떼어낸 반대의 고장을 못 잡는다.
    assert.match(flat(frame), /style=\{widthStyle\}>\s*\{children\}/);
  });

  test("🔴 조절 바를 감싼 요소에는 폭 스타일이 없다 — 폭을 바꿔도 조절 바가 안 움직인다", () => {
    const at = frame.indexOf("print:hidden");
    assert.notEqual(at, -1, "조절 바의 print:hidden 이 사라졌다 — 종이에 단추가 찍힌다");
    // print:hidden 이 든 여는 태그 하나만 잘라 본다.
    const openTag = frame.slice(frame.lastIndexOf("<", at), frame.indexOf(">", at) + 1);
    assert.ok(!openTag.includes("style="), openTag);
  });

  test("🔴 화면에 붙박지 않는다 — fixed · sticky 가 아니다", () => {
    // 「오른쪽 위 고정」은 **폭이 바뀌어도 움직이지 않는다**는 뜻이다. 스크롤을
    // 따라다니게 만들면 인쇄와 배치에 번진다.
    assert.ok(!/className="[^"]*\b(fixed|sticky)\b/.test(frame), frame);
  });
});
