import "server-only";

import path from "node:path";

import { compareShareFolderNames } from "@/lib/domain/share-folder-naming";
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
 * 연락서 공유폴더 **안에 무엇이 있는가** — 맨 위 칸만 읽는다 (연락서 조각 3)
 * ============================================================================
 * 폴더를 찾는 일은 storage/contact-folder-archive.ts 가 한다. 이 모듈은 **이미 찾은
 * 폴더 하나의 맨 위 칸**을 읽어 줄로 만든다.
 *
 * ── 🔴 만들지 않는다 · 쓰지 않는다 · 지우지 않는다 ────────────────────────
 * 조각 1 과 같은 규율이다. `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용
 * 도우미(storage/share-folder-fs.ts)가 하고, `mkdir` · `writeFile` · `unlink` · `rm` ·
 * `rmdir` · `rename` 은 **이 파일에 들어올 길이 없다.** 앱은 사람의 서류함을 고치지
 * 않는다. 그 사실을 contact-folder-entries-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 파일 내용을 읽지 않는다 ───────────────────────────────────────────
 * 여기서 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의 파일은
 * 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리 출처로
 * 내보내면 그 방어선이 통째로 빠진다. 그래서 `readFile` · 스트림이 여기 없다.
 *
 * ── 🔴 하위 폴더로 내려가지 않는다 ───────────────────────────────────────
 * 사람이 그 안에 `사진/` · `OLD/` 를 만들어 두는 일이 실제로 있다. 재귀로 읽으면 그
 * 전부가 한 화면에 쏟아진다. 맨 위 칸만 보고, 하위 폴더는 **폴더 한 줄**로만 보인다
 * (customer-portal-archive.ts 가 `OLD` 안을 안 뒤지는 것과 같은 절제).
 *
 * ── 🔴 돌려주는 값에 경로가 없다 ─────────────────────────────────────────
 * 파일을 가리키는 값은 **그 폴더 안에서의 이름**뿐이다. 루트(컨테이너 안 경로)도,
 * 이어 붙인 전체 경로도 담는 칸이 타입 수준에 없다. 실패 사유도 경로 없는 짧은
 * 문장이다(contact-folder-archive.ts 머리말과 같은 규율 — fs 오류의 `message` 에는
 * 경로가 들어 있으므로 쓰지 않고 **오류 코드만 보고** 바꾼다).
 *
 * ── 🔴 기다리는 시간과 줄 수에 상한을 둔다 ───────────────────────────────
 * 둘 다 「사람이 폴더에 수천 장을 넣어 둔 날」을 위한 것이다. 상한을 넘으면 기다리기를
 * 그만두고(`failed`), 줄이 넘치면 **앞의 N 개만 주고 「더 있습니다」를 함께 나른다.**
 * 상한은 곧 **NAS 왕복 횟수**이기도 하다 — 줄마다 `stat` 을 한 번씩 때리기 때문에,
 * 고를 것을 먼저 고른 **뒤에** 그만큼만 읽는다.
 * ============================================================================
 */

/**
 * 이만큼 안에 답하지 않으면 그만둔다. 찾기(1.5초)보다 조금 길게 잡은 까닭은 찾기가
 * `readdir` 한 번인 데 비해 이쪽은 `readdir` 한 번 + 줄마다 `stat` 이기 때문이다.
 */
export const CONTACT_FOLDER_ENTRIES_TIMEOUT_MS = 2000;

/**
 * 한 번에 보여 주는 줄 수의 상한.
 *
 * 🔴 **100 이다.** 실측(2026-10-05)에서 연락서 루트에는 폴더가 660 개이고 파일은 0 개였다 —
 * 한 건의 폴더에 들어가는 것은 연락서 스캔 · 엑셀 몇 장이라 한 자릿수가 보통이다. 100 이면
 * 그 열 배가 넘는다. 더 키우지 않는 까닭은 **줄마다 `stat` 을 한 번씩 때리기 때문**이다 —
 * 500 으로 두면 NAS 가 느린 날 위 상한에 먼저 걸려 목록이 **통째로** `failed` 가 된다.
 * 잘라서라도 보여 주는 쪽이 낫다.
 */
export const CONTACT_FOLDER_ENTRIES_LIMIT = 100;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const CONTACT_FOLDER_ENTRIES_SLOW_REASON =
  "공유폴더가 느려 목록을 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

const FOLDER_NAME_MISSING_REASON = "읽을 폴더 이름이 비어 있습니다.";
const OUTSIDE_ROOT_REASON = "읽으려는 폴더가 공유폴더 밖을 가리켜 읽지 않았습니다.";

/** 목록에서 빼는 이름들 — 사람이 만든 것이 아니라 프로그램이 남긴 것이다. */
const PROGRAM_LEFTOVER_NAMES = new Set(["thumbs.db", "desktop.ini"]);

/**
 * 이 줄을 목록에서 빼는가.
 *  · `~$…` — 엑셀 · 워드가 **열어 둔 동안** 만드는 잠금 파일이다. 사람이 파일을 닫으면
 *    사라지므로 목록에 보이면 「이게 뭐죠」만 부른다.
 *  · `Thumbs.db` · `desktop.ini` — 윈도우 탐색기가 남기는 것이다(대소문자를 접는다).
 *  · 점으로 시작하는 이름 — 숨김 파일이다(NAS 는 리눅스라 `.DS_Store` · `.@__thumb` 가
 *    실제로 쌓인다).
 */
export function isIgnoredContactFolderEntryName(name: string): boolean {
  if (name.startsWith(".")) return true;
  if (name.startsWith("~$")) return true;
  return PROGRAM_LEFTOVER_NAMES.has(name.toLowerCase());
}

/** 폴더를 먼저, 그 안에서 이름순 — 탐색기와 같은 차례다. */
export function compareContactFolderEntries(a: ShareFolderDirent, b: ShareFolderDirent): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return compareShareFolderNames(a.name, b.name);
}

/** 한 줄. 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type ContactFolderEntry = {
  name: string;
  isDirectory: boolean;
  /** 파일 크기(바이트). 🔴 폴더는 **0** 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(에포크 ms). 그 한 줄의 stat 이 막히면 null 이고, 이름은 그대로 보인다. */
  modifiedAtMs: number | null;
};

export type ContactFolderEntriesResult =
  | {
      status: "listed";
      entries: ContactFolderEntry[];
      /** 거른 뒤의 전체 줄 수. `entries.length` 보다 클 수 있다(아래 truncated). */
      totalCount: number;
      /** 🔴 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  | { status: "failed"; reason: string };

export type ListContactFolderEntriesInput = {
  /** 공유폴더 루트. 비어 있으면 실패다 — 이 모듈은 환경변수를 읽지 않는다. */
  root: string;
  /** 🔴 **디스크의 실제 폴더 이름**(findContactFolder 가 준 그대로). 구분자가 들어올 수 없다. */
  folderName: string;
  /** 줄 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 그 폴더의 맨 위 칸을 읽는다. **던지지 않는다** — 모든 결과가 `{ status, … }` 다.
 */
export async function listContactFolderEntries(
  input: ListContactFolderEntriesInput
): Promise<ContactFolderEntriesResult> {
  const folderName = typeof input.folderName === "string" ? input.folderName : "";
  if (folderName.trim().length === 0) {
    return { status: "failed", reason: FOLDER_NAME_MISSING_REASON };
  }
  // 받은 이름은 readdir 이 준 한 칸짜리 이름이라 구분자가 들어 있을 수 없지만, 디스크의
  // 이름을 그대로 잇는 자리라 방어로 본다(아래 assertInsideShareFolderRoot 와 두 겹이다).
  if (folderName !== path.basename(folderName)) {
    return { status: "failed", reason: OUTSIDE_ROOT_REASON };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : CONTACT_FOLDER_ENTRIES_LIMIT;
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : CONTACT_FOLDER_ENTRIES_TIMEOUT_MS;

  try {
    return await withShareFolderTimeout(read(input.root, folderName, limit), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: CONTACT_FOLDER_ENTRIES_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

async function read(rawRoot: string, folderName: string, limit: number): Promise<ContactFolderEntriesResult> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);
  const folder = path.join(root, folderName);
  assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);

  // 🔴 맨 위 칸만. 하위 폴더는 폴더 한 줄로만 보이고, 그 안을 읽지 않는다.
  const visible = (await listShareFolderDirents(folder)).filter(
    (dirent) => !isIgnoredContactFolderEntryName(dirent.name)
  );
  const kept = [...visible].sort(compareContactFolderEntries).slice(0, limit);

  // 🔴 stat 은 **남긴 줄에만** 때린다 — 상한이 곧 NAS 왕복 횟수다.
  const entries: ContactFolderEntry[] = [];
  for (const dirent of kept) {
    const info = await statShareFolderEntry(folder, dirent.name);
    entries.push({
      name: dirent.name,
      isDirectory: dirent.isDirectory,
      sizeBytes: dirent.isDirectory ? 0 : (info?.sizeBytes ?? 0),
      modifiedAtMs: info?.modifiedAtMs ?? null,
    });
  }

  return {
    status: "listed",
    entries,
    totalCount: visible.length,
    truncated: visible.length > entries.length,
  };
}
