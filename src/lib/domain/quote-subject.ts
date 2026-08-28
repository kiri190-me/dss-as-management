import type { QuoteKind } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 품명(건명)을 짓는다
 * ============================================================================
 * 양식의 `D13` 에 찍히고, 본문 첫 줄(`D23`)이 `=D13` 으로 그대로 받아 쓴다.
 * 사람이 매번 손으로 치던 값이라 **모델명과 신고증상으로 지어 준다**(사용자
 * 결정 2026-08-28).
 *
 *     RFK300FH-AD1 Bias Fwd Drop 수리 件
 *     RFK300FH-AD1 Bias Fwd Drop 수리 件 + OH      ← OH 견적서
 *
 * ── `수리 件` 과 ` + OH` 는 지어낸 말이 아니다 ──────────────────────────
 * 실제 발행본이 `KYOSAN 30/60kW Source RFG 수리 件 + OH` 이고, OH 양식의
 * `D13` 수식이 `내자견적서!D13 & " + OH"` 다. 표기를 그대로 따른다.
 *
 * ── 🔴 지어 주기만 하고 덮지 않는다 ────────────────────────────────────
 * 이 함수는 문자열을 만들 뿐이고, **언제 쓸지는 화면이 정한다.** 화면은 칸이
 * 비어 있을 때만 채우고, 다시 짓고 싶으면 사람이 단추를 누른다 — 인수번호를
 * 고쳐 불러올 때마다 손으로 다듬어 둔 품명이 사라지면 안 된다.
 *
 * ── 없는 조각은 통째로 뺀다 ────────────────────────────────────────────
 * 모델명도 신고증상도 없으면 **빈 문자열**이다. `수리 件` 만 남은 품명은 무엇에
 * 대한 견적인지 말해 주지 않으므로, 지어 주지 않고 사람에게 맡긴다.
 * ============================================================================
 */

/** 양식의 한 칸에 들어가는 값이라 길면 안 된다. validation 의 상한과 같다. */
const MAX_SUBJECT = 200;

const REPAIR_SUFFIX = "수리 件";
/** OH 양식의 `D13` 수식(`… & " + OH"`)과 글자까지 같아야 한다. */
export const OVERHAUL_SUFFIX = " + OH";

export function buildQuoteSubject(input: {
  modelName: string | null | undefined;
  faultDescription: string | null | undefined;
  kind: QuoteKind;
}): string {
  const modelName = input.modelName?.trim() ?? "";
  // 신고증상은 사람이 길게 적는 칸이다(최대 4000자). 줄바꿈이 섞이면 한 줄짜리
  // 품명이 깨지므로 공백으로 편다.
  const fault = (input.faultDescription ?? "").replace(/\s+/g, " ").trim();

  if (modelName === "" && fault === "") return "";

  const suffix = input.kind === "OVERHAUL" ? `${REPAIR_SUFFIX}${OVERHAUL_SUFFIX}` : REPAIR_SUFFIX;
  const head = [modelName, fault].filter((piece) => piece !== "").join(" ");
  const full = `${head} ${suffix}`;
  if (full.length <= MAX_SUBJECT) return full;

  /**
   * 넘치면 **신고증상만 줄인다.** 모델명과 꼬리말은 이 값이 무엇에 대한
   * 견적인지 말해 주는 부분이라 남겨야 하고, 잘린 자리에 `…` 를 남겨 사람이
   * 다듬을 곳을 알아보게 한다.
   */
  const modelPart = modelName === "" ? "" : `${modelName} `;
  const suffixPart = ` ${suffix}`;
  const room = MAX_SUBJECT - modelPart.length - suffixPart.length - 1; // 1 = "…"
  if (room <= 0) {
    // 모델명만으로도 상한을 넘는 경우. 실제로는 오지 않지만 잘라서라도 돌려준다.
    return full.slice(0, MAX_SUBJECT);
  }
  return `${modelPart}${fault.slice(0, room)}…${suffixPart}`;
}
