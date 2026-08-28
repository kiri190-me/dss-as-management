import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../client";
import { customerRepairRequests, customers } from "../schema";
import type { IntakeDraftData } from "@/lib/domain/local/draft-storage";

/**
 * 고객 수리 의뢰 하나를 접수 폼의 초기값으로 옮긴다.
 *
 * ■ 옮기는 것과 옮기지 않는 것
 *
 * 옮긴다: 고객사(링크가 가리킨 진짜 id) · 모델명(자유 입력) · L/N · S/N ·
 * 증상 · 연락처 셋.
 *
 * 옮기지 않는다: 유·무상(billingType), 워크플로 종류, 제품모델 마스터 id,
 * 인수일. 앞의 셋은 사람이 판단할 값이고, 인수일은 **물건이 들어온 날**이지
 * 고객이 의뢰를 넣은 날이 아니다. 자세한 근거는 부르는 페이지 주석에 있다.
 *
 * ■ 증상을 어디에 넣는가
 *
 * `reportedSymptom`(고객이 말한 증상)에 넣는다. 그게 정확히 그 칸의 뜻이고,
 * 점검 결과(`intakeInspectionResult`)와 섞으면 나중에 "고객이 뭐라고 했나"를
 * 되짚을 수 없다. 고객이 적은 다른 긴 글들(점검·조치 사항, 추가 확인 ①~⑥)은
 * 여기 넣지 않는다 — 접수 폼에 그것을 담을 칸이 없고, 억지로 비고에 몰아넣으면
 * 담당자가 읽어야 할 것과 참고만 할 것이 뒤섞인다. 그 내용은 의뢰 상세 화면에
 * 그대로 남아 있다.
 */
export type IntakePrefill = {
  customerName: string;
  draft: Partial<IntakeDraftData>;
};

export async function loadIntakePrefill(
  requestId: string
): Promise<IntakePrefill | null> {
  // 아무 uuid나 주소에 넣어도 조회 자체는 돌아간다. 없으면 null 이고 폼은
  // 평범한 빈 폼으로 열린다 — 여기서 오류를 띄우면 주소를 잘못 눌렀을 뿐인
  // 사람이 접수를 아예 못 만든다.
  const [row] = await db
    .select({
      status: customerRepairRequests.status,
      customerId: customerRepairRequests.customerId,
      customerName: customers.name,
      productModelName: customerRepairRequests.productModelName,
      lotNumber: customerRepairRequests.lotNumber,
      serialNumber: customerRepairRequests.serialNumber,
      symptomDescription: customerRepairRequests.symptomDescription,
      contactName: customerRepairRequests.contactName,
      contactPhone: customerRepairRequests.contactPhone,
      contactEmail: customerRepairRequests.contactEmail,
    })
    .from(customerRepairRequests)
    .innerJoin(customers, eq(customerRepairRequests.customerId, customers.id))
    .where(eq(customerRepairRequests.id, requestId));

  if (!row) return null;

  // 이미 접수가 되었거나 반려된 의뢰는 다시 옮기지 않는다. 옮기면 같은 물건에
  // 접수번호가 둘 생긴다 — 실제 선점은 전환 액션이 하지만, 화면에서도 미리
  // 막아 사람이 헛수고를 하지 않게 한다.
  if (row.status !== "NEW" && row.status !== "CONVERTING") return null;

  return {
    customerName: row.customerName,
    draft: {
      // 고객사만은 고객이 친 글자가 아니라 담당자가 링크를 발급할 때 고른
      // 진짜 id 다. 그래서 id 로 넣는다 — 이름으로 넣으면
      // resolveOrCreateCustomerByName 이 새 고객사를 만들 수 있다.
      customerId: row.customerId,
      customerName: row.customerName,
      customerCreateNew: false,

      // 모델명은 글자만. 마스터 id 는 비워 두어 유사이름 추천이 뜨게 한다.
      modelName: row.productModelName,
      lotNumber: row.lotNumber,
      serialNumber: row.serialNumber,

      reportedSymptom: row.symptomDescription,

      contactName: row.contactName,
      contactPhone: row.contactPhone,
      contactEmail: row.contactEmail ?? "",
    },
  };
}
