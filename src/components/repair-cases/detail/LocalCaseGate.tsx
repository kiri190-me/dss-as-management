"use client";

import LoadingNotice from "@/components/domain/LoadingNotice";
import DetailTabs from "@/components/repair-cases/detail/DetailTabs";
import RepairCaseNotFound from "@/components/repair-cases/detail/RepairCaseNotFound";
import { useLocalRepairCases } from "@/lib/domain/local/use-local-repair-cases";

/**
 * local- id 전용 게이트다. 서버는 localStorage를 볼 수 없으므로 존재 여부를
 * notFound()(진짜 HTTP 404)로 판단하지 않는다 — 하이드레이션이 끝날 때까지
 * 로딩 문구를 보여주고, 끝난 뒤 없으면 기존 한국어 not-found 화면을(HTTP는
 * 여전히 200), 있으면 탭 + 실제 내용을 보여준다. 즉, 오래된/추측된 local- URL은
 * 서버가 검사할 수 없어 HTTP 200으로 응답하지만 화면은 "찾을 수 없음"으로
 * 표시된다 — 일반 mock ID의 실제 404 동작은 그대로 유지된다(layout.tsx 참고).
 */
export default function LocalCaseGate({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { cases, isHydrated } = useLocalRepairCases();

  if (!isHydrated) {
    return <LoadingNotice />;
  }

  const exists = cases.some((c) => c.id === id);
  if (!exists) {
    return <RepairCaseNotFound />;
  }

  return (
    <div className="flex flex-col gap-4">
      <DetailTabs id={id} />
      {children}
    </div>
  );
}
