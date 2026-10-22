/**
 * ============================================================================
 * 인수번호 조회 통로가 **글자로** 하는 일 — 모양 검사와 응답 만들기
 * ============================================================================
 * DB 도 Next 도 부르지 않는다. 그래서 `npm test`(DB 없는 목록)에서 그대로 돌려
 * 볼 수 있다 — 라우트 자체는 DB 를 부르므로 시험이 직접 부를 수 없다.
 *
 * 받는 쪽은 재고 관리의 `src/lib/stock/intake-lookup.ts` 다. 그 파일의
 * `IntakeInfo` 가 기대하는 여섯 칸이 아래 `ExternalIntakeResponse` 와 같은 이름,
 * 같은 순서다. 그쪽 `parseLookupResponse` 는 `product_model` 같은 다른 이름도
 * 받아 주지만, 약속한 이름 하나로만 내보낸다.
 *
 * 🔵 2026-10-22: **`receivedAt`(인수일) 을 일곱째 칸으로 더했다.** 재고 관리의
 * [부품 요청]·[승인요청건] 화면이 model · L/N · S/N · 인수일 · 고객사를 보여 주려는데
 * 인수일만 못 받고 있었다(이 조사의 출발점). 🔴 **기존 여섯 칸의 이름·모양은 그대로다**
 * — 한 칸을 더하는 것이고, 받는 쪽이 아직 이 칸을 읽지 않아도 깨지지 않는다.
 * ============================================================================
 */

/**
 * 인수번호 모양: `D` + 숫자 6자리 (예 `D260701`).
 *
 * 🔴 재고 관리 쪽 `INTAKE_NUMBER_RE`(`src/lib/stock/codes.ts`)와 **같은 규칙**이다.
 * 두 시스템이 다른 잣대로 재면 한쪽이 400 이라 부르지도 못하는 번호를 다른 쪽은
 * 받아들이는 어긋남이 난다.
 *
 * ⚠️ DB 의 CHECK 는 이보다 좁다 — `repair_cases` 의
 * `^D[0-9]{2}(0[1-9]|1[0-2])[0-9]{2}$`(가운데 두 자리가 달이라 01~12).
 * 여기서 좁히지 않는 것은 **두 시스템의 약속을 맞추기 위해서**이고, 좁은 쪽에
 * 걸리는 번호(예 `D269901`)는 어차피 그런 건이 없으므로 404 로 나간다.
 */
export const EXTERNAL_INTAKE_NUMBER_RE = /^D\d{6}$/;

/**
 * 질의가 돌려주는 한 줄. 조인이 안 붙으면 칸이 null 로 온다.
 *
 * 🔵 `receivedAt` 만 조인이 아니라 `repair_cases` 자신의 칸(`received_at`,
 * `NOT NULL`)이라서 `string | null` 이 아니다 — 건이 있으면 항상 값이 있다.
 */
export type ExternalIntakeRow = {
  intakeNumber: string;
  customerName: string | null;
  endUser: string | null;
  productModel: string | null;
  productSerial: string | null;
  productLot: string | null;
  receivedAt: string;
};

/** 밖으로 나가는 모양. 🔴 칸 이름이 다른 시스템과의 약속이다. */
export type ExternalIntakeResponse = {
  intakeNumber: string;
  customerName: string;
  endUser: string;
  productModel: string;
  productSerial: string;
  productLot: string;
  /**
   * 인수일, "YYYY-MM-DD" (예 "2026-10-22"). 🔵 **모양을 정한 까닭:**
   * `repair_cases.received_at` 은 drizzle 스키마에서 `date("received_at")` —
   * mode 를 "date" 로 올리지 않은 기본값이라, drizzle 이 이미 날짜 전용 글자
   * "YYYY-MM-DD" 로 돌려준다(JS `Date` 객체가 아니다 — 이 저장소의 다른 곳,
   * 예컨대 `lib/db/mappers/repair-case.ts` 의 `receivedAt: row.receivedAt` 도
   * 같은 글자를 그대로 쓴다). 그래서 여기서도 **그 글자를 그대로** 내보낸다 —
   * Date 로 바꿔 쓰거나 `toISOString()` 을 거치지 않는다. 🔴 **시간대 계산을
   * 하지 않는 것 자체가 하루 어긋남을 막는 방법이다** — 애초에 시각이 없는
   * 날짜 전용 글자라 KST/UTC 변환이 끼어들 자리가 없다. 받는 쪽도 이 글자를
   * 그대로(파싱해 자정으로 바꾸지 않고) 보여 주는 용도로만 쓰면 하루가
   * 밀리거나 당겨지는 일이 없다.
   */
  receivedAt: string;
};

/** 받은 글자를 다듬는다 — 앞뒤 공백을 떼고 대문자로. `d260701` 도 같은 번호다. */
export function normalizeIntakeNumber(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidIntakeNumber(intakeNumber: string): boolean {
  return EXTERNAL_INTAKE_NUMBER_RE.test(intakeNumber);
}

/**
 * 🔴 **없는 값은 빈 글자다. null 을 내보내지 않는다.** 받는 쪽(`IntakeInfo`)의
 * 여섯 칸이 전부 `string` 이고, 화면이 그 값을 그대로 이어 붙여 사용처 글자를
 * 만든다(`buildUsagePlace`). null 이 가면 거기에 "null" 이 섞여 들어간다.
 */
function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function buildIntakeLookupResponse(row: ExternalIntakeRow): ExternalIntakeResponse {
  return {
    intakeNumber: row.intakeNumber,
    customerName: text(row.customerName),
    endUser: text(row.endUser),
    productModel: text(row.productModel),
    productSerial: text(row.productSerial),
    productLot: text(row.productLot),
    // 🔴 text() 를 거치지 않는다 — NOT NULL 칸이라 null 다듬기가 필요 없고,
    // "YYYY-MM-DD" 를 trim 하면(공백이 있을 리 없지만) 모양이 바뀌지 않으므로
    // 그대로 내보내는 것이 "받은 글자를 손대지 않는다"는 이 칸의 약속과 맞다.
    receivedAt: row.receivedAt,
  };
}
