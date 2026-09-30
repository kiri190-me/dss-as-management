/**
 * ============================================================================
 * 모델명으로 가리는 RF 제품 종류 — 제너레이터(RFG)인가 매쳐(MB)인가
 * ============================================================================
 * 교산 제품의 모델명은 **앞 세 글자**가 종류를 말한다(사용자 확인 2026-09-30).
 *
 *   RFG (제너레이터)
 *     Source (13.56MHz) : RFK___FH-JS   [JUSUNG]
 *     Bias   (4MHz)     : CFK___FH-IC   [ICD]
 *     Bias   (3.39MHz)  : KFK___M-AD    [INVENIA]
 *
 *   MB (매쳐)
 *     Source (13.56MHz) : MBK___M-JS    [JUSUNG]
 *     Bias   (4MHz)     : CMK___M-IC    [ICD]
 *     Bias   (3.39MHz)  : KMK___M-AD    [INVENIA]
 *
 * ── 🔴 모르면 null 이다. 짐작하지 않는다 ────────────────────────────────
 * 이 여섯 접두사에 없는 모델명은 판정하지 않는다. 이 판정의 쓰임새가 고객사
 * 현황표의 「Parts 명」 칸을 대신 채우는 것이라, 틀리게 채우면 **아무 오류 없이
 * 거짓이 고객사 표에 적힌다.** 빈칸은 사람이 보고 알아채지만 틀린 글자는
 * 알아챌 방법이 없다.
 *
 * ── 왜 별도 모듈인가 ────────────────────────────────────────────────────
 * 이것은 고객 안내 화면의 규칙이 아니라 **제품에 대한 사실**이다. 지금은
 * customer-portal-forms.ts 하나만 쓰지만, 제품 쪽에서 같은 질문이 생길 때
 * 고객 안내 화면의 파일을 가져다 쓰게 만들지 않으려고 여기 둔다.
 * ============================================================================
 */

/** 제너레이터인가 매쳐인가. */
export type RfProductKind = "RFG" | "MB";

/** 13.56MHz 쪽인가(Source) 그 아래 주파수 쪽인가(Bias). */
export type RfProductBand = "SOURCE" | "BIAS";

/** 모델명 끝에 붙는 고객사 표시. */
export type RfProductCustomerCode = "JS" | "IC" | "AD";

export type RfProductClassification = {
  kind: RfProductKind;
  band: RfProductBand;
};

/**
 * 접두사 여섯. 🔴 `Record` 로 적어 두면 종류가 늘 때 tsc 가 짝을 요구한다.
 * 비교는 **대문자로 눕혀서** 한다 — 모델명이 소문자로 등록된 행이 있을 수 있고,
 * 그때 종류를 못 가리면 칸이 조용히 빈다.
 */
const PREFIX_TABLE: Record<string, RfProductClassification> = {
  RFK: { kind: "RFG", band: "SOURCE" },
  CFK: { kind: "RFG", band: "BIAS" },
  KFK: { kind: "RFG", band: "BIAS" },
  MBK: { kind: "MB", band: "SOURCE" },
  CMK: { kind: "MB", band: "BIAS" },
  KMK: { kind: "MB", band: "BIAS" },
};

/**
 * 모델명 → 종류. 가릴 수 없으면 null.
 *
 * 앞뒤 공백은 지운다(마스터에 손으로 넣은 값이라 붙어 있는 일이 있다).
 * 그 밖에는 아무것도 고치지 않는다 — 가운데 공백을 지우거나 기호를 빼는 식으로
 * "봐 주기" 시작하면 어디까지 봐 줄지의 경계가 없어진다.
 */
export function classifyRfProductByModelName(
  modelName: string | null | undefined
): RfProductClassification | null {
  if (typeof modelName !== "string") return null;
  const trimmed = modelName.trim();
  if (trimmed.length < 3) return null;
  return PREFIX_TABLE[trimmed.slice(0, 3).toUpperCase()] ?? null;
}

/**
 * 모델명 끝의 고객사 표시(`-JS` · `-IC` · `-AD`). 없으면 null.
 *
 * 지금 이 값을 쓰는 화면은 없다. 위 표와 함께 확인된 사실이라 적어 두되,
 * **고객사를 가리는 데 쓰지 않는다** — 고객사는 접수 건이 이미 가리키고 있고,
 * 모델명 끝 두 글자로 그것을 뒤집으면 한 고객사가 남의 물건을 맡긴 경우에
 * 엉뚱한 회사의 표에 줄이 선다.
 */
export function rfProductCustomerCodeOf(
  modelName: string | null | undefined
): RfProductCustomerCode | null {
  if (typeof modelName !== "string") return null;
  const match = /-(JS|IC|AD)$/i.exec(modelName.trim());
  if (!match) return null;
  return match[1].toUpperCase() as RfProductCustomerCode;
}
