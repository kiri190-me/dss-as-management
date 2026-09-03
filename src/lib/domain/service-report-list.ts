/**
 * ============================================================================
 * 보고서 목록 한 줄의 이름
 * ============================================================================
 * 사용자가 정한 표기다:
 *
 *     RFK300FH-AD1_WU8042_1612027
 *     └──모델명───┘ └L/N─┘ └─S/N─┘
 *
 * ── 왜 문서번호가 이름이 아닌가 ─────────────────────────────────────────
 * 예전에는 이름 자리에 문서번호가 있었다. 그런데 그 번호는 **사람이 손으로 적는
 * 값**이고 실제로는 거의 비어 있어서, 목록이 「문서번호 없음」만 늘어선 채로
 * 어느 장인지 알아볼 수가 없었다. 장비를 가리키는 셋을 붙이면 목록에서 눈으로
 * 골라낼 수 있다(`quote-list.ts` 의 `buildQuoteSummaryLine` 과 같은 판단이다 —
 * 다만 그쪽은 공백으로 잇고 여기는 **밑줄**이다).
 *
 * 🔴 그렇다고 **문서번호를 버리지는 않는다.** 지금까지 이름 자리에 있던 값이므로
 * 목록 조각이 발행일 옆에 작은 글씨로 남긴다(`ServiceReportList` ·
 * `ServiceReportTabs`). 이 함수는 그것을 **되돌아갈 자리**로만 쓴다.
 *
 * ── ⚠️ L/N 이 먼저고 S/N 이 나중이다 ────────────────────────────────────
 * 값의 모양으로 짐작하면 틀린다 — **WU 접두가 L/N, 숫자만인 쪽이 S/N** 이다
 * (`schema/service-reports.ts` 가 그렇게 못 박아 두었고, 견적서 목록에서 실제로
 * 한 번 틀렸던 자리다). 칸 이름을 그대로 믿고, **그것을 시험으로 못 박는다**
 * (service-report-list.test.ts).
 *
 * ── 🔴 값은 보고서에 저장된 글자 스냅샷이다 ────────────────────────────
 * 조회는 `service_reports.model_name_text` · `lot_number_text` ·
 * `serial_number_text` 를 읽어 이 함수에 넘긴다 — 접수 건의 **지금** 값이
 * 아니다. 이미 낸 문서는 원본이 정정돼도 따라 바뀌면 안 된다는 것이 그 표가
 * 글자 스냅샷을 들고 있는 까닭이다.
 *
 * ── 왜 순수 함수인가 ────────────────────────────────────────────────────
 * 「사용중」 목록과 「휴지통」 목록이 **같은 이름 규칙**을 써야 한다. 두 조회가
 * 각자 join 하면 언젠가 한쪽만 다른 모양으로 붙는다(견적서 줄이 같은 이유로
 * 한 함수에 모여 있다).
 *
 * ⚠️ 이 모듈은 브라우저에서도 돈다 — 아무것도 값으로 가져오지 않는다. 특히
 * `@/lib/xlsx/*` 는 `node:fs`·`node:zlib` 를 끌고 와 클라이언트 번들을 깨뜨린다
 * (`ServiceReportTabs` 머리말의 그 규칙). 타입만 `import type` 은 안전하다.
 * ============================================================================
 */

export type ServiceReportListNameParts = {
  /** 보고서에 저장된 형식(모델명) 스냅샷. */
  modelName: string | null;
  /** L/N — 위 '⚠️' 항목 참조. 이름에서 S/N 보다 **앞**이다. */
  lotNumber: string | null;
  /** S/N */
  serialNumber: string | null;
  /**
   * `No. [앞]-[중간]-[뒤]` 를 이은 문서번호(`formatServiceReportNumber`).
   * 장비 셋이 다 비었을 때만 쓰인다.
   */
  reportNumber: string;
};

/**
 * 넷 다 비었을 때. 이름 없는 줄은 누를 곳이 어디인지도 알려 주지 못한다 —
 * 목록 조각이 예전에 「문서번호 없음」을 적던 자리와 같은 뜻이다.
 */
export const SERVICE_REPORT_LIST_NAME_FALLBACK = "이름 없음";

/**
 * 목록 한 줄의 이름.
 *
 * 🔴 **빈 칸은 통째로 뺀다** — 자리를 비워 두면 `RFK300FH-AD1__WU12345` 처럼
 * 밑줄이 겹쳐 "무언가 빠졌다"가 아니라 "글자가 깨졌다"로 읽힌다. 공백만 적힌
 * 값도 없는 것으로 접는다(`buildQuoteSummaryLine` 과 같은 규칙).
 *
 * 되돌아가는 순서는 셋이다: **장비 셋 → 문서번호 → 「이름 없음」.**
 */
export function buildServiceReportListName(parts: ServiceReportListNameParts): string {
  const equipment = [parts.modelName, parts.lotNumber, parts.serialNumber]
    .map((piece) => piece?.trim() ?? "")
    .filter((piece) => piece.length > 0)
    .join("_");
  if (equipment !== "") return equipment;

  const reportNumber = parts.reportNumber.trim();
  return reportNumber === "" ? SERVICE_REPORT_LIST_NAME_FALLBACK : reportNumber;
}
