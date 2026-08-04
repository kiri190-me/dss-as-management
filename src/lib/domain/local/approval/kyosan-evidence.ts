export type KyosanEvidenceStatus = "NOT_AVAILABLE" | "RECEIVED";

export type KyosanEvidenceSnapshot = {
  status: KyosanEvidenceStatus;
  evidenceType: string | null;
  referenceNumber: string | null;
  evidenceDate: string | null;
  note: string;
};

const EVIDENCE_NOTE = "실제 이메일이나 문서는 첨부되지 않은 데모 증빙입니다.";

/**
 * 교산 출하 승인 증빙은 내부 승인 레코드가 아니며 localStorage에 저장하지
 * 않는다 — RepairStatus로부터 유무를 추론하지도 않는다(워크플로 상태가
 * 바뀐다고 이 값이 바뀌지 않는다). repairCaseId로만 조회하는 고정된 읽기
 * 전용 시드 맵이며, mock/local 어느 쪽 id를 넣어도 동일하게 동작한다(local
 * id는 이 맵에 없으므로 항상 NOT_AVAILABLE을 반환한다).
 */
const KYOSAN_EVIDENCE_SEED: Record<string, Omit<KyosanEvidenceSnapshot, "note">> = {
  "rc-001": {
    status: "RECEIVED",
    evidenceType: "이메일 회신",
    referenceNumber: "KY-EMAIL-260601",
    evidenceDate: "2026-06-20",
  },
  "rc-003": {
    status: "RECEIVED",
    evidenceType: "PDF 문서",
    referenceNumber: "KY-DOC-260603",
    evidenceDate: "2026-06-24",
  },
  "rc-005": {
    status: "RECEIVED",
    evidenceType: "이메일 회신",
    referenceNumber: "KY-EMAIL-260702",
    evidenceDate: "2026-07-20",
  },
};

export function getKyosanEvidenceSnapshot(repairCaseId: string): KyosanEvidenceSnapshot {
  const seed = KYOSAN_EVIDENCE_SEED[repairCaseId];
  if (!seed) {
    return { status: "NOT_AVAILABLE", evidenceType: null, referenceNumber: null, evidenceDate: null, note: EVIDENCE_NOTE };
  }
  return { ...seed, note: EVIDENCE_NOTE };
}
