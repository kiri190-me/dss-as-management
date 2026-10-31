import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import UnsavedLeaveConfirmDialog from "./UnsavedLeaveConfirmDialog";
import { UNSAVED_LEAVE_CONFIRM_TITLE } from "@/lib/domain/unsaved-leave-guard";

/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 묻는 창** (2026-11-01)
 * ============================================================================
 * 사용자가 글자와 단추 셋을 정했다 — 「저장되지 않는 내용이 있습니다. 저장하시겠습니까?」 ·
 * [저장] · [저장없이 나가기] · [취소]. 🔴 **견적서와 보고서가 이 한 벌을 함께 쓴다.**
 *
 * 못 박는 것:
 *   1. 🔴 글자와 단추 셋, **그 차례**
 *   2. 🔴 「사라진다」를 돌려 말하지 않는다
 *   3. 🔴 저장할 수 없을 때는 [저장]을 **잠긴 채 두지 않고 아예 그리지 않는다**
 *   4. 🔴 브라우저 기본 confirm 이 아니라 이 저장소의 native <dialog> 다
 *   5. 🔴 처음 초점은 **가장 안전한 쪽**([취소])이다
 * ============================================================================
 */

/** 단추 이름을 **차례대로**. 링크는 세지 않는다(보고서 쪽 시험과 같은 읽개). */
function buttonLabels(html: string): string[] {
  return html
    .split("<button")
    .slice(1)
    .map((chunk) =>
      chunk
        .slice(chunk.indexOf(">") + 1, chunk.indexOf("</button>"))
        .replace(/<[^>]*>/g, "")
        .trim()
    );
}

function render(
  overrides: Partial<Parameters<typeof UnsavedLeaveConfirmDialog>[0]> = {}
): string {
  return renderToStaticMarkup(
    <UnsavedLeaveConfirmDialog
      isOpen
      canSave
      destinationLabel="견적서 목록"
      onSave={() => {}}
      onLeave={() => {}}
      onCancel={() => {}}
      {...overrides}
    />
  );
}

describe("🔴 ① 글자와 단추 셋 — 사용자가 정한 그대로", () => {
  test("제목이 **사용자가 정한 한 줄**이고, 값으로 못 박혀 있다", () => {
    const html = render();
    assert.ok(html.includes("저장되지 않는 내용이 있습니다. 저장하시겠습니까?"), html);
    // 🔴 글자를 화면마다 따로 적으면 한쪽만 고쳐진다 — 상수 하나에서 온다.
    assert.ok(html.includes(UNSAVED_LEAVE_CONFIRM_TITLE), html);
  });

  test("🔴 단추는 셋, 차례는 [저장] · [저장없이 나가기] · [취소]", () => {
    assert.deepEqual(buttonLabels(render()), ["저장", "저장없이 나가기", "취소"]);
  });

  test("되돌릴 수 없는 쪽이 붉은 단추다 — 휴지통 창들과 같은 규칙", () => {
    // 🔴 글 안에도 「[저장없이 나가기]」가 적혀 있다 — **단추만** 골라야 한다.
    const buttons = render().split("<button").slice(1);
    const leave = buttons.find((chunk) => chunk.slice(0, chunk.indexOf("</button>")).includes("저장없이 나가기"));
    assert.ok(leave !== undefined, "[저장없이 나가기] 단추를 못 찾았다");
    assert.ok(leave.includes("bg-red-600"), leave.slice(0, 300));
    // 그만두는 쪽은 테두리만 있는 수수한 단추다 — 붉게 칠하지 않는다.
    const cancel = buttons.find((chunk) => chunk.slice(0, chunk.indexOf("</button>")).includes("취소"));
    assert.ok(cancel !== undefined && !cancel.includes("bg-red-600"), cancel);
  });
});

describe("🔴 ② 「사라진다」를 돌려 말하지 않는다", () => {
  test("사라진다 · 되살릴 수 없다 · 남기는 길이 그대로 적혀 있다", () => {
    const html = render();
    assert.ok(html.includes("지금 적은 내용이 사라집니다"), html);
    assert.ok(html.includes("되살릴 수 없습니다"), html);
    assert.ok(html.includes("[저장]"), "남기는 길을 안 알려 준다");
    // 🔴 "저장되지 않습니다" 로 뭉개면 사람은 「어딘가 남아 있겠지」로 읽는다.
    assert.equal(html.includes("저장되지 않습니다"), false, html);
  });

  test("🔴 어디로 나가는지는 **화면이 넘긴 말**로 적는다 — 「목록으로」로 뭉개지 않는다", () => {
    assert.ok(render({ destinationLabel: "「보고서」 탭" }).includes("「보고서」 탭"));
    assert.ok(render({ destinationLabel: "견적서 목록" }).includes("견적서 목록"));
  });
});

describe("🔴 ③ 저장할 수 없으면 [저장]을 **그리지 않는다**", () => {
  test("단추가 둘로 줄고, 나가는 길은 그대로 열려 있다", () => {
    const html = render({ canSave: false });
    assert.deepEqual(buttonLabels(html), ["저장없이 나가기", "취소"]);
    // 🔴 못 하는 일을 **잠긴 단추**로 두지 않는다 — 「왜 안 눌리지」가 된다.
    assert.equal(html.includes('disabled=""'), false, html);
  });

  test("🔴 **왜** 지금 저장할 수 없는지를 그 자리에 적는다", () => {
    assert.ok(
      render({ canSave: false, cannotSaveReason: "다른 사람이 먼저 저장했습니다." }).includes(
        "다른 사람이 먼저 저장했습니다."
      )
    );
    // 까닭을 안 넘겨도 빈 자리로 두지 않는다.
    assert.ok(render({ canSave: false }).includes("지금은 저장할 수 없습니다"));
  });

  test("저장할 수 있을 때는 그 줄이 없다 — 괜한 경고를 쌓지 않는다", () => {
    assert.equal(render().includes("지금은 저장할 수 없습니다"), false);
  });
});

describe("🔴 ④⑤ 창의 모양과 처음 초점", () => {
  test("native <dialog> 다 — 브라우저 기본 confirm 이 아니다", () => {
    const html = render();
    assert.ok(html.startsWith("<dialog"), html.slice(0, 80));
  });

  test("🔴 처음 초점은 **가장 안전한 쪽**([취소])이다 — Enter 한 번에 저장되지 않게", () => {
    const html = render();
    const at = html.indexOf("autofocus");
    assert.ok(at >= 0, "autoFocus 가 없다 — showModal 은 첫 단추([저장])를 잡는다");
    // autofocus 가 붙은 단추가 [취소] 인가.
    const after = html.slice(at);
    assert.equal(
      after.slice(0, after.indexOf("</button>")).includes("취소"),
      true,
      after.slice(0, 300)
    );
  });

  test("닫혀 있어도 그려진다 — 열림 여부는 부모가 소유한다", () => {
    const html = render({ isOpen: false });
    assert.ok(html.startsWith("<dialog"), html.slice(0, 80));
    assert.deepEqual(buttonLabels(html), ["저장", "저장없이 나가기", "취소"]);
  });
});
