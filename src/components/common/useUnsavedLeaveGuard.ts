"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  UNSAVED_LEAVE_SENTINEL_KEY,
  unsavedLeaveHistoryMode,
  unsavedLeaveInstallsSentinel,
  unsavedLeaveOnExitRequest,
  unsavedLeaveOnPopState,
  unsavedLeaveSentinelState,
  unsavedLeaveWarnsOnUnload,
} from "@/lib/domain/unsaved-leave-guard";

/**
 * ============================================================================
 * 🔴 **저장 안 된 내용을 두고 나가려 할 때 막는 장치** (2026-11-01)
 * ============================================================================
 * 창을 띄우고 주소를 미는 자리는 여기 하나다. **무엇을 할지 고르는 규칙은 전부**
 * lib/domain/unsaved-leave-guard.ts 에 값으로 있다 — 그 나눔이 있어야 브라우저를 못
 * 여는 자리에서도 규칙이 시험으로 돌고, 둘(견적서 · 보고서)이 **한 글자도 다르지 않게**
 * 돈다.
 *
 * ── 🔴 「바뀌었나」는 **한 자리에서 낸다** ───────────────────────────────
 * 부르는 화면이 `dirty` 한 값을 넘기고, 나가는 길 **셋이 전부 그 하나만** 본다:
 *
 *   ① 화면 안의 [취소] · 머리의 나가기 단추 → `requestLeave()`
 *   ② 브라우저 뒤로가기(Alt+←)             → 아래 `popstate` 갈래
 *   ③ 탭 닫기 · 새로고침                   → 아래 `beforeunload` 갈래
 *
 * 🔴 ②③의 리스너는 **한 번만** 등록된다 — 렌더마다 새로 만들어지는 `dirty` 를 클로저로
 * 읽으면 **첫 렌더의 값(= 거짓)에 영영 묶인다.** 그래서 거울(`dirtyRef`)을 둔다. 리스너를
 * `dirty` 마다 다시 걸지 않는 까닭은 ②가 **발판을 세웠다 걷었다** 하는 장치라, 리스너가
 * 다시 걸리는 사이에 온 `popstate` 를 놓치면 그대로 화면을 빠져나가 버리기 때문이다.
 *
 * ── 🔴 발판은 나갈 때 **반드시** 걷는다 ─────────────────────────────────
 * 걷지 않고 `push` 로 나가면 도착한 화면에서 뒤로가기를 **두 번** 눌러야 한다. 걷는
 * 방법은 「한 칸을 지우기」가 아니라 **그 칸을 목적지로 바꾸기**다(`router.replace`) —
 * 히스토리에서 칸을 빼는 길은 브라우저에 없다. 저장 팝업이 넘기는 길도 같은 값을 받아
 * 간다(`historyMode()` → components/common/SavePopup.tsx).
 * ============================================================================
 */
export type UnsavedLeaveGuard = {
  /** 창이 떠 있는가. 화면은 이것을 `UnsavedLeaveConfirmDialog` 의 `isOpen` 으로 넘긴다. */
  asking: boolean;
  /**
   * **화면 안의 나가는 문**이 눌렸다 — [취소] · 머리의 [보고서 탭으로] 따위.
   * 고친 것이 있으면 창을 띄우고, 없으면 그대로 나간다.
   */
  requestLeave: () => void;
  /** 창의 [저장없이 나가기]. */
  leaveWithoutSaving: () => void;
  /** 창의 [취소] — 🔴 창만 닫는다. 적던 글에 손대지 않는다. */
  dismiss: () => void;
  /** 창의 [저장] — 창이 **닫힌 뒤** 화면의 저장 흐름을 그대로 부른다(아래 effect). */
  saveAndLeave: () => void;
  /**
   * 🔴 저장 팝업에 실어 보낼 값. 발판이 서 있으면 `"replace"` 다 — 안 실으면 저장하고
   * 나간 화면에서 뒤로가기를 두 번 눌러야 한다.
   *
   * 🔴 **함수다.** 렌더 때의 값으로 굳히면 저장이 도는 사이에 발판이 바뀐 것을 못 본다.
   */
  historyMode: () => "push" | "replace";
};

export function useUnsavedLeaveGuard(params: {
  /** 🔴 **저장 안 된 고침이 남아 있는가** — 나가는 길 셋이 보는 단 하나의 값. */
  dirty: boolean;
  /** 나갈 곳. 화면이 짓지 않고 서버가 넘긴 주소를 그대로 받는다. */
  leaveHref: string;
  /** 창의 [저장]이 부를 것 — 지금 화면의 저장 흐름 그대로다(새 길을 만들지 않는다). */
  onSave: () => void;
  /**
   * 🔴 **지금 열어 둔 것**을 가리키는 값(보고서의 장 id 따위). 이것이 바뀌면 떠 있던
   * 창을 닫는다 — 앞 장의 글을 두고 묻던 물음이라, 갈아 끼운 장에서 그대로
   * [저장없이 나가기]를 누르면 **묻지도 않은 것을 승낙한 꼴**이 된다.
   *
   * 화면이 주소만 바뀌고 컴포넌트는 그대로 남을 수 있는 곳에서만 쓴다(보고서의 `?id=`).
   * 넘기지 않으면 이 장치는 돌지 않는다.
   */
  openedKey?: string | null;
}): UnsavedLeaveGuard {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  /**
   * 열어 둔 것이 바뀌었는가 — **그리는 도중에** 맞춘다(props 가 바뀔 때 상태를 고치는
   * React 의 권장 방식이고, 이 저장소가 이미 쓰는 모양이다 — common/SavePopup.tsx).
   */
  const [askedFor, setAskedFor] = useState(params.openedKey ?? null);
  if (askedFor !== (params.openedKey ?? null)) {
    setAskedFor(params.openedKey ?? null);
    setAsking(false);
  }

  /**
   * 🔴 리스너가 읽는 **거울**들. 리스너는 한 번만 걸리므로 렌더마다 바뀌는 값을
   * 클로저로 못 읽는다(위 머리말) — 그러면 **첫 렌더의 거짓에 영영 묶인다.**
   *
   * 🔴 베끼는 자리는 **effect 다 — 그리는 도중이 아니다.** 그리면서 ref 를 고치면
   * `react-hooks/refs` 가 막는다(리액트 컴파일러의 규칙). 이 저장소에 이미 같은 모양이
   * 있다 — QuoteEditForm 의 `latestExcelFormValues`.
   *
   * 🔴 **맨 처음 값은 useRef 가 넣는다**(`useRef(params.dirty)`). 그래서 첫 그림과 첫
   * effect 사이에 값이 빈 적이 없다. 아래 effect 는 **의존 목록이 없어** 매 렌더 뒤에
   * 돌고, 이 파일에서 **가장 먼저 선언돼** 다른 effect 보다 먼저 돈다(React 는 한
   * 컴포넌트 안에서 선언 차례대로 돌린다) — 그래야 발판을 세우는 effect 가 **지금 값**을
   * 본다.
   */
  const dirtyRef = useRef(params.dirty);
  const leaveHrefRef = useRef(params.leaveHref);
  const onSaveRef = useRef(params.onSave);
  useEffect(() => {
    dirtyRef.current = params.dirty;
    leaveHrefRef.current = params.leaveHref;
    onSaveRef.current = params.onSave;
  });

  /** 발판 칸이 지금 히스토리의 맨 위인가. */
  const armedRef = useRef(false);
  /** 나가기로 정했는가 — 참이면 발판을 다시 세우지도, 새로 세우지도 않는다. */
  const leavingRef = useRef(false);
  /** 창의 [저장]을 눌렀는가 — 창이 닫힌 **뒤에** 저장을 시작하려고 둔 표다. */
  const saveAfterCloseRef = useRef(false);

  /**
   * 🔴 발판을 세운다 — **고친 것이 생긴 뒤에만.**
   *
   * `url` 을 주지 않는다: 주면 Next 가 `ACTION_RESTORE` 를 돌려 화면을 다시 그린다
   * (domain/unsaved-leave-guard.ts 머리말). 주소도 그대로이므로 사람 눈에는 아무 일도
   * 일어나지 않는다.
   */
  useEffect(() => {
    if (!unsavedLeaveInstallsSentinel({
      dirty: params.dirty,
      armed: armedRef.current,
      leaving: leavingRef.current,
    })) {
      return;
    }
    window.history.pushState(unsavedLeaveSentinelState(), "");
    armedRef.current = true;
  }, [params.dirty]);

  /**
   * 🔴 뒤로가기(Alt+←)가 발판을 먹었다.
   *
   * 🔴 **우리 발판인지 먼저 가린다.** 이 화면과 상관없는 뒤로가기(앱 안의 다른 이동,
   * 발판을 세우기 전의 칸들)에 손대면 멀쩡한 이동이 망가진다. `armedRef` 가 그 판단이다 —
   * 발판은 **맨 위 한 칸**이므로, 서 있는 동안 오는 `popstate` 는 그것이 먹힌 것뿐이다.
   */
  useEffect(() => {
    function onPopState() {
      const step = unsavedLeaveOnPopState({
        ours: armedRef.current,
        leaving: leavingRef.current,
        dirty: dirtyRef.current,
      });
      // 먹힌 순간 발판은 더 이상 맨 위가 아니다 — 어느 갈래로 가든 먼저 내려 둔다.
      if (armedRef.current) armedRef.current = false;
      if (step === "IGNORE") return;
      if (step === "FORWARD_BACK") {
        /**
         * 🔴 고친 것이 없는데 발판이 뒤로가기를 **대신 먹었다**(고쳤다가 되돌린 경우,
         * 저장에 성공하고도 이 화면에 남은 경우). 그 한 번을 돌려준다 — 안 그러면
         * 사람이 두 번 눌러야 하고, 그것은 「브라우저가 고장 났다」로 읽힌다.
         */
        window.history.back();
        return;
      }
      // 발판을 **다시 세운다** — 그래야 창에서 [취소]를 누른 뒤 또 눌러도 다시 묻는다.
      window.history.pushState(unsavedLeaveSentinelState(), "");
      armedRef.current = true;
      setAsking(true);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /**
   * 🔴 탭 닫기 · 새로고침 — **브라우저 기본 경고**다(글자를 못 고친다).
   * 흐름도 편집기 둘이 쓰는 모양 그대로다(`if (!dirty) return;` → `preventDefault()`).
   *
   * 🔵 앱 안의 이동(SPA)에는 걸리지 않으므로, 저장하고 나갈 때 이것을 따로 꺼 줄 일이
   * 없다 — 그래서 「저장했는데 경고가 떴다」가 생기지 않는다.
   */
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!unsavedLeaveWarnsOnUnload(dirtyRef.current)) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /**
   * 🔴 창의 [저장]은 **창이 닫힌 뒤에** 시작한다.
   *
   * 폼의 필수 칸이 비어 있으면 브라우저가 그 칸으로 초점을 옮겨 말풍선을 띄우는데,
   * 모달이 떠 있는 동안은 초점이 창 안에 갇혀 **아무것도 안 보인 채 저장만 안 된다.**
   * 창을 닫는 것도 effect 라, 여기서는 상태만 내려 두고 이 effect 가 그다음에 돈다 —
   * React 는 **자식의 effect 를 먼저** 돌리고 창은 자식이다.
   */
  useEffect(() => {
    if (asking) return;
    if (!saveAfterCloseRef.current) return;
    saveAfterCloseRef.current = false;
    onSaveRef.current();
  }, [asking]);

  /**
   * 🔴 발판이 **지금도 맨 위인가.** `armedRef` 만으로 재지 않고 히스토리 state 를 함께
   * 본다 — 그 사이에 앱 안의 다른 이동이 한 칸을 더 쌓았다면 맨 위는 그 칸이고, 그것을
   * 목적지로 덮어쓰면 남의 이동이 사라진다. 틀릴 때 `"push"` 로 기우는 쪽이라
   * **지금까지의 동작보다 나빠지지 않는다.**
   */
  function armedNow(): boolean {
    return armedRef.current && isUnsavedLeaveSentinelState(window.history.state);
  }

  /**
   * 🔴 나간다 — 발판이 서 있으면 **그 칸을 목적지로 바꾼다**(`replace`).
   * 발판이 없으면 지금까지와 똑같이 민다(`push`).
   */
  function go() {
    leavingRef.current = true;
    const href = leaveHrefRef.current;
    if (unsavedLeaveHistoryMode(armedNow()) === "replace") {
      armedRef.current = false;
      router.replace(href);
      return;
    }
    router.push(href);
  }

  return {
    asking,
    requestLeave() {
      if (unsavedLeaveOnExitRequest(dirtyRef.current) === "ASK") {
        setAsking(true);
        return;
      }
      go();
    },
    leaveWithoutSaving() {
      setAsking(false);
      go();
    },
    dismiss() {
      setAsking(false);
    },
    saveAndLeave() {
      saveAfterCloseRef.current = true;
      setAsking(false);
    },
    historyMode() {
      return unsavedLeaveHistoryMode(armedNow());
    },
  };
}

/** 히스토리 state 가 우리 발판 칸인가 — 시험과 디버깅에서 읽는다. */
export function isUnsavedLeaveSentinelState(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as Record<string, unknown>)[UNSAVED_LEAVE_SENTINEL_KEY] === true
  );
}
