import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 「이 제품의 과거 A/S 이력」 접기 — 가장 최근 1건만 펴 둔다 (2026-09-17 요구)
 * ============================================================================
 * 오래 쓴 제품은 이력이 열 건을 넘기도 해서, 그 목록이 제품 정보 칸 아래로
 * 화면 한 판을 밀어내고 있었다. 이제 가장 최근 1건만 펴 두고 나머지는 접는다.
 *
 * ── 왜 렌더하지 않고 원본을 글자로 읽는가 ──────────────────────────────────
 * ProductInfoSection 은 ProductInfoEditForm → useSectionEditSubmit →
 * @/lib/server/actions/update-repair-case 로 이어지는 사슬을 물고 있어서,
 * react-server 조건 없이 도는 test:components 에서는 **import 자체가 던진다.**
 * 이웃 시험(approval/approval-screen-layout.test.tsx ·
 * files/StoredAttachmentList.test.tsx)이 같은 자리에서 쓰는 방법을 그대로 쓴다.
 *
 * ── 여기서 못 박는 것 ──────────────────────────────────────────────────────
 *  1. <details>/<summary> 를 쓰지 않는다 — 까닭은 FilterDisclosure 헤더에 있다.
 *  2. aria-controls 가 가리킬 id 는 useId 로 만든다. 고정 문자열을 박으면 한
 *     문서에 같은 id 가 둘 생긴다(대시보드 두 패널이 주석으로 남긴 사고).
 *  3. 접힐 것이 없으면(이력 1건 이하) 토글 단추를 아예 그리지 않는다.
 *  4. 접혀 있어도 전체 건수 문구는 남는다 — 몇 건인지는 펼치지 않고도 알아야 한다.
 *  5. 기본은 접힘이다.
 *  6. 이력 한 줄의 세 줄 구성과 정렬 규칙은 건드리지 않았다.
 *
 * ── 이력 줄을 누르면 팝업이 떴다가 넘어간다 (2026-09-17 요구) ───────────────
 *  7. 저장·등록이 쓰던 showSavePopup 을 그대로 부른다 — 새 팝업·새 토스트를
 *     만들지 않았고, 떠 있는 시간도 save-popup.ts 의 상수 몫이라 여기서 다시
 *     재지 않는다(setTimeout 도, router.push 도 없다).
 *  8. redirectTo 는 그 건의 주소다. null 이면 0.5초 뒤 팝업만 닫히고 누르기 전
 *     화면이 그대로 남는다 — 상세가 서버에서 오는 데 시간이 걸리기 때문이다.
 *  9. <Link href> 는 그대로 남아 있고, 가로채는 것은 평범한 왼쪽 클릭뿐이다 —
 *     수식 키(⌘·Ctrl·Shift·Alt)나 왼쪽이 아닌 단추는 새 탭·새 창으로 열기라
 *     손대지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const source = readFileSync(
  new URL("src/components/repair-cases/detail/ProductInfoSection.tsx", repoUrl),
  "utf8"
);

/**
 * 주석을 뺀 원본. 그 파일의 주석이 "<details>/<summary> 를 쓰지 않는다" 라고
 * **글자로** 적어 두고 있어서, 그냥 찾으면 그 문장에 걸린다. 실제로 그린
 * 자리만 보려면 주석을 먼저 지워야 한다. JSX 안의 중괄호 주석도 블록 주석이라
 * 같은 규칙으로 함께 지워진다. 아래 단언은 모두 이 글자를 본다.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = code.replace(/\s+/g, " ");

describe("제품 정보 — 과거 A/S 이력 접기", () => {
  test("<details>/<summary> 를 쓰지 않는다", () => {
    assert.ok(!code.includes("<details"), "<details> 를 쓰면 안 된다 (FilterDisclosure 헤더)");
    assert.ok(!code.includes("<summary"), "<summary> 를 쓰면 안 된다 (FilterDisclosure 헤더)");
  });

  test("토글은 상태 하나 + aria-expanded/aria-controls 로 푼다", () => {
    assert.match(flat, /aria-expanded=\{isHistoryExpanded\}/);
    assert.match(flat, /aria-controls=\{olderHistoryId\}/);
  });

  test("aria-controls 가 가리킬 id 는 useId 로 만든다 — 고정 문자열이 아니다", () => {
    assert.match(flat, /const olderHistoryId = useId\(\);/);
    assert.ok(
      !/aria-controls="/.test(code),
      "aria-controls 에 고정 문자열을 박으면 한 문서에 같은 id 가 둘 생긴다"
    );
  });

  test("기본은 접힘이다", () => {
    assert.match(flat, /const \[isHistoryExpanded, setIsHistoryExpanded\] = useState\(false\);/);
  });

  test("이력이 1건 이하이면 토글을 그리지 않는다", () => {
    // 접히는 건수 = 첫 줄을 뺀 나머지. 0건·1건이면 0 이라 아래 조건이 거짓이 된다.
    assert.match(flat, /const olderCount = Math\.max\(related\.length - 1, 0\);/);
    assert.match(flat, /\{olderCount > 0 && \(/);
  });

  test("가장 최근 1건은 늘 보이고, 나머지만 접힌다", () => {
    assert.match(flat, /<HistoryItem item=\{related\[0\]\}/);
    assert.match(flat, /related\.slice\(1\)\.map\(/);
  });

  test("접힌 몸통은 지우지 않고 hidden 으로 둔다 — aria-controls 가 가리킬 곳이 있어야 한다", () => {
    assert.match(flat, /isHistoryExpanded \? "flex" : "hidden"/);
  });

  test("접혀 있어도 전체 건수 문구는 남는다", () => {
    assert.match(flat, /이 제품의 과거 A\/S 이력: \{related\.length\}건/);
    assert.ok(code.includes("동일 장비의 이전 A/S 이력이 없습니다."));
  });

  test("토글 글자가 접힘·펼침을 말한다", () => {
    assert.ok(code.includes("이전 이력 접기"));
    assert.match(flat, /이전 이력 \$\{olderCount\}건 더 보기/);
  });

  test("이력 한 줄의 세 줄 구성은 그대로다", () => {
    assert.match(flat, /<SourceBadge source=\{item\.source\} \/>/);
    assert.match(flat, /<HistoryLine label="신고증상" value=\{item\.reportedSymptom\} \/>/);
    assert.match(flat, /<HistoryLine label="조치 내용" value=\{actionSummary\} \/>/);
  });

  test("정렬을 여기서 다시 하지 않는다 — 목록의 첫 줄이 곧 가장 최근 건이다", () => {
    assert.ok(!/\.sort\(/.test(code), "정렬은 조회 몫이다 (접수일 내림차순)");
    assert.ok(!/\.reverse\(/.test(code));
  });
});

describe("제품 정보 — 이력 줄을 누르면 팝업이 떴다가 그 건으로 넘어간다", () => {
  test("이미 있는 저장 팝업을 부른다 — 새 팝업·새 토스트를 만들지 않았다", () => {
    assert.match(flat, /import \{ showSavePopup \} from "@\/components\/common\/SavePopup";/);
    assert.match(flat, /showSavePopup\(\{ message: "이전 이력으로 이동합니다\.",/);
    // 팝업을 직접 그리려 든 흔적이 없어야 한다 — 그리는 자리는 (app)/layout.tsx 하나뿐이다.
    assert.ok(!code.includes("<dialog"), "팝업은 SavePopup.tsx 가 그린다");
    assert.ok(!/createPortal|SavePopupHost|Toast|toast/.test(code));
  });

  test("한 곳에서만 부른다 — 펴 둔 1건과 접힌 나머지가 같은 HistoryItem 을 쓴다", () => {
    assert.equal(code.match(/showSavePopup\(/g)?.length, 1);
  });

  test("넘어갈 곳은 그 건의 주소다 — null 이 아니다", () => {
    assert.match(flat, /redirectTo: `\/repair-cases\/\$\{item\.id\}`,? \}\)/);
    assert.ok(
      !/redirectTo: null/.test(code),
      "null 이면 팝업만 닫히고 누르기 전 화면이 그대로 남는다(상세는 서버에서 온다)"
    );
  });

  test("0.5초를 이 파일에서 다시 재지 않는다 — 기다리는 것도 넘기는 것도 팝업 몫이다", () => {
    assert.ok(!/setTimeout|setInterval/.test(code), "떠 있는 시간은 SAVE_POPUP_VISIBLE_MS 다");
    assert.ok(!/SAVE_POPUP_VISIBLE_MS/.test(code));
    assert.ok(!/router\.push|useRouter/.test(code), "넘기는 것은 팝업이 한다");
  });

  test("<Link href> 는 그대로 남아 있다", () => {
    assert.match(flat, /<Link href=\{`\/repair-cases\/\$\{item\.id\}`\}/);
  });

  test("가로채는 것은 평범한 왼쪽 클릭뿐이다 — 수식 키·다른 단추는 그대로 둔다", () => {
    assert.match(
      flat,
      /event\.button === 0 && !event\.metaKey && !event\.ctrlKey && !event\.shiftKey && !event\.altKey/
    );
    // 막는 것은 가로챌 때뿐이다 — 가드가 preventDefault 앞에 있다.
    assert.match(flat, /if \(!isPlainLeftClick\(event\)\) return; event\.preventDefault\(\);/);
    assert.equal(code.match(/preventDefault\(\)/g)?.length, 1);
  });
});
