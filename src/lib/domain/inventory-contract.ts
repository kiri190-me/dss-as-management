/**
 * ============================================================================
 * 두 시스템이 **같은 말을 하고 있는가** — 재는 자 (순수. 망도 DB 도 여기서 만지지 않는다)
 * ============================================================================
 * 2026-10-21. A/S 의 부품 요청 칸은 제 표가 아니라 **재고 관리를 직접 읽는다**
 * (`inventory-gateway.ts` 머리말). 두 시스템을 잇는 끈은 사실상 **코드값 글자 하나**다 —
 * `status.code` 가 「PENDING」이면 [요청 취소]를 그리고, 「REJECTED」면 결정 사유 상자의
 * 머리글을 「반려 사유」로 적는다.
 *
 * 🔴 **그 글자가 어긋나도 아무 오류가 안 난다.** `===` 가 그냥 거짓이 될 뿐이라, 단추가
 *    영영 안 그려지거나 머리글이 틀린 채로 몇 달을 간다. 타입도 못 잡는다 — 통로를 타고
 *    들어오는 값이라 이쪽에서는 그냥 `string` 이다.
 *
 * 실제로 2026-10-21 에 재고 관리가 상태를 하나 더했다(`IN_APPROVAL` 「결재 중」). A/S 가
 * 안 깨진 것은 **양쪽이 우연히 안전한 쪽으로 적혀 있었기 때문**이지(모르는 코드를
 * `canCancelStockRequest` 는 「못 거둔다」로 접는다) 누가 재어 본 것이 아니다. 다음에도
 * 그러리라는 보장이 없고, 그때까지 **재는 자가 없었다.**
 *
 * ── 이 파일이 쥐는 것 셋 ─────────────────────────────────────────────────
 *  ㉠ **저쪽이 내는 코드와 글자 목록**(아래 상수). 🔴 손으로 베껴 온 값이라 **읽은 날짜를
 *     적어 둔다** — 어긋났을 때 어느 쪽이 옛것인지 가릴 길이 그것뿐이다.
 *  ㉡ **우리가 코드값으로 판단하는 자리**를 원본 글자에서 **긁어모으는 자**
 *     (`scanStatusCodeChecks`). 🔴 그 목록을 손으로 적지 않는 까닭: 판단하는 자리가 하나
 *     늘어도 아무도 이 파일을 고치러 오지 않고, 그러면 재는 자가 **새로 생긴 자리만 쏙
 *     빼고** 통과한다 — 있으나 마나 한 점검이 된다.
 *  ㉢ **두 목록을 맞대는 셈**(`codesMissingFromInventory` · `codesUnknownToAs`).
 *
 * 🔵 **돌리는 자리는 `scripts/check-inventory-contract.ts`** 다. 여기에는 **서버가 없어도
 *    잴 수 있는 부분**만 둔다 — 그래야 시험이 망 없이 덮는다(저쪽 저장소의
 *    `lib/api/stock-request-status.ts` ↔ 라우트와 같은 가름이다).
 * ============================================================================
 */

/**
 * 재고 관리가 내는 신청 상태 코드 **전부**.
 *
 * 🔴 **2026-10-21 에 저쪽 `src/db/schema/stock-requests.ts` 의 `REQUEST_STATUSES` 를 읽어
 *    적었다.** 베낀 값이라 저쪽이 늘리는 날 여기가 옛것이 된다 — 그것을 잡는 것이
 *    점검 도구의 일이다(살아 있는 서버가 내는 코드가 이 목록에 다 들어 있는가).
 * 🔵 **차례는 저쪽 enum 이 아니라 저쪽 글자 표**(`lib/stock/codes.ts` 의
 *    `REQUEST_STATUS_LABEL`)**의 차례**다. enum 은 마이그레이션 때문에 새 값이 맨 뒤에
 *    붙어(PARTIAL·ON_HOLD·IN_APPROVAL) 사람이 읽을 차례가 아니다 — 저쪽도 같은 까닭으로
 *    글자 표의 차례를 쓴다(`REQUEST_STATUS_ORDER` 주석).
 */
export const INVENTORY_REQUEST_STATUS_CODES = [
  "PENDING",
  "IN_APPROVAL",
  "CONFIRMING",
  "PARTIAL",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
  "ON_HOLD",
] as const;

export type InventoryRequestStatusCode = (typeof INVENTORY_REQUEST_STATUS_CODES)[number];

/**
 * 코드마다 저쪽 화면에 뜨는 글자. 🔴 저쪽 `lib/stock/codes.ts` 의 `REQUEST_STATUS_LABEL` 을
 * 2026-10-21 에 읽어 적었다.
 *
 * 🔴 **A/S 는 이 표로 글자를 짓지 않는다.** 화면에 그리는 글자는 통로가 준 `status.label`
 *    그대로다(`inventory-gateway.ts` 머리말 — 두 화면이 다른 말을 하면 같은 신청이 다른
 *    일로 보인다). 이 표는 **맞대어 보기 위한** 것이지 쓰기 위한 것이 아니다. 그래서 어긋나면
 *    고칠 자리는 화면이 아니라 이 상수다.
 */
export const INVENTORY_REQUEST_STATUS_LABELS: Record<InventoryRequestStatusCode, string> = {
  PENDING: "대기",
  IN_APPROVAL: "결재 중",
  CONFIRMING: "처리 중",
  PARTIAL: "일부 나감",
  CONFIRMED: "확인됨",
  REJECTED: "반려",
  CANCELLED: "취소",
  ON_HOLD: "보류",
};

/**
 * 🔴 **코드와 짝이 맞지 않는 글자 둘.** 저쪽은 상태값을 새로 만드는 대신 `label` 만 갈아
 * 끼우는 자리를 둘 두었다 — 둘 다 enum 마이그레이션을 피하려고 그렇게 한 것이다
 * (저쪽 `requestStatusDisplay`).
 *
 *  ㉠ **「마감」** — 코드는 `CONFIRMED` 인데 글자는 「마감」이다. 가르는 값은 `closed` 칸이다.
 *  ㉡ **「실행 대기」** — 코드는 보통 `IN_APPROVAL` 인데 글자는 「실행 대기」다. 가르는 값은
 *     저쪽 결재건 잠금이라 **A/S 에는 그 값이 아예 안 온다**(통로가 안 내준다).
 *
 * 🔵 그래서 점검 도구는 「글자가 코드의 글자와 같은가」를 잴 때 이 둘을 **어긋남으로 세지
 *    않는다.** 모르고 재면 마감된 신청을 볼 때마다 ✗ 가 떠 도구를 아무도 안 믿게 된다.
 *
 * 🔴 **㉠은 A/S 화면이 기대고 있는 약속이다**(2026-10-21). 마감된 신청의 글자가 이미 「마감」
 *    이라서 `PartRequestSection` 이 제 꼬리말(「(마감)」)을 걷어냈다 — 그 전까지는 둘이 겹쳐
 *    **「마감 (마감)」**으로 떴다. 저쪽이 이 약속을 그만두는 날 A/S 는 마감된 신청을
 *    **「확인됨」**으로 그리고, 오류가 아니라 **빠짐**이라 아무도 신고하지 않는다. 그래서
 *    점검 도구가 마감된 신청을 볼 때마다 이 글자를 실측한다.
 */
export const INVENTORY_CLOSED_STATUS_LABEL = "마감";
export const INVENTORY_AWAITING_EXECUTION_STATUS_LABEL = "실행 대기";

/** 🔴 위 둘에서 **뽑아 쓴다** — 따로 적으면 한쪽만 고치는 날 조용히 갈린다. */
export const INVENTORY_STATUS_LABEL_OVERRIDES = [
  INVENTORY_CLOSED_STATUS_LABEL,
  INVENTORY_AWAITING_EXECUTION_STATUS_LABEL,
] as const;

/**
 * 통로가 돌려주는 신청 한 줄에서 **A/S 파서가 실제로 읽는 칸**
 * (`parseInventoryStockRequestsResponse`).
 *
 * 🔴 이 목록이 파서와 어긋나지 않는 것은 시험이 지킨다 — 칸을 하나씩 빼 보고 **파서의 답이
 *    달라지는가**로 잰다(`inventory-contract.test.ts`). 손으로 맞춰 둔 목록은 언젠가 갈리지만,
 *    「빼면 답이 달라진다」는 거짓말을 할 수 없다.
 */
export const INVENTORY_STOCK_REQUEST_FIELDS = [
  "id",
  "requestKey",
  "intakeNumber",
  "status.code",
  "status.label",
  "closed",
  "requestedAt",
  "lines",
] as const;

/** 신청 줄 하나에서 읽는 칸. 🔵 줄이 하나도 없는 신청이면 잴 것이 없다(건너뛴다). */
export const INVENTORY_STOCK_REQUEST_LINE_FIELDS = ["no", "name", "quantity", "issued"] as const;

/**
 * 🔵 **있을 때만 재는 칸들.** 셋 다 `null` 이 정상이라(아직 결정 전 · 보류 아님 · 재고 관리에서
 * 직접 올린 신청) 없다고 어긋난 것이 아니다. 들어 있을 때 **속 칸이 맞는가**만 본다.
 */
export const INVENTORY_STOCK_REQUEST_DECISION_FIELDS = ["byName", "at", "note"] as const;
export const INVENTORY_STOCK_REQUEST_HOLD_FIELDS = ["reason", "byName", "at"] as const;
export const INVENTORY_STOCK_REQUEST_REQUESTER_FIELDS = ["sub", "name"] as const;

/**
 * 부품 한 줄에서 A/S 파서가 읽는 칸(`parseInventoryPartsResponse`).
 *
 * 🔵 `quotePrice` · `overhaulQuotePrice` 는 **`null` 이 정상**이다(「아직 정하지 않았다」).
 *    그래서 「값이 있는가」가 아니라 **「칸이 있는가」**를 잰다 — 아래 `missingFields` 가
 *    `null` 을 있는 것으로 세는 까닭이다.
 */
export const INVENTORY_PART_FIELDS = [
  "no",
  "name",
  "name2",
  "customerName",
  "kyosanPartNo",
  "drawingNo",
  "quantity",
  "note",
  "owner.code",
  "owner.label",
  "quotePrice",
  "overhaulQuotePrice",
] as const;

// ---------------------------------------------------------------------------
// ㉡ 우리가 코드값으로 판단하는 자리를 **원본 글자에서** 긁어모은다
// ---------------------------------------------------------------------------

/** 한 자리. 🔵 사람이 눈으로 짚을 수 있게 **원본 줄을 그대로** 들고 간다. */
export type StatusCodeSite = {
  file: string;
  line: number;
  /** 그 자리가 견주는 코드값. 🔴 **못 풀었으면 `null`** 이다 — 조용히 빠뜨리지 않는다. */
  code: string | null;
  /** 못 풀었을 때 무엇을 못 풀었는지(상수 이름). 푼 자리면 빈 글자. */
  unresolved: string;
  text: string;
};

export type StatusCodeScan = {
  /** 🔴 **코드값으로 판단하는 자리.** 점검 도구가 재는 것이 이것이다. */
  checks: StatusCodeSite[];
  /** `status.code` 가 나오지만 **견주지는 않는** 자리(화면에 그냥 그리는 것 등). */
  mentions: StatusCodeSite[];
  /** 주석 안의 `status.code`. 🔵 판단이 아니므로 세지 않되, 묻히지 않게 따로 들고 간다. */
  comments: StatusCodeSite[];
};

/** `status.code === "X"` · `status.code !== IDENT` 를 찾는다. 글자든 상수 이름이든 받는다. */
const COMPARISON_RE = /\bstatus\.code\s*(?:===|!==)\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))/g;
/** 견주지 않는 것까지 **전부**. 🔵 위와 **같은 자리에서 시작**해야 짝지을 수 있다. */
const MENTION_RE = /\bstatus\.code\b/g;

/**
 * 같은 파일 안에 적힌 `const IDENT = "값"` 을 푼다.
 *
 * 🔵 상수로 빼 둔 자리가 실제로 있다 — `canCancelStockRequest` 의 `CANCELLABLE_STATUS_CODE`.
 *    글자만 찾으면 그 자리가 통째로 안 보인다.
 * 🔴 **못 풀면 지어내지 않는다.** 다른 파일에서 끌어온 상수거나 계산된 값이면 `null` 이고,
 *    점검 도구가 그것을 **실패로** 센다 — 「못 쟀다」를 통과로 세지 않는 규칙 그대로다.
 */
function resolveConst(source: string, name: string): string | null {
  const re = new RegExp(`\\bconst\\s+${name}\\b[^=\\n]*=\\s*["']([^"']*)["']`);
  return re.exec(source)?.[1] ?? null;
}

/** 글자 위치 → 줄 번호(1부터). */
function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

function lineTextOf(source: string, index: number): string {
  const start = source.lastIndexOf("\n", index) + 1;
  const end = source.indexOf("\n", index);
  return source.slice(start, end === -1 ? source.length : end).trim();
}

/**
 * 🔴 **주석 줄인가.** 줄을 다듬었을 때 `*` · `//` · `/*` 로 시작하면 주석으로 본다.
 *
 * 🔵 주석을 글자에서 **떼어 내지 않는** 까닭: 떼어 내려면 문자열 안의 `//`(주소 같은 것)까지
 *    가려야 하는데, 거기서 틀리면 멀쩡한 줄이 통째로 사라져 **판단하는 자리가 조용히 안
 *    보이게** 된다. 줄의 첫 글자만 보는 쪽은 틀려도 「주석을 판단으로 센다」까지라, 사람이
 *    출력에서 바로 알아본다.
 */
function isCommentLine(text: string): boolean {
  return text.startsWith("*") || text.startsWith("//") || text.startsWith("/*");
}

/**
 * 파일들의 원본 글자에서 **코드값으로 판단하는 자리**를 전부 긁어모은다.
 *
 * 🔴 **시험 파일을 넣지 마라.** 시험에는 「이 글자가 화면에 있으면 안 된다」를 재는 줄이 있어
 *    (`assert.doesNotMatch(source, /status\.code === "PENDING"/)`) 판단하는 자리로 잘못 센다.
 *    거르는 일은 부르는 쪽(점검 도구)이 한다 — 여기는 글자만 본다.
 */
export function scanStatusCodeChecks(files: readonly { path: string; source: string }[]): StatusCodeScan {
  const checks: StatusCodeSite[] = [];
  const mentions: StatusCodeSite[] = [];
  const comments: StatusCodeSite[] = [];

  for (const { path, source } of files) {
    const compared = new Map<number, { code: string | null; unresolved: string }>();
    for (const match of source.matchAll(COMPARISON_RE)) {
      const [, dq, sq, ident] = match;
      const literal = dq ?? sq;
      if (literal !== undefined) {
        compared.set(match.index, { code: literal, unresolved: "" });
        continue;
      }
      const resolved = ident === undefined ? null : resolveConst(source, ident);
      compared.set(match.index, { code: resolved, unresolved: resolved === null ? (ident ?? "?") : "" });
    }

    for (const match of source.matchAll(MENTION_RE)) {
      const text = lineTextOf(source, match.index);
      const site = { file: path, line: lineOf(source, match.index), text };
      const hit = compared.get(match.index);
      if (isCommentLine(text)) comments.push({ ...site, code: hit?.code ?? null, unresolved: "" });
      else if (hit) checks.push({ ...site, ...hit });
      else mentions.push({ ...site, code: null, unresolved: "" });
    }
  }

  return { checks, mentions, comments };
}

/** 긁어모은 자리에서 **코드값만** 추린다(겹치면 한 번). 🔵 못 푼 자리는 빠진다 — 따로 센다. */
export function judgedStatusCodes(scan: StatusCodeScan): string[] {
  const codes = new Set<string>();
  for (const site of scan.checks) if (site.code !== null) codes.add(site.code);
  return [...codes].sort();
}

// ---------------------------------------------------------------------------
// ㉢ 두 목록을 맞댄다
// ---------------------------------------------------------------------------

/**
 * 🔴 **A/S 가 집는데 재고 관리가 내지 않는 코드** — 그 판정은 **영영 거짓**이다.
 *
 * 오타 하나, 저쪽이 이름을 바꾼 날 하루면 이렇게 된다. 오류가 안 나고 화면도 멀쩡해서
 * (단추가 하나 안 그려질 뿐이다) 아무도 신고하지 않는다 — 이 함수가 그것을 잡는 자리다.
 */
export function codesMissingFromInventory(
  judged: readonly string[],
  emitted: readonly string[]
): string[] {
  const known = new Set(emitted);
  return judged.filter((code) => !known.has(code));
}

/**
 * 🔵 **재고 관리가 내는데 A/S 가 이름으로 집지 않는 코드.** 이것 자체는 어긋남이 아니다 —
 * 모르는 코드를 **어느 쪽으로 접는가**가 자리마다 정해져 있다(`canCancelStockRequest` 는
 * 「못 거둔다」, `isInventoryRequestSettled` 는 「안 끝났다」). 어느 쪽이 안전한가는 사람이
 * 읽고 판단할 일이라, 도구는 **목록을 보여 주기만** 한다.
 */
export function codesUnknownToAs(emitted: readonly string[], judged: readonly string[]): string[] {
  const named = new Set(judged);
  return emitted.filter((code) => !named.has(code));
}

// ---------------------------------------------------------------------------
// 칸이 다 있는가
// ---------------------------------------------------------------------------

/**
 * 점 찍힌 길(`status.code`)까지 따라가 **없는 칸**의 이름을 돌려준다.
 *
 * 🔴 **`null` 은 있는 칸이다.** 「아직 정하지 않은 견적가」·「결정 전」이 전부 `null` 이라,
 *    값이 비었다고 없다고 세면 멀쩡한 응답마다 ✗ 가 뜬다. 가르는 것은 **`undefined`** 뿐이다.
 */
export function missingFields(row: unknown, fields: readonly string[]): string[] {
  return fields.filter((field) => {
    let cursor: unknown = row;
    for (const step of field.split(".")) {
      if (cursor === null || typeof cursor !== "object") return true;
      if (!(step in (cursor as Record<string, unknown>))) return true;
      cursor = (cursor as Record<string, unknown>)[step];
    }
    return cursor === undefined;
  });
}

/**
 * 상태 글자가 **저쪽 표와 같은가**.
 *
 * 🔴 **둘러 가는 글자 둘은 어긋남이 아니다**(`INVENTORY_STATUS_LABEL_OVERRIDES` 머리말) —
 *    마감된 신청은 「마감」, 결재가 끝나 실행만 남은 신청은 「실행 대기」로 온다. 그것까지
 *    ✗ 로 세면 도구가 늘 빨개져 아무도 안 본다.
 * 🔵 모르는 코드면 **견줄 글자가 없다** — 그때는 `null`(못 쟀다)이다. 거짓으로 돌려주면
 *    「코드가 새로 생겼다」가 「글자가 틀렸다」로 둔갑한다.
 */
export function statusLabelMatches(code: string, label: string): boolean | null {
  if ((INVENTORY_STATUS_LABEL_OVERRIDES as readonly string[]).includes(label)) return true;
  const expected = INVENTORY_REQUEST_STATUS_LABELS[code as InventoryRequestStatusCode];
  return expected === undefined ? null : expected === label;
}
