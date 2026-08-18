export type ExcelImportIssueDisplayKind = "REVIEW" | "NOTICE" | "MAPPING_PENDING";

export type ExcelImportIssueDisplay = {
  kind: ExcelImportIssueDisplayKind;
  title: string;
  reason: string;
  action: string;
};

const DEFAULT_DISPLAY: ExcelImportIssueDisplay = {
  kind: "REVIEW",
  title: "원본 내용 확인 필요",
  reason: "자동 처리 방법을 안전하게 결정할 수 없습니다.",
  action: "원본 내용을 확인하고 처리 방법을 선택해 주세요.",
};

const ISSUE_DISPLAYS: Readonly<Record<string, ExcelImportIssueDisplay>> = {
  INTAKE_NUMBER_MALFORMED: { kind: "REVIEW", title: "인수번호 형식 확인", reason: "인수번호를 승인된 형식으로 해석할 수 없습니다.", action: "올바른 인수번호를 확인해 주세요." },
  INTAKE_NUMBER_DUPLICATED: { kind: "REVIEW", title: "중복 인수번호 확인", reason: "파일 안에 같은 인수번호가 둘 이상 있습니다.", action: "각 행이 같은 수리 건인지 확인해 주세요." },
  RECEIVED_DATE_PARTIAL: { kind: "REVIEW", title: "인수일 확인", reason: "연·월·일이 모두 없어 날짜를 확정할 수 없습니다.", action: "정확한 인수일을 확인해 주세요." },
  RECEIVED_DATE_TWO_DIGIT_YEAR: { kind: "REVIEW", title: "인수일 연도 확인", reason: "두 자리 연도는 세기를 안전하게 판단할 수 없습니다.", action: "네 자리 연도를 확인해 주세요." },
  RECEIVED_DATE_INVALID_CALENDAR_DATE: { kind: "REVIEW", title: "인수일 확인", reason: "실제로 존재하지 않는 날짜입니다.", action: "정확한 인수일을 확인해 주세요." },
  RECEIVED_DATE_SERIAL_OUT_OF_RANGE: { kind: "REVIEW", title: "Excel 날짜 값 확인", reason: "Excel 날짜 값이 허용 범위를 벗어났습니다.", action: "원본 날짜를 확인해 주세요." },
  RECEIVED_DATE_UNINTERPRETABLE: { kind: "REVIEW", title: "인수일 해석 필요", reason: "원문을 날짜 하나로 안전하게 해석할 수 없습니다.", action: "사용할 인수일을 선택해 주세요." },
  REQUIRED_FORMULA_CACHE_MISSING: { kind: "REVIEW", title: "수식 결과 확인", reason: "수식 셀에 저장된 계산 결과가 없습니다.", action: "Excel에서 수식을 다시 계산한 뒤 저장해 주세요." },
  LOT_NUMBER_CONFLICT: { kind: "REVIEW", title: "이전 L/N 판정 기록", reason: "이전 Parser가 참고용 I열의 과거 입고 횟수를 L/N과 비교한 기록입니다.", action: "새 검토 정책으로 다시 분석해 주세요." },
  NUMERIC_IDENTITY_FORMAT_RISK: { kind: "REVIEW", title: "식별번호 저장 형식 확인", reason: "숫자 저장 방식 때문에 앞자리 0이나 자릿수가 손실되었을 가능성이 있습니다.", action: "원본 표시와 실제 L/N 또는 S/N을 확인해 주세요." },
  NUMERIC_IDENTITY_NORMALIZED: { kind: "NOTICE", title: "숫자형 식별번호 자동 변환", reason: "안전한 정수 숫자 셀을 문자열 식별번호로 변환했습니다.", action: "별도 조치는 필요하지 않습니다." },
  LEGACY_REPORT_NUMBER_FORMAT_RISK: { kind: "NOTICE", title: "보고서번호 표시 확인", reason: "Excel 숫자 저장 방식 때문에 표시 문자열을 완전히 복원하지 못했을 수 있습니다.", action: "원본 Excel의 표시값과 보고서번호를 확인해 주세요." },
  // Read-only compatibility for persisted v1-v3 Preview rows. Parser v6 no
  // longer emits this code; it emits a non-blocking pending-billing notice.
  BILLING_AMBIGUOUS: { kind: "REVIEW", title: "유·무상 확인 필요", reason: "이전 분석에서 유·무상 원문을 하나로 확정하지 못했습니다.", action: "새 Parser로 재분석하거나 원문을 확인해 주세요." },
  BILLING_PENDING_EMPTY: { kind: "NOTICE", title: "유·무상 추후결정", reason: "원본 유·무상 셀이 비어 있어 추후결정으로 이관합니다.", action: "접수 후 작업을 시작하기 전에 유상·일부유상·무상 중 하나로 확정해 주세요." },
  BILLING_PENDING_UNRESOLVED: { kind: "NOTICE", title: "유·무상 추후결정", reason: "원문에서 유상·일부유상·무상 중 하나를 안전하게 확정할 수 없어 추후결정으로 이관합니다.", action: "접수 후 작업을 시작하기 전에 유상·일부유상·무상 중 하나로 확정해 주세요." },
  STATUS_REQUIRES_REVIEW: { kind: "REVIEW", title: "상태 확인 필요", reason: "서로 다른 상태 후보가 동시에 발견되었습니다.", action: "적용할 현재 상태를 선택해 주세요." },
  SHIPMENT_DATE_MULTIPLE: { kind: "REVIEW", title: "출하일 확인 필요", reason: "현재 상태 원문에 날짜가 여러 개 있어 출하일 하나를 안전하게 선택할 수 없습니다.", action: "정식 출하일을 확인해 주세요." },
  SHIPMENT_DATE_UNINTERPRETABLE: { kind: "REVIEW", title: "출하일 해석 필요", reason: "현재 상태 원문의 날짜를 유효한 네 자리 연도 날짜로 해석할 수 없습니다.", action: "정식 출하일을 확인해 주세요." },
  BUSINESS_COLOR_REQUIRES_REVIEW: { kind: "REVIEW", title: "업무 색상 확인 필요", reason: "U열 셀 배경이 승인된 흰색·무채움 또는 노란색 서명과 일치하지 않습니다.", action: "출하 완료인지 진행 중인지 확인해 주세요." },
  LEGACY_STATUS_FILL_CONFLICT: { kind: "REVIEW", title: "상태와 행 색상 충돌", reason: "현재 상태 문구와 행 또는 셀의 색상 근거가 서로 다릅니다.", action: "출하 완료인지 진행 중인지 확인해 주세요." },
  LEGACY_STATUS_DATE_CONFLICT: { kind: "REVIEW", title: "진행 상태와 날짜 충돌", reason: "진행 중 상태 문구와 출하일로 보이는 날짜가 함께 있습니다.", action: "현재 상태와 날짜 의미를 확인해 주세요." },
  SHIPMENT_DATE_NOT_AVAILABLE: { kind: "NOTICE", title: "출하일 없음", reason: "출하 완료로 판정했지만 U열에서 안전한 출하일을 찾지 못했습니다.", action: "수리 건은 완료 단계로 이관되며 출하일은 비워 둡니다." },
  STATUS_MAPPING_PENDING: { kind: "MAPPING_PENDING", title: "상태 단계 연결 대기", reason: "상태 후보는 확인됐지만 DB workflow 단계 연결이 남아 있습니다.", action: "다음 매핑 단계에서 시스템이 workflow 단계를 연결합니다." },
  MULTIPLE_DATES_IN_CELL: { kind: "REVIEW", title: "복수 날짜 확인", reason: "한 셀에 날짜가 여러 개 있어 자동 선택이 위험합니다.", action: "이관에 사용할 날짜를 선택해 주세요." },
  ASSIGNEE_MAPPING_PENDING: { kind: "MAPPING_PENDING", title: "담당자 연결 대기", reason: "현재 사용자 계정과 정확히 일치하는 담당자를 찾지 못했습니다.", action: "다음 매핑 단계에서 담당자 원문 그룹을 계정에 연결하거나 비워 둘 수 있습니다." },
  ASSIGNEE_MULTIPLE_MATCHES: { kind: "MAPPING_PENDING", title: "담당자 연결 대기", reason: "같은 이름으로 일치하는 사용자 계정이 여러 명입니다.", action: "연결할 담당자 계정을 선택하거나 비워 두세요." },
  ASSIGNEE_AUTO_MATCHED: { kind: "NOTICE", title: "담당자 자동 연결", reason: "담당자 원문과 정확히 일치하는 사용자 계정 하나를 찾았습니다.", action: "별도 조치는 필요하지 않습니다." },
  CUSTOMER_MAPPING_PENDING: { kind: "MAPPING_PENDING", title: "고객사 연결 대기", reason: "고객사 마스터 조회 단계가 남아 있습니다.", action: "다음 매핑 단계에서 고객사를 연결합니다." },
  END_USER_MAPPING_PENDING: { kind: "MAPPING_PENDING", title: "End-User 연결 대기", reason: "End-User 마스터 조회 단계가 남아 있습니다.", action: "다음 매핑 단계에서 End-User를 연결합니다." },
  PRODUCT_MODEL_MAPPING_PENDING: { kind: "MAPPING_PENDING", title: "Product Model 연결 대기", reason: "Product Model 마스터 조회 단계가 남아 있습니다.", action: "다음 매핑 단계에서 Product Model을 연결합니다." },
  CUSTOMER_AUTO_MATCHED: { kind: "NOTICE", title: "고객사 자동 연결", reason: "정확히 일치하는 기존 고객사 하나를 찾았습니다.", action: "별도 조치는 필요하지 않습니다." },
  END_USER_AUTO_MATCHED: { kind: "NOTICE", title: "End-User 자동 연결", reason: "연결된 고객사 범위에서 정확히 일치하는 End-User 하나를 찾았습니다.", action: "별도 조치는 필요하지 않습니다." },
  PRODUCT_MODEL_AUTO_MATCHED: { kind: "NOTICE", title: "Product Model 자동 연결", reason: "제품 종류와 Model이 모두 일치하는 기존 Product Model 하나를 찾았습니다.", action: "별도 조치는 필요하지 않습니다." },
  UNEXPECTED_DATA_OUTSIDE_IMPORT_RANGE: { kind: "NOTICE", title: "이관 범위 밖 데이터", reason: "A:Y 범위 밖에 값이 있습니다.", action: "이관 대상이 아니라면 별도 조치는 필요하지 않습니다." },
  HYPERLINK_PRESENT: { kind: "NOTICE", title: "하이퍼링크 포함", reason: "원본 파일에 하이퍼링크가 포함되어 있습니다.", action: "링크는 자동 실행되지 않습니다." },
};

export function excelImportIssueDisplay(code: string): ExcelImportIssueDisplay {
  return ISSUE_DISPLAYS[code] ?? DEFAULT_DISPLAY;
}

/** Backward-compatible short description for upload-level errors. */
export function excelImportIssueMessage(code: string): string {
  return excelImportIssueDisplay(code).reason;
}
