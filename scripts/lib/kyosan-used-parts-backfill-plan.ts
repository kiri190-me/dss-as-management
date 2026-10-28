/**
 * ============================================================================
 * 연락서 **사용 부품 백필**의 고르는 규칙·세는 규칙 (2026-10-28)
 * ============================================================================
 * DB 도 디스크도 건드리지 않는다. 받은 값으로 「이 흔적은 백필 대상인가 · 넣을
 * 줄은 무엇인가 · 지금 줄과 같은가 · 어느 갈래인가」만 판정하고 돌려준다. 그래서
 * DB 없이 값으로 시험할 수 있고(`kyosan-used-parts-backfill-plan.test.ts`),
 * 실제로 도는 쪽(`kyosan-used-parts-backfill.ts`)은 여기가 내놓은 갈래를 세기만
 * 한다. 일괄 이식 러너의 세 겹(`kyosan-import-run-plan.ts` · `…-run.ts` · CLI)과
 * **같은 모양**이다.
 *
 * ── 🔴 이 도구가 **왜 따로 있는가** ─────────────────────────────────────
 * 2026-10-28 에 연락서 부품을 **품번**으로 읽게 바꿨는데(커밋 `7eda887`·
 * `567c5c6`), 운영에 이미 들어간 줄들은 옛 방식(손글씨 이름)으로 저장되어 있다.
 * 그 줄들을 품번으로 바꾸려면 연락서를 다시 읽어야 한다.
 *
 * 🔴 **그런데 「연락서를 다시 넣는」 길로 가면 안 된다.** 이식기
 * (`src/lib/server/services/kyosan-report-import.ts`)는 사용 부품만 덮어쓰는 것이
 * 아니라 **작업 기록과 첨부를 한 벌 더 만든다**:
 *   · 작업 기록 — `appendWorkRecords` 가 장마다 새 `clientRequestId`(randomUUID)를
 *     만든다. 멱등 판정은 `(repair_case_id, client_request_id)` 하나뿐이라
 *     (`db/mutations/repair-case-work-records.ts`) **절대 안 걸린다.**
 *   · 첨부 — `placeSourceFile` 이 장마다 새 첨부 id 로 새 경로를 만든다.
 *     `attachments.checksum_sha256` 에는 평범한 index 만 있고 unique 가 없다.
 * 그래서 다시 넣으면 기본 정보의 「인수점검 결과」·「현재 진단/조치 요약」이 같은
 * 글을 두 번 보여 주고, 연락서 원본 `.xlsm` 과 사진이 두 벌이 된다.
 *
 * 🔴 **그리고 그 상태는 되돌리기 도구로 치울 수 없다.** 다시 넣으면 흔적이 둘로
 * 쌓이는데, 둘째 이식의 덮어쓰기가 첫 흔적의 `usedPartIds` 가 가리키는 줄을 이미
 * 지워 버린다 → `decideTraceRevert`(`kyosan-import-revert-plan.ts`)가 첫 흔적을
 * 「사용 부품 N줄을 찾아야 하는데 0줄만 있습니다」로 **건너뛴다**. 순서를 바꿔도
 * 같다 — 첫 흔적은 **다시 넣는 그 순간부터** 못 되돌리는 흔적이 된다.
 *
 * 그래서 사용자 결정(2026-10-28)은 **「연락서를 다시 넣지 않고 사용 부품만 다시
 * 적는다」**이다. 이 묶음이 그 도구다.
 *
 * ── 🔴 되돌리기가 **그대로 말이 되게** 하는 한 가지 ──────────────────────
 * 사용 부품을 갈아 끼우면 기존 흔적의 `usedPartIds` 가 **없어진 줄**을 가리키게
 * 된다. 그대로 두면 위에서 적은 그 고장이 백필에서도 똑같이 난다. 그래서 이
 * 도구는 **흔적을 새로 만들지 않고 기존 흔적의 `usedPartIds`·`usedPartCount` 를
 * 갈아 끼운다**. 그러면
 *   · 한 건에 연락서 흔적은 **그대로 하나**이고,
 *   · `revert-kyosan-import.ts --batch <원래 회차>` 가 **고치지 않아도 그대로**
 *     듣는다(`importBatchId` 를 건드리지 않는다),
 *   · `decideTraceRevert` 가 `basis: "id"` 로 새 줄을 정확히 집는다.
 *
 * ── 🔴 판정을 **두 벌로 만들지 않는다** ─────────────────────────────────
 * 넣을 줄을 만드는 규칙은 이식기의 `replaceUsedParts` 와 **같은 함수들**이다:
 * `mergeKyosanPartsForUsedParts`(갈래를 버리고 이름으로 묶어 수량을 더한다) →
 * `translateKyosanSentence`(all-or-nothing 번역). 이 파일은 그 둘을 **부르기만**
 * 하고 규칙을 다시 적지 않는다.
 * ============================================================================
 */

import {
  mergeKyosanPartsForUsedParts,
  type KyosanPreviewPart,
  type KyosanUsedPartLine,
} from "../../src/lib/kyosan/report-preview";
import { translateKyosanSentence } from "../../src/lib/kyosan/report-word-terms";

// ─────────────────────────────────────────────── 결과 갈래

/**
 * 흔적 하나가 어떻게 끝났는가.
 *
 * 🔴 `updatable` 은 **계획(dry-run) 전용**이고 `updated` 는 **`--apply` 전용**
 * 이다. 일괄 이식 러너의 `importable`/`imported` 와 같은 규율 — 「바꿀 수 있다」와
 * 「바꿨다」를 한 칸에 세면 계획 출력을 읽은 사람이 이미 바뀐 줄 안다.
 *
 * 🔴 **「안 바꿨다」를 한 칸에 뭉치지 않는다.** 사람이 알아야 하는 것은 「몇 건이
 * 안 바뀌었나」가 아니라 **「왜 안 바뀌었나」**이고, 까닭마다 다음에 할 일이 다르다
 * (다시 돌리면 되는 것 · 사람이 봐야 하는 것 · 설계대로인 것).
 */
export type KyosanUsedPartsBackfillOutcome =
  /** 계획: 갈아 끼울 수 있다. */
  | "updatable"
  /** `--apply`: 실제로 갈아 끼웠다. */
  | "updated"
  /**
   * 🔵 다시 읽어도 **글자까지 같다** — 한 글자도 쓰지 않았다. 두 번 돌려도 같은
   * 답이 나온다는 뜻이라, 이 갈래가 많아지는 것이 정상이다(두 번째 실행부터).
   */
  | "unchanged"
  /**
   * 🔴 **흔적에 `usedPartIds` 가 없다**(S5-A 커밋 `99b860d` 이전의 옛 흔적).
   * 갈아 끼울 칸이 없으므로 **손대지 않는다** — 갈아 끼우면 그 흔적은 어느 줄이
   * 제 것인지 영영 못 말하게 되고, 되돌리기가 값 대조(감사 스냅숏) 경로로 떨어져
   * 백필이 바꾼 글자 때문에 한 줄도 못 맞춘다.
   */
  | "legacy-trace"
  /** 흔적 안에서 `usedPartIds` 와 `usedPartCount` 가 어긋난다 — 사람이 봐야 한다. */
  | "trace-inconsistent"
  /**
   * 🔴 흔적이 말하길 **그 이식은 사용 부품을 한 줄도 안 넣었다**(`usedPartCount`
   * 가 0). 교체 부품이 없었거나 게이트에 막힌 장이다. 지금 넣으면 **이식이 하지
   * 않은 일**을 백필이 하는 것이고, 그 칸에 있는 줄은 **사람이 적은 줄**일 수
   * 있다. 백필은 「이식이 넣은 줄을 고쳐 적는 일」이지 「새로 넣는 일」이 아니다.
   */
  | "no-imported-parts"
  /**
   * 🔴 그 수리 건에 연락서 흔적이 **둘 이상**이다(연락서를 여러 장 넣은 건).
   * 사용 부품 칸은 건마다 하나인데 흔적은 둘이라, 어느 장의 부품이 남아야 하는지
   * 도구가 정할 수 없다. 아무 쪽이나 고르면 **다른 흔적의 되돌리기가 깨진다.**
   */
  | "multi-trace"
  /**
   * 🔴 지금 그 건의 사용 부품 줄이 **흔적이 말한 줄과 다르다**(사람이 그 뒤에
   * 고쳤다). 지우면 사람의 손글씨가 사라진다 — 손대지 않는다.
   */
  | "row-mismatch"
  /** 🔴 문서가 아닌 파일(165바이트 엑셀 잠금 파일 등) — 고장이 아니다. */
  | "non-document"
  /** 문서인데 판독기가 열지 못했다. */
  | "unreadable"
  /**
   * 🔴 연락서에서 교체 부품을 **하나도 못 뽑았다** — 칸을 비우지 않는다.
   * `replaceUsedParts` 의 맨 앞 빠른 반환과 같은 규칙이다(「칸을 연락서에 맞추는
   * 일」이 아니라 「연락서에서 읽은 부품을 적는 일」이다).
   */
  | "no-parts-in-report"
  /**
   * 🔴 **재고 관리에 올라간 부품 요청(반출) 신청이 있다** — 거절이 아니라
   * **설계한 동작**이다(2026-10-28 결정, `replaceUsedParts` 머리말). 그 요청에서
   * 잡히므로 덮어쓰지 않는다.
   */
  | "part-request-present"
  /**
   * 🔴 **재고 관리에 물어보지 못했다.** 「없다」가 아니라 「모른다」라서 건너뛴다 —
   * 저쪽이 돌아온 뒤 **그대로 다시 돌리면** 들어간다(실패가 아니다).
   */
  | "inventory-unknown"
  /** 사용 부품 칸의 규칙 셋에 막혔다(출하 잠김 + 가져온 건 아님 등). */
  | "gate-blocked"
  /** 흔적의 주인 수리 건이 없거나 휴지통에 있다. */
  | "case-missing"
  /**
   * `--apply` 중 **잠금 안에서 다시 재니 달라졌다.** 한 글자도 안 쓰고 건너뛴다 —
   * 그대로 다시 돌리면 들어간다(실패가 아니다).
   */
  | "changed"
  /** 그 밖의 실패. */
  | "failed";

/** 표에 찍는 차례와 이름. 🔴 0건인 갈래도 찍는다 — 없는 줄은 사람이 못 읽는다. */
export const KYOSAN_BACKFILL_OUTCOME_ORDER: readonly KyosanUsedPartsBackfillOutcome[] = [
  "updatable",
  "updated",
  "unchanged",
  "no-parts-in-report",
  "part-request-present",
  "gate-blocked",
  "row-mismatch",
  "multi-trace",
  "no-imported-parts",
  "legacy-trace",
  "trace-inconsistent",
  "case-missing",
  "non-document",
  "unreadable",
  "inventory-unknown",
  "changed",
  "failed",
];

export const KYOSAN_BACKFILL_OUTCOME_LABEL: Readonly<
  Record<KyosanUsedPartsBackfillOutcome, string>
> = {
  updatable: "바꿀 수 있음",
  updated: "바꿈",
  unchanged: "그대로(이미 같음)",
  "no-parts-in-report": "연락서에 교체 부품 없음",
  "part-request-present": "부품 요청 있음(설계대로 안 넣음)",
  "gate-blocked": "사용 부품 칸이 잠김",
  "row-mismatch": "사람이 그 뒤에 고침",
  "multi-trace": "한 건에 연락서가 여러 장",
  "no-imported-parts": "이식이 한 줄도 안 넣었던 건",
  "legacy-trace": "옛 흔적(usedPartIds 없음)",
  "trace-inconsistent": "흔적 안이 어긋남",
  "case-missing": "수리 건 없음·휴지통",
  "non-document": "문서 아님(잠금·자리표시자)",
  unreadable: "못 읽음",
  "inventory-unknown": "재고 확인 못 함(다시 돌릴 것)",
  changed: "그 사이에 바뀜(다시 돌릴 것)",
  failed: "실패",
};

/**
 * 🔴 **그대로 다시 돌리면 들어가는 갈래.** 요약이 이것들만 따로 모아 접수번호를
 * 찍는다 — 「다시 돌릴 거리」와 「들여다볼 거리」가 한 칸에 뭉치면 아무도 안 본다
 * (일괄 이식 러너의 `inventory-unknown` 과 같은 규율).
 */
export const KYOSAN_BACKFILL_RETRYABLE_OUTCOMES: readonly KyosanUsedPartsBackfillOutcome[] = [
  "inventory-unknown",
  "changed",
];

export type KyosanBackfillTally = Record<KyosanUsedPartsBackfillOutcome, number>;

export function emptyBackfillTally(): KyosanBackfillTally {
  const tally = {} as KyosanBackfillTally;
  for (const outcome of KYOSAN_BACKFILL_OUTCOME_ORDER) tally[outcome] = 0;
  return tally;
}

export function tallyBackfillOutcomes(
  outcomes: readonly KyosanUsedPartsBackfillOutcome[]
): KyosanBackfillTally {
  const tally = emptyBackfillTally();
  for (const outcome of outcomes) tally[outcome] += 1;
  return tally;
}

/** 갈래 합계. 🔴 훑은 흔적 수와 같아야 한다 — 어느 갈래에도 안 들어간 흔적이 없다. */
export function backfillTallyTotal(tally: KyosanBackfillTally): number {
  return KYOSAN_BACKFILL_OUTCOME_ORDER.reduce((sum, outcome) => sum + tally[outcome], 0);
}

// ─────────────────────────────────────────────── 흔적이 백필 대상인가

/**
 * 흔적 하나의 **모양**만 보고 가른다(DB 를 더 읽기 전에 거르는 자리).
 *
 * 🔴 돌려주는 값이 `null` 이면 「여기서 걸릴 것이 없다 — 계속 간다」다. 갈래를
 * 돌려주면 그 흔적은 거기서 끝이다.
 *
 * 차례에 뜻이 있다: **수리 건이 없는 것**이 먼저고(그 뒤 검사가 의미를 잃는다),
 * **한 건에 여러 장**이 그다음이며(어느 장의 부품이 남아야 하는지 못 정한다),
 * 그 뒤에 흔적 안의 모양을 본다.
 */
export function classifyBackfillTraceShape(input: {
  /** 주인 수리 건이 살아 있는가(행이 있고 휴지통이 아니다). */
  caseAlive: boolean;
  /** 그 수리 건에 달린 **연락서 이식 흔적**의 수(자기 자신을 포함한다). */
  traceCountForCase: number;
  /** 흔적의 `metadata.usedPartIds`. 칸이 없거나 모양이 틀리면 `null`. */
  usedPartIds: readonly string[] | null;
  /** 흔적의 `metadata.usedPartCount`. 칸이 없거나 모양이 틀리면 `null`. */
  usedPartCount: number | null;
}): KyosanUsedPartsBackfillOutcome | null {
  if (!input.caseAlive) return "case-missing";
  if (input.traceCountForCase > 1) return "multi-trace";
  // 🔴 개수 칸이 없으면 옛 흔적이다 — id 칸도 없다고 봐야 한다.
  if (input.usedPartCount === null || input.usedPartIds === null) return "legacy-trace";
  if (input.usedPartIds.length !== input.usedPartCount) return "trace-inconsistent";
  if (input.usedPartCount === 0) return "no-imported-parts";
  return null;
}

// ─────────────────────────────────────────────── 지금 줄이 흔적이 말한 그 줄인가

/** 지금 DB 에 있는 사용 부품 한 줄. */
export type BackfillUsedPartRow = {
  id: string;
  lineNo: number;
  /** 🔴 부품 대장과 이어 붙은 줄인가. 이식이 넣은 줄은 언제나 `null` 이다. */
  partId: string | null;
  partNameText: string;
  quantity: number;
};

/**
 * 🔴 **지금 그 건의 줄이 「이식이 넣은 그 줄 그대로」인가.** 아니면 사람이 손댄
 * 것이고, 그때는 한 줄도 건드리지 않는다.
 *
 * 세 가지를 모두 본다:
 *  1. **줄 id 의 집합이 흔적의 `usedPartIds` 와 정확히 같은가.** 하나라도 더
 *     있으면 그것은 이식이 넣지 않은 줄(사람이 적은 줄)이고, 지우면 사라진다.
 *     하나라도 모자라면 이미 누가 지운 것이다.
 *  2. **`part_id` 가 전부 비어 있는가.** 이식은 부품 대장과 이어 붙이지 않는다
 *     (`replaceUsedParts` 의 `partId: null`). 값이 있으면 다른 손이 닿은 줄이다.
 *  3. (1)·(2)가 맞으면 **갈아 끼워도 사라지는 것은 이식이 넣은 줄뿐**이다.
 *
 * 🔵 화면에서 사용 부품을 고치면 `saveRepairCaseUsedParts` 가 그 건의 줄을 통째로
 *    다시 그려 **id 가 전부 바뀐다** — 그래서 (1)이 사람의 손길을 잡아낸다.
 */
export function backfillRowsMatchTrace(
  rows: readonly BackfillUsedPartRow[],
  usedPartIds: readonly string[]
): boolean {
  if (rows.length !== usedPartIds.length) return false;
  if (rows.some((row) => row.partId !== null)) return false;
  const claimed = new Set(usedPartIds);
  if (claimed.size !== usedPartIds.length) return false;
  return rows.every((row) => claimed.has(row.id));
}

// ─────────────────────────────────────────────── 넣을 줄 만들기

/** 백필이 넣을 줄 하나. 차례(`lineNo`)는 1번부터 다시 매긴다. */
export type BackfillNextLine = {
  lineNo: number;
  partNameText: string;
  quantity: number;
};

/**
 * 연락서의 「교체 부품」 줄들을 **사용 부품 칸에 넣을 줄**로 바꾼다.
 *
 * 🔴 **이식기와 같은 두 함수를 그대로 부른다** — 규칙을 여기 다시 적지 않는다:
 *  1. `mergeKyosanPartsForUsedParts` — 갈래(고장분·예방분)를 버리고 **이름으로
 *     묶어 수량을 더한다**(수량이 안 적힌 줄은 1). 줄 수가 줄고 수량 합계는 같다.
 *  2. `translateKyosanSentence` — **묶은 뒤에** 건다. 묶는 열쇠는 연락서 표기여야
 *     하고(`report-preview.test.ts` 가 묶은 결과를 일본어 그대로 못 박는다),
 *     이 함수는 all-or-nothing 이라 일본어가 한 글자라도 남으면 `null` 이다 →
 *     `?? line.text` 로 원문이 그대로 들어간다. 반쪽짜리 글자가 생길 길이 없다.
 *
 * 차례와 글자가 `replaceUsedParts` 의 `nextLines` 와 **한 글자도 다르지 않아야**
 * 한다 — 다르면 백필을 돌린 건과 지금 새로 이식한 건이 서로 다른 값을 갖는다.
 */
export function buildBackfillNextLines(
  parts: readonly KyosanPreviewPart[]
): BackfillNextLine[] {
  const merged: KyosanUsedPartLine[] = mergeKyosanPartsForUsedParts(parts);
  let nextLineNo = 0;
  return merged.map((line) => ({
    lineNo: (nextLineNo += 1),
    partNameText: translateKyosanSentence(line.text) ?? line.text,
    quantity: line.quantity,
  }));
}

/**
 * 🔴 **지금 줄과 넣을 줄이 글자까지 같은가.** 같으면 한 글자도 쓰지 않는다
 * (`unchanged`) — 두 번 돌려도 같은 답이 나오게 하는 자리이고, 두 번째 실행에서
 * 재고 관리를 500번 두드리지 않게 하는 자리이기도 하다.
 *
 * 🔴 **차례까지 본다.** 같은 줄이 다른 차례로 들어 있으면 화면에 보이는 차례가
 * 달라지므로 「같다」가 아니다.
 */
export function backfillLinesAreIdentical(
  rows: readonly BackfillUsedPartRow[],
  next: readonly BackfillNextLine[]
): boolean {
  if (rows.length !== next.length) return false;
  const ordered = [...rows].sort((a, b) => a.lineNo - b.lineNo);
  return ordered.every((row, index) => {
    const line = next[index];
    return (
      row.lineNo === line.lineNo &&
      row.partNameText === line.partNameText &&
      row.quantity === line.quantity
    );
  });
}

/** 줄들의 수량 합계. 🔴 묶기가 수량을 더하므로 전후가 같아야 정상이다. */
export function backfillQuantityTotal(
  lines: readonly { quantity: number }[]
): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

// ─────────────────────────────────────────────── 기록의 모양

export type KyosanBackfillTraceRecord = {
  /** 1부터. 진행 표시와 같은 수다. */
  index: number;
  traceId: string;
  repairCaseId: string | null;
  intakeNumber: string | null;
  sourceSha256: string;
  /**
   * 해시로 짝지은 연락서 **파일 이름**.
   * 🔴 **기록 JSON 전용이다 — 요약(화면)에 절대 싣지 않는다**(아래 머리말).
   */
  fileName: string;
  outcome: KyosanUsedPartsBackfillOutcome;
  /** 바꾸기 전 줄 수(= 흔적이 말한 이식 줄 수). */
  previousLineCount: number;
  /** 바꾼(또는 바꿀) 줄 수. 안 바꾸는 갈래에서는 0. */
  nextLineCount: number;
  previousQuantityTotal: number;
  nextQuantityTotal: number;
  /**
   * 사람이 읽을 한 문장. 값(부품 이름)은 담지 않는다 — 개수와 까닭뿐이다.
   * ⚠️ `failed` 갈래에서는 **파일 경로가 섞일 수 있다**(fs 오류 문장) — 그래서 화면에
   * 올릴 때 `screenSafeMessage` 를 지난다.
   */
  message: string | null;
};

export type KyosanBackfillDuplicateGroup = {
  sha256: string;
  /** 🔴 **기록 JSON 전용.** 요약은 묶음 수와 장수만 찍는다. */
  fileNames: readonly string[];
};

export type KyosanUsedPartsBackfillRecord = {
  ranAt: string;
  databaseName: string;
  mode: "dry-run" | "apply";
  /** 🔴 한 회차를 묶는 번호. 계획에서는 `null` — 아무것도 안 바꿨다. */
  backfillRunId: string | null;
  actorUserId: string | null;
  /** 연락서로 센 장수. 🔴 아래 `ignoredFileCount` 는 여기에 **안 들어간다**. */
  scannedFileCount: number;
  /**
   * 🔴 **세지 않은 찌꺼기 장수**(`~$…` 엑셀 잠금 파일 · 숨김 파일 등). 조용히 빼면
   * 「연락서가 몇 장인지」가 달라진 까닭을 아무도 모른다.
   */
  ignoredFileCount: number;
  /** DB 에 있는 연락서 이식 흔적 수(짝을 못 지은 것까지 전부). */
  traceCount: number;
  /** 🔴 해시가 짝지지 않은 흔적 — 그 연락서 파일이 훑은 자리에 없다. **접수번호**다. */
  unmatchedTraceIntakeNumbers: readonly string[];
  /** 흔적이 없는 연락서 파일 수(= 아직 한 번도 이식되지 않은 장). */
  orphanFileCount: number;
  tally: KyosanBackfillTally;
  /** 🔴 **바뀌는 건만** 더한 줄 수 — 「N줄 → M줄」의 그 수다. */
  changedPreviousLineTotal: number;
  changedNextLineTotal: number;
  /** 🔴 수량 합계. 묶기가 수량을 더하므로 **전후가 같아야** 정상이다. */
  changedPreviousQuantityTotal: number;
  changedNextQuantityTotal: number;
  duplicateHashGroups: readonly KyosanBackfillDuplicateGroup[];
  traces: readonly KyosanBackfillTraceRecord[];
};

// ─────────────────────────────────────────────── 사람이 읽는 표

/**
 * ============================================================================
 * 🔴 **요약(화면)에는 파일 이름을 한 글자도 싣지 않는다** (2026-10-28)
 * ============================================================================
 * 연락서 파일 이름에는 **고객사명 · 모델 · L/N · S/N 이 그대로** 들어 있다. 이
 * 저장소는 「이식 흔적에 파일 이름을 싣지 않는다」를 규율로 지켜 왔는데
 * (`kyosan-report-import.ts` 머리말), 이 도구의 첫 판이 그 규율을 깨고 있었다 —
 * 「내용이 같은 파일」 절이 묶음마다 이름을 **전부** 늘어놓았고, 계획을 한 번
 * 돌려 보니 한 묶음이 80장을 넘었다(운영이면 1,622장 분량이 터미널에 쏟아진다).
 *
 * 🔵 **이름이 필요한 사람은 기록 JSON(`--out`)에서 본다.** 그 파일은 저장소 밖에만
 * 쓰게 CLI 가 막고 있어 git 에 들어갈 길이 없다.
 *
 * 🔴 **화면에 올라가는 글자는 넷뿐이다**: 접수번호 · 개수 · 갈래 이름 · 우리가 지은
 * 문장. 그래서 이 파일의 `format…Summary` 는
 *   · `duplicateHashGroups` 의 `fileNames` 를 **세기만** 하고,
 *   · `traces[].fileName` 을 **아예 읽지 않으며**,
 *   · `traces[].message` 는 `screenSafeMessage` 를 지나게 한다(fs 오류 문장에 전체
 *     경로가 섞여 올 수 있다 — `failed` 갈래).
 * 🔵 시험이 **요약을 실제로 만들어** 그 안에 이름이 없는지 본다(소스 글자를 읽는
 *    검사로는 못 잡는다).
 * ============================================================================
 */

/**
 * 🔴 **파일 이름·경로가 섞일 수 있는 문장은 화면에 올리지 않는다.** 막히는 쪽으로
 * 떨어뜨린다 — 경로 구분자나 통합문서 확장자가 하나라도 보이면 통째로 바꾼다.
 *
 * 🔵 우리가 지은 문장에는 그 글자가 들어갈 일이 없다(개수와 까닭뿐이다). 실제로
 * 걸리는 것은 `failed` 갈래의 fs 오류 문장
 * (`ENOENT: no such file or directory, open 'C:\…\DSS 2026-… <고객사> ….xlsm'`)이다.
 */
export function screenSafeMessage(message: string | null): string | null {
  if (message === null) return null;
  return /[\\/]|\.xlsm|\.xlsx/i.test(message)
    ? "(자세한 사유는 기록 JSON 에 있습니다 — `--out` 을 주고 다시 돌리세요.)"
    : message;
}

/**
 * 한글은 화면에서 두 칸을 먹는다 — `padEnd` 는 글자 수로 세므로 섞인 칸이
 * 어긋난다(일괄 이식 러너·되돌리기 도구의 같은 함수).
 */
function padLabel(label: string, columns: number): string {
  let width = 0;
  for (const character of label) width += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏]/u.test(character) ? 2 : 1;
  return label + " ".repeat(Math.max(0, columns - width));
}

export function formatKyosanUsedPartsBackfillSummary(
  record: KyosanUsedPartsBackfillRecord
): string {
  const lines: string[] = [];

  lines.push("=== 갈래별 합계 ===");
  for (const outcome of KYOSAN_BACKFILL_OUTCOME_ORDER) {
    const count = record.tally[outcome];
    // 계획에는 `updated` 가, `--apply` 에는 `updatable` 이 있을 수 없다 — 그 칸은 감춘다.
    if (count === 0 && (outcome === "updated" || outcome === "updatable")) continue;
    lines.push(
      // 🔵 34칸 — 가장 긴 이름(「부품 요청 있음(설계대로 안 넣음)」)이 화면에서 32칸이다.
      //    모자라면 그 줄만 수가 밀려 표가 어긋난다(실측으로 한 줄이 밀려 있었다).
      `  ${padLabel(KYOSAN_BACKFILL_OUTCOME_LABEL[outcome], 34)}${String(count).padStart(4, " ")}건`
    );
  }
  lines.push(`  ${padLabel("(합계)", 34)}${String(backfillTallyTotal(record.tally)).padStart(4, " ")}건`);
  lines.push("");

  // 🔴 「몇 줄이 바뀌는가」 — 사람이 승인하려면 이 수를 봐야 한다.
  const label = record.mode === "apply" ? "바꾼" : "바꿀";
  lines.push(`=== 🔴 ${label} 줄 수 ===`);
  lines.push(
    `  사용 부품   ${record.changedPreviousLineTotal}줄 → ${record.changedNextLineTotal}줄`
  );
  lines.push(
    `  수량 합계   ${record.changedPreviousQuantityTotal} → ${record.changedNextQuantityTotal}` +
      (record.changedPreviousQuantityTotal === record.changedNextQuantityTotal
        ? "  (같다 — 정상)"
        : "  ⚠ 달라졌다. 연락서 쪽에서 수량을 다시 읽은 결과다 — 표본을 눈으로 볼 것")
  );
  lines.push("");

  lines.push("=== 훑은 자리 ===");
  lines.push(`  연락서 파일            ${record.scannedFileCount}장`);
  lines.push(
    `  세지 않은 찌꺼기        ${record.ignoredFileCount}장 (\`~$…\` 엑셀 잠금 파일 · 숨김 파일 — 연락서가 아니다)`
  );
  lines.push(`  연락서 이식 흔적       ${record.traceCount}건 (DB 전체)`);
  lines.push(`  🔴 해시가 짝지지 않은 흔적  ${record.unmatchedTraceIntakeNumbers.length}건`);
  if (record.unmatchedTraceIntakeNumbers.length > 0) {
    lines.push(
      "     (그 연락서 파일이 훑은 자리에 없다 — 폴더를 덜 주었거나 원본이 사라졌다. 아래 접수번호)"
    );
    for (const intakeNumber of record.unmatchedTraceIntakeNumbers) lines.push(`     ${intakeNumber}`);
  }
  lines.push(`  흔적이 없는 연락서 파일  ${record.orphanFileCount}장 (아직 한 번도 이식되지 않은 장)`);
  lines.push("");

  /**
   * 🔴 **그대로 다시 돌리면 들어가는 건은 접수번호를 전부 찍는다.**
   * 사람이 알아야 하는 것이 「몇 건」이 아니라 **「어느 건」**이기 때문이다 — 수만
   * 찍으면 그 몇 건을 다시 찾는 길이 기록 JSON 을 손으로 뒤지는 것뿐이다
   * (일괄 이식 러너의 `inventory-unknown` 표와 같은 자리).
   * 🔵 접수번호는 우리 번호라 화면에 찍어도 된다 — 파일 이름과 다르다.
   */
  const retryable = record.traces.filter((trace) =>
    KYOSAN_BACKFILL_RETRYABLE_OUTCOMES.includes(trace.outcome)
  );
  lines.push(`=== 🔴 그대로 다시 돌리면 되는 건: ${retryable.length}건 ===`);
  if (retryable.length === 0) {
    lines.push("  (없음)");
  } else {
    for (const trace of retryable) {
      lines.push(
        `  ${trace.intakeNumber ?? "(접수번호 없음)"}  ${KYOSAN_BACKFILL_OUTCOME_LABEL[trace.outcome]}`
      );
    }
    lines.push("  🔴 **실패가 아니다** — 재고 관리가 멈췄거나 그 사이에 자료가 바뀐 것이고,");
    lines.push("     아무것도 쓰지 않았다. 나중에 같은 명령을 그대로 다시 돌리면 된다.");
  }
  lines.push("");

  // 🔴 사람이 **봐야 하는** 건 — 조용히 지나가면 안 되는 갈래들.
  const needsHuman = record.traces.filter(
    (trace) =>
      trace.outcome === "legacy-trace" ||
      trace.outcome === "trace-inconsistent" ||
      trace.outcome === "multi-trace" ||
      trace.outcome === "row-mismatch" ||
      trace.outcome === "gate-blocked" ||
      trace.outcome === "case-missing" ||
      trace.outcome === "unreadable" ||
      trace.outcome === "failed"
  );
  lines.push(`=== 🔴 사람이 따로 정해야 하는 건: ${needsHuman.length}건 ===`);
  if (needsHuman.length === 0) {
    lines.push("  (없음)");
  } else {
    for (const trace of needsHuman) {
      // 🔴 `screenSafeMessage` 를 반드시 지난다 — fs 오류 문장에 경로가 섞여 온다.
      const message = screenSafeMessage(trace.message);
      lines.push(
        `  ${trace.intakeNumber ?? "(접수번호 없음)"}  ${KYOSAN_BACKFILL_OUTCOME_LABEL[trace.outcome]}` +
          (message === null ? "" : `\n     ${message}`)
      );
    }
  }
  lines.push("");

  /**
   * 🔴 **묶음 수와 장수만.** 이름은 기록 JSON 에만 있다(이 절의 머리말).
   */
  const biggestGroup = record.duplicateHashGroups.reduce(
    (most, group) => Math.max(most, group.fileNames.length),
    0
  );
  lines.push(
    `=== 내용이 같은 파일(sha256) — ${record.duplicateHashGroups.length}묶음` +
      (biggestGroup === 0 ? " ===" : ` (가장 큰 묶음 ${biggestGroup}장) ===`)
  );
  if (record.duplicateHashGroups.length === 0) {
    lines.push("  (없음 — 훑은 파일의 내용이 전부 다르다)");
  } else {
    lines.push("  (바이트가 같으니 어느 장을 읽어도 결과가 같다 — 먼저 나온 한 장만 읽는다.)");
  }
  lines.push(
    "  🔴 파일 이름은 화면에 찍지 않는다 — 고객사명·모델·S/N 이 들어 있다. 기록 JSON(`--out`)에서 본다."
  );
  lines.push("");
  lines.push("  🔴 이 도구는 작업 기록 · 첨부 · 신고 증상 · 보고서를 한 줄도 건드리지 않는다.");
  lines.push("  🔴 이식 흔적을 새로 만들지 않는다 — 기존 흔적의 사용 부품 id 만 갈아 끼운다.");

  return lines.join("\n");
}
