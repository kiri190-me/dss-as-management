"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import { useIsHydrated } from "@/lib/domain/local/use-is-hydrated";
import type { IntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import IntakeFormInner from "./IntakeFormInner";

type IntakeFormProps = {
  /** Plain string union (not imported from src/lib/config/write-source.ts,
   * which is server-only) — avoids any doubt about a server-only module
   * boundary being crossed into a client component. */
  writeSource: "local" | "database";
  /** Real database customer/End-User/engineer options — only non-null in
   * database mode. Type-only import (erased at compile time), so the
   * server-only guard on repair-case-references.ts is never crossed. */
  referenceData: IntakeReferenceData | null;
};

/**
 * IntakeFormInner는 하이드레이션이 끝난 뒤에만 마운트된다 — draft/local 접수
 * 목록을 localStorage에서 읽어야 하므로, 서버 렌더와 다른 값을 그리다 생기는
 * 하이드레이션 불일치를 피하기 위해서다.
 */
export default function IntakeForm({ writeSource, referenceData }: IntakeFormProps) {
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  return <IntakeFormInner writeSource={writeSource} referenceData={referenceData} />;
}
