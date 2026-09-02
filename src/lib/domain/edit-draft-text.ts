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
 * 고객사 편집 화면(CustomerEditForm)의 이름표. **기본 맵을 쓰지 않는다.**
 *
 * 세 이름(contactName · contactEmail · contactPhone)이 위 EDIT_DRAFT_LABELS 에도
 * 같은 이름으로 있지만, 그것을 그대로 쓸 수는 없다:
 *  - `name`(고객사명)이 위 맵에 **없다.** 수리 건 인수 정보에서 고객사는 콤보박스라
 *    UUID 로 남고, 손으로 친 이름이 남는 것은 "새로 등록"일 때뿐이다
 *    (newCustomerName). 이 화면은 고객사 자체를 고치는 자리라 그 칸이 자유 입력이다.
 *  - 화면에 놓인 차례가 다르다(이 화면은 이메일이 전화보다 위다). 상자에 나오는
 *    차례는 사람이 방금 보고 있던 폼의 차례여야 다시 옮겨 적기 쉽다.
 *
 * **rowColor 는 없다** — 팔레트에서 고르는 값이라 다시 고르는 데 몇 초면 되고,
 * 저장되는 것은 `blue` 같은 팔레트 키라 보여 줘 봐야 사람에게 뜻이 없다
 * (파일 헤더의 '왜 자유 입력만인가'). updatedAt·id 도 마찬가지로 없다.
 */
export const CUSTOMER_DRAFT_LABELS: Readonly<Record<string, string>> = {
  name: "고객사명",
  contactName: "담당자 성함",
  contactEmail: "연락처(이메일)",
  contactPhone: "연락처(전화)",
};

/**
 * 제품모델 편집 화면(ProductModelEditForm)의 이름표.
 *
 * **kind(제품 종류)는 없다.** 화면에서 `<select>` 로 고르는 값이고(Generator ·
 * Matcher · Total Controller · 미지정), 저장되는 것은 `GENERATOR` 같은 내부
 * 값이다 — 상자에 넣으면 사람이 읽을 수 없는 글자가 정작 잃은 글을 밀어낸다.
 * 파일 헤더가 '고르는 값(… 종류)은 다시 고르는 데 몇 초면 된다'고 적은 그 칸이
 * 바로 이것이다.
 *
 * ── 🔴 manufacturer(제조사)도 없다 (되살리지 말 것) ─────────────────────
 * 그 자리는 화면에서 `고객사` 로 바뀌었고, **제조사 입력칸은 폼에 없다.** 그런데
 * 값 자체는 지워지지 않게 폼이 그대로 다시 실어 보낸다(ProductModelEditForm 의
 * `manufacturer` 상태 — 칼럼을 남겨 둔 뜻이 성립하려면 값이 살아 있어야 한다).
 * 즉 저장하려던 묶음에는 여전히 제조사가 들어 있지만, 그것은 **사람이 방금 친
 * 글이 아니다.** 여기에 이름표를 남겨 두면 충돌 상자가 사용자가 적지도 않은
 * 값을 "당신이 적어 둔 글"로 되돌려 준다. 그래서 뺐다.
 *
 * ── 고객사는 넣지 않는다 ────────────────────────────────────────────────
 * 이 상자는 **글로 친 것**을 살리는 자리인데 고객사는 목록에서 **고른** 것이다
 * (저장되는 값은 customerIds — uuid 배열이라 사람이 읽을 수 없다). 게다가 폼이
 * 얼어도 고른 칩은 화면에 그대로 보이므로 잃을 것이 없다. 파일 헤더의 '내부
 * id는 사람이 읽을 수 없어 보여 주면 오히려 방해다'가 그대로 적용된다.
 *
 * 남은 둘은 전부 손으로 친 글이다(설명은 `<textarea>` 라 여러 줄이 들어간다).
 * 차례는 화면에 놓인 차례 그대로다.
 */
export const PRODUCT_MODEL_DRAFT_LABELS: Readonly<Record<string, string>> = {
  modelName: "모델명",
  description: "설명",
};

/**
 * 검사·수리 보고서 폼(ServiceReportForm)의 이름표.
 *
 * 이 화면도 낙관적 잠금이라 두 사람이 같은 보고서를 열어 두면 나중 사람이
 * CONFLICT 를 받는다. 그리고 이 화면이 **가장 많이 잃는다** — 확인내용·조치·정리는
 * 한 장에 수백 줄까지 간다(`SERVICE_REPORT_MAX_BODY_ROWS`). 파일 헤더의 '오래
 * 적을수록 부딪힐 확률이 높고, 오래 적었을수록 많이 잃는다'가 그대로다.
 *
 * 차례는 화면에 놓인 차례다 — 머리(문서번호 → 고객사 → 발생 장소 → 제품) →
 * 상황 → 조치 → 본문 → 비고. 다시 옮겨 적을 때 위에서부터 훑을 수 있어야 한다.
 *
 * ── 없는 것과 그 까닭 ───────────────────────────────────────────────────
 * · **날짜 칸 전부**(발행일·접수일·발생 년월일·현품 인수일·조치 완료일) — 파일
 *   헤더의 '날짜는 다시 고르는 데 몇 초면 된다'.
 * · **고르는 값**(종류·품명·상황 요청·원인 체크·현장수리/대품출고 체크) — 같은
 *   이유이고, 저장되는 값이 `PART_DEFECT` 같은 내부 코드라 보여 줘도 뜻이 없다.
 * · **숫자 칸**(제조 년·월, 사용 년수·개월수) — 대부분 S/N 에서 자동으로 채워지고,
 *   폼을 다시 열면 같은 규칙으로 다시 채워진다.
 * · 🔴 **findingsIntro(정형 문구)** — 화면이 미리 채워 둔 문장이지 사람이 친 글이
 *   아니다. 여기 이름표를 두면 충돌 상자가 **사용자가 적지도 않은 문장**을
 *   "당신이 적어 둔 글"로 되돌려 준다(위 PRODUCT_MODEL_DRAFT_LABELS 의
 *   manufacturer 와 똑같은 함정이다).
 * · 🔴 **occurredOnText** — 양식의 견본이 `―――` 인 칸이라 사람이 적는 글이라기보다
 *   자리 표시다.
 */
export const SERVICE_REPORT_DRAFT_LABELS: Readonly<Record<string, string>> = {
  // ── 머리
  reportNumberPrefix: "보고서번호(앞)",
  reportNumberMiddle: "보고서번호(중간)",
  reportNumberTail: "보고서번호(뒤)",
  customerName: "고객사명",
  customer: "고객사(제출처)",
  occurrencePlace: "발생 장소",
  occurrencePlaceDetail: "발생 장소(상세)",
  productCategory: "품명(둘째 줄)",
  modelName: "형식",
  lotNumber: "L/N",
  serialNumber: "S/N",
  situationDetail: "상황(상세)",

  // ── 조치
  goodsReceiptNumber: "현품 인수 번호",
  repairNumber: "수리 번호",

  // ── 본문 · 비고
  findings: "확인내용",
  actions: "조치",
  summary: "정리",
  remark: "비고",
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
