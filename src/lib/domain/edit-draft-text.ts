/**
 * ============================================================================
 * 저장 충돌이 났을 때, 적어 둔 내용을 보여 주기 — 무엇을 보여 줄지 정하는 규칙
 * ============================================================================
 * 두 사람이 같은 수리 건을 동시에 고치면 서버가 낙관적 잠금으로 막는다
 * (repair_cases.version 불일치 → CONFLICT). 그러면 화면은 낡은 폼을 얼리고
 * "최신 정보 다시 불러오기" 하나만 남긴다. 그것을 누르면 폼이 언마운트되어
 * **방금 손으로 친 글이 통째로 사라진다.** 고장 증상을 열 줄 적어 두었어도
 * 전부 날아간다 — 오래 적을수록 부딪힐 확률이 높고, 오래 적었을수록 많이 잃는다.
 *
 * 그래서 얼리기 직전에 "저장하려던 값"에서 **사람이 직접 타이핑한 글만** 골라
 * 한 덩이로 만든다. 화면은 그것을 읽기 전용 상자에 담아 보여 주기만 한다.
 *
 * ── 왜 자유 입력만인가 ───────────────────────────────────────────────────
 * 고르는 값(유·무상, 우선순위, 종류)과 날짜는 다시 고르는 데 몇 초면 된다.
 * 내부 id(customerId/endUserId/productModelId)는 UUID라 **사람이 읽을 수 없어**
 * 보여 주면 오히려 방해다. 잃어서 아픈 것은 손으로 친 글뿐이다.
 *
 * ── 이 파일에서 계산만 떼어 둔 이유 ──────────────────────────────────────
 * 보여 주는 일은 브라우저(클립보드·선택)의 몫이지만, **무엇을 보여 줄지 고르는
 * 규칙**은 순수 계산이라 여기서 따로 검증할 수 있다. 규칙이 새면 UUID나 날짜가
 * 상자에 섞여 나오고, 반대로 너무 좁으면 정작 잃은 글이 안 보인다.
 * ============================================================================
 */

/**
 * 보여 줄 항목과 그 이름표. **여기 없는 항목은 절대 보여 주지 않는다.**
 *
 * 키는 validation/repair-case-update-input.ts의 SECTION_FIELD_NAMES에 있는
 * 이름 그대로다(어떤 항목이 존재하는지의 단일 출처). 그중 세 편집 폼에서
 * 실제로 `<textarea>`/자유 텍스트 `<input>`으로 입력받는 것만 골랐다 —
 * 새 항목이 섹션에 추가되어도 여기에 이름표를 적기 전까지는 새어 나오지
 * 않는다(id·날짜·선택값이 조용히 섞이는 것을 막는 안전장치다).
 *
 * 순서가 곧 화면에 나오는 순서다 — 인수 정보 → 제품 정보 → 고장·서비스 정보.
 */
export const EDIT_DRAFT_LABELS: Readonly<Record<string, string>> = {
  // ── 인수 정보 (INTAKE)
  // 고객사/End-User는 콤보박스다. 기존 것을 고르면 UUID(customerId/endUserId)만
  // 남으므로 보여 줄 것이 없고, "새로 등록"을 눌렀을 때만 사람이 친 이름이
  // 남는다 — 그 경우만 보여 준다.
  newCustomerName: "고객사(새로 등록)",
  newEndUserName: "End-User(새로 등록)",
  contactName: "담당자 성함",
  contactPhone: "연락처(전화)",
  contactEmail: "연락처(이메일)",
  // 보고서번호는 자동 채번도 형식 규칙도 없는 수기 입력값이다. 편집 지점이
  // 상단 요약 카드(ReportNumberEditCell)일 뿐, 같은 INTAKE 섹션으로 같은
  // 훅을 타고 저장되며 충돌도 똑같이 난다.
  legacyReportNumber: "보고서번호",

  // ── 제품 정보 (PRODUCT)
  newProductModelName: "Model(새로 등록)",
  lotNumber: "L/N",
  serialNumber: "S/N",
  accessoryList: "동봉 액세서리",
  externalConditionSummary: "외관 상태 요약",
  reasonForRemoval: "탈거 사유",

  // ── 고장 및 서비스 정보 (FAULT_SERVICE)
  reportedSymptom: "신고 증상",
  notes: "비고",
};

/**
 * 저장하려던 값에서 보여 줄 글을 만든다. **보여 줄 것이 없으면 빈 문자열**이다
 * (화면은 그때 상자를 아예 그리지 않는다 — 빈 상자는 무언가 잘못된 것처럼
 * 보인다).
 *
 * 이름표 맵의 순서로 훑는다 — 저장하려던 값이 어떤 순서로 담겨 왔든 화면에
 * 나오는 순서는 항상 같다. 값이 문자열이 아니거나(null 포함) 비어 있으면
 * 건너뛴다.
 *
 * 여러 줄로 적은 글은 **줄바꿈을 그대로 남긴다** — 고장 증상은 여러 줄로 적고,
 * 줄이 뭉개지면 다시 옮겨 적을 때 그만큼 손이 간다.
 */
export function buildDraftText(
  fields: Record<string, unknown>,
  labels: Readonly<Record<string, string>> = EDIT_DRAFT_LABELS
): string {
  const blocks: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const value = fields[key];
    // 문자열이 아닌 것은 전부 여기서 걸린다 — null(값 비움), undefined(제출되지
    // 않은 항목), 그리고 혹시 섞여 들어온 숫자·불리언까지.
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text === "") continue;
    blocks.push(`${label}\n${text}`);
  }
  return blocks.join("\n\n");
}
