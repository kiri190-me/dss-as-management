import type { Metadata } from "next";
import IntakeForm from "@/components/repair-cases/new/IntakeForm";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";
import { loadIntakePrefill } from "@/lib/db/queries/customer-request-prefill";

export const metadata: Metadata = {
  title: "A/S 접수 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseNewPage({
  searchParams,
}: {
  searchParams: Promise<{ fromRequestId?: string }>;
}) {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("repairCaseNew");

  const { fromRequestId } = await searchParams;

  // 접수는 데이터베이스에만 등록되므로 고객사/End-User/엔지니어/Product Model
  // 후보도 항상 실제 데이터베이스에서 가져온다.
  const referenceData = await getIntakeReferenceData();

  // Product Model Master 연결 체크포인트 — "새 모델로 등록" 버튼을 보여줄지
  // 결정하는 UX 힌트일 뿐이다(실제 권한 재확인은 create-repair-case.ts
  // Server Action이 독립적으로 수행한다). 세션이 없으면 항상 false로 안전하게
  // 기본값 처리한다 — 이 페이지 자체는 계속 로그인을 강제하지 않는다(기존
  // 동작 유지, Server Action이 최종 인가자).
  const session = await readSession();
  const actingUser = session ? await resolveActingUserForSession(session) : null;
  const canRegisterProductModel =
    actingUser !== null && (await hasPermission(actingUser.role, "productModels.edit", "WRITE"));

  /*
   * 고객이 보낸 수리 의뢰에서 넘어왔으면 아는 값만 미리 채운다.
   *
   * ── 무엇을 채우지 않는가가 더 중요하다 ──────────────────────────────
   *
   *  billingType     비운다. 유상/무상은 상업적 판단이고 고객이 정할 수
   *                  없다. 비워 두면 기존 필수 검사가 그대로 걸린다.
   *  workflowType    건드리지 않는다. 종류 × 유상/무상에서 파생되는 값이라
   *                  billingType 을 사람이 고르기 전에는 정할 수 없다.
   *  productModelId  비운다. 자유 입력 modelName 만 채워, 기존 유사이름
   *                  추천이 떠서 사람이 마스터를 고르거나 새로 등록하게
   *                  한다. 여기서 id 를 찍어 주면 고객이 친 글자가 마스터
   *                  선택으로 굳어 버린다.
   *  receivedAt      건드리지 않는다(오늘). 인수일은 **물건이 실제로 들어온
   *                  날**이지 고객이 의뢰를 넣은 날이 아니다.
   *  customerId      링크가 가리키는 고객사 id 를 그대로 쓴다 — 이 값만은
   *                  고객이 친 글자가 아니라 담당자가 발급할 때 고른 것이다.
   */
  const prefill = fromRequestId
    ? await loadIntakePrefill(fromRequestId)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">A/S 접수</h1>
      {prefill ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <strong>{prefill.customerName}</strong> 이(가) 보낸 수리 의뢰에서
          옮겨 왔습니다. 유·무상과 제품 모델은 담당자가 확인해 주세요.
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          이 화면에서 등록한 접수 건은 데이터베이스에 저장됩니다.
        </p>
      )}
      <IntakeForm
        referenceData={referenceData}
        canRegisterProductModel={canRegisterProductModel}
        initialDraft={prefill?.draft}
        // 접수가 만들어지면 이 의뢰를 그 접수에 묶는다. prefill이 없으면
        // (없는 의뢰거나 이미 처리된 의뢰) 넘기지 않는다.
        fromRequestId={prefill ? fromRequestId : undefined}
      />
    </div>
  );
}
