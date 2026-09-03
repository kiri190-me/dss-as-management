import {
  SERVICE_REPORT_LIST_NAME_FALLBACK,
  buildServiceReportListName,
} from "./service-report-list";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * ============================================================================
 * 내려받는 검사·수리 보고서 파일의 이름
 * ============================================================================
 * `quote-file-name.ts` 와 같은 이유다 — 받는 사람의 다운로드 폴더에서 **어느
 * 장비의 것인지 바로 알아볼 수 있어야** 한다. 모양은 이렇다
 * (**2026-09-03 사용자 결정**):
 *
 *     검사보고서_RFK300FH-AD1_WU8042_1612027.xlsx
 *     └─종류─┘ └──모델명───┘ └L/N─┘ └─S/N─┘
 *
 * ── 🔴 장비 셋을 잇는 규칙은 여기 없다 ─────────────────────────────────
 * 뒷부분은 **목록 한 줄의 이름 그대로**다(`domain/service-report-list.ts` 의
 * `buildServiceReportListName`). 그 함수를 가져다 쓰는 까닭은 하나다 — **목록에
 * 보이는 이름과 내려받은 파일 이름이 같아야** 사람이 둘을 이어 붙일 수 있다.
 * 여기서 `modelName_lotNumber_serialNumber` 를 다시 이으면 「사용중」·「휴지통」·
 * 파일 이름 셋이 서로 다른 규칙으로 갈라지는 날이 온다.
 *
 * 되돌아가는 순서(**장비 셋 → 문서번호**)도 그 함수의 것이라 공짜로 따라온다.
 * 다만 그 함수의 마지막 갈래인 「이름 없음」은 **파일 이름이 아니다** — 목록의
 * 빈 줄을 가리키는 말이라 파일에는 종류만 남긴다(아래).
 *
 * 🔴 고객사명은 이름에서 뺐다. 같은 고객사의 장비 여러 대를 한 폴더에 받으면
 * 이름이 전부 같아져 `(1)` `(2)` 로 갈리는데, 그때 어느 것이 어느 장비인지는
 * 열어 봐야 알 수 있었다.
 *
 * ── 🔴 종류가 이름의 맨 앞이다 ──────────────────────────────────────────
 * 검사 보고서와 수리 보고서는 **같은 통합문서에서 나온다.** 같은 장비로 두 장을
 * 만들면 나머지 조각이 **모두 같으므로**, 종류가 없으면 브라우저가 두 번째
 * 파일을 `(1)` 을 붙여 저장한다 — 어느 쪽이 수리인지는 열어 봐야 안다.
 *
 * ── RFC 5987 은 견적서 것을 그대로 쓴다 ─────────────────────────────────
 * `quoteContentDisposition` 은 견적서 도메인에 묶여 있지 않다(글자 하나를
 * 받는다). 한글 파일명을 브라우저마다 깨지지 않게 보내는 규칙을 두 벌 두면
 * 한쪽만 고쳐지는 날이 온다. 그래서 여기서 새로 쓰지 않고 그대로 내보낸다.
 *
 * ── 파일 이름에 쓸 수 없는 글자 ─────────────────────────────────────────
 * `\ / : * ? " < > |` 와 제어문자. 형식·L/N·S/N 은 사람이 손으로 적는 칸이라
 * 슬래시가 섞여 들어오는 일이 실제로 있고, 제어문자는 헤더에 그대로 실리면
 * 응답을 깨뜨린다.
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

/**
 * `[종류]_[모델명]_[L/N]_[S/N].xlsx`.
 *
 * 장비 셋이 다 비면 문서번호로 되돌아가고(그 순서는
 * `buildServiceReportListName` 의 것이다), 그것마저 비면 **종류만** 남는다 —
 * 빈 이름을 내보내지 않는다(이름 없는 첨부는 브라우저가 `download` 로 저장한다).
 *
 * 🔴 장비 셋은 **안 준 것과 빈 것이 같은 뜻**이라 `undefined` 도 받는다. 채우개
 * 입력(`ServiceReportInput`)은 없는 칸을 `undefined` 로 들고 있고, 목록 쪽은
 * `null` 로 들고 있다 — 부르는 자리에서 한쪽으로 맞추게 하지 않는다.
 */
export function buildServiceReportFileName(input: {
  kind: ServiceReportKind;
  /** 형식. `null`·`undefined`·빈 글자 모두 「없음」이다. */
  modelName?: string | null;
  /** L/N — 🔴 이름에서 S/N 보다 **앞**이다(`service-report-list.ts` 의 '⚠️'). */
  lotNumber?: string | null;
  serialNumber?: string | null;
  /** `formatServiceReportNumber` 가 이어 준 문서번호. 장비 셋이 다 빌 때만 쓰인다. */
  reportNumber: string;
}): string {
  const label = REPORT_LABELS[input.kind] ?? "보고서";

  const name = buildServiceReportListName({
    modelName: input.modelName ?? null,
    lotNumber: input.lotNumber ?? null,
    serialNumber: input.serialNumber ?? null,
    reportNumber: input.reportNumber,
  });

  /**
   * 🔴 「이름 없음」은 **목록의 빈 줄을 가리키는 말**이지 파일 이름이 아니다 —
   * `수리보고서_이름 없음.xlsx` 보다 `수리보고서.xlsx` 가 낫다. 못 쓰는 글자만
   * 남은 값도(`///`) 다듬고 나면 빈 글자라 같은 갈래로 떨어진다.
   */
  const part = name === SERVICE_REPORT_LIST_NAME_FALLBACK ? "" : sanitize(name);
  return part === "" ? `${label}.xlsx` : `${label}_${part}.xlsx`;
}
