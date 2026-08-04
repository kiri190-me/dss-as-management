"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SourceBadge } from "@/components/repair-cases/badges";

export default function RegisteredSuccessNotice({
  id,
  intakeNumber,
}: {
  id: string;
  intakeNumber: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  // 쿼리 마커는 배너를 "표시할지" 최초 판단할 때만 쓴다 — 아래 effect가 URL에서
  // 마커를 곧바로 제거하므로, searchParams를 직접 렌더 조건으로 쓰면 제거되는
  // 순간 배너도 함께 사라져버린다. 그래서 마운트 시점 값을 로컬 state로 한 번만
  // 캡처해 배너의 표시 여부와 URL 상태를 분리한다.
  const [wasRegistered] = useState(() => searchParams.get("registered") === "1");

  useEffect(() => {
    if (!wasRegistered) return;
    // 표시된 뒤 쿼리 마커를 제거한다(풀 리로드 없이 클라이언트 사이드로만).
    router.replace(`/repair-cases/${id}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wasRegistered, id]);

  if (!wasRegistered || dismissed) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">A/S 접수가 로컬 데모 데이터로 등록되었습니다.</span>
        <span>인수번호: {intakeNumber}</span>
        <SourceBadge source="LOCAL_DEMO" />
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="rounded-md border border-green-300 px-2 py-1 text-xs text-green-800 hover:bg-green-100 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900"
      >
        닫기
      </button>
    </div>
  );
}
