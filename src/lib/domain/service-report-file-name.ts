import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 내려받는 검사·수리 보고서 파일의 이름
 * ============================================================================
 * `quote-file-name.ts` 와 같은 이유, 같은 규칙이다 — 받는 사람의 다운로드
 * 폴더에서 **어느 건인지 바로 알아볼 수 있어야** 한다. 종류(검사/수리)와
 * 고객사, 문서번호 셋이면 충분하다.
 *
 * ── 🔴 종류가 이름의 맨 앞이다 ──────────────────────────────────────────
 * 검사 보고서와 수리 보고서는 **같은 통합문서에서 나온다.** 같은 접수 건으로 두
 * 장을 만들면 나머지 두 조각(고객사·문서번호)이 같을 수 있어서, 종류가 없으면
 * 브라우저가 두 번째 파일을 `(1)` 을 붙여 저장한다 — 어느 쪽이 수리인지는 열어
 * 봐야 안다.
 *
 * ── RFC 5987 은 견적서 것을 그대로 쓴다 ─────────────────────────────────
 * `quoteContentDisposition` 은 견적서 도메인에 묶여 있지 않다(글자 하나를
 * 받는다). 한글 파일명을 브라우저마다 깨지지 않게 보내는 규칙을 두 벌 두면
 * 한쪽만 고쳐지는 날이 온다. 그래서 여기서 새로 쓰지 않고 그대로 내보낸다.
 *
 * ── 파일 이름에 쓸 수 없는 글자 ─────────────────────────────────────────
 * `\ / : * ? " < > |` 와 제어문자. 고객사 이름에 `㈜A/S 사업부` 처럼 슬래시가
 * 들어가는 일이 실제로 있고, 제어문자는 헤더에 그대로 실리면 응답을 깨뜨린다.
 *
 * 🔴 제어문자는 **정규식 대신 코드 포인트로** 가른다. 정규식에 적은 유니코드
 * 이스케이프는 편집기·도구를 거치는 동안 조용히 **진짜 제어문자로 풀려** 소스에
 * 박히는 일이 있고(이 파일을 만들면서 실제로 겪었다), 그러면 눈에 보이지 않는
 * 채로 규칙이 달라진다. 숫자로 견주면 그 위험이 없다.
 * ============================================================================
 */

export { quoteContentDisposition as serviceReportContentDisposition } from "./quote-file-name";

const REPORT_LABELS: Record<ServiceReportKind, string> = {
  INSPECTION: "검사보고서",
  REPAIR: "수리보고서",
};

/** Windows 가 파일 이름에 허용하지 않는 글자. */
const FORBIDDEN_CHARACTERS = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

/** 이름이 길어지면 브라우저·파일시스템마다 다르게 잘린다. 넉넉하되 상한은 둔다. */
const MAX_PART_LENGTH = 60;

/** DEL(127)과 그 아래의 제어문자. */
function isControlCharacter(code: number): boolean {
  return code < 32 || code === 127;
}

function sanitize(value: string): string {
  let cleaned = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += FORBIDDEN_CHARACTERS.has(character) || isControlCharacter(code) ? " " : character;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, MAX_PART_LENGTH).trim();
}

/**
 * 보고서 번호를 사람이 읽는 한 덩어리로.
 *
 * 양식은 이 번호를 세 칸에 나눠 적는다(`AF13` `No. {앞} - ` · `AM13` 중간 ·
 * `AQ13` 뒤, 사이의 `-` 는 양식이 갖고 있다). 파일 이름에는 그 모양을 그대로
 * 옮긴다 — 문서를 열었을 때 보이는 번호와 파일 이름이 같아야 찾을 수 있다.
 *
 * 앞자리는 없을 수 있다(채우개가 `No. ` 만 적는다). 빈 조각은 빼고 잇는다 —
 * `Z494--4013` 같은 이름이 나오지 않게.
 */
export function formatServiceReportNumber(reportNumber: {
  prefix?: string;
  middle: string;
  tail: string;
}): string {
  return [reportNumber.prefix, reportNumber.middle, reportNumber.tail]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join("-");
}

export function buildServiceReportFileName(input: {
  kind: ServiceReportKind;
  customerName: string;
  reportNumber: string;
}): string {
  const label = REPORT_LABELS[input.kind] ?? "보고서";
  const parts = [sanitize(input.customerName), sanitize(input.reportNumber)].filter(
    (part) => part.length > 0
  );

  // 둘 다 비는 일은 없다(검증이 고객사명과 번호를 필수로 막는다). 그래도 빈
  // 이름을 내보내지는 않는다 — 이름 없는 첨부는 브라우저가 `download` 로 저장한다.
  return parts.length > 0 ? `${label}_${parts.join("_")}.xlsx` : `${label}.xlsx`;
}
