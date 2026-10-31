/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 막는다** (2026-11-01)
 * ============================================================================
 * 사용자 요구: 「견적서나 보고서에서 내용을 수정하다가 브라우저에서 뒤로가기를
 * 누르거나 취소를 누르면 [저장되지 않는 내용이 있습니다. 저장하시겠습니까?] 라는
 * 팝업이 뜨면서 … 선택할 수 있도록 해줘. 내가 원하는건 브라우저에서
 * **[alt + 왼쪽 화살표]** 를 하면 이전으로 돌아갈 때, 팝업이 떴으면 좋겠는거야.」
 *
 * 이 파일은 **판단만** 한다 — `window` 도 라우터도 여기 들어오지 않는다. 그래야 규칙이
 * Node 시험으로 돌고, 브라우저를 못 여는 자리에서도 「무엇을 하기로 했는가」가 값으로
 * 남는다(domain/save-popup.ts 와 같은 나눔). 실제로 창을 띄우고 주소를 미는 자리는
 * components/common/useUnsavedLeaveGuard.ts 하나뿐이다.
 *
 * ── 🔴 나가는 길이 셋인데 **보는 값은 하나**다 ──────────────────────────
 * ① 화면 안의 [취소] 단추 · ② 브라우저 뒤로가기(Alt+←) · ③ 탭 닫기·새로고침.
 * 셋이 각자 「바뀌었나」를 재면 언젠가 한쪽만 고쳐져 **한 문만 묻는 화면**이 된다 —
 * 보고서에서 실제로 겪은 일이라(2026-10-19 머리의 [보고서 탭으로]가 링크였다) 아래
 * 세 함수는 전부 **같은 `dirty` 한 값**만 받는다. 다른 인자를 더하지 말 것.
 *
 * ── 🔴 Next 에는 「이동을 막는」 API 가 없다 ────────────────────────────
 * `next/navigation` 이 내보내는 것 가운데 이동을 가로채는 길이 없다. 그래서 ②는
 * **발판(sentinel)** 으로 막는다: 고친 것이 생기는 순간 지금 주소와 **같은 주소**로
 * 히스토리 한 칸을 더 쌓아 둔다. 뒤로가기는 그 칸을 먼저 먹고, 우리는 `popstate` 에서
 * 그것을 알아채 **발판을 다시 세우고** 창을 띄운다 — 화면은 그대로다.
 *
 * 🔴 **`url` 인자를 주지 않는 것**이 요점이다. Next 는 `history.pushState` 를 제 것으로
 * 바꿔 두었는데(next/dist/client/components/app-router.js), `url` 이 있을 때만
 * `ACTION_RESTORE` 를 돌린다. 주지 않으면 **주소도 안 바뀌고 다시 그리지도 않는다** —
 * 내부 상태(`__NA` · 트리)는 그 패치가 알아서 베껴 넣는다.
 *
 * ⚠️ **③은 글자를 못 고친다.** `beforeUnload` 의 문구는 브라우저가 정한다(크롬은
 * 「변경사항이 저장되지 않을 수 있습니다」). 사용자가 그 사실을 알고 괜찮다고 했다
 * (2026-11-01) — 탭 닫기·새로고침까지 우리 창으로 막을 길은 없다.
 * ============================================================================
 */

/** 창에 적는 한 줄 — **사용자가 정한 글자 그대로**다(2026-11-01). 두 화면이 이것 하나를 쓴다. */
export const UNSAVED_LEAVE_CONFIRM_TITLE = "저장되지 않는 내용이 있습니다. 저장하시겠습니까?";

/**
 * 발판 칸임을 알아보는 표식. 히스토리 state 에 이 열쇠가 서 있으면 우리가 쌓은 칸이다.
 *
 * 🔴 이름을 길게 적는다 — Next 가 쓰는 `__NA` · `__PRIVATE_NEXTJS_INTERNALS_TREE` 와
 * 같은 상자에 들어가므로, 흔한 이름(`guard` 따위)을 쓰면 남의 값과 부딪친다.
 */
export const UNSAVED_LEAVE_SENTINEL_KEY = "__dssUnsavedLeaveGuard";

/** 발판 칸에 싣는 state. `pushState` 에 그대로 넘긴다(Next 가 제 값들을 여기 베껴 넣는다). */
export function unsavedLeaveSentinelState(): Record<string, true> {
  return { [UNSAVED_LEAVE_SENTINEL_KEY]: true };
}

// ──────────────────────────────────── ① 화면 안의 나가는 문

/** 「묻는다」인가 「그냥 나간다」인가. */
export type UnsavedLeaveExitStep = "ASK" | "GO";

/**
 * [취소] 같은 **화면 안의 나가는 문**이 눌렸을 때.
 *
 * 🔴 아무것도 안 고쳤으면 **묻지 않고 바로 나간다.** 늘 물으면 사람은 읽지 않고 누르는
 * 손을 배우고, 그러면 정작 글이 사라질 때도 그냥 넘긴다(보고서 쪽이 2026-10-19 에
 * 세운 규칙 그대로다).
 */
export function unsavedLeaveOnExitRequest(dirty: boolean): UnsavedLeaveExitStep {
  return dirty ? "ASK" : "GO";
}

// ──────────────────────────────────── ② 브라우저 뒤로가기

/**
 * 발판을 지금 세워야 하는가.
 *
 * 🔴 **고친 것이 있을 때만** 세운다. 늘 세워 두면 아무것도 안 고친 화면에서 뒤로가기가
 * 한 번 먹히고 아무 일도 안 일어난다 — 사람은 브라우저가 고장 난 줄 안다.
 * 🔴 **나가기로 한 뒤에는 세우지 않는다**(`leaving`). 떠나는 중에 한 칸을 더 쌓으면
 * 도착한 화면에서 뒤로가기를 두 번 눌러야 한다.
 */
export function unsavedLeaveInstallsSentinel(input: {
  dirty: boolean;
  armed: boolean;
  leaving: boolean;
}): boolean {
  if (input.leaving) return false;
  if (input.armed) return false;
  return input.dirty;
}

/** 발판이 먹힌 뒤 할 일 셋. */
export type UnsavedLeavePopStep =
  /** 우리 발판이 아니거나 우리가 걷어낸 것이다 — 아무것도 하지 않는다. */
  | "IGNORE"
  /**
   * 고친 것이 없다 — 발판이 뒤로가기를 **대신 먹었으므로** 그 한 번을 돌려준다
   * (`history.back()`). 안 그러면 사람이 두 번 눌러야 한다.
   */
  | "FORWARD_BACK"
  /** 고친 것이 있다 — 발판을 **다시 세우고** 창을 띄운다. 화면은 그대로 남는다. */
  | "REARM_AND_ASK";

/**
 * `popstate` 한 번을 받아 무엇을 할지 고른다.
 *
 * 🔴 `ours` 가 거짓이면 **남의 popstate** 다(앱 안 다른 이동, 또는 우리가 쌓기 전의
 * 칸들). 손대지 않는다 — 여기서 뭔가 하면 이 화면과 상관없는 뒤로가기가 망가진다.
 * 🔴 `leaving` 이 참이면 **우리가 걷어낸 것**이다. 다시 세우면 영영 못 나간다.
 */
export function unsavedLeaveOnPopState(input: {
  ours: boolean;
  leaving: boolean;
  dirty: boolean;
}): UnsavedLeavePopStep {
  if (!input.ours) return "IGNORE";
  if (input.leaving) return "IGNORE";
  return input.dirty ? "REARM_AND_ASK" : "FORWARD_BACK";
}

// ──────────────────────────────────── ③ 탭 닫기 · 새로고침

/**
 * 브라우저 기본 경고를 띄울 것인가.
 *
 * 🔴 **위 둘과 똑같은 `dirty` 하나만** 본다. 흐름도 편집기 둘이 이미 같은 모양이다
 * (`CaseFlowchartEditorScreen` · `ProcedureTemplateEditorScreen` 의 `handleBeforeUnload`).
 */
export function unsavedLeaveWarnsOnUnload(dirty: boolean): boolean {
  return dirty;
}

// ──────────────────────────────────── 나갈 때 히스토리를 어떻게 쓰는가

/**
 * 🔴 **발판이 서 있으면 `replace` 로 나간다** — 이것을 빠뜨리면 도착한 화면에서
 * 뒤로가기를 **두 번** 눌러야 한다.
 *
 * 까닭: 발판은 **지금 칸 위에 쌓은 한 칸**이다. 그 위에서 `push` 로 나가면 쌓임이
 * `[…, 폼, 발판, 목적지]` 가 되어 목적지의 뒤로가기가 발판(= 폼과 같은 주소)으로
 * 가고, 거기서 한 번 더 눌러야 비로소 폼이다. `replace` 로 나가면 발판 칸이 목적지로
 * 바뀌어 `[…, 폼, 목적지]` — **발판이 없던 때와 글자 하나 다르지 않은 쌓임**이 된다.
 *
 * 🔵 발판이 없으면 `"push"` 다 — 지금까지의 모든 화면이 그대로 돈다.
 */
export function unsavedLeaveHistoryMode(armed: boolean): "push" | "replace" {
  return armed ? "replace" : "push";
}
