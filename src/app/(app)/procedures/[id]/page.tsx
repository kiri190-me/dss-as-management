import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import PlaceholderPage from "@/components/layout/PlaceholderPage";
import ProcedureTemplateDetailScreen from "@/components/procedures/ProcedureTemplateDetailScreen";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  getProcedureTemplateDetail,
  listProcedureTemplateVersions,
  listUndeletableProcedureTemplateIds,
} from "@/lib/db/queries/procedure-templates";
import {
  mayEditTemplateOfCategory,
  mayCreateDraftVersionOfCategory,
  mayDeleteTemplateOfCategory,
  mayPublishTemplateOfCategory,
  mayViewSomeTemplate,
  mayViewTemplateOfCategory,
  mayViewEveryTemplateStatusOfCategory,
} from "@/lib/auth/technical-procedure-capabilities";
// 🔵 2026-11-27 — `actorMay` 가 이 화면에서 사라졌다. 역할 고정 정책 함수를 직접
//    부르는 자리가 **한 곳도 안 남았다**는 뜻이다(판정은 전부 설정을 보는 창구를
//    거치고, 그 창구 안에서 분류가 아닐 때만 역할 함수로 떨어진다).
import { hasPermission } from "@/lib/auth/permission-resolver";

export const metadata: Metadata = {
  title: "기술 절차 템플릿 상세 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProcedureTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const authSource = getAuthSource();
  if (authSource !== "database") {
    return (
      <PlaceholderPage
        title="기술 절차 템플릿"
        description="추후 이 화면에서 수리 절차 템플릿을 확인할 수 있습니다."
      />
    );
  }

  const session = await readSession();
  if (!session) redirect("/login");
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) redirect("/login");

  // 🔴 2026-11-27 — 역할 고정 canViewPublishedProcedureTemplates 에서 설정으로
  //    바뀌었다. **이 한 줄이 「조회를 넓혀도 안 열린다」의 전부였다** — 목록 화면은
  //    설정을 보는데 여기가 역할 고정이라, 열어 준 사람이 목록은 보면서 한 줄도
  //    못 열었다.
  // 🔵 여기는 템플릿 행을 읽기 **전**이라 분류를 모른다. 그래서 「둘 중 하나라도
  //    가능성이 있으면」 통과시키고(없는 id 로 찔러 보는 사람에게 행의 존재가 안
  //    새어 나가게 하는 그 차례는 그대로다), 행을 읽은 뒤 분류별 관문이 다시 본다.
  if (!(await mayViewSomeTemplate(actingUser))) {
    return (
      <PlaceholderPage
        title="기술 절차 템플릿"
        description="이 화면에 접근할 권한이 없습니다."
      />
    );
  }

  if (!UUID_PATTERN.test(id)) notFound();

  const template = await getProcedureTemplateDetail(id);
  if (!template) notFound();

  // 🔴 분류별 관문 — 기술 절차는 설정이, 나머지 분류는 공용 정책이 판정한다.
  //    notFound() 인 까닭은 아래 상태 관문과 같다: 볼 수 없는 사람에게 「그런 절차가
  //    있긴 하다」를 알려 주지 않는다.
  if (!(await mayViewTemplateOfCategory(actingUser, template.category))) notFound();

  // AS_ENGINEER (view-published-only) must never see a DRAFT/ARCHIVED
  // template just by knowing/guessing its id — the list already hides
  // these rows, this is the direct-URL backstop.
  //
  // 🔴 이 한 식이 **이 화면에서 "초안을 볼 수 있는가"의 유일한 답**이다. 아래
  // [버전 목록]도 같은 값을 쓴다 — 두 자리에 각각 적으면 어긋나는 날이 오고,
  // 어긋나는 방향은 둘 다 나쁘다: 느슨하면 못 여는 판이 목록에 떠서 누르는 족족
  // 404 가 되고, 빡빡하면 지금 보고 있는 판이 제 목록에서 사라진다.
  //
  // 🔴 2026-11-27(ㄱ안) — 역할 고정 canViewAllProcedureTemplateStatuses 에서 **분류별**
  // 판정으로 바뀌었다. 바로 그 「누르는 족족 404」가 실제로 나 있었다: 목록 화면은
  // 설정을 보는데 이 줄만 역할 고정이라, 설정으로 열어 준 사람이 목록에서 제 초안을
  // 보고 눌렀는데 여기서 notFound() 가 됐다.
  // 🔵 **기술 절차 가지만** 설정을 본다. 이 route 에는 전체 서비스·참고용 행도 주소로
  //    들어올 수 있어서(/procedures 의 리다이렉트 주석), 그 가지는 종전 함수 그대로다.
  const mayViewEveryStatus = await mayViewEveryTemplateStatusOfCategory(actingUser, template.category);
  if (template.status !== "PUBLISHED" && !mayViewEveryStatus) {
    notFound();
  }

  // 같은 code 줄기의 판 전부(볼 수 있는 것만). 상세에서 판을 갈아타는 길이다 —
  // 목록 화면이 줄기당 한 줄로 접혔으므로(2026-11-04), 판을 고르는 자리는 여기
  // 하나뿐이다.
  const versions = await listProcedureTemplateVersions(template.code, template.category, mayViewEveryStatus);

  // ── 게시 단추의 노출 판정 ──────────────────────────────────────────────
  // 서버(publishProcedureTemplate)가 트랜잭션 안에서 실제로 보는 **그 함수**를
  // 그대로 부른다. 다른 함수를 쓰면 "단추는 보이는데 누르면 늘 실패"(또는 그
  // 반대)가 만들어진다 — 커밋 af6da9b·1a75ac7 이 그 사고였다.
  //
  // 🔴 2026-11-27 — 여기 있던 **어긋남이 사라졌다.** 그 전까지 이 줄은 역할 고정
  // 함수 둘(canManageTechnicalTemplates · canActorPublishTemplateOfCategory)과
  // 설정 하나를 AND 로 묶고 있었다. 서버가 역할 고정이라서 그래야 했다 —
  // 설정에서 technicalProcedures.publish 를 넓혀도 mutation 이 다시 막았고,
  // 단추만 뜨는 거짓 약속을 피하려면 좁은 쪽을 함께 보는 수밖에 없었다.
  // 이제 mutation 이 같은 설정을 보므로 **AND 할 것이 없다.** 역할 고정 둘을
  // 다시 끼워 넣지 마라 — 그러면 설정으로 넓힌 사람이 화면에서만 막힌다.
  const canPublish = await mayPublishTemplateOfCategory(actingUser, template.category);

  // ── [버전 목록]의 [삭제] 노출 판정 (2026-11-04 사용자 요청) ────────────
  // 🔴 편집기의 [초안 버리기]와 **글자 그대로 같은 관문**이다
  //    (/procedures/[id]/edit/page.tsx 의 canDiscardDraft). 한쪽만 고치면
  //    "편집기에서는 되는데 상세에서는 안 되는" 단추가 생긴다.
  //
  // 🔴 2026-11-27 — 둘이 하나가 되었다. 그전까지 역할 고정
  //    canDeleteTechnicalTemplates 와 설정을 AND 로 묶었던 까닭은 서버가 역할
  //    고정이었기 때문이다(넓혀도 mutation 이 다시 막으니 단추만 뜨는 거짓 약속을
  //    피하려 좁은 쪽을 함께 봤다). 이제 서버가 **이 함수 그대로**를 부른다.
  // 🔵 **분류 조건은 안 풀렸다** — 그 함수가 TECHNICAL_TASK 를 먼저 묻는다.
  //    기술 절차가 아닌 행에서는 설정을 아무리 넓혀도 단추가 안 뜬다.
  const canDeleteVersion = await mayDeleteTemplateOfCategory(actingUser, template.category);

  // 🔴 「쓰이고 있어 못 지우는 판」은 **서버가 센다.** 목록 화면의 [삭제 모드]가
  //    쓰는 것과 **같은 조회**다 — 세는 잣대가 둘이 되면 화면에는 단추가 있는데
  //    서버는 거절하는 날이 온다.
  //    🔵 권한이 없으면 아예 읽지 않는다(쓸 데가 없는 조회를 매번 하지 않게).
  const referencedVersionIds = canDeleteVersion ? [...(await listUndeletableProcedureTemplateIds())] : [];

  return (
    <Suspense fallback={null}>
      <ProcedureTemplateDetailScreen
        template={template}
        versions={versions}
        canManageValidation={await hasPermission(actingUser, "technicalProcedures.validation", "READ")}
        canCreateDraftVersion={await mayCreateDraftVersionOfCategory(actingUser, template.category)}
        canEditDraft={await mayEditTemplateOfCategory(actingUser, template.category)}
        canPublish={canPublish}
        canDeleteVersion={canDeleteVersion}
        referencedVersionIds={referencedVersionIds}
      />
    </Suspense>
  );
}
