import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { isLocalId } from "@/lib/domain/local/local-types";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  listAttachmentsForRepairCase,
  listTrashedAttachmentsForRepairCase,
} from "@/lib/db/queries/attachments";
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

  // 실제 DB 접수 건에서만 실제 저장을 쓴다. mock 읽기 소스로 띄운 데모 건은
  // 붙일 DB 행이 없으므로 종전의 브라우저 저장소 화면 그대로 둔다 — 이번
  // 단계는 저장 바닥을 놓는 일이지 데모를 걷는 일이 아니다.
  if (resolved.source !== "DATABASE") {
    return <FilesScreen resolved={resolved} actingUser={actingUser} />;
  }

  const [attachments, trashedAttachments] = await Promise.all([
    listAttachmentsForRepairCase(resolved.id),
    listTrashedAttachmentsForRepairCase(resolved.id),
  ]);

  // 화면이 올리기 칸과 지우기·되살리기 버튼을 보일지 말지. 실제 판정은 업로드
  // 라우트와 서버 액션이 각자 다시 한다 — 여기서 숨기는 것은 눌러도 막히는
  // 버튼을 내밀지 않기 위해서다.
  const canManageFiles = actingUser
    ? await hasPermission(actingUser.role, "repairCases.files", "WRITE")
    : false;

  return (
    <FilesScreen
      resolved={resolved}
      actingUser={actingUser}
      attachments={attachments}
      trashedAttachments={trashedAttachments}
      canUpload={canManageFiles}
      canManage={canManageFiles}
    />
  );
}
