"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ============================================================================
 * 마스터 데이터 휴지통의 확인 창 상태 — 고객사·제품 모델·부품이 함께 쓴다
 * ============================================================================
 * 삭제·복원·완전삭제 세 조작은 화면이 달라도 하는 일이 같다: 대상을 모아
 * 창을 열고, 사유를 받고, 서버 액션을 부르고, 건별 결과를 사람이 읽을 수
 * 있는 한 문장으로 접고, 성공한 만큼 화면을 다시 읽는다. 이걸 화면마다
 * 베껴 두면 한쪽만 고쳐지는 날 "고객사는 실패를 알려 주는데 제품 모델은
 * 조용히 넘어가는" 상태가 된다.
 *
 * 서버 액션 자체는 화면이 넘긴다 — 이 훅은 어떤 액션인지 모르고, 액션은
 * 이 훅이 있는지 모른다.
 *
 * ── 성공한 뒤에는 서버를 다시 읽는다 ────────────────────────────────────
 * 지운 행을 클라이언트에서 옮겨 붙이지 않고 router.refresh()로 서버 목록을
 * 다시 받는다. 휴지통 행에는 삭제 시각·삭제자처럼 **서버만 아는 값**이
 * 있어서, 클라이언트가 옮겨 붙이려면 그 값을 지어내야 한다. 지어낸 값이
 * 잠깐이라도 화면에 보이는 것보다 한 번 더 읽는 편이 낫다.
 *
 * ── 일부만 실패해도 성공한 만큼은 반영한다 ──────────────────────────────
 * 서버 액션은 건마다 자기 결과를 돌려준다(customer-trash.ts). 그래서 여기서
 * 전부 실패로 취급하지 않는다 — 실패한 건의 이유를 창에 남겨 둔 채로 목록은
 * 새로고침한다. 성공한 것은 사라지고, 실패한 것만 이유와 함께 남는다.
 * ============================================================================
 */

/**
 * 서버 액션이 받는 한 건. 기본값은 updated_at으로 낙관적 동시성을 보는
 * 화면(고객사·제품 모델)의 모양이고, **version 컬럼을 쓰는 화면은 자기 모양을
 * 넘긴다**(재고의 부품은 `{ id, expectedVersion }`).
 *
 * 훅 자체는 이 안을 들여다보지 않는다 — 이름만 떼어 내고 나머지는 그대로
 * 액션에 넘긴다. 그래서 화면마다 다른 동시성 기준을 억지로 한 가지 문자열로
 * 맞출 필요가 없다(맞추면 숫자 version을 문자열인 척하게 된다).
 */
export type MasterDataTrashItem = { id: string; expectedUpdatedAt: string };

/** 창에 이름을 나열하기 위해 대상마다 이름도 함께 받는다. */
export type MasterDataTrashTarget<TItem = MasterDataTrashItem> = TItem & { name: string };

export type MasterDataTrashItemResult = {
  id: string;
  ok: boolean;
  code?: string;
  message?: string;
};

export type MasterDataTrashActionResult =
  | { ok: true; results: MasterDataTrashItemResult[] }
  | { ok: false; code: string; message: string };

export type MasterDataTrashKind = "DELETE" | "RESTORE" | "PERMANENT_DELETE";

/** 건별 실패를 창에 띄울 한 문장으로 접는다. 같은 이유가 여러 번이면 한 번만 적는다. */
function summarizeFailures(results: MasterDataTrashItemResult[]): string | null {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return null;

  const reasons = [...new Set(failed.map((result) => result.message ?? "알 수 없는 이유로 처리하지 못했습니다."))];
  const succeeded = results.length - failed.length;
  const head =
    succeeded > 0
      ? `${succeeded}건은 처리했지만 ${failed.length}건은 처리하지 못했습니다.`
      : `${failed.length}건을 처리하지 못했습니다.`;
  return `${head} ${reasons.join(" ")}`;
}

export function useMasterDataTrash<TItem extends { id: string } = MasterDataTrashItem>(actions: {
  onDelete: (input: { items: TItem[]; reason: string | null }) => Promise<MasterDataTrashActionResult>;
  onRestore: (input: { items: TItem[] }) => Promise<MasterDataTrashActionResult>;
  onPermanentDelete: (input: { items: TItem[]; reason: string }) => Promise<MasterDataTrashActionResult>;
  /** 한 건도 남김없이 성공했을 때만 부른다 — 선택 해제·삭제 모드 종료 같은 뒷정리. */
  onAllSucceeded?: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<MasterDataTrashKind | null>(null);
  const [targets, setTargets] = useState<MasterDataTrashTarget<TItem>[]>([]);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const open = useCallback((nextKind: MasterDataTrashKind, nextTargets: MasterDataTrashTarget<TItem>[]) => {
    if (nextTargets.length === 0) return;
    setKind(nextKind);
    setTargets(nextTargets);
    setReason("");
    setSubmitError(null);
  }, []);

  const close = useCallback(() => {
    setKind(null);
    setTargets([]);
    setReason("");
    setSubmitError(null);
  }, []);

  const submit = useCallback(async () => {
    if (kind === null || isSubmitting) return;

    // 이름만 떼어 내고 나머지는 그대로 넘긴다 — 이 훅은 항목의 안을 모른다.
    const items = targets.map((target) => {
      const item = { ...target } as Record<string, unknown>;
      delete item.name;
      return item as unknown as TItem;
    });
    const trimmedReason = reason.trim();

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result =
        kind === "DELETE"
          ? await actions.onDelete({ items, reason: trimmedReason || null })
          : kind === "RESTORE"
            ? await actions.onRestore({ items })
            : await actions.onPermanentDelete({ items, reason: trimmedReason });

      if (!result.ok) {
        // 관문에서 막힌 경우(권한·검증). 아무것도 바뀌지 않았으므로 새로고침하지 않는다.
        setSubmitError(result.message);
        return;
      }

      const failureMessage = summarizeFailures(result.results);
      // 성공한 건이 하나라도 있으면 목록을 다시 읽는다 — 실패한 건이 남아
      // 있어도 성공한 건은 이미 사라진 뒤다.
      if (result.results.some((item) => item.ok)) router.refresh();

      if (failureMessage) {
        setSubmitError(failureMessage);
        return;
      }

      actions.onAllSucceeded?.();
      close();
    } finally {
      setIsSubmitting(false);
    }
  }, [actions, close, isSubmitting, kind, reason, router, targets]);

  return {
    /** 지금 열려 있는 창. null이면 아무 창도 열려 있지 않다. */
    kind,
    /** 창에 나열할 이름들. */
    names: targets.map((target) => target.name),
    targetCount: targets.length,
    reason,
    setReason,
    isSubmitting,
    submitError,
    open,
    close,
    submit,
  };
}
