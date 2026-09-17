import type { ResolvedRepairCase } from "./resolved-repair-case";

/**
 * 제품이력 매칭 전략(명시적으로 문서화):
 *  - 두 건 모두 MOCK 소스이면 기존과 동일하게 productId 정확 일치로 비교한다
 *    (기존 모의 데이터 결과와 100% 동일 — 모의 제품 9종은 모두 서로 다른
 *    model/L·N/S·N 조합이라 productId 일치와 정규화 3필드 일치가 항상
 *    같은 결과를 낸다).
 *  - 두 건 모두 DATABASE 소스이면 repair_cases.product_id 정확 일치로 비교한다
 *    (products 표의 제품 개체 FK). 실제 운영 데이터에서는 같은 물건이
 *    재접수돼도 Model/L·N/S·N 문자열이 표기 차이로 어긋날 수 있고, 반대로
 *    서로 다른 개체가 같은 세 값을 가질 수도 있다 — FK 가 유일하게 믿을 수
 *    있는 동일성 기준이다.
 *  - 비교 대상 중 하나라도 LOCAL_DEMO(local 임베디드 스냅샷, productId 없음)이면
 *    정규화된 Model + L/N + S/N 세 값이 모두 일치할 때만 매칭한다.
 * 이 로직을 임의로 전부 정규화-3필드 비교로 바꾸지 않는다 — mock-to-mock
 * 경로는 기존 productId 매칭을 그대로 유지해 기존 상세 페이지 결과가
 * 바뀌지 않도록 한다. 반대로 정규화-3필드 폴백도 지우지 않는다 — 소스가
 * 섞인(LOCAL_DEMO 가 낀) 비교에는 여전히 이것뿐이다.
 */
function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function matchesNormalizedTriple(
  a: { modelName: string; lotNumber: string; serialNumber: string },
  b: { modelName: string; lotNumber: string; serialNumber: string }
): boolean {
  const aModel = normalize(a.modelName);
  const aLot = normalize(a.lotNumber);
  const aSerial = normalize(a.serialNumber);
  if (!aModel || !aLot || !aSerial) return false;
  return aModel === normalize(b.modelName) && aLot === normalize(b.lotNumber) && aSerial === normalize(b.serialNumber);
}

function isSameProduct(current: ResolvedRepairCase, candidate: ResolvedRepairCase): boolean {
  if (current.source === "MOCK" && candidate.source === "MOCK") {
    return (
      current.productId !== null &&
      candidate.productId !== null &&
      current.productId === candidate.productId
    );
  }
  if (current.source === "DATABASE" && candidate.source === "DATABASE") {
    return (
      current.productId !== null &&
      candidate.productId !== null &&
      current.productId === candidate.productId
    );
  }
  return matchesNormalizedTriple(current, candidate);
}

/**
 * 저장된 접수 건(mock 또는 local) 상세 페이지에서 쓰는 "과거 A/S 이력"
 * 조회다. 자기 자신을 제외하고, 접수일이 현재 건보다 이른 건만 포함하며,
 * 접수일 내림차순(최근 과거 이력 먼저)으로 정렬한다.
 */
export function findProductHistoryMatches(
  all: ResolvedRepairCase[],
  current: ResolvedRepairCase
): RelatedMatch[] {
  return all
    .filter(
      (candidate) =>
        candidate.id !== current.id &&
        candidate.receivedAt < current.receivedAt &&
        isSameProduct(current, candidate)
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map(toRelatedMatch);
}

/**
 * 이력 한 줄이 그리는 값들. `reportedSymptom`(신고증상)은 접수 때 적는 값이라
 * 이미 ResolvedRepairCase 에 실려 있으므로 여기서 옮겨 담기만 한다 — 별도
 * 조회가 없다.
 *
 * ⚠️ 짝이 되는 `조치 내용`은 **여기 없다.** 그 값은 접수 건의 칼럼이 아니라
 * 작업기록(repair_case_work_records)의 DIAGNOSIS_REPAIR_SUMMARY 최신 줄에서
 * 도출되고(queries/repair-case-work-records.ts 의
 * getDerivedServiceSummariesForCases), 화면은 그 결과를 건 id 로 찾아 그린다.
 * repair_cases 의 옛 텍스트 칼럼(current_diagnosis_summary)을 여기 끼워 넣지
 * 않는다 — 상세 화면 본문이 읽지 않는 칸이라, 이력 줄과 본문이 서로 다른 글을
 * 보이게 된다.
 */
export type RelatedMatch = Pick<
  ResolvedRepairCase,
  "id" | "source" | "intakeNumber" | "receivedAt" | "status" | "actualShipmentDate" | "reportedSymptom"
>;

function toRelatedMatch(c: ResolvedRepairCase): RelatedMatch {
  return {
    id: c.id,
    source: c.source,
    intakeNumber: c.intakeNumber,
    receivedAt: c.receivedAt,
    status: c.status,
    actualShipmentDate: c.actualShipmentDate,
    reportedSymptom: c.reportedSymptom,
  };
}
