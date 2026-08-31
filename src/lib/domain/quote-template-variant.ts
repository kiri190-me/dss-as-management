import type { WorkflowKind } from "./workflow-kind";
import type { QuoteKind } from "@/lib/validation/quote-input";

/**
 * ============================================================================
 * 견적서 하나가 어느 양식을 쓰는가 — 장비 종류 × 견적서 종류
 * ============================================================================
 * 양식은 넷이고 **기본 문구가 넷 다 다르다**(2026-08-31 실측). 특히 납기가
 * 제너레이터 내자 3주 · 제너레이터 OH 4주 · 매쳐 내자 약 3개월 · 매쳐 OH 6주로
 * 전부 갈린다.
 *
 * ── 왜 서버 모듈이 아니라 여기 있나 ─────────────────────────────────────
 * 양식 파일을 읽는 일은 서버만 할 수 있지만(storage/quote-template.ts 는
 * `server-only`), **어느 양식을 쓸지 고르는 규칙**은 화면도 알아야 한다 —
 * 견적서 폼은 사람이 종류를 바꾸는 순간 그에 맞는 문구로 갈아 끼운다.
 * 규칙을 두 곳에 적으면 한쪽만 고쳐지는 날이 오고, 그때 증상은 "화면에 뜨는
 * 납기와 실제로 나가는 납기가 다른" 것이다.
 * ============================================================================
 */

/** 양식 넷을 가리키는 키. `장비:종류` 꼴이다. */
export type QuoteTemplateKey =
  | "GENERATOR:DOMESTIC"
  | "GENERATOR:OVERHAUL"
  | "MATCHER:DOMESTIC"
  | "MATCHER:OVERHAUL";

/**
 * 🔴 **Total Controller(T/C) 는 제너레이터 양식을 쓴다** — T/C 전용 양식을 아직
 * 받지 못했다. 다른 양식이 필요하다면 그 파일이 생기는 날 여기 한 줄이 는다.
 *
 * 장비 종류를 아직 안 고른 견적서(이 기능이 생기기 전에 만든 것들)도 제너레이터로
 * 본다 — 지금까지 그 양식 하나만 쓰였으니 그것이 사실에 가장 가깝다.
 */
export function quoteTemplateKey(
  equipmentKind: WorkflowKind | null,
  quoteKind: QuoteKind
): QuoteTemplateKey {
  const equipment = equipmentKind === "MATCHER" ? "MATCHER" : "GENERATOR";
  return `${equipment}:${quoteKind}`;
}
