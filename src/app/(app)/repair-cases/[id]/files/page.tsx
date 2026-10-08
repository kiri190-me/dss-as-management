import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { resolveRepairCaseForServer } from "@/lib/server/repair-case-resolver";
import {
  listAttachmentsForRepairCase,
  listTrashedAttachmentsForRepairCase,
} from "@/lib/db/queries/attachments";
import { listShareDocsForProductModelKind } from "@/lib/db/queries/product-model-kind-share-docs";
import { listShareDocsForProductModel } from "@/lib/db/queries/product-model-share-docs";
import { getProductModelIdForProduct } from "@/lib/db/queries/repair-cases";
import { productModelKindOfWorkflowKind } from "@/lib/domain/product-model-kind";
import { workflowKindOf } from "@/lib/domain/workflow-kind";
import type { ActingUser } from "@/lib/domain/local/approval/transitions";
import { resolveContactFolderArchiveRoot } from "@/lib/storage/contact-folder-archive";
import { resolveRepairDocsArchiveRoot } from "@/lib/storage/repair-docs-archive";
import FilesScreen from "@/components/repair-cases/files/FilesScreen";

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

  const resolved = await resolveRepairCaseForServer(id);
  // 이 지점에 도달했다면 상위 layout.tsx가 이미 존재를 확인했으므로 resolved는
  // 항상 존재해야 한다. 방어적으로만 남겨둔다.
  if (!resolved) {
    notFound();
  }

  // 🔴 **이 건의 제품 종류** — 수리 건에는 그 칸이 없다. 접수할 때 사람이 고른 워크플로
  // 종류를 제품 종류 축으로 옮기는 자리는 저장소에 하나뿐이고(domain/product-model-kind.ts 의
  // productModelKindOfWorkflowKind), 접수의 공통 서류 복사도 같은 함수를 부른다. 🔴 규칙을
  // 여기 베껴 적지 않는다 — 한쪽 축에 값이 느는 날 이 자리만 조용히 틀린다.
  const productModelKind = productModelKindOfWorkflowKind(workflowKindOf(resolved.workflowType));

  const [attachments, trashedAttachments, kindShareDocs, modelShareDocs] = await Promise.all([
    listAttachmentsForRepairCase(resolved.id),
    listTrashedAttachmentsForRepairCase(resolved.id),
    // 🔴 그 종류가 가리켜 둔 공유폴더 서류 — **DB 표 한 번**이다. 가리킨 자리에 실제로
    //    무엇이 있는지는 들여다보지 않으므로 아래 주석의 규율(공유폴더를 서버에서 읽지
    //    않는다)을 그대로 지킨다. 종류별 서류함 page.tsx 가 그은 선과 같다.
    listShareDocsForProductModelKind(productModelKind),
    // 🔴 **이 제품 모델**이 가리켜 둔 공유폴더 서류(2026-10-08) — 위 종류 쪽과 달리
    //    **두 단계**다. 수리 건은 모델 마스터의 id 를 들고 있지 않고(장비의 이름만 든다),
    //    가리킴 표의 주인은 그 id 라 **먼저 id 를 알아내야** 조회할 수 있다. 그래서 두
    //    조회를 한 묶음으로 싸서 `Promise.all` 의 **한 자리**에 넣는다 — 위 세 조회의
    //    병렬성은 그대로 두고, 이 안에서만 순서가 생긴다.
    //
    //    🔴 **모델을 못 찾으면 거기서 멈춘다**(DB 를 더 읽지 않고 빈 목록이다). 그런 건이
    //    실제로 있다: 장비가 모델 마스터에 안 묶였거나(products.product_model_id 는 NULL 을
    //    허용한다), 묶인 모델이 휴지통에 있다. 그 둘을 한 자리에서 null 로 떨어뜨리는 함수가
    //    이미 있어(queries/repair-cases.ts 의 getProductModelIdForProduct — 막다른 길을 막는
    //    것이 그 함수의 일이다) 판정을 여기 베껴 적지 않는다. 화면은 빈 목록을 여느 0건과
    //    똑같이 다뤄 구역을 아예 그리지 않는다.
    //
    //    🔴 여기서도 공유폴더(디스크)는 읽지 않는다 — DB 표뿐이다(위와 같은 선).
    (async () => {
      if (!resolved.productId) return [];
      const productModelId = await getProductModelIdForProduct(resolved.productId);
      if (!productModelId) return [];
      return listShareDocsForProductModel(productModelId);
    })(),
  ]);

  // 화면이 올리기 칸과 지우기·되살리기 버튼을 보일지 말지. 실제 판정은 업로드
  // 라우트와 서버 액션이 각자 다시 한다 — 여기서 숨기는 것은 눌러도 막히는
  // 버튼을 내밀지 않기 위해서다.
  const canManageFiles = actingUser
    ? await hasPermission(actingUser, "repairCases.files", "WRITE")
    : false;

  // 🔴 사내 공유폴더가 설정된 환경인가(조각 12). 꺼져 있으면 화면이 [DATA에 저장]을
  // **아예 그리지 않는다** — 눌러도 막히는 단추를 내밀지 않는다. 🔴 나가는 것은 참/거짓
  // 하나뿐이고 루트 값(.env)은 화면으로 가지 않는다.
  //
  // 🔴 공유폴더 **읽기**는 여기서 하지 않는다 — 그러면 NAS 가 느린 날 이 탭이 통째로 안
  // 뜬다(읽기는 화면이 뜬 뒤 공유폴더 구역이 따로 한다). 설정을 보는 것은 `process.env`
  // 한 줄이라 디스크를 건드리지 않는다.
  const contactFolderEnabled = resolveContactFolderArchiveRoot() !== null;

  // 🔴 가리킨 공유폴더 서류를 **이 건 폴더로 가져올 수 있는가**(2026-10-08).
  // 셋이 모두 참이어야 한다 — **읽을 곳**(수리 관련)과 **쓸 곳**(연락서 폴더)이 둘 다
  // 있어야 성립하는 일이고, 파일을 하나 늘리는 일이라 이 탭의 쓰기 권한이 필요하다.
  // 🔴 하나라도 거짓이면 두 구역이 단추를 **아예 그리지 않는다** — 눌러도 막히는 단추를
  // 내밀지 않는다. 🔴 나가는 것은 참/거짓 하나뿐이고 루트 값(.env)은 화면으로 가지 않는다.
  // 🔴 여기서도 공유폴더(디스크)는 읽지 않는다 — 설정을 보는 것은 `process.env` 한 줄이다.
  const shareDocCopyEnabled =
    canManageFiles && contactFolderEnabled && resolveRepairDocsArchiveRoot() !== null;

  return (
    <FilesScreen
      resolved={resolved}
      actingUser={actingUser}
      attachments={attachments}
      trashedAttachments={trashedAttachments}
      canUpload={canManageFiles}
      canManage={canManageFiles}
      contactFolderEnabled={contactFolderEnabled}
      shareDocCopyEnabled={shareDocCopyEnabled}
      kindShareDocs={kindShareDocs}
      modelShareDocs={modelShareDocs}
    />
  );
}
