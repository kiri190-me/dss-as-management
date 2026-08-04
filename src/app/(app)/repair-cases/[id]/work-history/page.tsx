import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import ActivityTimelineScreen from "@/components/repair-cases/work-history/ActivityTimelineScreen";
import LocalActivityContent from "@/components/repair-cases/work-history/LocalActivityContent";

export const metadata: Metadata = {
  title: "작업 이력 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * Stage E-2: 이 화면은 mockWorkHistories뿐 아니라 로컬 워크플로/승인/첨부파일
 * 이벤트까지 하나의 타임라인으로 병합해야 하므로(3개 모두 클라이언트 전용
 * localStorage 소스) approval/files 페이지와 동일한 서버 분기 패턴을 따른다.
 * 이 스테이지는 쓰기 동작을 추가하지 않으므로 readSession()은 필요 없다.
 *
 * Stage G-2 Batch 3: resolveMockRepairCaseById → resolveRepairCaseForServer로
 * 교체해 database 모드의 UUID도 이 탭에 도달할 수 있게 한다. mockWorkHistories/
 * 로컬 이벤트 병합 로직 자체는 변경하지 않는다 — DB 소스 건은 대응하는
 * mockWorkHistories/로컬 이벤트가 없으므로 기존 "이력 없음" 빈 상태를 그대로
 * 보여준다(임시로 허용됨, DB 백드 작업이력은 이번 배치 범위 밖).
 */
export default async function WorkHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (isLocalId(id)) {
    return <LocalActivityContent id={id} />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  return <ActivityTimelineScreen resolved={resolved} />;
}
