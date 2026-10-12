import "server-only";

import path from "node:path";

import {
  purchaseOrderProductKey,
  readPurchaseOrderFolderName,
} from "@/lib/domain/purchase-order-folder-name";
import { compareShareFolderNames, isIgnoredShareFolderEntryName } from "@/lib/domain/share-folder-naming";
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
 * **이 장비의 발주서 폴더 하나**를 찾아 그 안을 읽는다 (2026-10-12)
 * ============================================================================
 * 수리 건 상세 「발주서」 탭의 공유폴더 구역이 쓴다. 고객사가 우리에게 낸 발주서(내자)가
 * 사내 공유폴더에 발주 건마다 폴더 하나로 쌓여 있다:
 *
 *   <루트>/2026/1. 주성엔지니어링/101. 내자 20251223_PO…_MBKK200-JS2_WN1183_1708076 - …원/
 *          └연도┘ └───고객사───┘ └──────────────── 발주 건 ────────────────┘
 *
 * ── 🔴 **고객사 이름을 우리 DB 와 맞추지 않는다** ─────────────────────────
 * 폴더 이름에 L/N 과 S/N 이 들어 있으니 **그 열쇠로 바로** 찾는다(사용자 결정 2026-10-12).
 * 고객사 이름 맞추기 규칙(`㈜` 유무 · 띄어쓰기)을 만들 일이 없고, 수리 중에 고객사가 바뀐
 * 건도 찾힌다. 고객사 폴더는 **지나가는 켜**일 뿐 판단에 쓰지 않는다.
 *
 * ── 🔴 연도 폴더를 **전부** 훑는다 ───────────────────────────────────────
 * 발주 번호나 날짜로 연도를 추측하지 않는다. 견적서 쪽 실측(2026-10-06)에서
 * `DSS 2023-018` 폴더가 **2024 연도 폴더**에 들어 있었다 — 사람이 그 해에 정리하면서 그리
 * 넣은 것이다. 추측하면 그런 건은 영영 안 보인다.
 *  · 🔴 연도 폴더 이름 규칙을 **견적서 쪽에서 가져오지 않는다.** 저쪽은 `NN. YYYY 내자견적서`
 *    이고 여기는 그냥 `2026` 이다 — 다른 서류함이라 이름 규칙도 다르다(아래 isYearFolder).
 *
 * ── 🔴 **가장 최근 폴더 하나만** 보여 준다 ───────────────────────────────
 * 사용자 결정 2026-10-12. 가리는 잣대는 **폴더 이름의 날짜**(`20251223`)다.
 *  · 🔴 날짜가 **같은 폴더가 둘이면 `multiple` 로 끝낸다** — 목록도 경로도 내지 않는다.
 *    이웃(견적서 번호 읽기)은 같은 값이면 「둘 다 읽는다」로 갔지만 그쪽은 **번호를 모아
 *    늘어놓는** 자리다. 여기는 **폴더 하나의 안을 통째로 보여 주는** 자리라, 둘 중 하나를
 *    임의로 고르면 그 순간 **남의 발주서 내용**이 화면에 뜬다. 사람이 공유폴더를 정리하는
 *    것이 맞다(견적서 구역의 `multiple` 갈래와 같은 판단).
 *
 * ── 🔴 **읽기 전용이다** ─────────────────────────────────────────────────
 * 이웃들과 같은 규율이다. `node:fs/promises` 를 아예 가져오지 않는다 — 읽기는 공용 도우미
 * (storage/share-folder-fs.ts)가 하고, `mkdir` · `writeFile` · `unlink` · `rm` · `rename` 은
 * **이 파일에 들어올 길이 없다.** 앱은 사람의 서류함을 고치지 않는다. 그 사실을
 * purchase-order-archive-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * ── 🔴 **바로 가기를 따라가지 않는다** ───────────────────────────────────
 * 그 서류함에 `임시 발주서 및 신용장 - 바로 가기` 가 실제로 있다. 공용 도우미의
 * `listShareFolderNames` 가 `isDirectory()` 만 보는데, Windows 의 바로 가기(reparse point)도
 * 리눅스의 심볼릭 링크도 거기서 폴더로 치지 않는다 — **따로 거를 필요가 없다**(그 파일
 * 머리말에 그렇게 적혀 있다). `.lnk` 파일 모양이면 애초에 파일이라 빠진다.
 *
 * ── 🔴 돌려주는 값에 **절대 경로**가 없다 ────────────────────────────────
 * 폴더를 가리키는 값은 **루트 기준 상대 경로**(`연도/고객사/발주 건`)뿐이고, 줄을 가리키는
 * 값은 **그 폴더 안에서의 이름**뿐이다. 컨테이너 안 경로(루트)를 담을 칸이 타입 수준에
 * 없고, 실패 사유도 경로 없는 짧은 문장이다(fs 오류의 `message` 에는 경로가 들어 있으므로
 * 쓰지 않고 **오류 코드만 보고** 바꾼다).
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 모든 결과가 `{ status, … }` 다. 부르는 쪽(통로)은 try 를 쓰지 않는다.
 * ============================================================================
 */

/**
 * 「수리 관련」 이웃들과 같은 모양의 **쌍**이다(.env.example 의 발주서 절):
 *  · `PURCHASE_ORDER_ARCHIVE_DIR`      — 🔴 **서버가 읽을** 경로. 운영에서는 컨테이너에
 *    연결(마운트)한 공유폴더의 **컨테이너 안** 경로다. 이 파일이 쓰는 값이다.
 *  · `PURCHASE_ORDER_ARCHIVE_UNC_ROOT` — 사람 PC 의 탐색기가 보는 주소(UNC). 폴더 열기
 *    도우미의 **설치본에만** 심긴다(server/quote-folder-helper.ts). 이 파일은 안 읽는다.
 * 둘을 섞어 적으면 한쪽은 조용히 꺼지고 다른 쪽은 열리지 않는다.
 *
 * 🔴 **부르는 시점에** 읽는다 — 모듈을 불러오는 것만으로 값이 굳지 않게. 비었거나 공백이면
 * null 이고 그 기능만 꺼진다(`resolveQuoteArchiveRoot` 와 같은 약속). 값 자체를 로그로 찍지
 * 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolvePurchaseOrderArchiveRoot(): string | null {
  const configured = process.env.PURCHASE_ORDER_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

/**
 * 이만큼 안에 답하지 않으면 그만둔다.
 *
 * 🔴 **8000 이다.** 이 서류함은 **세 켜**라 훑기가 이웃보다 한 단 깊다 — readdir 횟수는
 * `1(루트) + 연도 수 + 연도 수 × 고객사 수` 다. 사용자가 보여 준 모양으로 세면 연도 다섯 ·
 * 연도마다 고객사 일곱이라 **1 + 5 + 35 = 41 번**이고, 견적서 쪽 훑기(1 + 21 = 22 번에
 * 851ms — 한 번에 20~40ms)와 견주면 **대략 그 두 배**다. 거기에 고른 폴더 하나를 열어 줄마다
 * `stat` 을 때리는 몫이 붙는다. 그 다섯 배쯤을 잡아 **느린 날에도 한 번은 성공**하게 하되,
 * 더 키우지 않는 까닭은 이 시간이 곧 **요청 워커가 NAS 에 매달려 있는 시간**이기 때문이다 —
 * 오래 기다리느니 「잠시 뒤 다시」가 낫다.
 * 🔴 이웃들과 숫자가 다른 것은 **읽는 켜가 다르기** 때문이다. 한쪽을 고칠 일이 있어도 따라
 * 고치지 말 것.
 */
export const PURCHASE_ORDER_ARCHIVE_TIMEOUT_MS = 8000;

/**
 * 한 번에 보여 주는 줄 수의 상한.
 *
 * 🔴 **100 이다.** 발주 건 폴더 하나에 드는 것은 발주서 · 신용장 · 메일 몇 장이라 열 개
 * 안쪽이다. 100 이면 그 열 배가 넘는다. 더 키우지 않는 까닭은 **줄마다 `stat` 을 한 번씩
 * 때리기 때문**이다 — 크게 두면 NAS 가 느린 날 기다리기 상한에 먼저 걸려 목록이 **통째로**
 * `failed` 가 된다. 잘라서라도 보여 주는 쪽이 낫다(견적서 · 연락서 목록과 같은 숫자).
 */
export const PURCHASE_ORDER_ARCHIVE_ENTRIES_LIMIT = 100;

/**
 * 폴더를 한꺼번에 몇 개씩 여는가.
 *
 * 🔴 **8 이다.** 하나씩 차례로 열면 고객사 폴더 35 개가 곧 NAS 왕복 35 번을 **줄 세워**
 * 기다리는 일이 된다(한 번에 20~40ms — 그대로 1 초가 넘는다). 반대로 전부 한꺼번에 던지면
 * 느린 날 NAS 가 밀린다. 여덟씩 묶어 둘 사이를 잡는다(이웃 quote-archive-case-numbers.ts 의
 * 같은 숫자 · 같은 까닭).
 */
const SCAN_CONCURRENCY = 8;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const PURCHASE_ORDER_ARCHIVE_SLOW_REASON =
  "공유폴더가 느려 발주서 폴더를 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

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
 * 🔴 **견적서 쪽 판정(isQuoteArchiveYearFolder)을 쓰지 않는다.** 저쪽은
 * `NN. YYYY 내자견적서` 라는 **다른 서류함의 규칙**이고, 여기 이름은 그냥 `2026` 이다 —
 * 가져다 쓰면 한 폴더도 안 걸린다. 반대로 여기 규칙을 넉넉히 두는 까닭은 사람이 `2026년` ·
 * `1. 2026` 처럼 적어 둔 날에도 걸리게 하기 위해서다. 넉넉해도 안전하다 — 엉뚱한 폴더를
 * 훑어 봐야 그 아래 발주 건 이름이 **날짜 · L/N · S/N 으로 읽히고 열쇠까지 맞아야** 후보가
 * 되기 때문이다(domain/purchase-order-folder-name.ts).
 */
function isYearFolder(name: string): boolean {
  for (const match of name.matchAll(/\d{4}/g)) {
    const year = Number(match[0]);
    if (year >= EARLIEST_YEAR && year <= LATEST_YEAR) return true;
  }
  return false;
}

/** 한 줄. 🔴 **경로를 담는 칸이 없다** — 이름은 그 폴더 안에서의 이름뿐이다. */
export type PurchaseOrderArchiveEntry = {
  name: string;
  isDirectory: boolean;
  /** 파일 크기(바이트). 🔴 폴더는 **0** 이다 — 안으로 내려가지 않으므로 재지 않는다. */
  sizeBytes: number;
  /** 수정 시각(에포크 ms). 그 한 줄의 stat 이 막히면 null 이고, 이름은 그대로 보인다. */
  modifiedAtMs: number | null;
};

export type PurchaseOrderArchiveResult =
  | {
      status: "found";
      /**
       * 공유폴더 루트 기준 슬래시 경로 — `연도/고객사/발주 건`. 디스크의 실제 이름이다.
       * 🔴 컨테이너 안 경로(루트)는 여기에 들어 있지 않다.
       */
      relativePath: string;
      /** 고른 폴더 이름에서 읽은 발행일 `YYYY-MM-DD`. 어느 발주 건을 보고 있는지 가른다. */
      issuedDate: string;
      entries: PurchaseOrderArchiveEntry[];
      /** 거른 뒤의 전체 줄 수. `entries.length` 보다 클 수 있다(아래 truncated). */
      totalCount: number;
      /** 🔴 상한에 걸려 잘렸는가 — 화면이 「더 있습니다」를 세운다. */
      truncated: boolean;
    }
  /** 🔴 날짜가 같은 폴더가 둘 이상이다 — **목록도 경로도 내지 않는다**(머리말). */
  | { status: "multiple" }
  /** 이 장비의 발주서 폴더가 아직 없다 — 만들지 않는다. */
  | { status: "not-found" }
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

export type FindPurchaseOrderArchiveFolderInput = {
  /**
   * 공유폴더 루트. 주지 않으면(`undefined` · `null`) 설정을 읽는다 — 비어 있으면
   * `disabled` 로 끝나고 🔴 **디스크를 한 번도 보지 않는다.** 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /** 장비의 L/N. 🔴 비면 디스크를 아예 보지 않는다. */
  lotNumber: string | null | undefined;
  /** 장비의 S/N. 🔴 비면 디스크를 아예 보지 않는다. */
  serialNumber: string | null | undefined;
  /** 줄 수 상한. 시험에서만 바꾼다. */
  limit?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 그 장비의 **가장 최근 발주서 폴더 하나**를 찾아 그 안을 읽는다. **던지지 않는다** —
 * 모든 결과가 `{ status, … }` 다.
 */
export async function findPurchaseOrderArchiveFolder(
  input: FindPurchaseOrderArchiveFolderInput
): Promise<PurchaseOrderArchiveResult> {
  const wantedKey = purchaseOrderProductKey(input.lotNumber, input.serialNumber);
  // 🔴 둘 중 하나라도 비면 여기서 끝난다 — 아래 디스크를 보는 코드에 닿지 않는다.
  //    빈 열쇠로 훑으면 남의 발주서가 걸린다(domain 쪽 머리말).
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
  /** 폴더 이름에서 읽은 발행일 `YYYY-MM-DD`. 최신을 가리는 잣대다. */
  issuedDate: string;
};

async function findAndRead(
  rawRoot: string,
  wantedKey: string,
  limit: number
): Promise<PurchaseOrderArchiveResult> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);

  const candidates = await scan(root, wantedKey);
  if (candidates.length === 0) return { status: "not-found" };

  // 🔴 **폴더 이름의 날짜**로 가린다 — `YYYY-MM-DD` 라 글자 차례가 곧 날짜 차례다.
  const latestDate = candidates.reduce(
    (latest, candidate) => (candidate.issuedDate > latest ? candidate.issuedDate : latest),
    candidates[0].issuedDate
  );
  const latest = candidates.filter((candidate) => candidate.issuedDate === latestDate);
  // 🔴 어느 폴더인지 모르는데 내용을 보이면 안 된다 — 경로도 목록도 내지 않는다(머리말).
  if (latest.length > 1) return { status: "multiple" };

  const picked = latest[0];
  const relativePath = [picked.yearFolderName, picked.customerFolderName, picked.folderName].join("/");
  const folder = path.join(root, picked.yearFolderName, picked.customerFolderName, picked.folderName);
  assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_REASON);

  return {
    status: "found",
    relativePath,
    issuedDate: picked.issuedDate,
    ...(await read(folder, limit)),
  };
}

/**
 * 연도 폴더 전부 → 고객사 폴더 전부 → 발주 건 폴더 **이름만** 읽어 열쇠가 맞는 것을 모은다.
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
        // 🔴 읽지 못하는 이름은 여기서 빠진다(외자 · 바로 가기 · 꼬리가 붙은 이름).
        const read = readPurchaseOrderFolderName(folderName);
        if (read === null) continue;
        // 🔴 **열쇠가 같아야** 한다 — L/N 과 S/N 을 한 덩이로 견준다.
        if (purchaseOrderProductKey(read.lotNumber, read.serialNumber) !== wantedKey) continue;
        candidates.push({
          yearFolderName: chunk[index].yearFolderName,
          customerFolderName: chunk[index].customerFolderName,
          folderName,
          issuedDate: read.issuedDate,
        });
      }
    });
  }

  return candidates;
}

/**
 * 그 자리의 **폴더 이름들**. 이을 때는 디스크의 실제 이름을 쓴다 — 다듬은 이름으로 이으면
 * 없는 폴더가 된다. 🔴 바로 가기 · 심볼릭 링크 · 파일은 공용 도우미가 이미 뺀다(머리말).
 */
async function listInside(root: string, segments: readonly string[]): Promise<string[]> {
  const directory = path.join(root, ...segments);
  assertInsideShareFolderRoot(root, directory, OUTSIDE_ROOT_REASON);
  return listShareFolderNames(directory);
}

/** 폴더를 먼저, 그 안에서 이름순 — 탐색기와 같은 차례다(견적서 목록과 같은 규칙). */
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
