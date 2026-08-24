"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import { useIsHydrated } from "@/lib/domain/local/use-is-hydrated";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import IntakeFormInner from "./IntakeFormInner";

type IntakeFormProps = {
  /** Real database customer/End-User/engineer/Product Model options. Type-only
   * import (erased at compile time), so the server-only guard on
   * repair-case-references.ts is never crossed. */
  referenceData: IntakeReferenceData;
  /** Product Model Master 연결 체크포인트 — SUPER_ADMIN/ADMIN만 true. */
  canRegisterProductModel: boolean;
};

/**
 * IntakeFormInner는 하이드레이션이 끝난 뒤에만 마운트된다 — 작성 중인 초안을
 * localStorage에서 읽어야 하므로, 서버 렌더와 다른 값을 그리다 생기는
 * 하이드레이션 불일치를 피하기 위해서다.
 */
export default function IntakeForm({ referenceData, canRegisterProductModel }: IntakeFormProps) {
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  return <IntakeFormInner referenceData={referenceData} canRegisterProductModel={canRegisterProductModel} />;
}
