import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 막는다** — 두 화면의 이음새 (2026-11-01)
 * ============================================================================
 * 규칙 자체는 값으로 돈다(lib/domain/unsaved-leave-guard.test.ts). 여기서 재는 것은
 * **화면이 그 장치에 제대로 꽂혀 있는가**다 — 꽂히지 않으면 규칙이 아무리 옳아도
 * 아무 일도 일어나지 않고, 그 증상은 「나가기를 눌렀더니 그냥 나갔다」이다.
 *
 * 🔴 **브라우저에서 Alt+← 를 눌러 볼 수 없는 자리**라 소스를 글자로 읽는다 —
 * 이웃들과 같은 방법이다(save-popup-screens.test.ts · service-report-cancel-screen).
 *
 * 못 박는 것:
 *   1. 🔴 두 화면이 **훅 하나**를 쓴다(뒤로가기 · 탭 닫기를 제 손으로 다루지 않는다).
 *   2. 🔴 나가는 문이 **빠짐없이** 그 훅을 지난다 — 묻지 않고 빠져나가는 문이 없다.
 *   3. 🔴 저장 팝업이 **발판을 걷고** 넘어간다.
 *   4. 🔴 **그 둘 말고는 아무 화면도** historyMode 를 적지 않는다(기본값 push 그대로).
 *   5. 🔴 저장에 성공하면 **기준선을 곧바로 갱신**한다.
 * ============================================================================
 */

const QUOTE = "src/components/quotes/QuoteEditForm.tsx";
const REPORT = "src/components/repair-cases/report/service-report/ServiceReportForm.tsx";
const GUARD = "src/components/common/useUnsavedLeaveGuard.ts";

/** 주석을 걷어낸 코드 — 머리말이 설명하느라 적은 낱말에 걸리지 않게. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** 공백을 한 칸으로 접은 것 — 여러 줄에 걸쳐 적힌 호출을 한 글자로 견주려고. */
function flatOf(path: string): string {
  return codeOf(path).replace(/\s+/g, " ");
}

describe("🔴 ① 두 화면이 **같은 장치 하나**를 쓴다", () => {
  for (const path of [QUOTE, REPORT]) {
    test(`${path} — 뒤로가기 · 탭 닫기를 제 손으로 다루지 않는다`, () => {
      const code = codeOf(path);
      assert.ok(code.includes("useUnsavedLeaveGuard({"), `${path} 가 훅을 안 쓴다`);
      /**
       * 🔴 화면이 직접 다루기 시작하면 **같은 일을 두 곳이** 하게 되고, 그때부터 한쪽만
       * 고쳐진다. 흐름도 편집기 둘이 각자 `beforeunload` 를 가진 것이 지금 그 꼴인데,
       * 그쪽은 이 창이 없어 이 장치의 대상이 아니다.
       */
      for (const forbidden of ["popstate", "beforeunload", "history.pushState", "history.back"]) {
        assert.equal(code.includes(forbidden), false, `${path} 가 ${forbidden} 를 따로 다룬다`);
      }
    });
  }

  test("🔴 장치는 나가는 길 셋을 **한 파일**에서 다룬다 — 거울로 같은 값을 읽는다", () => {
    const guard = codeOf(GUARD);
    for (const needed of [
      "popstate",
      "beforeunload",
      "window.history.pushState",
      "dirtyRef.current = params.dirty",
    ]) {
      assert.ok(guard.includes(needed), `장치에 ${needed} 가 없다`);
    }
    // 🔴 리스너가 읽는 값이 거울이 아니라 클로저면 **첫 렌더의 거짓에 영영 묶인다.**
    assert.equal(
      /addEventListener\("(popstate|beforeunload)"[\s\S]*?params\.dirty/.test(guard),
      false,
      "리스너가 거울이 아니라 props 를 직접 읽는다"
    );
  });
});

describe("🔴 ② 나가는 문이 빠짐없이 그 장치를 지난다", () => {
  test("견적서 — 나가는 단추 셋이 전부 같은 문이다", () => {
    const flat = flatOf(QUOTE);
    // [취소] · 못 올린 첨부의 [목록으로] · PDF 변환 결과의 나가기.
    assert.equal(
      (flat.match(/onClick=\{leaveGuard\.requestLeave\}/g) ?? []).length,
      2,
      "나가는 단추 가운데 묻지 않는 것이 있다"
    );
    assert.ok(flat.includes("onLeave={leaveGuard.requestLeave}"), flat.slice(0, 200));
    /**
     * 🔴 **돌아갈 주소로 그냥 미는 길이 남아 있으면** 그 문은 묻지 않는다. 옛 모양은
     * `onClick={() => router.push(returnHref ?? "/quotes")}` 였다.
     */
    assert.equal(
      /router\.push\(returnHref/.test(flat),
      false,
      "묻지 않고 빠져나가는 문이 남아 있다"
    );
  });

  test("보고서 — [취소] · 머리의 [보고서 탭으로] · PDF 안내의 나가기", () => {
    const flat = flatOf(REPORT);
    assert.ok(flat.includes("onCancel={leaveGuard.requestLeave}"), "단추 줄이 안 묻는다");
    assert.ok(flat.includes("onClick={leaveGuard.requestLeave}"), "머리의 나가기가 안 묻는다");
    assert.ok(flat.includes("onLeave={leaveGuard.requestLeave}"), "PDF 안내의 나가기가 안 묻는다");
    // 🔴 `router.push(reportHref)` 로 그냥 미는 길이 남아 있으면 안 된다.
    assert.equal(/router\.push\(reportHref\)/.test(flat), false, flat.slice(0, 200));
  });

  test("🔴 창의 단추 셋이 전부 꽂혀 있다 — 하나라도 비면 죽은 단추가 된다", () => {
    for (const path of [QUOTE, REPORT]) {
      const flat = flatOf(path);
      for (const wiring of [
        "isOpen={leaveGuard.asking}",
        "onSave={leaveGuard.saveAndLeave}",
        "onLeave={leaveGuard.leaveWithoutSaving}",
        "onCancel={leaveGuard.dismiss}",
      ]) {
        assert.ok(flat.includes(wiring), `${path}: ${wiring} 가 없다`);
      }
    }
  });

  test("🔴 [저장]은 **지금 저장 흐름을 그대로** 탄다 — 새 길을 짓지 않는다", () => {
    // 견적서: 폼의 submit 을 그대로 부른다(같은 handleSubmit · 같은 필수 칸 검사).
    assert.ok(flatOf(QUOTE).includes("onSave: () => formRef.current?.requestSubmit(),"), QUOTE);
    assert.ok(flatOf(QUOTE).includes("<form ref={formRef} onSubmit={handleSubmit}"), QUOTE);
    // 보고서: 폼 요소가 없어 저장 함수를 그대로 부른다.
    assert.ok(flatOf(REPORT).includes("onSave: () => void handleSave(),"), REPORT);
  });
});

describe("🔴 ③④ 발판을 걷고 넘어간다 — 그 둘 말고는 아무도 안 적는다", () => {
  test("견적서의 저장 팝업 넷이 모두 발판을 걷는다", () => {
    // 저장(고치기) · 등록 · 알림을 닫은 뒤 마무리 · PDF 변환 중 팝업.
    assert.equal(
      (flatOf(QUOTE).match(/historyMode: leaveGuard\.historyMode\(\)/g) ?? []).length,
      4,
      "팝업 가운데 발판을 안 걷는 것이 있다"
    );
  });

  test("보고서의 저장 팝업 셋이 모두 발판을 걷는다", () => {
    assert.equal(
      (flatOf(REPORT).match(/historyMode: leaveGuard\.historyMode\(\)/g) ?? []).length,
      3,
      "팝업 가운데 발판을 안 걷는 것이 있다"
    );
  });

  test("🔴 발판을 **거꾸로 적지 않는다** — 서 있으면 replace 여야 한다", () => {
    const guard = codeOf(GUARD);
    // 뒤집으면 저장하고 나간 목록에서 뒤로가기가 폼이 아니라 발판으로 간다.
    assert.ok(guard.includes('unsavedLeaveHistoryMode(armedNow()) === "replace"'), guard.slice(0, 200));
  });

  test("🔴 호스트가 그 값을 **실제로 쓴다** — 안 쓰면 값만 돌고 동작은 그대로다", () => {
    const host = codeOf("src/components/common/SavePopup.tsx");
    assert.ok(host.includes('if (historyMode === "replace") router.replace(redirectTo);'), host.slice(0, 200));
    assert.ok(host.includes("else router.push(redirectTo);"), "기본 길(push)이 사라졌다");
  });
});

describe("🔴 ⑤ 저장에 성공하면 기준선을 곧바로 갱신한다", () => {
  test("견적서 — 저장이 성공한 **바로 그 자리**에서 기준선을 다시 뜬다", () => {
    const flat = flatOf(QUOTE);
    /**
     * 🔴 안 하면 방금 저장한 그대로인데도 「저장 안 된 고침이 있다」가 참으로 남아,
     * 탭을 닫을 때 브라우저 경고가 뜨고 [목록으로]를 눌러도 창이 묻는다.
     * 🔴 `UNCHANGED` 갈래보다 **앞**이어야 한다 — 그때도 화면의 값은 DB 와 같다.
     */
    const at = flat.indexOf("setBaselineToken((token) => token + 1); if (savedQuote) {");
    assert.ok(at >= 0, "저장 성공 자리에서 기준선을 안 뜬다");
    assert.ok(at < flat.indexOf('result.outcome === "UNCHANGED"'), "UNCHANGED 갈래보다 뒤에 있다");
  });

  test("🔴 견적서 — **기계가 채운 값**은 고침으로 세지 않는다", () => {
    const flat = flatOf(QUOTE);
    // 자동 불러오기(수리 건에서 들어온 길)와 발행번호 제안, 그리고 저장 성공 — 셋뿐이다.
    assert.ok(flat.includes("void handleLookup().finally(() => setBaselineToken((token) => token + 1));"), flat.slice(0, 200));
    // 🔴 **부르는 자리가 셋뿐**이다: 자동 불러오기 · 발행번호 제안 · 저장 성공.
    //    [인수번호로 불러오기] 단추는 **사람이 누른 것**이라 여기 들어오면 안 된다 —
    //    들어오면 불러온 값이 「고침」이 아니게 되어, 불러오고 그냥 나가면 말없이 사라진다.
    assert.equal(
      (flat.match(/setBaselineToken\(/g) ?? []).length,
      3,
      "기준선을 다시 뜨는 자리가 셋이 아니다"
    );
  });

  test("보고서 — 2026-10-19 부터 있던 그 줄이 그대로다", () => {
    assert.ok(
      flatOf(REPORT).includes(
        "setEdited(values); setSaved({ id: result.id, version: result.version }); setSavedValues(values);"
      ),
      REPORT
    );
  });
});
