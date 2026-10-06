import "server-only";

import path from "node:path";

import type { QuoteArchiveNamingInput } from "@/lib/domain/quote-archive-naming";
import { compareShareFolderNames, isIgnoredShareFolderEntryName } from "@/lib/domain/share-folder-naming";
import { findQuoteArchiveFolder, resolveQuoteArchiveRoot } from "./quote-archive";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  listShareFolderDirents,
  requireExistingShareFolderRoot,
  shareFolderReadFailureReason,
  statShareFolderEntry,
  withShareFolderTimeout,
  type ShareFolderDirent,
} from "./share-folder-fs";

/**
 * ============================================================================
 * 견적서 공유폴더 **안에 무엇이 있는가** — 그 폴더의 맨 위 칸만 읽는다 (2026-10-06)
 * ============================================================================
 * 폴더를 **찾는** 일은 storage/quote-archive.ts 의 findQuoteArchiveFolder 가 한다 — 이
 * 모듈은 찾기를 새로 쓰지 않고 그것을 그대로 부른 뒤, 찾은 폴더 하나의 맨 위 칸을 읽어
 * 줄로 만든다. 그래야 [폴더 열기]가 여는 폴더와 이 목록이 **반드시 같은 폴더**다.
 *
 * ── 🔴 만들지 않는다 · 쓰지 않는다 · 지우지 않는다 ────────────────────────
 * 연락서 쪽(storage/contact-folder-entries.ts)과 같은 규율이다. `node:fs/promises` 를 아예
 * 가져오지 않는다 — 읽기는 공용 도우미(storage/share-folder-fs.ts)가 하고, `mkdir` ·
 * `writeFile` · `unlink` · `rm` · `rmdir` · `rename` 은 **이 파일에 들어올 길이 없다.** 앱은
 * 사람의 서류함을 고치지 않는다. 그 사실을 quote-archive-entries-source.test.ts 가 원본을
 * 글자로 읽어 못 박는다.
 *
 * ── 🔴 파일 내용을 읽지 않는다 ───────────────────────────────────────────
 * 여기서 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의 파일은
 * 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리 출처로
 * 내보내면 그 방어선이 통째로 빠진다. 파일을 **여는** 일은 그 PC 의 탐색기 도우미가 한다
 * (domain/quote-folder-file-link.ts). 그래서 `readFile` · 스트림이 여기 없다.
 *
 * ── 🔴 한 칸만 읽는다 — 하위 폴더로 내려가는 길이 **없다** ─────────────────
 * 연락서 쪽에는 폴더 줄을 눌러 들어가는 길이 있지만 여기에는 **일부러 넣지 않았다.**
 * 실측(2026-10-06, 2026 연도 폴더)에서 견적서 폴더 105 개 안의 파일 342 개에 대해
 * **하위 폴더는 0 개**였다 — 평평하다. 쓰지 않을 길을 들이면 상한 · 검사 · 시험이 함께
 * 따라오고, 그만큼 틀릴 자리가 는다. 혹시 사람이 폴더를 하나 만들어 두었으면 **폴더 한
 * 줄로만** 보이고(그 안은 읽지 않는다) 그 아래는 [폴더 열기]로 탐색기에서 본다.
 *
 * ── 🔴 돌려주는 값에 **절대 경로**가 없다 ─────────────────────────────────
 * 줄을 가리키는 값은 **그 폴더 안에서의 이름**뿐이고, 폴더를 가리키는 값은 **공유폴더
 * 루트 기준 상대 경로**(`연도 폴더/견적서 폴더`)뿐이다 — 이웃 통로
 * (api/quotes/[id]/archive-folder)가 [폴더 열기]에 쓰는 바로 그 값이고, 화면이 줄의
 * [열기] 주소를 만들 때 쓴다. 컨테이너 안 경로(루트)도, 이어 붙인 전체 경로도 담을 칸이
 * 타입 수준에 없다. 실패 사유도 경로 없는 짧은 문장이다(fs 오류의 `message` 에는 경로가
 * 들어 있으므로 쓰지 않고 **오류 코드만 보고** 바꾼다).
 *
 * ── 🔴 맞는 폴더가 여럿이면 목록을 내지 않는다 ───────────────────────────
 * 어느 폴더인지 모르는 채로 내용을 보이면 **남의 견적서 서류를 보일 수 있다.** 찾기는
 * 「이름순 첫째」를 고르지만(저장과 같은 선택), 이 모듈은 그 사실(multipleFolderMatches)을
 * 보면 `multiple` 로 끝낸다 — 정리는 사람이 한다. 연락서 쪽 목록 통로와 같은 판단이다.
 *
 * ── 🔴 기다리는 시간과 줄 수에 상한을 둔다 ───────────────────────────────
 * 둘 다 「사람이 폴더에 수천 장을 넣어 둔 날」과 「NAS 가 느린 날」을 위한 것이다. 상한을
 * 넘으면 기다리기를 그만두고(`failed`), 줄이 넘치면 **앞의 N 개만 주고 「더 있습니다」를
 * 함께 나른다.** 상한은 곧 **NAS 왕복 횟수**이기도 하다 — 줄마다 `stat` 을 한 번씩 때리기
 * 때문에, 고를 것을 먼저 고른 **뒤에** 그만큼만 읽는다.
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 결과가 `{ status, … }` 다. 부르는 쪽(통로)은 try 를 쓰지 않는다.
 * ============================================================================
 */

/**
 * 이만큼 안에 답하지 않으면 그만둔다.
 *
 * 🔴 **3000 이다.** 이 상한 하나가 **찾기와 읽기를 함께** 덮는다 — 연락서 쪽은 찾기(1500)와
 * 읽기(2000)가 따로 두 번 걸리지만, 여기서는 찾기(findQuoteArchiveFolder)가 제 상한을 들지
 * 않아 한 번에 묶었다. 재는 일은 `readdir` 세 번(연도 폴더 · 견적서 폴더 · 그 안)과 남긴
 * 줄마다의 `stat` 이다. 더 키우지 않는 까닭은 이 시간이 곧 **요청 워커가 NAS 에 매달려 있는
 * 시간**이기 때문이다 — 오래 기다리느니 「잠시 뒤 다시」가 낫다.
 */
export const QUOTE_ARCHIVE_ENTRIES_TIMEOUT_MS = 3000;

/**
 * 한 번에 보여 주는 줄 수의 상한.
 *
 * 🔴 **100 이다.** 실측(2026-10-06)에서 2026 연도 폴더의 견적서 폴더 105 개에 든 파일은 모두
 * 342 개였다 — 폴더당 평균 3~4 개이고 많아야 열 개 안쪽이다. 100 이면 그 열 배가 넘는다.
 * 더 키우지 않는 까닭은 **줄마다 `stat` 을 한 번씩 때리기 때문**이다 — 크게 두면 NAS 가 느린
 * 날 기다리기 상한에 먼저 걸려 목록이 **통째로** `failed` 가 된다. 잘라서라도 보여 주는
 * 쪽이 낫다(연락서 목록과 같은 숫자 · 같은 까닭).
 */
export const QUOTE_ARCHIVE_ENTRIES_LIMIT = 100;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const QUOTE_ARCHIVE_ENTRIES_SLOW_REASON =
  "공유폴더가 느려 목록을 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

/** 🔴 사유에 경로를 담지 않는다(머리말의 규율). */
const OUTSIDE_ROOT_REASON = "읽으려는 폴더가 공유폴더 밖을 가리켜 읽지 않았습니다.";

/** 한 줄. 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type QuoteArchiveEntry = {
  name: string;
  isDirectory: boolean;
  /** 파일 크기(바이트). 🔴 폴더는 **0** 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(에포크 ms). 그 한 줄의 stat 이 막히면 null 이고, 이름은 그대로 보인다. */
  modifiedAtMs: number | null;
};

export type QuoteArchiveEntriesResult =
  | {
      status: "found";
      /**
       * 공유폴더 루트 기준 슬래시 경로 — `연도 폴더/견적서 폴더`. 디스크의 실제 이름이다
       * (이웃 통로 api/quotes/[id]/archive-folder 가 [폴더 열기]에 쓰는 값과 같다).
       * 🔴 컨테이너 안 경로(루트)는 여기에 들어 있지 않다.
       */
      relativePath: string;
      entries: QuoteArchiveEntry[];
      /** 거른 뒤의 전체 줄 수. `entries.length` 보다 클 수 있다(아래 truncated). */
      totalCount: number;
      /** 🔴 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 맞는 폴더가 여럿이다 — **목록도 경로도 내지 않는다**(머리말). */
  | { status: "multiple" }
  /** 연도 폴더나 견적서 폴더가 아직 없다 — 만들지 않는다. */
  | { status: "not-found" }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export type ListQuoteArchiveEntriesInput = {
  /**
   * 공유폴더 루트. 주지 않으면(`undefined` · `null`) 설정을 읽는다 — 비어 있으면
   * `disabled` 로 끝나고 🔴 **디스크를 한 번도 보지 않는다.** 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /** 발행일자 `"YYYY-MM-DD"` — 연도 폴더를 정한다(찾기가 쓴다). */
  quoteDate: string;
  naming: QuoteArchiveNamingInput;
  /** 줄 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/** 폴더를 먼저, 그 안에서 이름순 — 탐색기와 같은 차례다. */
export function compareQuoteArchiveEntries(a: ShareFolderDirent, b: ShareFolderDirent): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return compareShareFolderNames(a.name, b.name);
}

/**
 * 그 견적서의 공유폴더 폴더를 찾고, 찾았으면 그 맨 위 칸을 읽는다.
 * **던지지 않는다** — 모든 결과가 `{ status, … }` 다.
 */
export async function listQuoteArchiveEntries(
  input: ListQuoteArchiveEntriesInput
): Promise<QuoteArchiveEntriesResult> {
  // 🔴 설정이 비어 있으면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  const configured = input.root === undefined || input.root === null ? resolveQuoteArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : QUOTE_ARCHIVE_ENTRIES_LIMIT;
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : QUOTE_ARCHIVE_ENTRIES_TIMEOUT_MS;

  try {
    // 🔴 상한 하나가 **찾기와 읽기를 함께** 덮는다(머리말의 상한 설명).
    return await withShareFolderTimeout(findAndRead(configured, input, limit), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: QUOTE_ARCHIVE_ENTRIES_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

async function findAndRead(
  rawRoot: string,
  input: ListQuoteArchiveEntriesInput,
  limit: number
): Promise<QuoteArchiveEntriesResult> {
  // 🔴 찾기를 새로 쓰지 않는다 — [폴더 열기]와 **같은 폴더**를 가리켜야 한다.
  //    findQuoteArchiveFolder 는 던지지 않고 값으로 답한다(읽기 전용 찾기).
  const found = await findQuoteArchiveFolder({
    root: rawRoot,
    quoteDate: input.quoteDate,
    naming: input.naming,
  });
  if (found.status === "not-found") return { status: "not-found" };
  if (found.status === "failed") return { status: "failed", reason: found.reason };
  // 🔴 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 경로도 목록도 내지 않는다.
  if (found.multipleFolderMatches) return { status: "multiple" };

  const entries = await read(rawRoot, found.relativePath, limit);
  return { status: "found", relativePath: found.relativePath, ...entries };
}

async function read(
  rawRoot: string,
  relativePath: string,
  limit: number
): Promise<{ entries: QuoteArchiveEntry[]; totalCount: number; truncated: boolean }> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);
  // 찾기가 준 경로는 **디스크의 실제 이름**을 슬래시로 이은 것이다(연도 폴더 · 견적서 폴더).
  // 다듬은 이름으로 이으면 없는 폴더가 된다 — 받은 그대로 마디로 쪼개 잇는다.
  const folder = path.join(root, ...relativePath.split("/"));
  // 이름을 그대로 잇는 자리라 방어로 한 겹 더 본다(찾기 쪽에도 같은 검사가 있다).
  assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);

  // 🔴 그 자리의 맨 위 칸만. 그 아래 폴더는 폴더 한 줄로만 보이고, 그 안을 읽지 않는다.
  //    찌꺼기(Thumbs.db · desktop.ini · ~$… · 점으로 시작)는 **세기 전에** 뺀다 — 「더
  //    있습니다」가 사람이 넣은 적 없는 줄 때문에 거짓으로 서지 않게.
  const visible = (await listShareFolderDirents(folder)).filter(
    (dirent) => !isIgnoredShareFolderEntryName(dirent.name)
  );
  const kept = [...visible].sort(compareQuoteArchiveEntries).slice(0, limit);

  // 🔴 stat 은 **남긴 줄에만** 때린다 — 상한이 곧 NAS 왕복 횟수다.
  const entries: QuoteArchiveEntry[] = [];
  for (const dirent of kept) {
    const info = await statShareFolderEntry(folder, dirent.name);
    entries.push({
      name: dirent.name,
      isDirectory: dirent.isDirectory,
      sizeBytes: dirent.isDirectory ? 0 : (info?.sizeBytes ?? 0),
      modifiedAtMs: info?.modifiedAtMs ?? null,
    });
  }

  return { entries, totalCount: visible.length, truncated: visible.length > entries.length };
}
