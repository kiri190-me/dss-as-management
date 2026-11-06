import "server-only";

import path from "node:path";

import {
  purchaseOrderNumberKey,
  readPurchaseOrderFolderNumber,
} from "@/lib/domain/purchase-order-folder-number";
import { compareShareFolderNames, isIgnoredShareFolderEntryName } from "@/lib/domain/share-folder-naming";
import {
  PURCHASE_ORDER_ARCHIVE_ENTRIES_LIMIT,
  PURCHASE_ORDER_ARCHIVE_SLOW_REASON,
  PURCHASE_ORDER_ARCHIVE_TIMEOUT_MS,
  resolvePurchaseOrderArchiveRoot,
  type PurchaseOrderArchiveEntry,
} from "./purchase-order-archive";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  listShareFolderDirents,
  listShareFolderNames,
  requireExistingShareFolderRoot,
  shareFolderReadFailureReason,
  statShareFolderEntry,
  withShareFolderTimeout,
  type ShareFolderDirent,
} from "./share-folder-fs";

/**
 * ============================================================================
 * **이 번호의 발주 건 폴더 하나**를 찾아 그 안을 읽는다 (2026-11-06)
 * ============================================================================
 * 기타건 상세(내자 정리 한 줄) 「발주서」 탭의 공유폴더 구역이 쓴다. 서류함은 수리 건 쪽과
 * **같은 한 곳**이다 — 같은 설정(PURCHASE_ORDER_ARCHIVE_DIR) · 같은 세 켜:
 *
 *   <루트>/2026/1. 가나전자/117. 내자 20261103_PO261103031_(고객) 부속케이블 3SET - …/
 *          └연도┘ └──고객사──┘ └──────────────── 발주 건 ─────────────────┘
 *
 * ── 🔴 **옆에 더한 길이다 — 수리 건 모듈을 고치지 않았다** ───────────────
 * 이웃(purchase-order-archive.ts)은 폴더 이름의 **마지막 두 마디**(L/N · S/N)로 그 장비의
 * 발주 건을 찾고, 그 엄격함이 「느슨하게 걸리면 남의 발주서가 뜬다」를 막는 장치다. 🔴
 * **기타건에는 L/N 도 S/N 도 없어** 그 길이 아예 안 통하므로(부속 · 케이블 · 일식 줄),
 * 번호로 맞대는 길을 **옆에 세웠다.** 이웃의 동작은 한 글자도 바뀌지 않았다.
 *  · 🔴 **같이 쓸 수 있는 것은 전부 가져다 쓴다** — 설정 읽기 · 상한 둘 · 느림 사유 · 줄
 *    타입은 이웃이 내보내는 것을 그대로 부른다(아래 import). 그래서 두 길이 **같은
 *    서류함**을 보고, 한쪽만 다른 폴더를 뒤지는 일이 생기지 않는다.
 *  · 🔴 **훑는 모양은 두 벌이다**(아래 isYearFolder · scan · read). 이웃 쪽 것은 그 파일
 *    안에만 있는(export 하지 않는) 함수들이고, 꺼내려면 그 파일을 고쳐야 한다 — 이 조각은
 *    수리 건 길을 건드리지 않기로 했다. 대신 두 길이 **같은 연도 폴더를 같게 가린다**는 것을
 *    purchase-order-number-archive.test.ts 가 **한 트리에서 둘을 나란히 돌려** 못 박는다.
 *
 * ── 🔴 고객사 폴더를 판단에 쓰지 않는다 · 연도 폴더는 **전부** 훑는다 ─────
 * 이웃과 같은 까닭이다. 폴더 이름의 날짜와 연도 폴더의 해가 어긋난 건이 실측으로 있었고
 * (견적서 쪽 2026-10-06 — `DSS 2023-018` 이 2024 폴더에 있었다), 고객사 이름 맞추기 규칙
 * (`㈜` 유무 · 띄어쓰기)을 만들면 그것이 또 하나의 어긋날 자리가 된다. 켜는 **지나가는
 * 길**일 뿐이고 판단은 **번호 한 가지**로 한다.
 *
 * ── 🔴 **같은 번호의 폴더가 둘이면 `multiple`** — 목록도 경로도 내지 않는다 ──
 * 이웃이 날짜가 같을 때 하는 것과 같은 판단이다. 번호가 같다고 **같은 발주 건이라는 보장은
 * 없다** — 사람이 다른 고객사 폴더에 번호를 잘못 적어 둔 날, 둘 중 하나를 임의로 고르면 그
 * 순간 **남의 발주서 내용**이 화면에 뜬다. 정리는 사람이 한다.
 *
 * ── 🔴 폴더 이름의 **날짜를 읽지 않는다** ────────────────────────────────
 * 이웃은 날짜로 「가장 최근 하나」를 가리지만, 여기서는 번호가 곧 그 발주 건이라 가릴 것이
 * 없다. 날짜를 읽으려면 그 문법(여덟 자리 · 달력에 있는 날 · 연도 범위)을 **두 벌째** 적어야
 * 하는데, 쓰지도 않을 값 때문에 갈라질 자리를 만들지 않는다 — 그래서 결과에 `issuedDate` 칸이
 * 없다.
 *
 * ── 🔴 **읽기 전용이다** ─────────────────────────────────────────────────
 * `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용 도우미(share-folder-fs.ts)가 하고
 * `mkdir` · `writeFile` · `unlink` · `rm` · `rename` 은 **이 파일에 들어올 길이 없다.** 앱은
 * 사람의 서류함을 고치지 않는다. 그 사실을 purchase-order-number-archive-source.test.ts 가
 * 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 돌려주는 값에 **절대 경로**가 없다 ────────────────────────────────
 * 폴더를 가리키는 값은 **루트 기준 상대 경로**(`연도/고객사/발주 건`)뿐이고, 줄을 가리키는
 * 값은 **그 폴더 안에서의 이름**뿐이다. 실패 사유도 경로 없는 짧은 문장이다(fs 오류의
 * `message` 에는 경로가 들어 있으므로 쓰지 않고 **오류 코드만 보고** 바꾼다).
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 결과가 `{ status, … }` 다. 부르는 쪽(통로)은 try 를 쓰지 않는다.
 * ============================================================================
 */

/**
 * 폴더를 한꺼번에 몇 개씩 여는가.
 *
 * 🔴 **8 이다.** 하나씩 차례로 열면 고객사 폴더 수만큼 NAS 왕복을 **줄 세워** 기다리는 일이
 * 된다(한 번에 20~40ms). 반대로 전부 한꺼번에 던지면 느린 날 NAS 가 밀린다. 이웃
 * (purchase-order-archive.ts · quote-archive-case-numbers.ts)의 같은 숫자 · 같은 까닭이다 —
 * 🔴 **같은 서류함을 같은 깊이로 훑으므로** 이 숫자는 그쪽과 함께 움직여야 한다.
 */
const SCAN_CONCURRENCY = 8;

/** 🔴 사유에 경로를 담지 않는다(머리말의 규율). */
const OUTSIDE_ROOT_REASON = "읽으려는 폴더가 공유폴더 밖을 가리켜 읽지 않았습니다.";

/**
 * 연도 범위. 맨 위 켜에서 **연도 폴더만** 골라 들어가기 위한 울타리다 — 사람이 거기에
 * `_작업중` 같은 폴더를 하나 만들어 두어도 그 아래를 훑지 않는다.
 */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2099;

/**
 * 맨 위 켜의 이 폴더가 **연도 폴더인가** — 이름에 2000~2099 의 네 자리가 들어 있으면 그렇다.
 *
 * 🔴 **이웃(purchase-order-archive.ts)의 같은 판정과 두 벌째다.** 저쪽 것은 그 파일 안에만
 * 있고 꺼내려면 그 파일을 고쳐야 하는데, 이 조각은 수리 건 길을 건드리지 않는다(머리말).
 * 두 벌이 **같게 가린다**는 사실은 시험이 한 트리에서 둘을 나란히 돌려 본다.
 *
 * 규칙을 넉넉히 두는 까닭도 저쪽과 같다 — 사람이 `2026년` · `1. 2026` 처럼 적어 둔 날에도
 * 걸리게. 넉넉해도 안전하다: 엉뚱한 폴더를 훑어 봐야 그 아래 발주 건 이름의 **둘째 마디가
 * 이 줄의 번호와 같아야** 후보가 된다.
 */
function isYearFolder(name: string): boolean {
  for (const match of name.matchAll(/\d{4}/g)) {
    const year = Number(match[0]);
    if (year >= EARLIEST_YEAR && year <= LATEST_YEAR) return true;
  }
  return false;
}

export type PurchaseOrderNumberArchiveResult =
  | {
      status: "found";
      /**
       * 공유폴더 루트 기준 슬래시 경로 — `연도/고객사/발주 건`. 디스크의 실제 이름이다.
       * 🔴 컨테이너 안 경로(루트)는 여기에 들어 있지 않다.
       */
      relativePath: string;
      /** 🔴 줄 타입은 이웃과 **한 벌**이다 — 같은 서류함의 같은 줄이다. */
      entries: PurchaseOrderArchiveEntry[];
      /** 거른 뒤의 전체 줄 수. `entries.length` 보다 클 수 있다(아래 truncated). */
      totalCount: number;
      /** 🔴 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 같은 번호의 폴더가 둘 이상이다 — **목록도 경로도 내지 않는다**(머리말). */
  | { status: "multiple" }
  /** 그 번호의 발주 건 폴더가 아직 없다 — 만들지 않는다. */
  | { status: "not-found" }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export type FindPurchaseOrderArchiveFolderByNumberInput = {
  /**
   * 공유폴더 루트. 주지 않으면(`undefined` · `null`) 설정을 읽는다 — 비어 있으면
   * `disabled` 로 끝나고 🔴 **디스크를 한 번도 보지 않는다.** 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /**
   * 내자 정리에 적힌 **발주서번호**. 🔴 비었거나 가리키는 것이 없는 값(`-`)이면 디스크를
   * 아예 보지 않는다 — 빈 열쇠로 훑으면 아무 폴더에나 걸린다.
   */
  purchaseOrderNumber: string | null | undefined;
  /** 줄 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 그 번호의 **발주 건 폴더 하나**를 찾아 그 안을 읽는다. **던지지 않는다** — 모든 결과가
 * `{ status, … }` 다.
 */
export async function findPurchaseOrderArchiveFolderByNumber(
  input: FindPurchaseOrderArchiveFolderByNumberInput
): Promise<PurchaseOrderNumberArchiveResult> {
  const wantedKey = purchaseOrderNumberKey(input.purchaseOrderNumber);
  // 🔴 쓸 수 있는 번호가 아니면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  if (wantedKey === null) return { status: "not-found" };

  // 🔴 설정이 비어 있으면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  const configured =
    input.root === undefined || input.root === null ? resolvePurchaseOrderArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit) && input.limit > 0
      ? Math.floor(input.limit)
      : PURCHASE_ORDER_ARCHIVE_ENTRIES_LIMIT;
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : PURCHASE_ORDER_ARCHIVE_TIMEOUT_MS;

  try {
    // 🔴 상한 하나가 **훑기와 읽기를 함께** 덮는다.
    return await withShareFolderTimeout(findAndRead(configured, wantedKey, limit), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: PURCHASE_ORDER_ARCHIVE_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

/** 훑다가 걸린 발주 건 폴더 하나. 🔴 담는 것은 **디스크의 이름 세 조각**뿐이다. */
type Candidate = {
  yearFolderName: string;
  customerFolderName: string;
  folderName: string;
};

async function findAndRead(
  rawRoot: string,
  wantedKey: string,
  limit: number
): Promise<PurchaseOrderNumberArchiveResult> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);

  const candidates = await scan(root, wantedKey);
  if (candidates.length === 0) return { status: "not-found" };
  // 🔴 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 경로도 목록도 내지 않는다(머리말).
  if (candidates.length > 1) return { status: "multiple" };

  const picked = candidates[0];
  const relativePath = [picked.yearFolderName, picked.customerFolderName, picked.folderName].join("/");
  const folder = path.join(root, picked.yearFolderName, picked.customerFolderName, picked.folderName);
  assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);

  return { status: "found", relativePath, ...(await read(folder, limit)) };
}

/**
 * 연도 폴더 전부 → 고객사 폴더 전부 → 발주 건 폴더 **이름만** 읽어 번호가 같은 것을 모은다.
 * 🔴 **발주 건 폴더 안은 열지 않는다** — 고른 하나만 나중에 연다(아래 read).
 *
 * 🔴 **여덟씩 묶어 연다**(SCAN_CONCURRENCY). 줄 세워 열면 고객사 폴더 수만큼 NAS 왕복이
 * 그대로 더해진다.
 */
async function scan(root: string, wantedKey: string): Promise<Candidate[]> {
  const yearFolderNames = await listShareFolderNames(root, isYearFolder);

  /** 훑을 고객사 폴더들 — `연도/고객사`. */
  const customerFolders: Array<{ yearFolderName: string; customerFolderName: string }> = [];
  for (let from = 0; from < yearFolderNames.length; from += SCAN_CONCURRENCY) {
    const chunk = yearFolderNames.slice(from, from + SCAN_CONCURRENCY);
    const listed = await Promise.all(chunk.map((yearFolderName) => listInside(root, [yearFolderName])));
    listed.forEach((names, index) => {
      for (const customerFolderName of names) {
        customerFolders.push({ yearFolderName: chunk[index], customerFolderName });
      }
    });
  }

  const candidates: Candidate[] = [];
  for (let from = 0; from < customerFolders.length; from += SCAN_CONCURRENCY) {
    const chunk = customerFolders.slice(from, from + SCAN_CONCURRENCY);
    const listed = await Promise.all(
      chunk.map((place) => listInside(root, [place.yearFolderName, place.customerFolderName]))
    );
    listed.forEach((names, index) => {
      for (const folderName of names) {
        // 🔴 둘째 마디를 못 읽는 이름은 여기서 빠진다(마디가 하나뿐인 이름 · 바로 가기).
        const number = readPurchaseOrderFolderNumber(folderName);
        if (number === null) continue;
        // 🔴 **번호가 같아야** 한다 — 이름 어딘가에 들어 있는지로 보지 않는다(domain 머리말).
        if (purchaseOrderNumberKey(number) !== wantedKey) continue;
        candidates.push({
          yearFolderName: chunk[index].yearFolderName,
          customerFolderName: chunk[index].customerFolderName,
          folderName,
        });
      }
    });
  }

  return candidates;
}

/**
 * 그 자리의 **폴더 이름들**. 이을 때는 디스크의 실제 이름을 쓴다 — 다듬은 이름으로 이으면
 * 없는 폴더가 된다. 🔴 바로 가기 · 심볼릭 링크 · 파일은 공용 도우미가 이미 뺀다.
 */
async function listInside(root: string, segments: readonly string[]): Promise<string[]> {
  const directory = path.join(root, ...segments);
  assertInsideShareFolderRoot(root, directory, OUTSIDE_ROOT_REASON);
  return listShareFolderNames(directory);
}

/** 폴더를 먼저, 그 안에서 이름순 — 탐색기와 같은 차례다(이웃 목록들과 같은 규칙). */
function compareEntries(a: ShareFolderDirent, b: ShareFolderDirent): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
  return compareShareFolderNames(a.name, b.name);
}

/**
 * 고른 폴더의 **맨 위 칸만** 읽는다. 🔴 파일 **내용**을 읽지 않는다 — 이름 · 크기 · 수정
 * 시각 · 폴더인가 넷뿐이다. 찌꺼기(Thumbs.db · desktop.ini · `~$…` · 점으로 시작)는 **세기
 * 전에** 뺀다 — 「더 있습니다」가 사람이 넣은 적 없는 줄 때문에 거짓으로 서지 않게.
 */
async function read(
  folder: string,
  limit: number
): Promise<{ entries: PurchaseOrderArchiveEntry[]; totalCount: number; truncated: boolean }> {
  const visible = (await listShareFolderDirents(folder)).filter(
    (dirent) => !isIgnoredShareFolderEntryName(dirent.name)
  );
  const kept = [...visible].sort(compareEntries).slice(0, limit);

  // 🔴 stat 은 **남긴 줄에만** 때린다 — 상한이 곧 NAS 왕복 횟수다.
  const entries: PurchaseOrderArchiveEntry[] = [];
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
