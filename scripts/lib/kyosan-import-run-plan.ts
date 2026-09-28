/**
 * ============================================================================
 * 연락서 **일괄 이식 러너**의 고르는 규칙·세는 규칙 (조각 S5-C)
 * ============================================================================
 * DB 도 디스크도 건드리지 않는다. 받은 값으로 「이 파일은 문서인가 · 이 결과는
 * 어느 갈래인가 · 몇 장인가」만 판정하고 돌려준다. 그래서 DB 없이 값으로 시험할
 * 수 있고(`kyosan-import-run-plan.test.ts`), 실제로 도는 쪽
 * (`kyosan-import-run.ts`)은 여기가 내놓은 갈래를 세기만 한다.
 *
 * 🔴 **판정 규칙을 새로 짓지 않는다.** 「넣을 수 있는가」는 이식기
 * (`src/lib/server/services/kyosan-report-import.ts`)가 저장 직전에 내리는 바로
 * 그 판정이고, 이 파일의 `classifyPlanOutcome` 은 그 함수의 네 줄
 * (`preview.plan === null || matched === null` … `alreadyImported`)을 **그대로**
 * 옮겨 적은 것이다. 갈라지면 계획이 거짓말을 한다.
 *
 * ── 🔴 이 파일이 들여오는 것은 **타입 하나뿐**이다 ──────────────────────
 * `import type` 은 컴파일에서 지워지므로 `server-only` 도 DB 도 끌려오지 않는다
 * (`kyosan-import-revert-plan.ts` 가 번역 함수 하나를 들여오며 같은 규율을
 * 적는다). 값을 하나라도 들여오면 이 파일은 순수 함수가 아니게 된다.
 * ============================================================================
 */

import type { KyosanReportImportFailureCode } from "../../src/lib/server/services/kyosan-report-import";

// ─────────────────────────────────────────────── 문서가 아닌 파일 가려내기

/**
 * 🔴 **문서가 아닌 파일**의 크기 상한. 이보다 작고 ZIP 이 아니면 「연락서가 아직
 * 없는 자리」로 센다 — 고장이 아니다.
 *
 * ── 실측 (2026-09-28, 백업된 503장) ─────────────────────────────────────
 * `kyosan-xlsm` 360장 가운데 **31장이 정확히 165바이트**이고 ZIP 이 아니다.
 * 지도 파일(`kyosan-xlsm-map.tsv`)로 원본 경로를 되짚으면 **31장 전부 이름이
 * `~$…` 로 시작한다** — 엑셀이 문서를 열어 둘 때 옆에 두는 **소유자 잠금 파일**
 * 이다(`src/lib/kyosan/kyosan-report.ts` 의 판독기 머리말이 같은 것을 적어
 * 두었다: 「엑셀 잠금 파일(`~$…`, 165바이트, zip 이 아니다)이 실제로 섞여
 * 있다」). 원본을 일련번호로 옮겨 담으면서 `~$` 접두사가 사라졌으므로
 * **이름이 아니라 내용으로** 가려야 한다.
 *
 * 상한을 1KB 로 둔 까닭: 165바이트보다 넉넉히 크고, 실제 통합문서보다는 훨씬
 * 작다(가장 작은 연락서가 수십 KB 다). 이 사이에 걸리는 것은 문서가 아니다.
 */
export const KYOSAN_NON_DOCUMENT_MAX_BYTES = 1024;

/**
 * ZIP 서명인가. `.xlsx`·`.xlsm` 은 전부 ZIP 이다(`ZipArchive.fromBuffer` 가 그것을
 * 요구한다). 🔴 여기서 통합문서를 **여는** 것이 아니라 「문서 꼴이기는 한가」만
 * 본다 — 여는 일은 판독기가 한다.
 */
export function looksLikeZipArchive(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  // PK\x03\x04(보통) · PK\x05\x06(빈 저장소) · PK\x07\x08(분할)
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}

/**
 * 🔴 **못 읽는 파일을 오류로 세지 않는다.** 자리표시자·잠금 파일은 「아직 문서가
 * 없는 자리」이고, 판독 실패는 「문서인데 우리가 못 읽었다」다. 둘을 섞으면
 * 503장을 돌린 뒤 「31장 실패」가 남아 아무도 그것이 정상인지 모른다.
 */
export function isKyosanNonDocumentFile(bytes: Uint8Array): boolean {
  return bytes.length <= KYOSAN_NON_DOCUMENT_MAX_BYTES && !looksLikeZipArchive(bytes);
}

// ─────────────────────────────────────────────── 결과 갈래

/**
 * 한 장이 어떻게 끝났는가.
 *
 * 🔴 `importable` 은 **계획(dry-run) 전용**이고 `imported` 는 **`--apply` 전용**
 * 이다. 둘을 한 낱말로 묶지 않는다 — 「넣을 수 있다」와 「넣었다」를 같은 칸에
 * 세면 계획 출력을 읽은 사람이 이미 들어간 줄 안다.
 */
export type KyosanRunOutcome =
  /** 계획: 넣을 수 있다(이식기의 `preview.plan` 이 있다). */
  | "importable"
  /** `--apply`: 실제로 넣었다. */
  | "imported"
  /** 같은 원본이 그 건에 이미 들어 있다(`ALREADY_IMPORTED`). */
  | "already-imported"
  /** 짝이 없거나 · 사람이 골라야 하거나 · 미리보기가 막았다(`NOT_IMPORTABLE`). */
  | "not-importable"
  /** 🔴 문서가 아닌 파일(165바이트 잠금 파일 등) — 고장이 아니다. */
  | "non-document"
  /** 문서인데 판독기가 열지 못했다. */
  | "unreadable"
  /** 그 밖의 실패(`TARGET_CHANGED` · `SOURCE_*` · `STORAGE_FAILED` · `SAVE_REJECTED`). */
  | "failed";

/** 표에 찍는 차례와 이름. 🔴 0장인 갈래도 찍는다 — 없는 줄은 사람이 못 읽는다. */
export const KYOSAN_RUN_OUTCOME_ORDER: readonly KyosanRunOutcome[] = [
  "importable",
  "imported",
  "already-imported",
  "not-importable",
  "non-document",
  "unreadable",
  "failed",
];

export const KYOSAN_RUN_OUTCOME_LABEL: Readonly<Record<KyosanRunOutcome, string>> = {
  importable: "넣을 수 있음",
  imported: "넣음",
  "already-imported": "이미 있음",
  "not-importable": "짝 없음·막힘",
  "non-document": "문서 아님(잠금·자리표시자)",
  unreadable: "못 읽음",
  failed: "실패",
};

/**
 * 🔴 이식기가 돌려준 실패 코드를 갈래로 옮긴다. **`switch` 가 빠짐없다** —
 * `KyosanReportImportFailureCode` 에 코드가 하나 늘면 여기서 컴파일이 깨진다.
 * 그래야 새 실패가 조용히 「그 밖 실패」에 섞이지 않는다.
 */
export function outcomeForFailureCode(code: KyosanReportImportFailureCode): KyosanRunOutcome {
  switch (code) {
    case "ALREADY_IMPORTED":
      return "already-imported";
    case "NOT_IMPORTABLE":
      return "not-importable";
    case "TARGET_CHANGED":
    case "SOURCE_REJECTED":
    case "SOURCE_TOO_LARGE":
    case "STORAGE_FAILED":
    case "SAVE_REJECTED":
      return "failed";
  }
}

/**
 * 🔴 계획(dry-run)의 판정. **이식기의 네 줄을 그대로 옮긴 것**이다
 * (`kyosan-report-import.ts` 의 `preview.plan === null || matched === null` 갈래):
 *
 *     if (preview.plan === null || matched === null) {
 *       const alreadyImported =
 *         matched !== null && (caseState?.importedSourceSha256.includes(sha) ?? false);
 *       return { code: alreadyImported ? "ALREADY_IMPORTED" : "NOT_IMPORTABLE" };
 *     }
 *
 * 🔴 **새 규칙을 짓지 않는다.** 이식기가 저장 직전에 다시 한 번 (잠금 안에서)
 * 같은 해시를 보므로 실제 `--apply` 에서 `ALREADY_IMPORTED` 가 더 나올 수는
 * 있지만(그 사이에 누가 먼저 넣었을 때), 계획이 **더 낙관적으로** 말하는 일은
 * 없다.
 */
export function classifyPlanOutcome(input: {
  /** 짝짓기가 `matched` 를 내놓았는가. */
  hasMatch: boolean;
  /** 미리보기가 `plan` 을 내놓았는가. */
  hasPlan: boolean;
  /** 짝지은 건에 이 원본 해시가 이미 있는가(`caseState.importedSourceSha256`). */
  caseAlreadyHasSourceHash: boolean;
}): Extract<KyosanRunOutcome, "importable" | "already-imported" | "not-importable"> {
  if (input.hasPlan && input.hasMatch) return "importable";
  return input.hasMatch && input.caseAlreadyHasSourceHash ? "already-imported" : "not-importable";
}

// ─────────────────────────────────────────────── 세기

export type KyosanRunTally = Record<KyosanRunOutcome, number>;

export function emptyRunTally(): KyosanRunTally {
  return {
    importable: 0,
    imported: 0,
    "already-imported": 0,
    "not-importable": 0,
    "non-document": 0,
    unreadable: 0,
    failed: 0,
  };
}

export function tallyRunOutcomes(outcomes: readonly KyosanRunOutcome[]): KyosanRunTally {
  const tally = emptyRunTally();
  for (const outcome of outcomes) tally[outcome] += 1;
  return tally;
}

/** 갈래 합계. 🔴 훑은 장수와 같아야 한다 — 어느 갈래에도 안 들어간 장이 없다. */
export function runTallyTotal(tally: KyosanRunTally): number {
  return KYOSAN_RUN_OUTCOME_ORDER.reduce((sum, outcome) => sum + tally[outcome], 0);
}

// ─────────────────────────────────────────────── 같은 파일을 두 번 세지 않는다

export type KyosanDuplicateHashGroup = {
  sha256: string;
  /** 같은 바이트를 가진 파일들의 이름(들어온 차례 그대로). */
  fileNames: readonly string[];
};

/**
 * 🔴 **이름이 아니라 내용(sha256)으로** 판단한다.
 *
 * 백업된 두 폴더(`kyosan-xlsm` · `kyosan-xls-converted`)는 **파일 이름이 겹친다** —
 * 폴더별로 1번부터 다시 매긴 일련번호이기 때문이다. 그런데 내용은 전부 다르다
 * (실측: 원본 NAS 경로가 한 개도 겹치지 않는다). 이름으로 가르면 없는 중복을
 * 143쌍이나 만들어 내고, 내용으로 가르면 진짜 중복만 남는다.
 *
 * 돌려주는 것은 **둘 이상**인 묶음뿐이다. 계획 출력이 그것을 사람에게 알린다 —
 * 그중 하나가 먼저 들어가면 나머지는 `ALREADY_IMPORTED` 로 떨어진다(이식기가
 * 원본 해시로 막는다). 🔴 러너가 말없이 건너뛰지 않는다.
 */
export function findDuplicateHashGroups(
  entries: readonly { fileName: string; sha256: string }[]
): KyosanDuplicateHashGroup[] {
  const byHash = new Map<string, string[]>();
  for (const entry of entries) {
    const names = byHash.get(entry.sha256);
    if (names === undefined) byHash.set(entry.sha256, [entry.fileName]);
    else names.push(entry.fileName);
  }
  const groups: KyosanDuplicateHashGroup[] = [];
  for (const [sha256, fileNames] of byHash) {
    if (fileNames.length > 1) groups.push({ sha256, fileNames });
  }
  return groups;
}

// ─────────────────────────────────────────────── 경고 세기

/**
 * 🔴 **부품 건너뛰기**를 가르는 글자. 이식기의 `appendUsedParts` 가 막힐 때
 * 남기는 문장이다:
 *
 *     `교체 부품 ${N}건을 사용 부품 칸에 적지 않았습니다 — ${gate.message}`
 *
 * 🔴 **이식이 실패하지 않는다 — 경고만 남는다.** 출하가 잠긴 건 · 반출 이력이
 * 있는 건에서는 교체 부품이 **말없이 건너뛰어진다**(그 함수의 머리말: 막으면 그
 * 건의 연락서를 영영 못 넣게 되므로 실패시키지 않는다). 세지 않으면 나중에
 * 「부품이 왜 안 들어왔지」가 터진다.
 *
 * 🔴 이 글자가 이식기와 갈라지지 않았는지 시험이 **그 파일의 글자를 읽어** 본다
 * (`kyosan-import-run-plan.test.ts` — `kyosan-import-revert-plan.ts` 의 첨부 설명
 * 상수와 같은 규율이다).
 */
export const USED_PARTS_SKIPPED_WARNING_MARK = "사용 부품 칸에 적지 않았습니다";

export function isUsedPartsSkippedWarning(text: string): boolean {
  return text.includes(USED_PARTS_SKIPPED_WARNING_MARK);
}

/**
 * 문장을 **종류**로 누른다. 같은 종류인데 수만 다른 문장이 503줄 쏟아지면 표가
 * 되지 않으므로, 잇단 숫자를 `N` 으로 바꿔 묶는다.
 *
 * 🔴 값이 섞일 걱정은 없다 — 이식기와 미리보기의 경고·막은 까닭 문구는 **항목
 * 이름과 개수만** 담는다(두 파일 머리말의 같은 규칙). 고객 글자가 들어 있지 않다.
 * 그래서 경고(warning)와 막은 까닭(blocker)에 **같은 함수**를 쓴다.
 */
export function kyosanMessageKind(text: string): string {
  return text.replace(/\d+/g, "N");
}

export type KyosanMessageTallyRow = {
  /** 숫자를 `N` 으로 누른 문장. */
  kind: string;
  /** 🔴 그 문장이 **몇 장에** 붙었는가(줄 수가 아니다). */
  files: number;
};

/**
 * 🔴 **장 단위로 센다.** 한 장이 같은 종류의 문장을 두 줄 남겨도 1장이다 —
 * 사람이 알고 싶은 것은 「몇 장이 그런 상태인가」이기 때문이다.
 *
 * 많은 것부터, 같으면 글자 차례로 돌려준다.
 */
export function tallyMessageKinds(
  perFileWarnings: readonly (readonly string[])[]
): KyosanMessageTallyRow[] {
  const counts = new Map<string, number>();
  for (const warnings of perFileWarnings) {
    const kinds = new Set(warnings.map(kyosanMessageKind));
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, files]) => ({ kind, files }))
    .sort((a, b) => b.files - a.files || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/** 🔴 부품이 건너뛰어진 장수. 표와 따로 한 줄로 크게 찍는다. */
export function countUsedPartsSkippedFiles(
  perFileWarnings: readonly (readonly string[])[]
): number {
  return perFileWarnings.filter((warnings) => warnings.some(isUsedPartsSkippedWarning)).length;
}
