import type { Metadata } from "next";
import IntakeForm from "@/components/repair-cases/new/IntakeForm";
import { getIntakeReferenceData } from "@/lib/db/queries/repair-case-references";
import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { requireAreaAccessForCurrentUser } from "@/lib/auth/area-guard";

export const metadata: Metadata = {
  title: "A/S 접수 | DSS A/S 관리 시스템",
};

export const dynamic = "force-dynamic";

export default async function RepairCaseNewPage() {
  // 역할별 접근 권한(사용자 관리 > 역할별 접근 권한)에서 이 메뉴가 꺼져 있으면
  // 주소를 직접 입력해도 들어올 수 없다 — 사이드바에서 감추는 것만으로는
  // 막은 것이 아니다.
  await requireAreaAccessForCurrentUser("repairCaseNew");

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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">A/S 접수</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        이 화면에서 등록한 접수 건은 데이터베이스에 저장됩니다.
      </p>
      <IntakeForm referenceData={referenceData} canRegisterProductModel={canRegisterProductModel} />
    </div>
  );
}
