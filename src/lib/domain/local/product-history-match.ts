import type { ResolvedRepairCase } from "./resolved-repair-case";

/**
 * 제품이력 매칭 전략(명시적으로 문서화):
 *  - 두 건 모두 MOCK 소스이면 기존과 동일하게 productId 정확 일치로 비교한다
 *    (기존 모의 데이터 결과와 100% 동일 — 모의 제품 9종은 모두 서로 다른
 *    model/L·N/S·N 조합이라 productId 일치와 정규화 3필드 일치가 항상
 *    같은 결과를 낸다).
 *  - 비교 대상 중 하나라도 LOCAL_DEMO(local 임베디드 스냅샷, productId 없음)이면
 *    정규화된 Model + L/N + S/N 세 값이 모두 일치할 때만 매칭한다.
 * 이 로직을 임의로 전부 정규화-3필드 비교로 바꾸지 않는다 — mock-to-mock
 * 경로는 기존 productId 매칭을 그대로 유지해 기존 상세 페이지 결과가
 * 바뀌지 않도록 한다.
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

export type RelatedMatch = Pick<
  ResolvedRepairCase,
  "id" | "source" | "intakeNumber" | "receivedAt" | "status" | "actualShipmentDate"
>;

function toRelatedMatch(c: ResolvedRepairCase): RelatedMatch {
  return {
    id: c.id,
    source: c.source,
    intakeNumber: c.intakeNumber,
    receivedAt: c.receivedAt,
    status: c.status,
    actualShipmentDate: c.actualShipmentDate,
  };
}

/**
 * 접수 폼 작성 중(아직 저장되지 않은 초안) 실시간 안내에 쓰는 조회다.
 * 초안은 productId가 없으므로 항상 정규화된 Model+L/N+S/N으로만 비교한다.
 * 저장된 건이 아니므로 제외할 "자기 자신"이 없다.
 */
export function findProductHistoryMatchesForDraft(
  all: ResolvedRepairCase[],
  draft: { modelName: string; lotNumber: string; serialNumber: string }
): RelatedMatch[] {
  const model = normalize(draft.modelName);
  const lot = normalize(draft.lotNumber);
  const serial = normalize(draft.serialNumber);
  if (!model || !lot || !serial) return [];

  return all
    .filter((candidate) => matchesNormalizedTriple(candidate, draft))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map(toRelatedMatch);
}
