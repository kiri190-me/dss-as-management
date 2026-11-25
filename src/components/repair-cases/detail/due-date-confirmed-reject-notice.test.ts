import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 **거절 문구가 사람에게 닿는 길** — 읽어야 닫히는 알림인가 (2026-11-25)
 * ============================================================================
 * 사용자 결정 원문: 「**거절하되 왜 거절되는지 팝업으로** 알려주도록 해」.
 *
 * 연결된 내자 회차의 납기일이 확정돼 있으면 수리 건의 고객 요청 납기일 저장이
 * 거절된다(db/mutations/repair-cases.ts). 그 거절은 **보낸 값에 흠이 있어서가 아니라
 * 다른 화면에 걸린 잠금** 때문이고, 해야 할 일도 그 다른 화면에 있다 — [내자 정리]
 * 에서 [확정 해제]. 그래서 칸 밑 한 줄로는 전해지지 않는다.
 *
 * ── 🔴 **가장 쉽게 틀리는 자리** ────────────────────────────────────────
 * 🔴 이 저장소의 **저장 팝업(SavePopup)은 성공 전용이고 0.5초 뒤 저절로 닫힌다.**
 * 읽어야 하는 글에 그것을 쓰면 **사람이 글자를 못 읽는다**(components/common/
 * NoticePopup.tsx 머리말 — 이 저장소에서 실제로 겪은 일이다). 그래서 이 파일은
 * 「알림이 뜨는가」만이 아니라 **어느 팝업인가**를 잰다.
 *
 * ── 🔴 못 박는 것 다섯 ──────────────────────────────────────────────────
 *  ① 🔴 **코드로 가른다** — 문장을 글자로 재면 문구를 다듬는 날 조용히 안 걸린다.
 *  ② 🔴 **거절 갈래 안**이다 — 성공 갈래로 새면 저장이 안 됐는데 폼이 닫히고
 *     「저장했습니다」가 뜬다. `router.refresh()` · `onDone()` · `showSavePopup` 셋이
 *     그 갈래 **뒤**에 있어야 한다.
 *  ③ 🔴 **끊기지 않고 이어진다** — 훅 → 폼 → 구역 → 상세 화면.
 *  ④ 🔴 **NoticePopup 이다**(SavePopup 이 아니다). 상세 화면이 띄우고, 폼·구역은
 *     제 안에서 안 띄운다 — 폼은 열려 있지만 구역이 다시 그려질 수 있다.
 *  ⑤ 🔴 **제목이 「저장은 됐는데 못 맞췄다」 쪽과 다르다.** 둘을 한 상자에 담으면
 *     제목 하나가 정반대인 두 사실을 가리키고, 사람은 자기 저장이 됐는지를 못 읽는다.
 *
 * 🔴 값은 전부 지어낸 것이다 — 실제 고객사·L/N·S/N 은 한 글자도 쓰지 않는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

/**
 * 🔴 **세기 전에 주석을 걷는다.** 이 저장소는 「왜 그렇게 했는가」를 길게 적고 그 글에
 * 부품 이름과 코드가 그대로 들어 있다 — 날것으로 세면 **주석만으로 통과**한다.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/^[ \t]*\/\/[^\n]*$/gm, " ")
    .replace(/\/\/[^\n]*$/gm, " ");

const hook = stripComments(read("src/components/repair-cases/detail/edit/useSectionEditSubmit.ts"));
const intakeForm = stripComments(
  read("src/components/repair-cases/detail/edit/IntakeInfoEditForm.tsx")
);
const intakeSection = stripComments(read("src/components/repair-cases/detail/IntakeInfoSection.tsx"));
const detailView = stripComments(read("src/components/repair-cases/detail/RepairCaseDetailView.tsx"));
/** 코드 글자 그대로의 상세 화면 — 주석을 걷지 않은 판(JSX 주석까지 걷히면 셀 것이 없다). */
const detailViewRaw = read("src/components/repair-cases/detail/RepairCaseDetailView.tsx");

const CODE = "DOMESTIC_ORDER_DUE_DATE_CONFIRMED";
const CALLBACK = "onSaveBlockedByConfirmedDueDate";

describe("표본 점검 — 네 파일이 정말 그 자리다", () => {
  test("훅·폼·구역·상세가 비어 있지 않고 각자 제 몫을 들고 있다", () => {
    assert.ok(hook.includes("useSectionEditSubmit"), "훅이 아니다");
    assert.ok(intakeForm.includes("useSectionEditSubmit({"), "인수정보 편집 폼이 아니다");
    assert.ok(intakeSection.includes("<IntakeInfoEditForm"), "인수 정보 구역이 아니다");
    assert.ok(detailView.includes("<IntakeInfoSection"), "상세 화면이 아니다");
  });
});

describe("🔴 ①② 거절을 **코드로** 가르고, **거절 갈래 안**에서만 알린다", () => {
  test("🔴 ① 코드로 가른다 — 문장을 글자로 재지 않는다", () => {
    assert.match(flat(hook), new RegExp(`if \\(result\\.code === "${CODE}"\\) \\{ params\\.${CALLBACK}\\?\\.\\(result\\.message\\); \\}`));
    // 🔵 문장을 글자로 재고 있으면 안 된다 — 거절 문구의 주인은 도메인 한 곳이다.
    assert.equal(
      hook.includes("확정 해제"),
      false,
      "훅이 거절 문장을 글자로 재고 있다 — 문구를 다듬는 날 조용히 안 걸린다"
    );
  });

  test("🔴 ② 성공 갈래로 새지 않는다 — 저장이 안 됐는데 폼이 닫히면 입력이 사라진다", () => {
    const gateAt = hook.indexOf(`result.code === "${CODE}"`);
    assert.ok(gateAt > 0, "거절 갈래를 찾지 못했다");
    for (const marker of ["router.refresh();", "params.onDone();", "showSavePopup("]) {
      const at = hook.indexOf(marker);
      assert.ok(at > 0, `훅에서 '${marker}' 를 찾지 못했다 — 표본이 비었다`);
      assert.ok(
        at > gateAt,
        `'${marker}' 가 거절 갈래보다 앞에 있다 — 거절한 저장이 성공처럼 끝난다`
      );
    }
    // 🔴 **저장 팝업은 성공 전용**이다(0.5초 뒤 닫힌다) — 거절에 쓰면 글자를 못 읽는다.
    const rejectBlock = hook.slice(gateAt, hook.indexOf("return;", gateAt));
    assert.equal(
      rejectBlock.includes("showSavePopup"),
      false,
      "거절을 저장 팝업으로 알린다 — 그 팝업은 성공 전용이고 저절로 닫힌다"
    );
  });
});

describe("🔴 ③ 훅 → 폼 → 구역 → 상세 화면까지 **끊기지 않는다**", () => {
  test("자리마다 같은 이름으로 이어진다", () => {
    assert.match(hook, new RegExp(`${CALLBACK}\\?: \\(message: string\\) => void;`));
    assert.match(intakeForm, new RegExp(`${CALLBACK}: \\(message: string\\) => void;`));
    assert.match(flat(intakeForm), new RegExp(`useSectionEditSubmit\\(\\{[^;]*${CALLBACK}, \\}\\);`));
    assert.match(intakeSection, new RegExp(`${CALLBACK}: \\(message: string\\) => void;`));
    assert.match(
      flat(intakeSection),
      new RegExp(`<IntakeInfoEditForm[^>]*${CALLBACK}=\\{${CALLBACK}\\}`)
    );
    assert.match(
      flat(detailView),
      new RegExp(`<IntakeInfoSection[^>]*${CALLBACK}=\\{setDueDateConfirmBlocked\\}`)
    );
  });

  test("🔴 같은 훅을 쓰는 다른 넷은 이 자리를 채우지 않는다 — 고객 요청 납기일을 안 보낸다", () => {
    for (const name of [
      "ProductInfoEditForm.tsx",
      "FaultServiceEditForm.tsx",
      "EngineerEditCell.tsx",
      "ReportNumberEditCell.tsx",
    ]) {
      const source = read(`src/components/repair-cases/detail/edit/${name}`);
      assert.equal(
        source.includes(CALLBACK),
        false,
        `${name} 이 거절 알림을 받는다 — 이 구역은 고객 요청 납기일을 보내지 않는다`
      );
    }
  });
});

describe("🔴 ④⑤ **NoticePopup** 이고, 제목이 저쪽과 다르다", () => {
  test("🔴 ④ 상세 화면이 **읽어야 닫히는 알림**으로 띄운다", () => {
    assert.match(
      detailView,
      /const \[dueDateConfirmBlocked, setDueDateConfirmBlocked\] = useState<string \| null>\(null\);/
    );
    assert.match(
      flat(detailView),
      /\{dueDateConfirmBlocked !== null && \( <NoticePopup title="저장하지 않았습니다" lines=\{dueDateConfirmBlocked\.split\("\\n\\n"\)\} onClose=\{\(\) => setDueDateConfirmBlocked\(null\)\} \/> \)\}/
    );
    // 🔴 폼과 구역에는 대화상자가 없어야 한다 — 거기서 띄우면 다시 그려질 때 사라진다.
    //    🔵 **여는 꺾쇠**로 센다: 주석이 그 부품을 까닭으로 들 수 있다.
    assert.doesNotMatch(intakeForm, /<NoticePopup/, "편집 폼이 제 안에서 알림을 그린다");
    assert.doesNotMatch(intakeSection, /<NoticePopup/, "인수 정보 구역이 제 안에서 알림을 그린다");
  });

  test("🔴 ⑤ 「저장은 됐는데 못 맞췄다」 쪽과 **다른 상자**다 — 제목도 상태도", () => {
    // 전제: 저쪽 상자가 지금도 있어야 「다르다」가 뜻을 가진다.
    assert.ok(
      detailView.includes('title="내자 정리의 날짜는 바뀌지 않았습니다"'),
      "묶기 실패 알림이 사라졌다 — 비교할 짝이 없다"
    );
    assert.ok(
      detailView.includes("requestedDueDateNotLinked"),
      "묶기 실패 상태가 사라졌다 — 비교할 짝이 없다"
    );
    // 🔴 상자가 둘, 제목이 둘, 상태가 둘이다. 하나로 합치면 제목 하나가 정반대인
    //    두 사실(저장됨 · 저장 안 됨)을 가리킨다.
    assert.equal(
      detailViewRaw.split("<NoticePopup").length - 1,
      2,
      "상세 화면의 알림 상자가 둘이 아니다"
    );
    assert.notEqual(
      "저장하지 않았습니다",
      "내자 정리의 날짜는 바뀌지 않았습니다",
      "두 제목이 같은 말이면 가를 뜻이 없다"
    );
  });
});
