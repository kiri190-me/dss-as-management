"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import { useIsHydrated } from "@/lib/domain/local/use-is-hydrated";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import type { IntakeDraftData } from "@/lib/domain/local/draft-storage";
import IntakeFormInner from "./IntakeFormInner";

type IntakeFormProps = {
  /** Real database customer/End-User/engineer/Product Model options. Type-only
   * import (erased at compile time), so the server-only guard on
   * repair-case-references.ts is never crossed. */
  referenceData: IntakeReferenceData;
  /** Product Model Master 연결 체크포인트 — SUPER_ADMIN/ADMIN만 true. */
  canRegisterProductModel: boolean;
  /**
   * 고객이 보낸 수리 의뢰에서 옮겨 온 초기값. 없으면 종전과 같다.
   * 무엇을 채우고 무엇을 비워 두는지는 new/page.tsx 주석에 있다.
   */
  initialDraft?: Partial<IntakeDraftData>;
  /** 그 의뢰의 id. 접수가 만들어지면 이 의뢰를 접수에 묶는다. */
  fromRequestId?: string;
};

/**
 * IntakeFormInner는 하이드레이션이 끝난 뒤에만 마운트된다 — 작성 중인 초안을
 * localStorage에서 읽어야 하므로, 서버 렌더와 다른 값을 그리다 생기는
 * 하이드레이션 불일치를 피하기 위해서다.
 */
export default function IntakeForm({ referenceData, canRegisterProductModel, initialDraft, fromRequestId }: IntakeFormProps) {
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  return (
    <IntakeFormInner
      referenceData={referenceData}
      canRegisterProductModel={canRegisterProductModel}
      initialDraft={initialDraft}
      fromRequestId={fromRequestId}
    />
  );
}
