import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProductModelKindFilesScreen from "@/components/product-models/ProductModelKindFilesScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { getAuthSource } from "@/lib/config/auth-source";
import { hasPermission } from "@/lib/auth/permission-resolver";
import {
  listAttachmentsForProductModelKind,
  listTrashedAttachmentsForProductModelKind,
} from "@/lib/db/queries/product-model-kind-attachments";
import { listShareDocsForProductModelKind } from "@/lib/db/queries/product-model-kind-share-docs";
import { isProductModelKind } from "@/lib/domain/product-model-kind";

export const metadata: Metadata = {
  title: "종류별 공통 서류 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

/**
 * ============================================================================
 * /product-models/kinds/{종류코드} — 종류 하나가 통째로 나눠 쓰는 서류함
 * ============================================================================
 * 제품 모델 상세(/product-models/[id])와 **같은 문지기**를 쓴다 — 같은 메뉴 안의
 * 자리이고, 보는 조건도 바꾸는 조건도 모델 자료와 같아야 한다:
 *
 *   메뉴 접근   requireAreaAccessForCurrentUser("productModels")
 *   저장 모드    데이터베이스 모드에서만
 *   보기        productModels.view READ
 *   올리기·지우기 productModels.files WRITE  → canManageFiles 로 화면에 내려보낸다
 *
 * 🔴 **권한을 새로 만들거나 넓히지 않았다.** 네 줄 전부 모델 상세 page.tsx 에서
 * 글자 그대로 가져온 것이고, 실제 차단은 언제나처럼 업로드 라우트와 서버 액션이
 * 각자 다시 한다(화면에서 감추는 것은 편의일 뿐 경계가 아니다).
 *
 * ── 🔴 주소의 마디가 종류가 아니면 404 ───────────────────────────────────
 * URL 에 오는 것은 **enum 코드**다(GENERATOR · MATCHER · TOTAL_CONTROLLER). 한글을
 * 주소에 쓰지 않는 까닭은 저장 경로와 같다 — 인코딩이 다르게 풀리는 자리를 만들지
 * 않는다. 셋 중 하나가 아니면 `notFound()` 로 보낸다: 아무 글자나 넣어 들어오면
 * 「빈 서류함」이 끝없이 만들어지고, 그 주소가 링크로 돌아다니기 시작한다.
 *
 * 이 판정은 **권한 확인보다 뒤**다. 앞에 두면 권한 없는 사람이 404 와 「권한 없음」을
 * 갈라 받으면서 종류 목록을 떠볼 수 있다 — 지금은 두 경우 모두 같은 「권한 없음」
 * 화면이다.
 * ============================================================================
 */
export default async function ProductModelKindFilesPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  // 역할별 접근 권한에서 이 메뉴가 꺼져 있으면 주소를 직접 입력해도 들어올 수
  // 없다 — 목록 화면과 같은 첫 관문이다.
  await requireAreaAccessForCurrentUser("productModels");

  if (getAuthSource() !== "database") {
    return (
      <PlaceholderPage
        title="종류별 공통 서류"
        description="이 화면은 데이터베이스 저장 모드에서만 사용할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) {
    redirect("/login");
  }
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) {
    redirect("/login");
  }

  if (!(await hasPermission(actingUser, "productModels.view", "READ"))) {
    return <PlaceholderPage title="종류별 공통 서류" description="이 화면에 접근할 권한이 없습니다." />;
  }

  const { kind } = await params;
  if (!isProductModelKind(kind)) {
    notFound();
  }

  // 서류를 **올리고 지우는** 권한. 보는 것은 위 productModels.view 로 이미
  // 판정했다 — 좁히는 것은 바꾸는 쪽뿐이고, 모델 상세와 같은 규칙이다.
  const canManageFiles = await hasPermission(actingUser, "productModels.files", "WRITE");

  // 서로 기다릴 이유가 없어 함께 띄운다. 셋 다 읽기 전용이고, 셋 다 **DB 만** 본다.
  //
  // 🔴 **공유폴더(디스크)를 여기서 읽지 않는다.** 가리킴 목록은 표에 적힌 경로 줄일
  // 뿐이라 DB 한 번이고, 그 자리에 실제로 무엇이 있는지를 들여다보는 일은 화면이 뜬
  // 뒤 클라이언트가 통로로 따로 묻는다(components/product-models/KindShareFolderPicker).
  // NAS 가 느린 날 이 화면 자체가 안 뜨는 것을 막는 선이고, 수리 건 「파일 관리」 탭이
  // 그은 선과 같다.
  const [attachments, trashedAttachments, shareDocs] = await Promise.all([
    listAttachmentsForProductModelKind(kind),
    listTrashedAttachmentsForProductModelKind(kind),
    listShareDocsForProductModelKind(kind),
  ]);

  return (
    <ProductModelKindFilesScreen
      kind={kind}
      attachments={attachments}
      trashedAttachments={trashedAttachments}
      shareDocs={shareDocs}
      canManageFiles={canManageFiles}
    />
  );
}
