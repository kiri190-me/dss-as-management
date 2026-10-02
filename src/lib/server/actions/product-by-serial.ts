"use server";

import { readSession } from "@/lib/auth/session";
import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasAreaAccess } from "@/lib/auth/area-guard";
import { getRepairCaseReadSource } from "@/lib/config/read-source";
import { findProductsBySerialNumber, type ProductBySerial } from "@/lib/db/queries/products";

/**
 * Server Action: 명판에서 읽은 **S/N 으로 등록된 장비**를 찾아 준다.
 *
 * 글자 인식이 세 칸 가운데 S/N 을 가장 잘 읽는다(실측 4/5). 그 한 칸으로
 * 장비를 찾아 Model·L/N 을 가져오면, 안 읽히는 두 칸을 사진에서 캐낼 필요가
 * 없다. 읽기 전용이다 — 쓰지 않는다.
 *
 * ── 게이트는 `intake-number-preview.ts` 와 **같은 순서·같은 기준**이다 ──
 * 읽기 소스 → 세션 → 승인 상태 → `repairCaseNew` 영역 접근. 그 파일을 본보기로
 * 삼은 까닭은 **쓰임새가 같기 때문**이다: 둘 다 접수 화면(`/repair-cases/new`)
 * 안에서만 불리는 읽기 전용 보조 조회이고, 그 화면은
 * `requireAreaAccessForCurrentUser("repairCaseNew")` 로 막혀 있다. 화면을
 * 막아 놓고 액션을 열어 두면 **가드를 우회해 같은 자료를 긁어 갈 수 있다.**
 *
 * 🔴 여기서 새는 것은 「우리가 어떤 장비를 몇 대 들고 있는가」다 — 고객사
 * 장비의 모델명·로트번호가 그대로 나간다. 접수 화면에 들어올 수 없는 계정이
 * S/N 을 넣어 가며 장비 대장을 훑을 수 있으면 안 된다.
 *
 * 🔴 **실패를 사용자에게 알리지 않고 빈 배열로 돌려준다.** 이 조회가 안 되면
 * 글자 인식 결과를 그대로 쓰면 될 뿐, 접수가 막히는 일이 아니다 — 오류 문구를
 * 띄우면 아무 문제 없는 접수를 담당자가 고장으로 오해한다.
 */
export async function findProductBySerialAction(serial: string): Promise<ProductBySerial[]> {
  if (getRepairCaseReadSource() !== "database") return [];

  const session = await readSession();
  if (!session) return [];

  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser || actingUser.approvalStatus !== "APPROVED") return [];

  if (!(await hasAreaAccess("repairCaseNew", actingUser))) return [];

  try {
    return await findProductsBySerialNumber(serial);
  } catch {
    // 조회가 실패해도 글자 인식 결과는 그대로 살아 있어야 한다.
    return [];
  }
}
