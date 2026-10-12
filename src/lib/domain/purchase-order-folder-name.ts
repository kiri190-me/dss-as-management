import {
  normalizeShareFolderNameForCompare,
  sanitizeShareFolderNamePiece,
} from "./share-folder-naming";

/**
 * ============================================================================
 * **발주서 폴더 이름을 읽는다** — 날짜 · L/N · S/N (순수 — 파일시스템 없음) (2026-10-12)
 * ============================================================================
 * 사내 발주서 공유폴더는 `<연도>/<고객사>/<발주 건>` 세 켜다. 우리가 읽는 것은 맨 아래의
 * **발주 건 폴더 이름** 하나뿐이고, 사람이 수년째 손으로 적어 온 이름이다:
 *
 *   `101. 내자 20251223_PO4500371858_MBKK200-JS2_WN1183_1708076 - 16,720,000원`
 *    └번호┘ └구분┘ └─날짜─┘ └──PO번호──┘ └──모델──┘ └L/N┘ └─S/N─┘  └──금액──┘
 *
 * ── 🔴 **못 읽으면 null 이다 — 지어내지 않는다** ──────────────────────────
 * 뽑지 못한 폴더는 후보에서 **빠진다.** 반쯤 읽어 「아마 이것일 것」을 내놓으면 그것이 곧
 * **남의 발주서를 이 건의 것처럼** 보여 주는 길이다. 이 모듈이 내는 값은 셋 다 이름에
 * 적혀 있는 글자 그대로이고, 하나라도 없으면 통째로 null 이다.
 *
 * ── 🔴 **외자 폴더는 저절로 빠진다** ─────────────────────────────────────
 *   `1. 외자 Purchase Order_JUSUNG_CSOT_4500391219_JPY16,295,000`
 * 날짜도 L/N 도 S/N 도 없다 — 「지금 수리건의 것인가」를 가릴 길이 없는 이름이다. 그래서
 * 🔴 **`내자` 라는 낱말을 보고 가르지 않는다**: 구분 글자가 아니라 **읽을 수 있는가**로
 * 가른다. 사람이 `내자` 를 빠뜨린 날에도 날짜 · L/N · S/N 이 제자리에 있으면 읽히고,
 * `내자` 라고 적혀 있어도 날짜가 없으면 안 읽힌다.
 * 바로 가기(`임시 발주서 및 신용장 - 바로 가기`)도 `_` 가 없어 여기서 null 이 된다 —
 * 애초에 저장소 쪽이 폴더로 치지 않지만(storage/share-folder-fs.ts), 두 겹으로 막는다.
 *
 * ── 🔴 **자리로 읽는다 — 이름 어딘가에 있는지 보지 않는다** ────────────────
 * 이웃(견적서)은 폴더 이름을 마디로 쪼개 L/N · S/N 이 **들어 있는가**로 가른다. 거기는
 * 「같은 장비의 지난 견적서」를 여러 장 늘어놓는 자리라 넉넉한 쪽이 맞다. 여기는 **폴더
 * 하나의 안을 통째로 보여 주는** 자리라 반대다 — 느슨하게 걸리면 그 순간 남의 발주서
 * 내용이 화면에 뜬다. 그래서 `_` 로 쪼갠 **마지막 두 마디**를 L/N · S/N 으로 읽는다.
 *  · 🔴 그 대가로 **꼬리가 더 붙은 이름은 못 읽는다**(`…_1708076_재발행`). 못 읽으면 그
 *    폴더가 안 보일 뿐이고, 잘못 읽으면 남의 서류가 보인다 — 안 보이는 쪽을 고른다.
 *
 * ── 🔴 **글자 다루기는 공용 함수를 쓴다** ────────────────────────────────
 * 사람이 탐색기 · NAS 에서 만든 폴더라 한글이 풀어쓴(NFD) 모양이거나 공백이 두 칸일 수
 * 있다. 비교용 다듬기(NFC · 연속 공백)는 share-folder-naming.ts 한 벌이다 — 여기에 두
 * 벌째 적지 않는다.
 *
 * 🔴 순수하다 — fs · 통로 · 서버 · DB 가 한 글자도 없다.
 * ============================================================================
 */

/** 읽어 낸 발주 건 폴더 이름. 🔴 **경로를 담는 칸이 없다** — 이름에서 나온 값뿐이다. */
export type PurchaseOrderFolderName = {
  /** 발주서 발행일 — `YYYY-MM-DD`. 이름의 여덟 자리를 자리만 끊어 적은 것이다. */
  issuedDate: string;
  /** 이름에 적힌 L/N — 다듬지 않은 **디스크의 글자 그대로**다. */
  lotNumber: string;
  /** 이름에 적힌 S/N — 금액 꼬리를 뗀 뒤의 글자 그대로다. */
  serialNumber: string;
};

/**
 * 날짜는 **첫 마디의 끝**에 있다 — `101. 내자 20251223`. 앞의 번호 · 구분 글자가 무엇이든
 * 상관하지 않고, 바로 뒤가 `_` 인 여덟 자리만 날짜로 친다.
 * 🔴 `PO4500371858` 같은 긴 숫자가 날짜로 읽히지 않는 까닭이 이것이다 — 그 숫자는 둘째
 * 마디이고, 첫 마디의 끝도 아니다.
 */
const ISSUED_DATE_AT_END = /(?:^|\s)(\d{4})(\d{2})(\d{2})$/;

/**
 * 마지막 마디에 붙는 금액 꼬리 — ` - 16,720,000원`. 🔴 **금액 모양을 글자로 적지 않는다**:
 * 원화 · 외화 · 메모 무엇이 붙든 ` - ` 뒤는 S/N 이 아니다. 띄어쓴 하이픈만 꼬리로 보므로
 * 모델 이름의 하이픈(`MBKK200-JS2`)이나 S/N 안의 하이픈은 떨어지지 않는다.
 */
const AMOUNT_TAIL = /\s-\s[\s\S]*$/;

/**
 * 날짜로 받아들이는 연도 범위. 사람이 모델명이나 사번을 날짜 자리에 적어 둔 이름이
 * 조용히 「1970 년 발주서」가 되지 않게 막는 울타리다 — 이 서류함에 1999 년이나 2100 년
 * 발주서는 없다.
 */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2099;

/**
 * 여덟 자리를 `YYYY-MM-DD` 로. 달력에 **실제로 있는 날**이 아니면 null 이다 — `20251332`
 * 같은 이름이 날짜 행세를 하지 못하게. 윤년 판정은 달의 마지막 날을 묻는 방식이다.
 */
function toIssuedDate(year: number, month: number, day: number): string | null {
  if (year < EARLIEST_YEAR || year > LATEST_YEAR) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 발주 건 폴더 이름에서 **날짜 · L/N · S/N** 을 읽는다. 🔴 셋을 다 읽지 못하면 null 이고,
 * 그 폴더는 후보에서 빠진다(머리말).
 */
export function readPurchaseOrderFolderName(folderName: string): PurchaseOrderFolderName | null {
  if (typeof folderName !== "string") return null;
  const pieces = normalizeShareFolderNameForCompare(folderName).split("_");
  // 날짜 마디 하나 + L/N + S/N — 적어도 셋이어야 자리로 읽을 수 있다.
  if (pieces.length < 3) return null;

  // 🔴 마디를 자른 자리의 공백을 걷고 본다 — 사람이 `… 20251223 _PO…` 처럼 적어 둔 날에도
  //    날짜를 읽는다(다듬기는 연속 공백을 하나로 줄일 뿐 마디 경계의 공백을 없애지 않는다).
  const dateMatch = ISSUED_DATE_AT_END.exec(pieces[0].trim());
  if (dateMatch === null) return null;
  const issuedDate = toIssuedDate(Number(dateMatch[1]), Number(dateMatch[2]), Number(dateMatch[3]));
  if (issuedDate === null) return null;

  const lotNumber = pieces[pieces.length - 2].trim();
  const serialNumber = pieces[pieces.length - 1].replace(AMOUNT_TAIL, "").trim();
  if (lotNumber === "" || serialNumber === "") return null;

  return { issuedDate, lotNumber, serialNumber };
}

/**
 * 이름 한 조각을 **비교용 열쇠**로 만든다 — 다듬고(금지 글자 · 연속 공백 · NFC) 대소문자를
 * 접는다. 로케일을 `en-US` 로 못 박는 까닭은 공용 모듈과 같다(터키어 로케일에서 `i` 가
 * 다른 글자가 되지 않게).
 */
function nameKey(value: string | null | undefined): string {
  return sanitizeShareFolderNamePiece(value).toLocaleUpperCase("en-US");
}

/**
 * 🔴 이 값이 **장비를 가리킬 수 있는가** — 글자나 숫자가 한 자라도 있어야 한다.
 * 수리 건 조회가 빈 칸을 `-` 로 채워 내려보내는 자리가 있다(mappers/repair-case.ts). 그
 * `-` 를 열쇠로 쓰면 아무 폴더에나 걸린다 — 빈 값과 똑같이 다룬다.
 */
function isUsableKey(key: string): boolean {
  return /[\p{L}\p{N}]/u.test(key);
}

/**
 * 장비 하나의 열쇠 — L/N 과 S/N 을 **둘 다** 쓸 수 있을 때만 만들어진다. 못 만들면 null.
 *
 * 🔴 **수리 건 쪽과 폴더 쪽이 이 한 함수를 함께 쓴다.** 한쪽만 손으로 다듬으면 NFD 로 앉은
 * 폴더나 소문자로 적힌 L/N 이 조용히 안 맞게 된다.
 *
 * 🔴 **둘 다 맞아야 한다** — S/N 하나로는 장비가 확정되지 않는다(이 시스템에는 같은 S/N 에
 * 모델이 셋인 사례가 있다). 그래서 열쇠가 한 덩이다.
 */
export function purchaseOrderProductKey(
  lotNumber: string | null | undefined,
  serialNumber: string | null | undefined
): string | null {
  const lotKey = nameKey(lotNumber);
  const serialKey = nameKey(serialNumber);
  if (!isUsableKey(lotKey) || !isUsableKey(serialKey)) return null;
  return `${lotKey}|${serialKey}`;
}
