import type { ProcedureValidationConfidence } from "./procedure-template-types";

/**
 * Deterministic, display-only classification of the 13 real ERROR-severity
 * issues found during the Phase 2.5/3A workbook investigation — never used
 * to gate or auto-apply anything, only to show a reviewer a confidence
 * badge and starting guidance before they make their own decision.
 *
 * Matched by stable source identity (template code, worksheet, issue type,
 * source reference), never by a database row id — ids are re-minted every
 * time the importer re-runs (see --replace-current), and this module must
 * keep working for future imported issues it has never seen: `classify`
 * returns `undefined` for anything unmatched, and every caller must treat
 * that as "no pre-classification available," not an error.
 */

export type ProcedureValidationIssueGroup = "GROUP_1_DETERMINISTIC" | "GROUP_2_NEEDS_CONFIRMATION" | "GROUP_3_NEEDS_BUSINESS_INPUT";

export type KnownIssueClassification = {
  group: ProcedureValidationIssueGroup;
  confidence: ProcedureValidationConfidence;
  recommendedAction: string;
  reviewerGuidance: string;
};

type KnownIssueKey = {
  templateCode: string;
  sourceWorksheet: string;
  issueType: string;
  sourceReference: string;
};

const KNOWN_ISSUES: (KnownIssueKey & KnownIssueClassification)[] = [
  // ---- RFG Group 1 (HIGH) — one physical defect, two issue rows ----
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (4)기본 정전 검사",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#57",
    group: "GROUP_1_DETERMINISTIC",
    confidence: "HIGH",
    recommendedAction: "connector#57을 shape#58 \"스나바 콘덴서 용량 확인\"의 DEFAULT 분기로 연결",
    reviewerGuidance: "connector#57의 도형 끝점이 shape#58과 거리 1.00으로 사실상 맞닿아 있습니다 — 원본 도면에 실제로 그려져 있던 연결선이 바인딩만 유실된 경우입니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (4)기본 정전 검사",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#50",
    group: "GROUP_1_DETERMINISTIC",
    confidence: "HIGH",
    recommendedAction: "connector#57 이슈와 동일한 결함 — shape#58 \"스나바 콘덴서 용량 확인\"으로 연결하면 이 이슈도 함께 해결됩니다.",
    reviewerGuidance: "이 결정 노드(shape#50)의 미해결 기본 경로는 connector#57의 유실된 바인딩과 같은 원인입니다.",
  },
  // ---- MB Group 1 (HIGH) — reconstructs one clean 3-step chain ----
  {
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(MB) 통전검사",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#8",
    group: "GROUP_1_DETERMINISTIC",
    confidence: "HIGH",
    recommendedAction: "connector#8을 shape#20 \"VPP정격, VD-DET 정격 확인 실시\"의 DEFAULT 분기로 연결 (대상은 이미 shape#7로 바인딩됨)",
    reviewerGuidance: "connector#8의 시작점이 shape#20과 거리 1.50으로 가장 가깝습니다.",
  },
  {
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(MB) 통전검사",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#19",
    group: "GROUP_1_DETERMINISTIC",
    confidence: "HIGH",
    recommendedAction: "connector#19를 shape#6 \"VDC 정격 확인 실시\"의 DEFAULT 분기로 연결 (대상은 이미 shape#20으로 바인딩됨)",
    reviewerGuidance: "connector#8과 함께 \"VDC 정격 확인 → VPP정격,VD-DET 정격 확인 → 4방향 정합 동작 확인\"의 완전한 3단계 기본 경로를 복원합니다.",
  },
  // ---- RFG Group 2 (MEDIUM) ----
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (5)통전검사(3상입력)",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#274",
    group: "GROUP_2_NEEDS_CONFIRMATION",
    confidence: "MEDIUM",
    recommendedAction: "shape#259 \"D-NET 연결 확인\"이 유력한 시작 후보입니다(거리 2.50) — 자동 적용하지 말고 검토자가 확인 후 연결하십시오.",
    reviewerGuidance: "가장 가까운 도형이 \"NG\" 라벨(거리 1.80)이라 매칭 확신도가 낮습니다. 후보 목록을 직접 확인해 주세요.",
  },
  // ---- RFG Group 3 (LOW) — genuine single-branch source diagrams ----
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (4)기본 정전 검사",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#183",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 원본 도면에 NG 분기 1개만 존재하며 두 번째 연결선 자체가 없습니다.",
    reviewerGuidance: "\"종단 AMP 디바이스 기판 외관 및 다이오드 측정\" 정상 시 다음 단계가 무엇인지 담당자 확인이 필요합니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (6)개선 사항 확인",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#7",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 시작 도형에 텍스트가 없고 대상 후보도 5 이상 떨어져 있습니다.",
    reviewerGuidance: "이 시트는 shape#2/#5가 이미 UNREACHABLE_NODE로도 flag된, 원본 자체가 불완전한 3도형 시트입니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (7)원복 검사 및 개선 작업",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#26",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 원본 도면에 NG 분기 1개만 존재합니다.",
    reviewerGuidance: "\"MCU 신호 점검\" 정상 시 다음 단계 확인이 필요합니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (7)원복 검사 및 개선 작업",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#69",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 원본 도면에 NG 분기 1개만 존재합니다.",
    reviewerGuidance: "\"INTER LOCK 알람 발생 유무 확인\" 정상 시 다음 단계 확인이 필요합니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (7)원복 검사 및 개선 작업",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#328",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 두 분기 모두 원본에서 명시적으로 NG로 라벨링되어 있습니다 (거리 0.50/1.80으로 확인됨).",
    reviewerGuidance: "\"HB2 조정 가능 유무 확인\"에 정상(비-NG) 결과가 실제로 존재하는지, 아니면 이 노드는 항상 두 NG 경우 중 하나로 귀결되는지 업무 확인이 필요합니다.",
  },
  {
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (8)고객 연락",
    issueType: "MISSING_OUTGOING_PATH",
    sourceReference: "shape#10",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — \"유상 안건\"이 실제로는 단일 경로 상태이고 노드 분류가 과도하게 DECISION으로 판정되었을 가능성이 있습니다.",
    reviewerGuidance: "\"무상 안건\"과 나란히 있는 형제 상태 노드로 보입니다 — 두 번째 분기가 정말 필요한지 담당자 확인이 필요합니다.",
  },
  // ---- MB Group 3 (LOW) — likely decorative artifacts ----
  {
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(MB) 출하완료",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#11",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 양쪽 끝 모두 미확인이며 번호 매기기 원(①) 근처의 장식용 도형일 가능성이 높습니다.",
    reviewerGuidance: "원본 Excel 파일에서 육안으로 확인 후, 실제 분기가 아니라면 \"장식 도형으로 확인\"으로 해결하십시오.",
  },
  {
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(MB) 출하완료",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#13",
    group: "GROUP_3_NEEDS_BUSINESS_INPUT",
    confidence: "LOW",
    recommendedAction: "자동 해결 불가 — 양쪽 끝 모두 미확인이며 번호 매기기 원(②) 근처의 장식용 도형일 가능성이 높습니다.",
    reviewerGuidance: "connector#11과 동일한 패턴 — 원본 Excel 파일에서 육안으로 확인해 주세요.",
  },
];

function matches(key: KnownIssueKey, candidate: KnownIssueKey): boolean {
  return (
    key.templateCode === candidate.templateCode &&
    key.sourceWorksheet === candidate.sourceWorksheet &&
    key.issueType === candidate.issueType &&
    key.sourceReference === candidate.sourceReference
  );
}

/**
 * Returns the pre-classification for a known issue, or `undefined` if this
 * issue (by stable identity) wasn't part of the 13-issue investigation —
 * always the expected outcome for any newly imported issue in a future
 * phase. Callers must render an "unclassified" state, never treat a miss
 * as an error.
 */
export function classifyKnownValidationIssue(key: KnownIssueKey): KnownIssueClassification | undefined {
  const found = KNOWN_ISSUES.find((k) => matches(key, k));
  if (!found) return undefined;
  return {
    group: found.group,
    confidence: found.confidence,
    recommendedAction: found.recommendedAction,
    reviewerGuidance: found.reviewerGuidance,
  };
}
