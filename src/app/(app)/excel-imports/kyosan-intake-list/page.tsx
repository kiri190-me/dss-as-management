import type { Metadata } from "next";
import KyosanIntakeImportScreen from "@/components/excel-imports/KyosanIntakeImportScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { listImportedCasesNeedingBillingReview } from "@/lib/db/queries/kyosan-intake-import";

export const metadata: Metadata = {
  title: "과거 인수품 가져오기 | DSS A/S 관리 시스템",
};

// 방금 가져온 건이 「유/무상 확인 필요」 목록에 바로 보여야 한다 — 캐시된 값을 보이지 않는다.
export const dynamic = "force-dynamic";

/**
 * 과거 인수품 가져오기 — 교산 인수품 리스트(xlsx)로 과거 수리 건을 한꺼번에 만든다.
 *
 * 가드가 먼저다 — 메뉴에서 감추는 것은 막은 것이 아니다. 관리(MANAGE)만 들어온다.
 * 서버 액션도 세션부터 다시 확인하므로 이 가드가 유일한 관문은 아니다
 * (lib/server/actions/kyosan-intake-import.ts).
 *
 * 저장 · 읽기 원천이 DB 가 아니면 액션이 거절하므로 화면도 열지 않는다 — 아래 목록 조회도
 * DB 가 있어야 한다.
 */
export default async function KyosanIntakeImportPage() {
  await requireAreaAccessForCurrentUser("kyosanIntakeImport", "MANAGE");

  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return (
      <PlaceholderPage
        title="과거 인수품 가져오기"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const billingReviewItems = await listImportedCasesNeedingBillingReview();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">과거 인수품 가져오기</h1>
      <KyosanIntakeImportScreen billingReviewItems={billingReviewItems} />
    </div>
  );
}
