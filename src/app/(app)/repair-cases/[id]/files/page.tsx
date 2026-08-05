import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import FilesScreen from "@/components/repair-cases/files/FilesScreen";
import LocalFilesContent from "@/components/repair-cases/files/LocalFilesContent";

export const metadata: Metadata = {
  title: "파일 관리 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseFilesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // approval/page.tsx와 동일한 기존 인증 로직(readSession)을 그대로 재사용한다.
  // 상위 (app) 레이아웃이 이미 세션을 확인했으므로 여기 도달했다면 정상적으로는
  // 항상 세션이 존재하지만, 방어적으로 한 번 더 확인한다.
  const session = await readSession();
  if (!session) {
    redirect("/login");
  }

  // 클라이언트에는 최소한의 검증된 정보만 넘긴다(id/name/role/approvalStatus).
  // 세션 쿠키 자체나 원본 세션 payload를 내려보내지 않는다.
  const actingUser: ActingUser | null = await resolveActingUserForSession(session);

  if (isLocalId(id)) {
    return <LocalFilesContent id={id} actingUser={actingUser} />;
  }

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  return <FilesScreen resolved={resolved} actingUser={actingUser} />;
}
