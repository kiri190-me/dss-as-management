import "server-only";

import path from "node:path";

import { compareShareFolderNames, isIgnoredShareFolderEntryName } from "@/lib/domain/share-folder-naming";
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
 * 「수리 관련」 서류 공유폴더 **안에 무엇이 있는가** — 한 칸씩 (2026-10-07)
 * ============================================================================
 * 제품 종류별 공통 서류를 **올리지 않고 자리만 가리킨다**(사용자 결정 2026-10-07).
 * 사람이 그 자리를 고르려면 서류함 안을 눈으로 훑어야 한다 — 이 모듈이 그 한 칸을
 * 읽어 줄로 만든다. 루트는 storage/repair-docs-archive.ts 가 정하고, 이 모듈은
 * **받은 루트만** 본다(환경변수를 읽지 않는다 — 꺼져 있는지 판단은 부르는 쪽의 몫이다).
 *
 * 본보기는 연락서 쪽 storage/contact-folder-entries.ts 다. 규율도 돌려주는 모양도
 * 그대로이고, **다른 것은 시작점 하나**다:
 *  · 연락서는 인수번호로 폴더를 **찾는** 단계가 앞에 있다(findContactFolder).
 *  · 여기는 **루트가 곧 시작점**이다. 찾을 것이 없고, 그래서 `folderName` 칸도 없다.
 *
 * ── 🔴 만들지 않는다 · 쓰지 않는다 · 지우지 않는다 ────────────────────────
 * `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용 도우미
 * (storage/share-folder-fs.ts)가 하고, `mkdir` · `writeFile` · `unlink` · `rm` ·
 * `rmdir` · `rename` 은 **이 파일에 들어올 길이 없다.** 사람이 수년째 손으로 쌓아
 * 온 서류함이고, 앱은 그것을 고치지 않는다. 그 사실을 repair-docs-entries-source.test.ts
 * 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 파일 내용을 읽지 않는다 ───────────────────────────────────────────
 * 여기서 나가는 것은 **이름 · 크기 · 수정 시각 · 폴더인가** 넷뿐이다. 공유폴더의
 * 파일은 첨부 통로의 권한 · 확장자 검사 · 앞머리 바이트 대조 **밖**에 있다 — 우리
 * 출처로 내보내면 그 방어선이 통째로 빠진다. 파일을 **여는** 일은 그 PC 의 탐색기
 * 도우미가 한다. 그래서 `readFile` · 스트림이 여기 없다.
 *
 * ── 🔴 한 번에 **한 칸만** 읽는다 — 재귀가 아니다 ─────────────────────────
 * 요청한 자리의 맨 위 칸만 읽고, 그 아래 폴더는 **폴더 한 줄**로만 보인다. 사람이
 * 그 줄을 눌렀을 때만 `relativePath` 가 한 마디 길어져 다시 맨 위 칸을 읽는다.
 *  · 🔴 내려가는 길은 **보이는 폴더 줄**뿐이다 — 마디마다 그 자리의 `readdir` 에
 *    폴더로 서 있는지 본다. `readdir(withFileTypes)` 의 `isDirectory()` 는 링크를
 *    따라가지 않으므로 **바로가기(정션 · 심볼릭 링크)는 폴더로 치지 않는다**
 *    (공유폴더 밖을 가리킬 수 있다). `..` · `.` · 드라이브 문자 · UNC · 끝이 점 ·
 *    공백인 마디는 디스크의 이름과 같을 수가 없어 **같은 한 자리에서** 막힌다.
 *  · 🔴 한 칸 내려갈 때마다 `assertInsideShareFolderRoot` 가 한 겹 더 본다.
 *
 * ── 🔴 돌려주는 값에 경로가 없다 ─────────────────────────────────────────
 * 줄을 가리키는 값은 **그 자리에서의 이름**뿐이다. 루트(컨테이너 안 경로)도, 이어
 * 붙인 전체 경로도 담는 칸이 타입 수준에 없다. 실패 사유도 경로 없는 짧은 문장이다
 * (fs 오류의 `message` 에는 경로가 들어 있으므로 쓰지 않고 **오류 코드만 보고**
 * 바꾼다). 폴더 이름에 고객사명이 섞여 있는 서류함이라 더욱 그렇다.
 *
 * ── 🔴 던지지 않는다 ────────────────────────────────────────────────────
 * 밖으로 나가는 것은 전부 `{ status, … }` 다. 안쪽에서만 ShareFolderFailure 를
 * 던지고 바깥 함수가 잡아 사유로 바꾼다.
 * ============================================================================
 */

/**
 * 이만큼 안에 답하지 않으면 그만둔다.
 *
 * 🔴 **3000 이다**(연락서 목록은 2000). 하는 일의 모양은 같지만 — `readdir` 한 번 +
 * 남긴 줄마다 `stat` — **줄 수 상한이 두 배**(아래 200)라 `stat` 왕복도 두 배까지
 * 늘어난다. 2000 그대로 두면 넓은 칸에서 목록이 **통째로** `failed` 가 되기 쉽다.
 * 더 늘리지 않는 까닭은 이것이 **요청 워커가 NAS 를 기다리는 시간**이기 때문이다 —
 * 길게 잡을수록 NAS 가 멎은 날 앱 전체가 함께 느려진다.
 *
 * 🔴 **잴 수 없었다.** 이 글을 쓰는 지금 `REPAIR_DOCS_ARCHIVE_DIR` 가 비어 있어
 * 실제 서류함을 재지 못했다(연락서 쪽 2000 · 100 · 5 는 실측에서 나온 값이다).
 * 실측하면 이 셋을 다시 정한다.
 */
export const REPAIR_DOCS_ENTRIES_TIMEOUT_MS = 3000;

/**
 * 한 번에 보여 주는 줄 수의 상한.
 *
 * 🔴 **200 이다**(연락서는 100). 연락서의 100 은 「한 수리 건의 폴더 안」을 재서 나온
 * 값이고 — 연락서 스캔 · 엑셀 몇 장이라 한 자릿수가 보통이다 — 이쪽은 **서류함 자체의
 * 한 칸**이다. 「3. 업체별 수리품현황」처럼 **고객사마다 폴더가 하나씩 서는 칸**이 있어
 * 100 이면 가나다 중간에서 잘릴 수 있다. 200 이면 그 칸도 통째로 보인다.
 *
 * 더 키우지 않는 까닭은 연락서와 같다 — **줄마다 `stat` 을 한 번씩 때린다.** 500 으로
 * 두면 NAS 가 느린 날 위의 기다리기 상한에 먼저 걸려 목록이 통째로 `failed` 가 된다.
 * 잘라서라도 보여 주는 쪽이 낫고, 잘렸다는 사실은 `truncated` 로 함께 나른다.
 */
export const REPAIR_DOCS_ENTRIES_LIMIT = 200;

/**
 * 루트 **아래로** 몇 칸까지 들어갈 수 있는가.
 *
 * 🔴 **6 이다**(연락서는 5). 연락서의 5 는 한 수리 건 폴더 아래(`사진/2026` 정도)를
 * 잰 값인데, 이쪽 루트는 **서류함의 꼭대기**다 — 스키마 머리말의 본보기부터가
 * `2. 인수시 서류/2. MB 인수시 체크시트` 로 이미 두 칸이고, 그 아래 모델별 · 연도별
 * 칸이 더 있을 수 있다. 여섯이면 지금 아는 쓰임의 두 배가 넘는다.
 *
 * 더 키우지 않는 까닭은 **한 칸 내려갈 때마다 `readdir` 을 한 번씩 더 때리기** 때문이다 —
 * 깊이가 곧 NAS 왕복 횟수라, 깊게 두면 느린 날 기다리기 상한에 먼저 걸려 목록이
 * 통째로 `failed` 가 된다. 더 깊은 자리는 폴더를 가리킴으로 담아 탐색기로 열면 된다.
 */
export const REPAIR_DOCS_ENTRIES_MAX_DEPTH = 6;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const REPAIR_DOCS_ENTRIES_SLOW_REASON =
  "공유폴더가 느려 목록을 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

/** 🔴 깊이 상한을 넘었다. 사유에 경로를 적지 않는다(머리말의 규율). */
export const REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON =
  "폴더가 너무 깊어 더 내려가지 않았습니다 — 그 위 폴더를 가리킴으로 담아 탐색기로 보세요.";

/** 🔴 바로가기(정션 · 심볼릭 링크) · 없는 이름 · 숨은 이름이 모두 여기로 모인다. */
export const REPAIR_DOCS_ENTRIES_SUBFOLDER_MISSING_REASON =
  "들어가려는 하위 폴더를 찾을 수 없습니다(바로가기는 따라가지 않습니다).";

const OUTSIDE_ROOT_REASON = "읽으려는 자리가 공유폴더 밖을 가리켜 읽지 않았습니다.";
const PATH_MISSING_REASON = "가리킬 자리가 비어 있습니다.";

/** 폴더를 먼저, 그 안에서 이름순 — 탐색기와 같은 차례다. */
export function compareRepairDocsEntries(a: ShareFolderDirent, b: ShareFolderDirent): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return compareShareFolderNames(a.name, b.name);
}

/** 한 줄. 🔴 **경로를 담는 칸이 없다** — 이름은 그 자리에서의 이름뿐이다. */
export type RepairDocsEntry = {
  name: string;
  isDirectory: boolean;
  /** 파일 크기(바이트). 🔴 폴더는 **0** 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(에포크 ms). 그 한 줄의 stat 이 막히면 null 이고, 이름은 그대로 보인다. */
  modifiedAtMs: number | null;
};

export type RepairDocsEntriesResult =
  | {
      status: "listed";
      entries: RepairDocsEntry[];
      /** 거른 뒤의 전체 줄 수. `entries.length` 보다 클 수 있다(아래 truncated). */
      totalCount: number;
      /** 🔴 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  | { status: "failed"; reason: string };

export type ListRepairDocsEntriesInput = {
  /** 공유폴더 루트. 비어 있으면 실패다 — 이 모듈은 환경변수를 읽지 않는다. */
  root: string;
  /**
   * 🔴 루트 **아래에서의** 자리(마디 구분자 `/`). 비면 루트의 맨 위 칸이다.
   * 마디마다 「그 자리에 보이는 폴더 줄인가」를 보고 한 칸씩 내려간다 — 머리말의 규율이다.
   */
  relativePath?: string;
  /** 줄 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 그 자리의 맨 위 칸을 읽는다. **던지지 않는다** — 모든 결과가 `{ status, … }` 다.
 */
export async function listRepairDocsEntries(
  input: ListRepairDocsEntriesInput
): Promise<RepairDocsEntriesResult> {
  const segments = segmentsOf(input.relativePath);
  if (segments.status !== "ok") return segments.failure;

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : REPAIR_DOCS_ENTRIES_LIMIT;
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : REPAIR_DOCS_ENTRIES_TIMEOUT_MS;

  return guard(() => read(input.root, segments.segments, limit), timeoutMs);
}

export type RepairDocsEntryLookupResult =
  /** 그 자리에 실제로 서 있다. 🔴 `isDirectory` 는 **디스크가 말한 것**이다. */
  | { status: "found"; isDirectory: boolean }
  /** 그 자리에 아무것도 없다(또는 목록에서 거르는 이름이다). */
  | { status: "not-found" }
  | { status: "failed"; reason: string };

export type FindRepairDocsEntryInput = {
  root: string;
  /** 🔴 루트 기준 상대 경로. **비면 실패다** — 루트 자신은 가리킴이 될 수 없다. */
  relativePath: string;
  timeoutMs?: number;
};

/**
 * 🔴 **가리킴을 담기 전에 묻는 물음** — 「그 자리에 지금 **무엇이** 있는가」.
 *
 * 걷는 길은 위 목록 읽기와 **같다**(보이는 폴더 줄로만 한 칸씩). 마지막 마디만
 * 폴더가 아니어도 되고, 그 줄이 폴더인지 파일인지를 그대로 돌려준다 — 사람이
 * 「파일」이라 적었는데 디스크에는 폴더가 서 있는 경우를 부르는 쪽이 가린다.
 *
 * **던지지 않는다.** 목록을 내지도 않는다 — 한 줄의 종류만 답한다.
 */
export async function findRepairDocsEntry(
  input: FindRepairDocsEntryInput
): Promise<RepairDocsEntryLookupResult> {
  const segments = segmentsOf(input.relativePath);
  if (segments.status !== "ok") return segments.failure;
  if (segments.segments.length === 0) return { status: "failed", reason: PATH_MISSING_REASON };

  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : REPAIR_DOCS_ENTRIES_TIMEOUT_MS;

  return guard(() => find(input.root, segments.segments), timeoutMs);
}

/**
 * 🔴 **디스크를 보기 전에** 마디를 가른다. 받아들이는 모양은 연락서 쪽과 같다 —
 * 빈 값(· 공백뿐)은 「맨 위 칸」이고, 마디 하나는 **이름 하나**여야 한다.
 */
function segmentsOf(
  value: unknown
): { status: "ok"; segments: string[] } | { status: "rejected"; failure: { status: "failed"; reason: string } } {
  const inside = typeof value === "string" ? value : "";
  const segments = inside.trim().length === 0 ? [] : inside.split("/");
  if (segments.length > REPAIR_DOCS_ENTRIES_MAX_DEPTH) {
    return { status: "rejected", failure: { status: "failed", reason: REPAIR_DOCS_ENTRIES_TOO_DEEP_REASON } };
  }
  // 구분자가 마디 안에 섞여 들어오는 길을 디스크를 보기 전에 끊는다(아래 「보이는
  // 폴더 줄인가」와 assertInsideShareFolderRoot 까지 세 겹이다).
  if (segments.some((segment) => segment.length === 0 || segment !== path.basename(segment))) {
    return { status: "rejected", failure: { status: "failed", reason: OUTSIDE_ROOT_REASON } };
  }
  return { status: "ok", segments };
}

/** 기다리기 상한을 씌우고, 안쪽에서 던진 것을 사유로 바꾼다 — 밖으로는 status 만 나간다. */
async function guard<T extends { status: string }>(
  work: () => Promise<T>,
  timeoutMs: number
): Promise<T | { status: "failed"; reason: string }> {
  try {
    return await withShareFolderTimeout(work(), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: REPAIR_DOCS_ENTRIES_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

/**
 * 🔴 한 마디씩 **걸어 내려간다**(재귀가 아니다 — 받은 마디 수만큼만 돈다). 자리마다
 * 맨 위 칸을 읽고, 다음 마디가 **거기 보이는 폴더 줄**일 때만 들어간다. 바로가기는
 * 폴더로 치지 않고(isDirectory 는 링크를 따라가지 않는다) `..` · 드라이브 · UNC ·
 * 끝이 점 · 공백인 마디는 디스크의 이름과 같을 수가 없어 같은 자리에서 막힌다.
 */
async function openFolder(
  rawRoot: string,
  segments: readonly string[]
): Promise<{ folder: string; visible: ShareFolderDirent[] }> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);
  let folder = root;
  const remaining = [...segments];
  let visible: ShareFolderDirent[] = [];

  for (;;) {
    visible = (await listShareFolderDirents(folder)).filter(
      (dirent) => !isIgnoredShareFolderEntryName(dirent.name)
    );
    const next = remaining.shift();
    if (next === undefined) break;
    if (!visible.some((dirent) => dirent.isDirectory && dirent.name === next)) {
      throw new ShareFolderFailure(REPAIR_DOCS_ENTRIES_SUBFOLDER_MISSING_REASON);
    }
    folder = path.join(folder, next);
    // 🔴 한 칸 내려갈 때마다 울타리를 다시 본다.
    assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);
  }

  return { folder, visible };
}

async function read(
  rawRoot: string,
  segments: readonly string[],
  limit: number
): Promise<RepairDocsEntriesResult> {
  const { folder, visible } = await openFolder(rawRoot, segments);

  // 🔴 그 자리의 맨 위 칸만. 그 아래 폴더는 폴더 한 줄로만 보이고, 그 안을 읽지 않는다.
  const kept = [...visible].sort(compareRepairDocsEntries).slice(0, limit);

  // 🔴 stat 은 **남긴 줄에만** 때린다 — 상한이 곧 NAS 왕복 횟수다.
  const entries: RepairDocsEntry[] = [];
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

async function find(rawRoot: string, segments: readonly string[]): Promise<RepairDocsEntryLookupResult> {
  // 마지막 마디의 **부모**까지만 걸어 내려간다 — 마지막 줄은 폴더가 아니어도 된다.
  const { visible } = await openFolder(rawRoot, segments.slice(0, -1));
  const last = segments[segments.length - 1];
  const found = visible.find((dirent) => dirent.name === last);
  // 🔴 `stat` 을 때리지 않는다 — 한 줄의 종류는 readdir 이 이미 말했고, 링크는 애초에
  //    목록에 서지 않는다(share-folder-fs.ts 의 listShareFolderDirents).
  return found ? { status: "found", isDirectory: found.isDirectory } : { status: "not-found" };
}
