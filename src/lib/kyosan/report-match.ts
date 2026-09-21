import { nfkcNameKey } from "../domain/kyosan-intake-import/name-suggestions";
import { KYOSAN_INTAKE_NUMBER_PATTERN, normalizeIdentifier } from "../domain/kyosan-intake-import/rules";
import type { CardFields } from "./card-fields";

/**
 * ============================================================================
 * 연락서 ↔ 이미 등록된 수리 건 짝짓기 (2026-09-21, 조각 S3a)
 * ============================================================================
 * 🔴 **사용자 정책(2026-09-21)**: 「이미 수리건이 등록된 경우에만 연락서의 내용을
 * 시스템에 이식한다.」 그러므로 이 판정은 **수리 건을 만들지 않는다.** 짝을 못
 * 찾으면 답은 「넣지 않는다」이고, 왜 못 찾았는지만 돌려준다.
 *
 * DB 를 모르는 **순수 함수**다. 후보를 읽어 오는 일은 부르는 쪽(질의)이 하고,
 * 여기서는 읽어 온 후보와 판독 결과를 견주기만 한다. 그래야 CLI 로 469장에
 * 돌려 볼 수 있고 시험이 DB 없이 돈다. `server-only` 를 부르지 않는다.
 *
 * ── 🔴 자동으로 확정하는 열쇠는 접수번호 **하나뿐**이다 ──────────────
 * `repair_cases.intake_number` 에는 유니크가 걸려 있다(휴지통 포함). 그래서
 * 접수번호 하나는 수리 건 **0 또는 1개**를 가리킨다 — 여기서 「여럿」이 나올 수
 * 없다. 모델 · S/N · L/N · 고객사는 **확정된 짝이 맞는지 검증**하는 데 쓰고,
 * 접수번호로 못 찾았을 때는 **후보를 보여 주기만** 한다. 같은 장비가 여러 번
 * 수리를 오기 때문이다(양식에 `RECALL_Count` 칸이 따로 있다) — S/N 이 같다고
 * 짝지으면 **지난번 수리 건에 이번 자료를 넣는다.**
 *
 * ── 세 갈래 ───────────────────────────────────────────────────────────
 *  · `matched`   — 붙일 수 있다. **어떻게 정해졌는지**를 `basis` 가 나른다:
 *      · `intake-number` 접수번호로 찾았고 신원이 어긋나지 않는다(자동).
 *      · `human-choice`  후보 목록에서 **사람이 고른 것**이다(아래).
 *  · `ambiguous` — 🔴 **사람이 골라야 한다.** 둘 중 하나다:
 *      · `identity-conflict`  접수번호는 맞는데 **모델도 S/N 도 다르다**.
 *        번호를 잘못 읽었거나 잘못 적힌 것이다. 그냥 붙이면 남의 건에 남의
 *        자료가 들어간다 — 가장 나쁜 결과라 사람에게 넘긴다.
 *      · `identity-candidates`  접수번호가 없거나 그 번호의 건이 없는데,
 *        S/N 으로 찾은 건이 있다. **하나뿐이어도 사람이 고른다**(위 RECALL).
 *  · `unmatched` — 짝이 없다. **넣지 않는다.** 까닭을 셋으로 나눈다:
 *      `intake-number-missing`(접수번호를 못 읽었다) ·
 *      `intake-number-malformed`(읽었는데 번호 꼴이 아니다) ·
 *      `intake-number-not-found`(번호는 멀쩡한데 그 번호의 건이 없다).
 *
 * ── 어긋남을 어떻게 재는가 ────────────────────────────────────────────
 * 네 항목을 따로 견준다(`agree` · `differ` · `unknown`). 한쪽이라도 비어 있으면
 * `unknown` 이다 — 「비었다」와 「다르다」는 다른 이야기다.
 *  · 모델 · 고객사 — `nfkcNameKey`(전각/반각 · 대소문자 · 공백)
 *  · S/N · L/N — 같은 눌림에 **공백을 아예 지워** 견준다(`1912 120` ↔ `1912120`)
 * 🔴 고객사는 **경고만** 낸다. 연락서의 `客先` 은 교산의 고객이고 우리 DB 의
 * 고객사는 교산인 판이 흔하다 — 이것으로 짝을 깨면 전부 깨진다.
 * 모델과 S/N 이 **둘 다** 어긋날 때만 짝을 사람에게 넘긴다.
 *
 * ── 🔴 사람이 고른 것을 받아들인다 (2026-09-21, 조각 S4b) ────────────
 * 사용자 결정: 「짝이 여럿일 때 사람이 고르면 저장까지 받아들인다.」 그래서
 * `chosenRepairCaseId` 를 받는다. 다만 **아무 건이나 받지 않는다**:
 *   · `identity-candidates`(= S/N 으로 찾은 후보 목록) 안에 있는 건만 올린다.
 *     화면이 보여 준 적 없는 건은 그대로 `ambiguous` 로 남는다.
 *   · `identity-conflict`(접수번호는 맞는데 모델도 S/N 도 다르다)은 **올리지
 *     않는다** — 그것은 「고를 후보」가 아니라 「번호가 틀렸다」는 신호다.
 *   · 접수번호로 이미 확정된 짝(`matched`)에는 고르기가 끼어들지 않는다.
 * 올라간 짝은 `basis: "human-choice"` 로 표시된다. 저장 직전 검사가 이 표시를
 * 보고 갈라진다(`server/services/kyosan-report-import.ts` 의 `lockAndReconfirm`)
 * — 자동 짝은 접수번호 동일성, 사람이 고른 짝은 모델·S/N 대조다.
 * ============================================================================
 */

/** 짝 후보 한 건. DB 에서 읽어 온 값이지만 이 모듈은 DB 를 모른다. */
export type KyosanCaseCandidate = {
  repairCaseId: string;
  intakeNumber: string;
  /** 🔴 휴지통의 건도 번호를 차지한다(질의가 함께 돌려준다). */
  isDeleted: boolean;
  customerName: string | null;
  modelName: string | null;
  serialNumber: string | null;
  /** 모르면 `null`/없음 — 견줌이 `unknown` 이 된다. */
  lotNumber?: string | null;
};

export type KyosanIdentityField = "model" | "serialNumber" | "lotNumber" | "customer";
export type KyosanAgreement = "agree" | "differ" | "unknown";
export type KyosanIdentityCheck = Readonly<Record<KyosanIdentityField, KyosanAgreement>>;

export type KyosanIntakeNumberStatus = "missing" | "malformed" | "not-found" | "found";

export type KyosanCandidateView = {
  candidate: KyosanCaseCandidate;
  identity: KyosanIdentityCheck;
};

/**
 * 짝이 **어떻게** 정해졌는가. 🔴 저장 직전 검사가 이것으로 갈라지므로
 * (`lockAndReconfirm`) 값을 늘리거나 뜻을 바꿀 때는 그쪽을 함께 본다.
 */
export type KyosanMatchBasis =
  /** 접수번호로 자동 확정. 저장 직전에 **접수번호가 그대로인지** 다시 본다. */
  | "intake-number"
  /** 후보 목록에서 사람이 골랐다. 저장 직전에 **모델·S/N 을 대조**한다. */
  | "human-choice";

export type KyosanMatchOutcome =
  | ({ kind: "matched"; basis: KyosanMatchBasis; warnings: readonly string[] } & KyosanCandidateView)
  | {
      kind: "ambiguous";
      reason: "identity-conflict" | "identity-candidates";
      candidates: readonly KyosanCandidateView[];
    }
  | {
      kind: "unmatched";
      reason: "intake-number-missing" | "intake-number-malformed" | "intake-number-not-found";
    };

export type KyosanMatch = {
  /** 연락서에 적힌 그대로(다듬기 전). 없으면 null. */
  rawIntakeNumber: string | null;
  /** 번호 꼴이 맞을 때만 값이 있다. 질의의 열쇠로 쓰는 것이 이것이다. */
  intakeNumber: string | null;
  intakeNumberStatus: KyosanIntakeNumberStatus;
  outcome: KyosanMatchOutcome;
};

/** 연락서에서 읽은 신원. 질의가 후보를 찾을 때도 쓴다. */
export type KyosanReportIdentity = {
  intakeNumber: string | null;
  rawIntakeNumber: string | null;
  model: string | null;
  serialNumber: string | null;
  lotNumber: string | null;
  customer: string | null;
};

/**
 * 접수번호를 다듬는다 — NFKC · 앞뒤 공백 · **속 공백까지 제거** · 대문자.
 * 실측에 `d210105` 나 `D 210105` 같은 것이 섞여 있어도 같은 번호로 본다.
 * 다듬어도 꼴이 아니면 `null` 을 돌려준다(그 사실은 `status` 가 나른다).
 */
export function normalizeKyosanIntakeNumber(value: string | null): string | null {
  const normalized = normalizeIdentifier(value);
  if (normalized === null) return null;
  const compact = normalized.replace(/\s+/g, "").toUpperCase();
  return KYOSAN_INTAKE_NUMBER_PATTERN.test(compact) ? compact : null;
}

/** 판독 결과에서 짝짓기에 쓸 신원만 뽑는다. */
export function readKyosanIdentity(card: CardFields): KyosanReportIdentity {
  const rawIntakeNumber = normalizeIdentifier(card.fields.intakeNumber.value);
  return {
    rawIntakeNumber,
    intakeNumber: normalizeKyosanIntakeNumber(rawIntakeNumber),
    model: normalizeIdentifier(card.fields.model.value),
    serialNumber: normalizeIdentifier(card.fields.serialNumber.value),
    lotNumber: normalizeIdentifier(card.fields.lotNumber.value),
    customer: normalizeIdentifier(card.fields.customer.value),
  };
}

/** 식별자 견줌용 열쇠 — NFKC · 공백 제거 · 대문자. 비면 null. */
function identifierKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const key = value.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
  return key === "" ? null : key;
}

/** 이름 견줌용 열쇠 — `nfkcNameKey`(공백 접기 · 소문자). 비면 null. */
function nameKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const key = nfkcNameKey(value);
  return key === "" ? null : key;
}

function agree(left: string | null, right: string | null): KyosanAgreement {
  if (left === null || right === null) return "unknown";
  return left === right ? "agree" : "differ";
}

/** 연락서의 신원과 후보 건의 신원을 항목마다 견준다. */
export function checkKyosanIdentity(
  identity: KyosanReportIdentity,
  candidate: KyosanCaseCandidate
): KyosanIdentityCheck {
  return {
    model: agree(nameKey(identity.model), nameKey(candidate.modelName)),
    serialNumber: agree(identifierKey(identity.serialNumber), identifierKey(candidate.serialNumber)),
    lotNumber: agree(identifierKey(identity.lotNumber), identifierKey(candidate.lotNumber)),
    customer: agree(nameKey(identity.customer), nameKey(candidate.customerName)),
  };
}

const FIELD_CAPTION: Readonly<Record<KyosanIdentityField, string>> = {
  model: "모델",
  serialNumber: "S/N",
  lotNumber: "L/N",
  customer: "고객사",
};

/** 짝은 지었지만 사람이 알아야 하는 것들. 🔴 값은 담지 않는다(항목 이름만). */
function identityWarnings(identity: KyosanIdentityCheck): string[] {
  const warnings: string[] = [];
  for (const field of ["model", "serialNumber", "lotNumber", "customer"] as const) {
    if (identity[field] === "differ") {
      warnings.push(`${FIELD_CAPTION[field]} 이(가) 수리 건과 다릅니다 — 사람이 확인해야 합니다.`);
    }
  }
  return warnings;
}

/** 모델도 S/N 도 어긋나면 그 짝은 믿지 않는다(머리말). */
function isIdentityConflict(identity: KyosanIdentityCheck): boolean {
  return identity.model === "differ" && identity.serialNumber === "differ";
}

export type KyosanMatchInput = {
  identity: KyosanReportIdentity;
  /** 접수번호로 찾은 건. 번호 유니크라 0 또는 1개다. */
  caseByIntakeNumber: KyosanCaseCandidate | null;
  /**
   * S/N 으로 미리 좁혀 온 후보들. 접수번호로 못 찾았을 때만 본다.
   * 비어 있어도 된다 — 그러면 「짝 없음」이다.
   */
  identityCandidates?: readonly KyosanCaseCandidate[];
  /**
   * 🔴 사람이 화면에서 고른 수리 건 id (조각 S4b). **후보 목록 안에 있을
   * 때만** 쓰인다 — 목록 밖의 id 는 조용히 무시되고 결과는 `ambiguous` 그대로다.
   * 접수번호로 이미 확정된 짝에는 끼어들지 않는다(머리말).
   */
  chosenRepairCaseId?: string | null;
};

/**
 * 연락서 한 장의 짝을 정한다. 세 갈래 가운데 하나를 돌려준다(머리말).
 * 🔴 여기서 수리 건을 만들지 않는다. 짝이 없으면 없는 대로 돌려준다.
 */
export function matchKyosanReport(input: KyosanMatchInput): KyosanMatch {
  const { identity } = input;
  const intakeNumber = identity.intakeNumber;

  const status: KyosanIntakeNumberStatus =
    identity.rawIntakeNumber === null
      ? "missing"
      : intakeNumber === null
        ? "malformed"
        : input.caseByIntakeNumber === null
          ? "not-found"
          : "found";

  const base = {
    rawIntakeNumber: identity.rawIntakeNumber,
    intakeNumber,
    intakeNumberStatus: status,
  };

  if (status === "found" && input.caseByIntakeNumber !== null) {
    const candidate = input.caseByIntakeNumber;
    const check = checkKyosanIdentity(identity, candidate);
    if (isIdentityConflict(check)) {
      // 번호는 맞는데 물건이 다르다 — 그대로 붙이면 남의 건에 남의 자료가 간다.
      // 🔴 여기서는 고르기를 받지 않는다. 「고를 후보」가 아니라 「번호가 틀렸다」이다.
      return {
        ...base,
        outcome: { kind: "ambiguous", reason: "identity-conflict", candidates: [{ candidate, identity: check }] },
      };
    }
    // 🔴 접수번호로 정해진 짝에는 고르기가 끼어들지 않는다(basis 가 바뀌면 저장
    //    직전 검사가 접수번호 대신 모델·S/N 을 보게 되어 안전장치가 느슨해진다).
    return {
      ...base,
      outcome: {
        kind: "matched",
        basis: "intake-number",
        candidate,
        identity: check,
        warnings: identityWarnings(check),
      },
    };
  }

  // 접수번호로 못 찾았다 — S/N 후보를 보여 주기만 한다(사람이 고른다).
  const serialKey = identifierKey(identity.serialNumber);
  const views: KyosanCandidateView[] =
    serialKey === null
      ? []
      : (input.identityCandidates ?? [])
          .map((candidate) => ({ candidate, identity: checkKyosanIdentity(identity, candidate) }))
          .filter((view) => view.identity.serialNumber === "agree" && view.identity.model !== "differ");

  if (views.length > 0) {
    // 🔴 사람이 고른 건이 **이 목록 안에 있을 때만** 짝으로 올린다.
    //    목록 밖의 id 는 화면이 보여 준 적 없는 건이므로 받아들이지 않는다.
    const chosen = input.chosenRepairCaseId ?? null;
    const picked =
      chosen === null ? undefined : views.find((view) => view.candidate.repairCaseId === chosen);
    if (picked !== undefined) {
      return {
        ...base,
        outcome: {
          kind: "matched",
          basis: "human-choice",
          candidate: picked.candidate,
          identity: picked.identity,
          warnings: identityWarnings(picked.identity),
        },
      };
    }
    return { ...base, outcome: { kind: "ambiguous", reason: "identity-candidates", candidates: views } };
  }

  return {
    ...base,
    outcome: {
      kind: "unmatched",
      reason:
        status === "missing"
          ? "intake-number-missing"
          : status === "malformed"
            ? "intake-number-malformed"
            : "intake-number-not-found",
    },
  };
}
