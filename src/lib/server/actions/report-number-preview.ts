"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasAreaAccess } from "@/lib/auth/area-guard";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { getNextReportNumberPreview } from "@/lib/db/queries/report-number-preview";

/**
 * Server Action: A/S 접수 폼의 보고서번호 칸에 흐리게 띄울 "예상 번호".
 *
 * 게이트는 intake-number-preview.ts 와 **같은 순서·같은 기준**이다(읽기 소스 →
 * 세션 → 권한). 실패를 사용자에게 알리지 않고 전부 null 로 돌려주는 것도 같다 —
 * 접수를 좌우하는 값이 아니라 편의용 힌트라서, 못 읽으면 칸이 비어 있을 뿐이어야
 * 한다. 오류 문구를 띄우면 아무 문제 없는 접수를 담당자가 고장으로 오해한다.
 *
 * 권한을 그래도 확인하는 이유도 같다: 보고서번호는 올해 접수가 몇 건 들어왔는지를
 * 그대로 드러낸다(세 자리 순번이 곧 건수에 가깝다). 접수 화면에 들어올 수 없는
 * 계정이 이 액션만 직접 불러 그 수를 세어 갈 수 있으면 화면 가드를 우회하는
 * 셈이 된다 — new/page.tsx 가 requireAreaAccessForCurrentUser("repairCaseNew")
 * 로 막는 것과 같은 기준을 여기서 한 번 더 본다(리다이렉트 대신 null).
 *
 * 인수번호 쪽과 달리 **인자가 없다.** 기준이 인수일이 아니라 오늘이기 때문이다
 * (queries/report-number-preview.ts 머리말).
 */
export async function previewNextReportNumberAction(): Promise<string | null> {
  if (getRepairCaseReadSource() !== "database") return null;

  const session = await readSession();
  if (!session) return null;

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || actingUser.approvalStatus !== "APPROVED") return null;

  if (!(await hasAreaAccess("repairCaseNew", actingUser))) return null;

  try {
    return await getNextReportNumberPreview();
  } catch {
    // 조회가 실패해도 접수는 그대로 된다 — 미리보기만 사라진다.
    return null;
  }
}
