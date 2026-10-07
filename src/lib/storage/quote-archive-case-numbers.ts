import "server-only";

import path from "node:path";

import { quoteNumbersFromArchiveFileNames } from "@/lib/domain/quote-archive-file-number";
import { isQuoteArchiveYearFolder } from "@/lib/domain/quote-archive-naming";
import {
  isIgnoredShareFolderEntryName,
  normalizeShareFolderNameForCompare,
  sanitizeShareFolderNamePiece,
} from "@/lib/domain/share-folder-naming";
import { resolveQuoteArchiveRoot } from "./quote-archive";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  listShareFolderDirents,
  listShareFolderNames,
  requireExistingShareFolderRoot,
  shareFolderReadFailureReason,
  withShareFolderTimeout,
} from "./share-folder-fs";

/**
 * ============================================================================
 * **여러 장비의 견적서 번호를 한 번에** 공유폴더에서 읽는다 (2026-10-07)
 * ============================================================================
 * 「고객 안내 현황」의 견적서 번호 칸이 쓴다. 내자 정리에 번호가 적혀 있지 **않은** 줄에
 * 한해, 그 장비(L/N + S/N)의 견적서 폴더 **안 파일 이름들**에서 발행번호를 읽어 보여 준다.
 * 한 건에 견적서가 여럿일 수 있어(가지 번호 · 개정본) **번호도 여럿**이다.
 *
 * ── 🔴 이웃(quote-archive-product-folders.ts)과 **다른 일**이다 ───────────
 * 저쪽은 **장비 하나**를 받아 폴더 목록을 그리는 함수다. 장비마다 연도 폴더를 전부 다시
 * 훑으므로(실측 851ms) 줄이 수십 개인 표에서는 851ms × 줄 수가 된다. 여기는 **장비 여럿**을
 * 한꺼번에 받아 **훑기를 한 번**으로 끝낸다. 그래서 저쪽 함수를 비틀어 쓰지 않고 따로 둔다 —
 * 🔴 **저쪽은 한 글자도 바뀌지 않았다.**
 *
 * ── 🔴 일을 둘로 나눈 까닭 — 한 화면에서 훑기는 한 번이다 ────────────────
 *   1. listQuoteArchiveFolderRefs    연도 폴더 전부 → 견적서 폴더 **이름** 전부 (비싼 쪽)
 *   2. readQuoteArchiveNumbersForProducts   그 이름들 가운데 **맞는 폴더만** 열어 번호를 읽는다
 *
 * 비싼 쪽(1)은 들어오는 장비가 무엇이든 **결과가 같다.** 그래서 부르는 쪽이 요청 수명
 * 캐시(React 의 cache)로 한 번만 돌리고, 그 결과를 양식 · 고객사마다 (2)에 넘긴다
 * (db/queries/customer-portal.ts). 한 덩어리였다면 양식이 셋이니 훑기도 셋이 된다.
 *
 * ── 🔴 연도 폴더를 **전부** 훑는다 ───────────────────────────────────────
 * 번호의 연도로 연도 폴더를 추측하지 않는다. 실측(2026-10-06)에 `DSS 2023-018` 폴더가
 * **2024 연도 폴더**에 들어 있었다 — 사람이 그 해에 정리하면서 그리 넣은 것이다. 연도 폴더를
 * 가르는 일은 **이미 있는 판정**(domain/quote-archive-naming.ts)을 그대로 쓴다.
 *
 * ── 🔴 폴더 **이름**에서 번호를 뽑지 않는다 ──────────────────────────────
 * 폴더 이름에는 본 번호 하나뿐이지만, 그 안의 파일에는 가지 번호(`2026-001-1`)와
 * 개정본(`2026-004R1`)까지 들어 있다(실측 2026-10-06). 사용자가 요구한 것이 「**파일들의**
 * 견적서 번호」라, 맞은 폴더만 열어 파일 이름에서 뽑는다(quoteNumbersFromArchiveFileNames).
 * 🔴 전체 폴더(실측 658 개)를 다 열지 않는 까닭은 그것이 곧 NAS 왕복 658 번이기 때문이다 —
 * 들어온 장비에 **맞은 폴더만** 연다.
 *
 * ── 🔴 L/N 과 S/N 이 **둘 다** 맞아야 한다 ───────────────────────────────
 * S/N 하나로는 장비가 확정되지 않는다 — 이 시스템에는 같은 S/N 에 모델이 셋인 사례가 있다.
 * 둘 중 하나라도 비면 그 장비는 **디스크를 보는 목록에 들어가지 않는다**: 빈 열쇠로 훑으면
 * 폴더가 전부 걸려 남의 장비 견적서 번호가 고객사 표에 적힌다.
 *
 * ── 🔴 만들지 않는다 · 쓰지 않는다 · 지우지 않는다 ────────────────────────
 * 이웃들과 같은 규율이다. `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용 도우미
 * (storage/share-folder-fs.ts)가 한다. 그 사실을 quote-archive-case-numbers-source.test.ts 가
 * 원본을 글자로 읽어 못 박는다.
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 결과가 `{ status, … }` 다. 공유폴더가 꺼져 있거나(`disabled`) 못 읽으면(`failed`)
 * 부르는 쪽은 **내자 정리 값만** 보여 주면 된다 — 화면이 깨지지 않는다.
 * ============================================================================
 */

/**
 * 연도 폴더를 전부 훑는 데 허락하는 시간.
 *
 * 🔴 **8000 이다.** 실측(2026-10-06)에서 연도 폴더 21 개 · 견적서 폴더 658 개를 다 훑는 데
 * **851ms** 였다. 그 열 배 가까이 잡는 까닭은 이 훑기가 **화면 한 장에 한 번**뿐이고(아래
 * 머리말 「일을 둘로 나눈 까닭」), 실패하면 그 화면의 견적서 번호 칸이 통째로 비기 때문이다.
 * 🔴 이웃(QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS = 5000)보다 큰 까닭이 그것이다 —
 * 저쪽은 구역 하나가 비는 일이고 여기는 표 한 장의 열 하나가 비는 일이다. 한쪽을 고칠 일이
 * 있어도 따라 고치지 말 것.
 */
export const QUOTE_ARCHIVE_CASE_NUMBERS_SCAN_TIMEOUT_MS = 8000;

/** 맞은 폴더들을 열어 파일 이름을 읽는 데 허락하는 시간. 폴더 수가 많아 훑기와 따로 둔다. */
export const QUOTE_ARCHIVE_CASE_NUMBERS_READ_TIMEOUT_MS = 8000;

/**
 * 한 번에 **열어 보는 폴더 수**의 상한.
 *
 * 🔴 **200 이다.** 이 수가 곧 NAS 왕복 횟수다. 실측(2026-10-06)에서 서로 다른 (L/N, S/N)
 * 조합 291 개 가운데 여러 폴더에 걸린 것이 44 건이고 가장 많은 것이 4 개였다 — 진행 중인
 * 건이 양식마다 수십 개이므로 보통은 100 을 넘지 않는다. 상한을 두는 까닭은 사람이 L/N ·
 * S/N 을 짧거나 흔한 값으로 적어 둔 날 폴더가 무더기로 걸리기 때문이다. 그때는 기다리기
 * 상한에 먼저 걸려 **열 전체가 비는 것**보다, 거기까지 읽고 끝내는 쪽이 낫다.
 */
export const QUOTE_ARCHIVE_CASE_NUMBERS_FOLDER_LIMIT = 200;

/**
 * 폴더를 한꺼번에 몇 개씩 여는가.
 *
 * 🔴 **8 이다.** 하나씩 차례로 열면 폴더 100 개가 곧 NAS 왕복 100 번을 **줄 세워** 기다리는
 * 일이 된다(실측상 한 번에 20~40ms — 그대로 2~4 초다). 반대로 전부 한꺼번에 던지면 느린 날
 * NAS 가 밀린다. 여덟씩 묶어 보내 둘 사이를 잡는다.
 */
const READ_CONCURRENCY = 8;

/**
 * 파일 이름에서 뽑은 번호 앞에 붙이는 머리말.
 *
 * 🔴 **지어내는 것이 아니다.** 사내 견적서 파일은 전부 `DSS` 로 시작하고
 * (domain/quote-archive-file-number.ts), 뽑는 함수가 그 머리말을 떼고 번호만 준다
 * (`DSS 2026-100 …xlsx` → `2026-100`). 반면 내자 정리에 **사람이 적어 둔 번호**는
 * `DSS 2026-100` 꼴이다(domain/quote-archive-naming.ts 의 QuoteArchiveNamingInput). 둘이
 * 한 칸에 번갈아 보이는 자리라, 머리말을 다시 붙여 **같은 꼴로** 맞춘다.
 */
const ARCHIVE_NUMBER_PREFIX = "DSS ";

/** 🔴 사유에 경로를 담지 않는다(머리말의 규율). */
const OUTSIDE_ROOT_REASON = "찾은 폴더가 공유폴더 밖을 가리켜 읽지 않았습니다.";

/** 공유폴더가 느려 그만두었을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON =
  "공유폴더가 느려 견적서 번호를 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

/**
 * 견적서 폴더 하나를 가리키는 값. 🔴 **절대 경로를 담는 칸이 없다** — 루트 기준 두 조각뿐이다.
 * 이 목록이 요청 수명 캐시에 담겨 여러 양식이 함께 쓴다.
 */
export type QuoteArchiveFolderRef = {
  /** 연도 폴더 이름 — 디스크의 실제 이름이다. */
  yearFolderName: string;
  /** 견적서 폴더 이름 — 디스크의 실제 이름이다. */
  folderName: string;
};

export type QuoteArchiveFolderRefsResult =
  | { status: "found"; folders: QuoteArchiveFolderRef[] }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/** 번호를 찾아 줄 장비 하나. 수리 건 조회가 내는 칸 이름을 그대로 쓴다. */
export type QuoteArchiveProduct = {
  lotNumber: string | null | undefined;
  serialNumber: string | null | undefined;
};

export type QuoteArchiveCaseNumbersResult =
  | {
      status: "found";
      /**
       * 🔴 열쇠는 `quoteArchiveProductKey` 가 만든 값이다 — 부르는 쪽도 **같은 함수로**
       * 열쇠를 만들어 꺼낸다. 번호를 못 찾은 장비는 아예 들어 있지 않다(빈 배열도 아니다).
       */
      numbersByProduct: Map<string, string[]>;
      /** 🔴 폴더 수 상한에 걸려 일부만 읽었는가. */
      truncated: boolean;
    }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/**
 * 이름 한 조각을 **비교용 열쇠**로 만든다 — 다듬고(금지 글자 · 연속 공백 · NFC) 대소문자를
 * 접는다. 로케일을 `en-US` 로 못 박는 까닭은 공용 모듈과 같다(터키어 로케일에서 `i` 가
 * 다른 글자가 되지 않게).
 *
 * ⚠️ 이웃 quote-archive-product-folders.ts 의 같은 이름 함수와 **규칙이 같다.** 그쪽은
 * 내보내는 이름이 `listQuoteArchiveProductFolders` 하나뿐임을 제 원본 시험이 글자로 못 박고
 * 있어(quote-archive-product-folders-source.test.ts) 끌어내 쓸 수 없었다. 규칙을 고칠 일이
 * 생기면 **두 곳을 함께** 고쳐야 한다.
 */
function archiveNameKey(value: string | null | undefined): string {
  return sanitizeShareFolderNamePiece(value).toLocaleUpperCase("en-US");
}

/**
 * 🔴 이 값이 **장비를 가리킬 수 있는가** — 글자나 숫자가 한 자라도 있어야 한다.
 *
 * 수리 건 조회가 빈 칸을 `-` 로 채워 내려보내는 자리가 있다(mappers/repair-case.ts). 그
 * `-` 를 열쇠로 쓰면 이름에 `-` 가 든 폴더가 전부 걸린다 — 빈 값과 똑같이 다룬다.
 */
function isUsableKey(key: string): boolean {
  return /[\p{L}\p{N}]/u.test(key);
}

/**
 * 폴더 이름을 **마디**로 쪼갠다(대소문자를 접은 채). 사내 폴더 이름은
 * `DSS <번호> <고객사> <모델> <L/N> <S/N> <꼬리>` 라 L/N · S/N 이 **마디 하나**다.
 * 마디로 보는 까닭은 경계 때문이다 — 그냥 포함으로 보면 S/N `1701056` 이 `17010567` 에도
 * 걸려 **다른 장비**의 번호를 그 줄에 적게 된다.
 *
 * 밑줄도 구분자로 친다 — 사내 파일 · 폴더에 `RFK300FH-AD1_WN3769_1802083` 처럼 밑줄로 이은
 * 이름이 실제로 있다(실측 2026-10-06).
 */
function archiveFolderNameKeys(folderName: string): Set<string> {
  const normalized = normalizeShareFolderNameForCompare(folderName).toLocaleUpperCase("en-US");
  return new Set(normalized.split(/[\s_]+/).filter((piece) => piece.length > 0));
}

/**
 * 장비 하나의 열쇠 — L/N 과 S/N 을 **둘 다** 쓸 수 있을 때만 만들어진다. 못 만들면 null 이고,
 * 그 장비는 디스크를 보는 목록에 들어가지 않는다(머리말).
 *
 * 🔴 **부르는 쪽도 이 함수로 열쇠를 만든다.** 결과 표(`numbersByProduct`)에서 제 줄의 번호를
 * 꺼낼 때 열쇠를 손으로 이으면, 다듬기 규칙이 바뀌는 날 조용히 한 줄도 안 맞게 된다.
 */
export function quoteArchiveProductKey(
  lotNumber: string | null | undefined,
  serialNumber: string | null | undefined
): string | null {
  const lotKey = archiveNameKey(lotNumber);
  const serialKey = archiveNameKey(serialNumber);
  if (!isUsableKey(lotKey) || !isUsableKey(serialKey)) return null;
  return `${lotKey}|${serialKey}`;
}

/**
 * 이 이름이 연도 폴더면 그 연도, 아니면 null. 🔴 판정 자체는 **이미 있는 함수**가 한다 —
 * 연도 폴더 이름 규칙(`NN. YYYY 내자견적서`)을 여기에 두 벌째 적지 않는다. 그 함수가 연도를
 * 받아야 하므로, 이름에 든 네 자리 숫자를 후보로 넣어 본다(연도 범위 판정도 그 안에 있다).
 */
function isYearFolder(name: string): boolean {
  for (const match of normalizeShareFolderNameForCompare(name).matchAll(/\d{4}/g)) {
    if (isQuoteArchiveYearFolder(name, Number(match[0]))) return true;
  }
  return false;
}

export type ListQuoteArchiveFolderRefsInput = {
  /**
   * 공유폴더 루트. 주지 않으면(`undefined` · `null`) 설정을 읽는다 — 비어 있으면
   * `disabled` 로 끝나고 🔴 **디스크를 한 번도 보지 않는다.** 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 연도 폴더를 전부 훑어 **견적서 폴더 이름 전부**를 모은다. **던지지 않는다.**
 *
 * 🔴 폴더 **안**은 보지 않는다 — 여기서는 이름뿐이다. 이 결과가 요청 하나 동안 캐시되어
 * 여러 양식 · 여러 고객사가 함께 쓴다(머리말 「일을 둘로 나눈 까닭」).
 */
export async function listQuoteArchiveFolderRefs(
  input: ListQuoteArchiveFolderRefsInput = {}
): Promise<QuoteArchiveFolderRefsResult> {
  // 🔴 설정이 비어 있으면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  const configured = input.root === undefined || input.root === null ? resolveQuoteArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const timeoutMs =
    typeof input.timeoutMs === "number" ? input.timeoutMs : QUOTE_ARCHIVE_CASE_NUMBERS_SCAN_TIMEOUT_MS;

  try {
    return await withShareFolderTimeout(scanFolders(configured), timeoutMs);
  } catch (error) {
    return toFailure(error);
  }
}

async function scanFolders(rawRoot: string): Promise<QuoteArchiveFolderRefsResult> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);

  const folders: QuoteArchiveFolderRef[] = [];
  for (const yearFolderName of await listShareFolderNames(root, isYearFolder)) {
    // 이을 때는 디스크의 실제 이름을 쓴다 — 다듬은 이름으로 이으면 없는 폴더가 된다.
    const yearDirectory = path.join(root, yearFolderName);
    assertInsideShareFolderRoot(root, yearDirectory, OUTSIDE_ROOT_REASON);
    for (const folderName of await listShareFolderNames(yearDirectory)) {
      folders.push({ yearFolderName, folderName });
    }
  }
  return { status: "found", folders };
}

export type ReadQuoteArchiveNumbersInput = {
  /** 위 ListQuoteArchiveFolderRefsInput 과 같은 규칙이다. */
  root?: string | null;
  /** listQuoteArchiveFolderRefs 가 모아 둔 폴더 이름들. 비어 있으면 디스크를 아예 안 본다. */
  folders: readonly QuoteArchiveFolderRef[];
  /** 번호를 찾아 줄 장비들. L/N · S/N 이 둘 다 있는 것만 쓰인다. */
  products: readonly QuoteArchiveProduct[];
  /** 열어 보는 폴더 수 상한. 시험에서만 바꾼다. */
  folderLimit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 장비들의 견적서 번호를 한 번에 읽는다. **던지지 않는다.**
 *
 * 🔴 **맞은 폴더만 연다.** 폴더 이름의 마디에 L/N 과 S/N 이 둘 다 있는 폴더가 그 장비의
 * 것이고, 그 폴더 **안 파일 이름들**에서 번호를 뽑는다.
 */
export async function readQuoteArchiveNumbersForProducts(
  input: ReadQuoteArchiveNumbersInput
): Promise<QuoteArchiveCaseNumbersResult> {
  const keys = new Set<string>();
  for (const product of input.products) {
    const key = quoteArchiveProductKey(product.lotNumber, product.serialNumber);
    if (key !== null) keys.add(key);
  }
  // 🔴 볼 장비가 없거나 훑어 둔 폴더가 없으면 여기서 끝난다 — 디스크에 닿지 않는다.
  if (keys.size === 0 || input.folders.length === 0) {
    return { status: "found", numbersByProduct: new Map(), truncated: false };
  }

  // 🔴 설정이 비어 있으면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  const configured = input.root === undefined || input.root === null ? resolveQuoteArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const folderLimit =
    typeof input.folderLimit === "number" && Number.isFinite(input.folderLimit) && input.folderLimit > 0
      ? Math.floor(input.folderLimit)
      : QUOTE_ARCHIVE_CASE_NUMBERS_FOLDER_LIMIT;
  const timeoutMs =
    typeof input.timeoutMs === "number" ? input.timeoutMs : QUOTE_ARCHIVE_CASE_NUMBERS_READ_TIMEOUT_MS;

  const matched = matchFolders(input.folders, keys, folderLimit);

  try {
    return await withShareFolderTimeout(readNumbers(configured, matched), timeoutMs);
  } catch (error) {
    return toFailure(error);
  }
}

type MatchedFolders = {
  /** 열어 볼 폴더들 — 같은 폴더가 두 장비에 걸려도 **한 번만** 들어 있다. */
  folders: QuoteArchiveFolderRef[];
  /** 폴더 자리번호 → 그 폴더가 걸린 장비 열쇠들. */
  keysByFolder: string[][];
  truncated: boolean;
};

/**
 * 훑어 둔 이름들 가운데 **그 장비들의 폴더**를 고른다. 디스크를 보지 않는 순수한 일이라
 * 기다리기 상한 **밖**에 둔다 — 상한은 NAS 를 기다리는 시간에만 걸려야 한다.
 */
function matchFolders(
  folders: readonly QuoteArchiveFolderRef[],
  keys: ReadonlySet<string>,
  folderLimit: number
): MatchedFolders {
  // 열쇠를 미리 갈라 둔다 — 폴더마다 다시 가르면 폴더 수 × 장비 수만큼 쪼개게 된다.
  const wanted = [...keys].map((key) => {
    const [lotKey, serialKey] = key.split("|");
    return { key, lotKey, serialKey };
  });

  const picked: QuoteArchiveFolderRef[] = [];
  const keysByFolder: string[][] = [];
  let truncated = false;

  for (const folder of folders) {
    const nameKeys = archiveFolderNameKeys(folder.folderName);
    const hit: string[] = [];
    for (const product of wanted) {
      // 🔴 **둘 다** 맞아야 한다 — S/N 하나로는 장비가 확정되지 않는다(머리말).
      if (nameKeys.has(product.lotKey) && nameKeys.has(product.serialKey)) hit.push(product.key);
    }
    if (hit.length === 0) continue;
    if (picked.length >= folderLimit) {
      truncated = true;
      break;
    }
    picked.push(folder);
    keysByFolder.push(hit);
  }

  return { folders: picked, keysByFolder, truncated };
}

/**
 * 고른 폴더들을 열어 **파일 이름만** 읽고 번호를 뽑는다. 🔴 내용 · 크기 · 수정 시각을 읽지
 * 않는다. 찌꺼기(Thumbs.db · desktop.ini · `~$…` · 점으로 시작)와 하위 폴더는 빼고 본다 —
 * 실측(2026-10-06)에서 파일 342 개 가운데 57 개가 찌꺼기였다.
 */
async function readNumbers(rawRoot: string, matched: MatchedFolders): Promise<QuoteArchiveCaseNumbersResult> {
  const root = await requireExistingShareFolderRoot(rawRoot);

  /** 장비 열쇠 → 그 장비의 폴더들에서 모은 파일 이름 전부. */
  const fileNamesByKey = new Map<string, string[]>();

  for (let from = 0; from < matched.folders.length; from += READ_CONCURRENCY) {
    const chunk = matched.folders.slice(from, from + READ_CONCURRENCY);
    const read = await Promise.all(chunk.map((folder) => readFileNames(root, folder)));
    read.forEach((fileNames, index) => {
      for (const key of matched.keysByFolder[from + index]) {
        const found = fileNamesByKey.get(key);
        if (found) found.push(...fileNames);
        else fileNamesByKey.set(key, [...fileNames]);
      }
    });
  }

  const numbersByProduct = new Map<string, string[]>();
  for (const [key, fileNames] of fileNamesByKey) {
    // 🔴 폴더가 여럿이어도 **한 번에** 뽑는다 — 그래야 중복 없애기와 차례가 그 함수 하나의
    //    규칙으로 끝난다(여러 번 뽑아 이으면 차례를 여기서 다시 정하게 된다).
    const numbers = quoteNumbersFromArchiveFileNames(fileNames);
    if (numbers.length > 0) {
      numbersByProduct.set(
        key,
        numbers.map((number) => `${ARCHIVE_NUMBER_PREFIX}${number}`)
      );
    }
  }

  return { status: "found", numbersByProduct, truncated: matched.truncated };
}

async function readFileNames(root: string, folder: QuoteArchiveFolderRef): Promise<string[]> {
  const directory = path.join(root, folder.yearFolderName, folder.folderName);
  assertInsideShareFolderRoot(root, directory, OUTSIDE_ROOT_REASON);
  return (await listShareFolderDirents(directory))
    .filter((dirent) => !dirent.isDirectory && !isIgnoredShareFolderEntryName(dirent.name))
    .map((dirent) => dirent.name);
}

/** 🔴 사유에 경로를 담지 않는다 — fs 오류의 `message` 에는 경로가 들어 있어 쓰지 않는다. */
function toFailure(error: unknown): { status: "failed"; reason: string } {
  if (error instanceof ShareFolderTimeout) {
    return { status: "failed", reason: QUOTE_ARCHIVE_CASE_NUMBERS_SLOW_REASON };
  }
  return {
    status: "failed",
    reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
  };
}
