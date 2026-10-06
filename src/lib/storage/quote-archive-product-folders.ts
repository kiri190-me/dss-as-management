import "server-only";

import path from "node:path";

import { quoteNumbersFromArchiveFileNames } from "@/lib/domain/quote-archive-file-number";
import { isQuoteArchiveYearFolder, matchesQuoteArchiveFolder } from "@/lib/domain/quote-archive-naming";
import {
  compareShareFolderNames,
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
 * **이 장비(L/N + S/N)가 예전에 받은 견적서 폴더**를 찾는다 (2026-10-06)
 * ============================================================================
 * 수리 건의 「견적서」 탭에서, 지금 수리 중인 그 장비가 **지난 몇 해 동안 어떤 견적서를
 * 받았는지** 공유폴더에서 찾아 보여 주기 위한 것이다. 같은 장비가 해를 걸러 다시 들어오는
 * 일이 흔해서, 그때 지난 견적서를 손으로 뒤지던 일을 그 자리에서 대신한다.
 *
 * ── 🔴 「이 건의 견적서 폴더」와 **다른 일**이다 ──────────────────────────
 * 그쪽(storage/quote-archive-entries.ts)은 **견적서 한 장**에서 출발해 그 장의 폴더 하나를
 * 찾는다. 여기는 **장비 하나**에서 출발해 연도 폴더 전부를 훑어 **여러 폴더**를 찾는다.
 * 찾는 열쇠도 다르다(저쪽은 발행번호, 여기는 L/N + S/N). 그래서 저쪽 함수를 비틀어 쓰지
 * 않고 따로 둔다 — 저쪽은 한 글자도 바뀌지 않았다.
 *
 * ── 🔴 연도 폴더를 **전부** 훑는다 ───────────────────────────────────────
 * 번호의 연도로 연도 폴더를 추측하지 않는다. 실측(2026-10-06)에 `DSS 2023-018` 폴더가
 * **2024 연도 폴더**에 들어 있었다 — 사람이 그 해에 정리하면서 그리 넣은 것이다.
 * 추측하면 그런 건은 영영 안 보인다. 연도 폴더인지 가르는 일은 **이미 있는 판정**
 * (domain/quote-archive-naming.ts 의 isQuoteArchiveYearFolder)을 그대로 쓴다.
 * 실측: 연도 폴더 21 개 · 견적서 폴더 658 개를 다 훑는 데 851ms.
 *
 * ── 🔴 L/N 과 S/N 이 **둘 다** 맞아야 한다 ───────────────────────────────
 * S/N 하나로는 장비가 확정되지 않는다 — 이 시스템에는 **같은 S/N 에 모델이 셋**인 사례가
 * 실제로 있다. 둘 중 하나라도 비면 디스크를 **아예 보지 않는다**: 빈 열쇠로 훑으면 658 개가
 * 전부 걸려 남의 장비 견적서를 통째로 보여 주게 된다.
 *
 * ── 🔴 만들지 않는다 · 쓰지 않는다 · 지우지 않는다 ────────────────────────
 * 이웃(quote-archive-entries.ts · contact-folder-entries.ts)과 같은 규율이다.
 * `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용 도우미
 * (storage/share-folder-fs.ts)가 하고, 만들기 · 쓰기 · 지우기 · 옮기기는 **이 파일에 들어올
 * 길이 없다.** 앱은 사람의 서류함을 고치지 않는다. 그 사실을
 * quote-archive-product-folders-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 파일 **내용**을 읽지 않는다 ───────────────────────────────────────
 * 폴더 안에서 읽는 것은 **이름뿐**이다(그 이름에서 발행번호를 뽑고, 파일 수를 센다).
 * 크기 · 수정 시각도 재지 않는다 — 줄마다 stat 을 한 번씩 때리는 일이 여기서는 폴더 수만큼
 * 더 늘기 때문이다. 자세한 목록은 그 폴더를 [열기]로 열어서 본다.
 *
 * ── 🔴 돌려주는 값에 **절대 경로**가 없다 ────────────────────────────────
 * 폴더를 가리키는 값은 **공유폴더 루트 기준 상대 경로**(`연도 폴더/견적서 폴더`)뿐이다 —
 * 화면의 [열기]가 도우미 주소를 만들 때 쓰는 바로 그 값이다. 컨테이너 안 경로(루트)를 담을
 * 칸이 타입 수준에 없고, 실패 사유도 경로 없는 짧은 문장이다(fs 오류의 `message` 에는 경로가
 * 들어 있으므로 쓰지 않고 **오류 코드만 보고** 바꾼다).
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 결과가 `{ status, … }` 다. 부르는 쪽(통로)은 try 를 쓰지 않는다.
 * ============================================================================
 */

/**
 * 이만큼 안에 답하지 않으면 그만둔다.
 *
 * 🔴 **5000 이다.** 실측(2026-10-06)에서 연도 폴더 21 개 · 견적서 폴더 658 개를 다 훑는 데
 * **851ms**(연도당 보통 20~40ms, 한 번 226ms 가 나온 적 있음)였다. 여기에 찾은 폴더마다
 * 안을 한 번 더 읽는 몫이 붙는다(실측상 많아야 4 개). 851ms 의 다섯 배를 넘게 잡아 **느린
 * 날에도 한 번은 성공**하게 하되, 더 키우지 않는 까닭은 이 시간이 곧 **요청 워커가 NAS 에
 * 매달려 있는 시간**이기 때문이다 — 오래 기다리느니 「잠시 뒤 다시」가 낫다.
 * 🔴 이웃 목록(QUOTE_ARCHIVE_ENTRIES_TIMEOUT_MS = 3000)보다 큰 까닭은 **읽는 폴더 수가
 * 다르기** 때문이다(저쪽은 셋, 여기는 스물 넘게). 한쪽을 고칠 일이 있어도 따라 고치지 말 것.
 */
export const QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS = 5000;

/**
 * 한 번에 보여 주는 폴더 수의 상한.
 *
 * 🔴 **20 이다.** 실측(2026-10-06)에서 서로 다른 (L/N, S/N) 조합 291 개 가운데 **여러 폴더에
 * 걸린 것이 44 건이고 가장 많은 것이 4 개**였다. 20 이면 그 다섯 배다. 상한을 두는 까닭은
 * 사람이 L/N · S/N 을 짧거나 흔한 값으로 적어 둔 날 **폴더마다 안을 한 번씩 더 읽는 일**이
 * 그 수만큼 늘기 때문이다 — 그러면 기다리기 상한에 먼저 걸려 구역이 통째로 `failed` 가 된다.
 * 잘라서라도 보여 주는 쪽이 낫다(잘렸다는 사실은 `truncated` 로 함께 나른다).
 */
export const QUOTE_ARCHIVE_PRODUCT_FOLDERS_LIMIT = 20;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON =
  "공유폴더가 느려 지난 견적서를 찾지 못했습니다(잠시 뒤 다시 시도하세요).";

/** 🔴 사유에 경로를 담지 않는다(머리말의 규율). */
const OUTSIDE_ROOT_REASON = "찾은 폴더가 공유폴더 밖을 가리켜 읽지 않았습니다.";

/** 찾은 폴더 하나. 🔴 **절대 경로를 담는 칸이 없다.** */
export type QuoteArchiveProductFolder = {
  /** 그 폴더가 든 연도 폴더의 연도(2024). 🔴 폴더 **번호**의 연도와 다를 수 있다. */
  year: number;
  /** 연도 폴더 이름 — 디스크의 실제 이름이다. */
  yearFolderName: string;
  /** 견적서 폴더 이름 — 디스크의 실제 이름이다. */
  folderName: string;
  /** 루트 기준 슬래시 경로 — `연도 폴더/견적서 폴더`. 화면의 [열기]가 쓴다. */
  relativePath: string;
  /** 그 폴더 안 **파일 이름에서 뽑은** 발행번호들(중복 없이, 차례대로). 없으면 빈 배열. */
  quoteNumbers: string[];
  /** 찌꺼기를 뺀 **파일** 수. 하위 폴더는 세지 않는다. */
  fileCount: number;
};

export type QuoteArchiveProductFoldersResult =
  | {
      status: "found";
      /** 연도 내림차순(최근이 위), 같은 연도면 폴더 이름순. 없으면 빈 배열이다. */
      folders: QuoteArchiveProductFolder[];
      /** 🔴 폴더 수 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export type ListQuoteArchiveProductFoldersInput = {
  /**
   * 공유폴더 루트. 주지 않으면(`undefined` · `null`) 설정을 읽는다 — 비어 있으면
   * `disabled` 로 끝나고 🔴 **디스크를 한 번도 보지 않는다.** 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /** 장비의 L/N. 🔴 비면 디스크를 아예 보지 않는다. */
  lotNumber: string | null | undefined;
  /** 장비의 S/N. 🔴 비면 디스크를 아예 보지 않는다. */
  serialNumber: string | null | undefined;
  /**
   * 🔴 **이 수리 건에 등록된 견적서 번호들.** 그 번호의 폴더는 「이 건의 견적서 폴더」
   * 구역이 이미 그리고 있으므로 여기서 뺀다 — 같은 폴더가 한 화면에 두 번 나오면 안 된다.
   * 거르는 규칙은 그 구역이 폴더를 찾을 때 쓰는 판정 그대로다(matchesQuoteArchiveFolder —
   * 본 번호로 시작하고 바로 뒤가 공백). 🔴 **연도 폴더를 가리지 않는다**: 번호가 이 건의
   * 것이면 어느 해 폴더에 들어 있든 「지난 견적서」가 아니다.
   */
  excludeQuoteNumbers?: readonly string[];
  /** 폴더 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 이름 한 조각을 **비교용 열쇠**로 만든다 — 다듬고(금지 글자 · 연속 공백 · NFC) 대소문자를
 * 접는다. 로케일을 `en-US` 로 못 박는 까닭은 공용 모듈과 같다(터키어 로케일에서 `i` 가
 * 다른 글자가 되지 않게).
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
 * 걸려 **다른 장비**의 견적서를 보여 주게 된다.
 *
 * 밑줄도 구분자로 친다 — 사내 파일 · 폴더에 `RFK300FH-AD1_WN3769_1802083` 처럼 밑줄로 이은
 * 이름이 실제로 있다(실측 2026-10-06).
 */
function archiveFolderNameKeys(folderName: string): Set<string> {
  const normalized = normalizeShareFolderNameForCompare(folderName).toLocaleUpperCase("en-US");
  return new Set(normalized.split(/[\s_]+/).filter((piece) => piece.length > 0));
}

/** 🔴 **둘 다** 맞아야 한다 — S/N 하나로는 장비가 확정되지 않는다(머리말). */
function matchesProduct(folderName: string, lotKey: string, serialKey: string): boolean {
  const keys = archiveFolderNameKeys(folderName);
  return keys.has(lotKey) && keys.has(serialKey);
}

/** 이 건의 견적서 폴더인가 — 그 구역이 이미 그리고 있으므로 여기서는 뺀다. */
function isThisCaseFolder(folderName: string, excludeQuoteNumbers: readonly string[]): boolean {
  return excludeQuoteNumbers.some((quoteNumber) => matchesQuoteArchiveFolder(folderName, quoteNumber));
}

/**
 * 이 이름이 연도 폴더면 그 연도, 아니면 null. 🔴 판정 자체는 **이미 있는 함수**가 한다 —
 * 연도 폴더 이름 규칙(`NN. YYYY 내자견적서`)을 여기에 두 벌째 적지 않는다. 그 함수가 연도를
 * 받아야 하므로, 이름에 든 네 자리 숫자를 후보로 넣어 본다(연도 범위 판정도 그 안에 있다).
 */
function yearFolderYear(name: string): number | null {
  for (const match of normalizeShareFolderNameForCompare(name).matchAll(/\d{4}/g)) {
    const year = Number(match[0]);
    if (isQuoteArchiveYearFolder(name, year)) return year;
  }
  return null;
}

/**
 * 그 장비가 예전에 받은 견적서 폴더들을 찾는다. **던지지 않는다** — 모든 결과가
 * `{ status, … }` 다.
 */
export async function listQuoteArchiveProductFolders(
  input: ListQuoteArchiveProductFoldersInput
): Promise<QuoteArchiveProductFoldersResult> {
  const lotKey = archiveNameKey(input.lotNumber);
  const serialKey = archiveNameKey(input.serialNumber);
  // 🔴 둘 중 하나라도 비면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  //    빈 열쇠로 훑으면 공유폴더의 견적서 폴더가 **전부** 걸린다(머리말).
  if (!isUsableKey(lotKey) || !isUsableKey(serialKey)) {
    return { status: "found", folders: [], truncated: false };
  }

  // 🔴 설정이 비어 있으면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  const configured = input.root === undefined || input.root === null ? resolveQuoteArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : QUOTE_ARCHIVE_PRODUCT_FOLDERS_LIMIT;
  const timeoutMs =
    typeof input.timeoutMs === "number" ? input.timeoutMs : QUOTE_ARCHIVE_PRODUCT_FOLDERS_TIMEOUT_MS;
  const exclude = input.excludeQuoteNumbers ?? [];

  try {
    // 🔴 상한 하나가 **연도 폴더 훑기와 폴더 안 읽기를 함께** 덮는다.
    return await withShareFolderTimeout(search(configured, lotKey, serialKey, exclude, limit), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: QUOTE_ARCHIVE_PRODUCT_FOLDERS_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

async function search(
  rawRoot: string,
  lotKey: string,
  serialKey: string,
  exclude: readonly string[],
  limit: number
): Promise<QuoteArchiveProductFoldersResult> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);

  // 🔴 연도 폴더 전부. 최근이 위로 오게 연도 내림차순, 같은 연도면 이름순이다
  //    (사람이 `20. 2026` 과 `21. 2026` 을 둘 다 만들어 둔 날에도 차례가 흔들리지 않게).
  const yearFolders: Array<{ name: string; year: number }> = [];
  for (const name of await listShareFolderNames(root)) {
    const year = yearFolderYear(name);
    if (year !== null) yearFolders.push({ name, year });
  }
  yearFolders.sort((a, b) => (a.year === b.year ? compareShareFolderNames(a.name, b.name) : b.year - a.year));

  const folders: QuoteArchiveProductFolder[] = [];
  for (const yearFolder of yearFolders) {
    // 이을 때는 디스크의 실제 이름을 쓴다 — 다듬은 이름으로 이으면 없는 폴더가 된다.
    const yearDirectory = path.join(root, yearFolder.name);
    assertInsideShareFolderRoot(root, yearDirectory, OUTSIDE_ROOT_REASON);

    const names = await listShareFolderNames(yearDirectory, (name) => matchesProduct(name, lotKey, serialKey));
    for (const name of names) {
      // 🔴 이 건의 견적서 폴더는 위 구역이 이미 그린다 — 한 화면에 두 번 나오지 않게.
      if (isThisCaseFolder(name, exclude)) continue;
      // 상한을 넘겼다 — 더 읽지 않고(폴더마다 NAS 왕복이 한 번 더 든다) 잘렸다고 알린다.
      if (folders.length >= limit) return { status: "found", folders, truncated: true };

      const folder = path.join(yearDirectory, name);
      assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);
      folders.push({
        year: yearFolder.year,
        yearFolderName: yearFolder.name,
        folderName: name,
        // 루트 기준, 구분자는 슬래시 — OS 와 무관하게 같은 값이 나오도록 문자열로 잇는다.
        relativePath: [yearFolder.name, name].join("/"),
        ...(await readNumbers(folder)),
      });
    }
  }

  return { status: "found", folders, truncated: false };
}

/**
 * 폴더 안 **이름만** 읽어 발행번호를 뽑고 파일 수를 센다. 🔴 내용 · 크기 · 수정 시각을
 * 읽지 않는다. 찌꺼기(Thumbs.db · desktop.ini · `~$…` · 점으로 시작)는 세기 전에 뺀다 —
 * 실측(2026-10-06)에서 파일 342 개 가운데 57 개가 찌꺼기였다.
 */
async function readNumbers(folder: string): Promise<{ quoteNumbers: string[]; fileCount: number }> {
  const fileNames = (await listShareFolderDirents(folder))
    .filter((dirent) => !dirent.isDirectory && !isIgnoredShareFolderEntryName(dirent.name))
    .map((dirent) => dirent.name);
  return { quoteNumbers: quoteNumbersFromArchiveFileNames(fileNames), fileCount: fileNames.length };
}
