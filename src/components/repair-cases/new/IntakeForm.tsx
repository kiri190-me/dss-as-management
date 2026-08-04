"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import { useIsHydrated } from "@/lib/domain/local/use-is-hydrated";
import IntakeFormInner from "./IntakeFormInner";

/**
 * IntakeFormInner는 하이드레이션이 끝난 뒤에만 마운트된다 — draft/local 접수
 * 목록을 localStorage에서 읽어야 하므로, 서버 렌더와 다른 값을 그리다 생기는
 * 하이드레이션 불일치를 피하기 위해서다.
 */
export default function IntakeForm() {
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  return <IntakeFormInner />;
}
