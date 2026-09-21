import type { Metadata } from "next";
import Link from "next/link";
import KyosanReportImportScreen from "@/components/excel-imports/KyosanReportImportScreen";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getRepairCaseWriteSource } from "@/lib/config/write-source";
import { KYOSAN_IMPORT_PERMISSION_AREA } from "@/lib/server/services/kyosan-intake-import";

export const metadata: Metadata = {
  title: "연락서 가져오기 | DSS A/S 관리 시스템",
};

// 방금 넣은 연락서가 다음 미리보기에서 「이미 넣음」으로 보여야 한다 — 캐시를 쓰지 않는다.
export const dynamic = "force-dynamic";

/**
 * 연락서 가져오기 — 교산 연락서(.xlsm/.xlsx) 한 장을 **이미 등록된 수리 건에** 넣는다.
 *
 * 🔴 권한은 **과거 인수품 가져오기와 같은 판정을 그대로 쓴다**
 * (`KYOSAN_IMPORT_PERMISSION_AREA` = `kyosanIntakeImport` 의 관리 수준). 같은 교산
 * 양식을 다루고 남의 수리 건에 자료가 들어가는 같은 무게의 일이라, 흉내 낸 검사를
 * 새로 만들지 않았다.
 *
 * 가드가 먼저다 — 메뉴에서 감추는 것은 막은 것이 아니다. 다만 이 가드는 화면을 그릴
 * 때만 돈다. 서버 액션(lib/server/actions/kyosan-report-import.ts)도 세션부터 다시
 * 읽고 같은 권한을 **각자** 다시 본다.
 *
 * 저장 · 읽기 원천이 DB 가 아니면 액션이 거절하므로 화면도 열지 않는다.
 */
export default async function KyosanReportImportPage() {
  await requireAreaAccessForCurrentUser(KYOSAN_IMPORT_PERMISSION_AREA, "MANAGE");

  if (getRepairCaseWriteSource() !== "database" || getRepairCaseReadSource() !== "database") {
    return (
      <PlaceholderPage
        title="연락서 가져오기"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">연락서 가져오기</h1>
        <Link
          href="/excel-imports/kyosan-intake-list"
          className="text-sm text-zinc-600 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          과거 인수품 가져오기로
        </Link>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        🔴 연락서는 <strong>이미 등록된 수리 건에만</strong> 들어갑니다. 짝이 없으면 넣지 않고, 수리 건을
        새로 만들지도 않습니다. 한 번에 한 장씩입니다.
      </p>
      <KyosanReportImportScreen />
    </div>
  );
}
