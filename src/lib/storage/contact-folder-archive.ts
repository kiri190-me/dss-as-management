import "server-only";

import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CONTACT_FOLDER_MAX_NUMBERED_COPIES,
  contactFolderCopyFileName,
  contactFolderName,
  numberedContactFolderFileName,
  pickContactFolder,
  pickSimilarContactFolders,
  type ContactFolderMatch,
  type ContactFolderNamingInput,
} from "@/lib/domain/contact-folder-naming";
import { normalizeShareFolderNameForCompare } from "@/lib/domain/share-folder-naming";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  listShareFolderNames,
  requireExistingShareFolderRoot,
  shareFolderErrorCode,
  shareFolderReadFailureReason,
  shareFolderWriteFailureReason,
  withShareFolderTimeout,
} from "./share-folder-fs";

/**
 * ============================================================================
 * 사내 공유폴더에서 그 수리 건의 **연락서 폴더를 찾고, 없으면 만든다**
 * ============================================================================
 *   <루트>/D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *
 * 이름 규칙 · 찾기 판정은 domain/contact-folder-naming.ts 가 정한다. 이 모듈이 하는
 * 일은 **디스크에서 폴더 이름을 읽어 그 판정에 넘기는 것**뿐이다.
 *
 * ── 🔴 만들고 · 새로 쓴다 · **지우지 않는다** ───────────────────────────
 * 2026-10-05 조각 5 가 **만들기(mkdir)** 를, 조각 6 이 **파일 새로 쓰기**를 들였다.
 * 지금 이 파일이 가진 파일시스템 능력은 다섯이고 **하나씩 까닭이 있다**:
 *   · `mkdir`   — 연락서 폴더 하나를 만든다(조각 5)
 *   · `open`    — 🔴 **`"wx"` 로만 연다.** 이미 있으면 EEXIST 로 실패해 다음 번호로 비켜
 *                 간다 — 존재 확인과 쓰기 사이에 틈이 없다(조각 6)
 *   · `readdir` — 폴더 안의 파일 이름을 **한 번** 읽는다(NFC/NFD 접어 견주기 · 빈 번호 고르기)
 *   · `stat` · `readFile` — 같은 내용의 파일이 이미 있는지 본다(크기가 같을 때만 읽는다)
 *
 * 🔴 **`unlink` · `rm` · `rmdir` · `rename` · `truncate` · `cp` 는 여전히 한 글자도 없다.**
 * 앱은 사람의 서류함에서 파일을 지우지도 옮기지도 않는다. 그 사실을
 * contact-folder-archive-source.test.ts 가 원본을 글자로 읽어 못 박는다.
 *
 * 그 대가가 하나 있다 — **쓰다가 끊기면 반쯤 쓰인 파일이 남는다.** 견적서 쪽
 * (quote-archive.ts 의 writeNewFile)은 그때 방금 만든 파일을 `unlink` 로 치우지만, 여기서는
 * 치우지 않는다: 연락서 폴더에는 직원이 손으로 넣은 파일이 섞여 있어 **이 모듈에 지우기를
 * 들이는 순간** 그것이 다음에 지울 수 있는 것의 울타리가 된다. 남은 조각은 사람이 탐색기에서
 * 지운다(응답이 실패를 알린다).
 *
 * ── 🔴 조용히 만들지 않는다 ─────────────────────────────────────────────
 * 이 함수를 부르는 것은 사람이 [폴더 만들고 열기]를 **누른 그때**뿐이다. 접수 · 조회가
 * 지나가면서 폴더를 늘리지 않는다 — 폴더가 늘어나는 것을 사람이 보고 정해야 한다.
 *
 * ── 🔴 루트를 만들지 않는다 ─────────────────────────────────────────────
 * 운영에서는 공유폴더를 컨테이너에 연결(마운트)해 쓴다. 연결이 빠진 채 루트를 만들면
 * 컨테이너 안 임시 디스크를 들여다보고 「없습니다」라고 거짓말하게 된다 — 루트가
 * 없으면 `failed` 로 끝난다.
 *
 * ── 🔴 던지지 않는다 · 사유에 경로를 담지 않는다 ────────────────────────
 * 모든 결과는 `{ status, … }` 다. `reason` 은 화면 · 응답으로 나가므로 **절대 경로 ·
 * 루트 값을 담지 않는다** — fs 오류의 `message` 에는 경로가 들어 있으므로 쓰지 않고
 * **오류 코드만 보고** 짧은 한국어로 바꾼다.
 *
 * ── 🔴 기다리는 시간에 상한을 둔다 (찾기만) ─────────────────────────────
 * NAS 가 느려지거나 멎으면 readdir 하나가 몇 십 초를 끈다. 그동안 요청 워커가 거기
 * 매달려 앱 전체가 느려진다. fs 작업 자체는 끊을 수 없지만 **요청은 돌려보낼 수
 * 있다** — 상한을 넘으면 `failed` 로 끝내고, 매달린 작업은 뒤에서 끝나게 둔다.
 *
 * 🔴 **만들기에는 상한을 두지 않는다**(견적서 저장 saveToQuoteArchive 와 같다). 끊어도
 * mkdir 은 뒤에서 계속 돌아 **폴더는 생긴다** — 그때 「실패했습니다」라고 답하면 감사
 * 기록이 없는 폴더가 하나 남는다. 만들기는 사람이 단추를 눌러 시작하는 한 번짜리 일이라
 * 느린 것을 기다리는 편이 낫다.
 * ============================================================================
 */

/** 공유폴더가 이만큼 안에 답하지 않으면 기다리기를 그만둔다. */
export const CONTACT_FOLDER_LOOKUP_TIMEOUT_MS = 1500;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const CONTACT_FOLDER_SLOW_REASON = "공유폴더가 느려 응답이 없습니다(잠시 뒤 다시 시도하세요).";

const INTAKE_NUMBER_MISSING_REASON = "인수번호가 비어 있어 연락서 폴더를 찾을 수 없습니다.";
const OUTSIDE_ROOT_ON_FIND = "찾은 폴더가 공유폴더 밖을 가리켜 쓰지 않았습니다.";
const OUTSIDE_ROOT_ON_CREATE = "만들 자리가 공유폴더 밖을 가리켜 만들지 않았습니다.";
const NAMING_FAILED_REASON = "수리 건 정보로 연락서 폴더 이름을 만들 수 없습니다.";
const NAME_TAKEN_BY_FILE_REASON = "같은 이름의 파일이 자리를 차지하고 있어 폴더를 만들 수 없습니다.";

/**
 * 연락서 공유폴더 루트. `CONTACT_FOLDER_ARCHIVE_DIR` 을 **부르는 시점에** 읽는다 —
 * 모듈을 불러오는 것만으로 값이 굳지 않게. 비었거나 공백이면 null(= 이 기능만 꺼져
 * 있다. 견적서 쪽 `QUOTE_ARCHIVE_DIR` 과 같은 모양이다).
 *
 * 값 자체를 로그로 찍지 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolveContactFolderArchiveRoot(): string | null {
  const configured = process.env.CONTACT_FOLDER_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

export type FindContactFolderInput = {
  /** 🔴 찾는 열쇠. 이것 하나로만 찾는다(모델 · S/N · L/N · 고객사로 확정하지 않는다). */
  intakeNumber: string;
  /**
   * 공유폴더 루트. 주지 않으면 `CONTACT_FOLDER_ARCHIVE_DIR` 을 읽는다.
   * 둘 다 비어 있으면 `disabled` 다. 시험에서는 임시 폴더를 준다.
   */
  root?: string | null;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

export type ContactFolderLookup =
  | ContactFolderMatch
  /** 공유폴더 위치가 설정되지 않았다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/**
 * 그 수리 건의 연락서 폴더를 **찾기만** 한다. **던지지 않는다.**
 *
 * 돌려주는 `folderName` 은 🔴 **디스크의 실제 이름**이다 — 경로를 이을 때 그대로 쓴다.
 * 다듬은 이름으로 이으면 없는 폴더가 된다(NFC/NFD · 공백 두 칸).
 */
export async function findContactFolder(input: FindContactFolderInput): Promise<ContactFolderLookup> {
  const configured = input.root === undefined || input.root === null ? resolveContactFolderArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const intakeNumber = typeof input.intakeNumber === "string" ? input.intakeNumber.trim() : "";
  if (intakeNumber.length === 0) {
    return { status: "failed", reason: INTAKE_NUMBER_MISSING_REASON };
  }

  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : CONTACT_FOLDER_LOOKUP_TIMEOUT_MS;
  try {
    return (await withShareFolderTimeout(look(configured, intakeNumber), timeoutMs)).picked;
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: CONTACT_FOLDER_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

export type CreateContactFolderInput = {
  /**
   * 🔴 이름을 짓는 재료 전부. 찾는 열쇠는 그 가운데 `intakeNumber` 하나뿐이고,
   * 이름은 **domain 의 contactFolderName 이 지은 것 그대로** 쓴다(여기서 새로 짓지 않는다).
   */
  naming: ContactFolderNamingInput;
  /** 공유폴더 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
};

export type ContactFolderCreation =
  /** 이번에 만들었다 — 🔴 감사 기록을 남길 자리는 여기 하나뿐이다. */
  | { status: "created"; folderName: string }
  /** 이미 있었다 — **만들지 않았다.** */
  | { status: "found"; folderName: string }
  /** 맞는 폴더가 여럿이다 — 🔴 만들지 않는다. 사람이 정리한다. */
  | { status: "multiple"; folderNames: string[] }
  /** 🔴 인수번호 없이 사람이 만들어 둔 **비슷한 폴더**가 있다 — 만들지 않는다. */
  | { status: "candidates"; folderNames: string[] }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/**
 * 그 수리 건의 연락서 폴더를 **찾고, 없으면 하나 만든다.** **던지지 않는다.**
 *
 * 규율은 견적서의 findOrCreateFolder 그대로다:
 *  · 🔴 루트를 만들지 않는다(연결이 빠졌을 때 컨테이너 임시 디스크에 쌓지 않게)
 *  · 🔴 먼저 찾는다 — 있으면 만들지 않고 그것을 쓴다
 *  · 🔴 `recursive` 없이 만든다. `EEXIST` 면 **다시 찾아** 그것을 쓴다(둘이 동시에 눌렀을 때)
 *  · 🔴 같은 이름의 **파일**이 자리를 막고 있으면 만들지 않고 `failed`
 * 여기에 연락서 쪽 안전장치가 하나 더 붙는다 — 🔴 **비슷한 폴더 훑기**(아래).
 */
export async function createContactFolder(input: CreateContactFolderInput): Promise<ContactFolderCreation> {
  const configured = input.root === undefined || input.root === null ? resolveContactFolderArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const intakeNumber = typeof input.naming.intakeNumber === "string" ? input.naming.intakeNumber.trim() : "";
  if (intakeNumber.length === 0) {
    return { status: "failed", reason: INTAKE_NUMBER_MISSING_REASON };
  }

  try {
    return await make(configured, { ...input.naming, intakeNumber });
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderWriteFailureReason(error),
    };
  }
}

async function make(rawRoot: string, naming: ContactFolderNamingInput): Promise<ContactFolderCreation> {
  // 루트는 이미 있는 폴더여야 한다 — 🔴 루트는 만들지 않는다.
  const root = await requireExistingShareFolderRoot(rawRoot);
  const names = await listShareFolderNames(root);

  // ── 🔴 먼저 찾는다. 있으면 만들지 않는다 ───────────────────────────────
  const picked = pickContactFolder(naming.intakeNumber, names);
  if (picked.status === "found") {
    assertInsideShareFolderRoot(root, path.join(root, picked.folderName), OUTSIDE_ROOT_ON_FIND);
    return picked;
  }
  if (picked.status === "multiple") {
    // 앱이 고르지 않으므로 **어디에 넣을지도 모른다** — 만들면 셋이 된다.
    return picked;
  }

  // ── 🔴 안전장치: 인수번호 없이 사람이 만들어 둔 비슷한 폴더가 있는가 ────
  //    하나뿐이어도 앱이 고르지 않는다. 사람이 탐색기에서 이름 앞에 인수번호를 붙인다.
  const similar = pickSimilarContactFolders(naming.serialNumber, names);
  if (similar.length > 0) {
    return { status: "candidates", folderNames: similar };
  }

  // ── 만든다 ─────────────────────────────────────────────────────────────
  let folderName: string;
  try {
    // 🔴 이름은 domain 이 짓는다(길이 상한 · 신고증상 20자 · 빈 조각 빼기가 거기 있다).
    folderName = contactFolderName(naming);
  } catch {
    // 던진 오류의 message 를 쓰지 않는다 — 사유는 늘 이 모듈이 정한 짧은 문장이다.
    throw new ShareFolderFailure(NAMING_FAILED_REASON);
  }

  const target = path.join(root, folderName);
  assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_ON_CREATE);
  try {
    // recursive 없이 — 부모(= 루트)가 없으면 만들지 않고 실패해야 한다.
    await mkdir(target);
    return { status: "created", folderName };
  } catch (error) {
    if (shareFolderErrorCode(error) !== "EEXIST") throw error;
  }

  // EEXIST — 둘이 동시에 눌렀거나, 같은 이름의 **파일**이 자리를 막고 있다.
  const again = pickContactFolder(naming.intakeNumber, await listShareFolderNames(root));
  if (again.status === "found") {
    assertInsideShareFolderRoot(root, path.join(root, again.folderName), OUTSIDE_ROOT_ON_FIND);
    return again;
  }
  if (again.status === "multiple") return again;
  // 폴더 목록에 없는데 자리가 차 있다 = 같은 이름의 파일이다. 🔴 지우지 않는다.
  throw new ShareFolderFailure(NAME_TAKEN_BY_FILE_REASON);
}

/**
 * ============================================================================
 * 🔴 **이미 있는 연락서 폴더에 사본을 꽂는다** (연락서 조각 6)
 * ============================================================================
 * [파일 관리]에서 올린 파일은 시스템 창고에 UUID 이름으로 들어간다 — 사람이 탐색기에서
 * 못 찾는 이름이다. 그래서 그 건의 연락서 폴더에 **사람이 읽는 이름으로** 사본을 하나 더
 * 꽂는다. 2026-10-05 사용자가 「양방향」을 고른 결과이고, 같은 파일이 두 곳에 있게 되는
 * 것을 **알고 고른 것**이다(그래야 공유폴더 목록의 [열기]로 그 파일을 열 수 있다).
 *
 * ── 🔴 폴더를 만들지 않는다 ─────────────────────────────────────────────
 * 이 길은 **이미 있는 폴더에만** 꽂는다. 폴더가 없으면 `no-folder` 로 조용히 끝난다 —
 * 폴더를 만드는 일은 사람이 [폴더 만들고 열기]를 누르는 그때뿐이고(조각 5), 올리기가
 * 지나가며 폴더를 늘리면 그 안전장치(비슷한 폴더 훑기)를 건너뛰게 된다.
 *
 * ── 🔴 덮어쓰지 않는다 ──────────────────────────────────────────────────
 * `open(…, "wx")` 로만 연다. 이미 있으면 ` (2)` 로 비켜 간다 — 현황표(견적서 쪽 덮어쓰기
 * 규칙)를 따라가지 **않는다.** 현황표 폴더에는 앱이 만든 파일만 있지만 **연락서 폴더에는
 * 직원이 손으로 넣은 파일이 섞여 있다.** 같은 이름이면 그것은 남의 파일이다.
 *
 * ── 🔴 NFC/NFD 구멍을 메운다 ────────────────────────────────────────────
 * `wx` 는 이름이 한 글자라도 다르면 못 막는다. 사람이 Mac 이나 옛 DSM 웹에서 올린 한글
 * 이름은 디스크에 **NFD**(풀어쓴 모양)로 앉을 수 있고 앱은 **NFC** 로 쓴다 — 커널에게는
 * 다른 파일이라 탐색기에서 **똑같아 보이는 파일이 둘** 생긴다. 그래서 쓰기 전에 폴더를
 * 읽어 **정규화해 견주고**, 이미 있으면 다음 번호로 간다. 내용 비교에 쓰는 이름 집합도
 * **같은 정규화**를 지난다.
 *
 * ── 내용이 같으면 새로 쓰지 않는다 ──────────────────────────────────────
 * 같은 사진을 두 번 올려도 ` (2)` 가 쌓이지 않게, 이번 이름의 후보 자리에 **같은 바이트**의
 * 파일이 있으면 그대로 둔다(견적서 findSameContentFile 의 전례). 크기를 먼저 보고 같을
 * 때만 읽는다. 비교와 쓰기 사이에 틈이 있어 **동시에** 같은 파일을 두 번 올리면 ` (2)` 가
 * 하나 생길 수 있다 — 덮어쓰기는 여전히 0 이라 그대로 둔다.
 *
 * ── 기다리는 시간 ───────────────────────────────────────────────────────
 * **찾기에만** 상한을 둔다(폴더가 어디인지 묻는 readdir 하나). 🔴 **쓰기에는 두지
 * 않는다** — 끊어도 쓰기는 뒤에서 계속 돌아 파일은 생기는데, 그때 「못 넣었습니다」라고
 * 답하면 사람이 같은 파일을 한 번 더 올려 ` (2)` 를 만든다(만들기 mkdir 과 같은 판단).
 * ============================================================================
 */

const FILE_NAME_UNUSABLE_REASON = "파일 이름에 공유폴더에 쓸 수 있는 글자가 없습니다.";
const OUTSIDE_ROOT_ON_COPY = "넣을 자리가 공유폴더 밖을 가리켜 넣지 않았습니다.";
const TOO_MANY_COPIES_REASON = `같은 이름의 파일이 너무 많습니다(${CONTACT_FOLDER_MAX_NUMBERED_COPIES}개). 연락서 폴더를 정리한 뒤 다시 시도하세요.`;

export type CopyIntoContactFolderInput = {
  /** 🔴 찾는 열쇠. 이것 하나로만 찾는다(만들기 · 찾기와 같다). */
  intakeNumber: string;
  /** 올린 파일의 원본 이름. 다듬어서 **사람이 읽는 이름**으로 꽂는다. */
  originalFileName: string;
  /** 꽂을 내용. 시스템 창고에 이미 들어간 그 파일의 바이트다. */
  bytes: Uint8Array;
  /** 공유폴더 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
  /** 폴더를 **찾는** 동안의 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

export type ContactFolderCopy =
  /** 이번에 새로 꽂았다. `fileName` 은 디스크에 실제로 쓴 이름(번호가 붙었을 수 있다). */
  | { status: "copied"; folderName: string; fileName: string }
  /** 같은 내용의 파일이 이미 있어 **쓰지 않았다.** */
  | { status: "unchanged"; folderName: string; fileName: string }
  /** 🔴 연락서 폴더가 아직 없다 — **만들지 않는다.** 사람이 [폴더 만들고 열기]로 만든다. */
  | { status: "no-folder" }
  /** 맞는 폴더가 여럿이다 — 🔴 어디에 넣을지 앱이 고르지 않는다. */
  | { status: "multiple"; folderNames: string[] }
  | { status: "disabled" }
  | { status: "failed"; reason: string };

/**
 * 올린 파일의 사본을 그 수리 건의 연락서 폴더에 꽂는다. **던지지 않는다.**
 *
 * 🔴 부르는 쪽(올리기 통로)은 이 결과가 무엇이든 **올리기를 성공으로 끝낸다** — 시스템
 * 창고에는 이미 들어갔고 감사도 남았다. 이 결과는 화면에 사실대로 알리기 위한 것이다.
 */
export async function copyIntoContactFolder(input: CopyIntoContactFolderInput): Promise<ContactFolderCopy> {
  const configured = input.root === undefined || input.root === null ? resolveContactFolderArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  const intakeNumber = typeof input.intakeNumber === "string" ? input.intakeNumber.trim() : "";
  if (intakeNumber.length === 0) {
    return { status: "failed", reason: INTAKE_NUMBER_MISSING_REASON };
  }

  // 이름부터 짓는다 — 쓸 수 있는 이름이 없으면 디스크를 보지 않는다.
  const fileName = contactFolderCopyFileName(input.originalFileName);
  if (fileName === null) {
    return { status: "failed", reason: FILE_NAME_UNUSABLE_REASON };
  }

  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : CONTACT_FOLDER_LOOKUP_TIMEOUT_MS;
  let located: { root: string; picked: ContactFolderMatch };
  try {
    // ── 1) 어느 폴더인가 — 🔴 여기까지만 상한을 둔다(읽기만 한다) ─────────
    located = await withShareFolderTimeout(look(configured, intakeNumber), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: CONTACT_FOLDER_SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }

  // 🔴 폴더가 없으면 **만들지 않는다.** 여럿이어도 앱이 고르지 않는다.
  const { root, picked } = located;
  if (picked.status === "not-found") return { status: "no-folder" };
  if (picked.status === "multiple") return { status: "multiple", folderNames: picked.folderNames };

  try {
    // ── 2) 꽂는다 — 🔴 상한 없이. 끊어도 쓰기는 뒤에서 끝나 파일이 생긴다 ──
    return await put(root, picked.folderName, fileName, input.bytes);
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderWriteFailureReason(error),
    };
  }
}

async function put(root: string, folderName: string, fileName: string, bytes: Uint8Array): Promise<ContactFolderCopy> {
  // 이을 때는 **디스크의 실제 이름**을 쓴다(look 이 돌려준 그대로).
  const directory = path.join(root, folderName);
  assertInsideShareFolderRoot(root, directory, OUTSIDE_ROOT_ON_COPY);

  // 🔴 폴더를 **한 번만** 읽는다 — NAS 너머라 왕복 한 번이 비싸다. 이 한 벌로 「같은 내용이
  //    있는가」와 「빈 번호가 어디인가」를 둘 다 푼다.
  const existing = await listFileNamesByCompareKey(directory);

  const same = await findSameContentFile(root, directory, existing, fileName, bytes);
  if (same !== null) {
    return { status: "unchanged", folderName, fileName: same };
  }

  const written = await writeNewFile(root, directory, existing, fileName, bytes);
  return { status: "copied", folderName, fileName: written };
}

/**
 * 폴더 맨 위 칸의 **파일 이름**들을 `정규화한 이름 → 디스크의 실제 이름들` 로 모은다.
 *
 * 🔴 정규화(NFC + 연속 공백 하나)해서 모으는 것이 핵심이다 — 디스크에 NFD 로 앉은 한글
 * 이름을 접어 봐야 「같은 이름이 이미 있다」를 판정할 수 있다. 한 열쇠에 이름이 여럿일
 * 수 있다(NFC 와 NFD 가 **둘 다** 있는 폴더). 폴더 · 링크는 담지 않는다.
 */
async function listFileNamesByCompareKey(directory: string): Promise<Map<string, string[]>> {
  const entries = await readdir(directory, { withFileTypes: true });
  const byKey = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const key = normalizeShareFolderNameForCompare(entry.name);
    const names = byKey.get(key);
    if (names) names.push(entry.name);
    else byKey.set(key, [entry.name]);
  }
  return byKey;
}

/**
 * 이번 이름의 후보들(`이름`, `이름 (2)` … 상한까지) 가운데 **같은 바이트**의 파일 이름을
 * 찾는다. 없으면 null. 다른 이름의 파일은 보지 않는다(견적서와 같은 절제).
 */
async function findSameContentFile(
  root: string,
  directory: string,
  existing: Map<string, string[]>,
  fileName: string,
  bytes: Uint8Array
): Promise<string | null> {
  for (let n = 1; n <= CONTACT_FOLDER_MAX_NUMBERED_COPIES; n += 1) {
    const candidate = numberedContactFolderFileName(fileName, n);
    const actualNames = existing.get(normalizeShareFolderNameForCompare(candidate));
    if (actualNames === undefined) continue;
    for (const actual of actualNames) {
      const target = path.join(directory, actual);
      assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_ON_COPY);
      if (await hasSameBytes(target, bytes)) return actual;
    }
  }
  return null;
}

/**
 * 그 파일이 이 바이트와 같은가 — 크기가 같을 때만 내용을 읽어 맞춘다. 읽지 못하면(사용 중 ·
 * 권한) 「같지 않음」으로 친다: 새로 쓰는 쪽으로 틀린다(덮어쓰지 않으니 잃는 것이 없다).
 */
async function hasSameBytes(target: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size !== bytes.byteLength) return false;
    return (await readFile(target)).equals(bytes);
  } catch {
    return false;
  }
}

/**
 * 파일을 **새로** 쓴다. 🔴 `wx` 로만 연다 — 있으면 다음 번호다.
 *
 * 빈 번호는 방금 읽어 둔 목록에서 고른다(디스크를 번호마다 두드리지 않는다). 그래도 `wx`
 * 를 쓰는 까닭은 **읽은 뒤에 생긴 파일**이 있을 수 있기 때문이다(둘이 동시에 올렸을 때) —
 * 그때는 EEXIST 를 받아 다음 번호로 간다.
 *
 * 🔴 쓰다 실패해도 **지우지 않는다**(머리말 「지우지 않는다」의 대가). 반쯤 쓰인 파일이
 * 남을 수 있고, 그 사실은 응답으로 사람에게 간다.
 */
async function writeNewFile(
  root: string,
  directory: string,
  existing: Map<string, string[]>,
  fileName: string,
  bytes: Uint8Array
): Promise<string> {
  for (let n = 1; n <= CONTACT_FOLDER_MAX_NUMBERED_COPIES; n += 1) {
    const candidate = numberedContactFolderFileName(fileName, n);
    // 🔴 NFC/NFD — `wx` 는 한 글자라도 다르면 못 막는다. 접어서 먼저 견준다.
    if (existing.has(normalizeShareFolderNameForCompare(candidate))) continue;

    const target = path.join(directory, candidate);
    assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_ON_COPY);

    let handle;
    try {
      handle = await open(target, "wx");
    } catch (error) {
      if (shareFolderErrorCode(error) === "EEXIST") continue;
      throw error;
    }

    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close().catch(() => undefined);
    }
    return candidate;
  }
  throw new ShareFolderFailure(TOO_MANY_COPIES_REASON);
}

/**
 * 찾기 한 번 — 🔴 **루트와 판정을 함께** 돌려준다. 사본 꽂기(copyIntoContactFolder)가
 * 그 루트 아래에 경로를 이어야 하는데, 루트 확인을 한 번 더 하면 NAS 왕복이 늘고
 * 「루트는 이미 있어야 한다」가 두 자리에서 판정된다.
 */
async function look(rawRoot: string, intakeNumber: string): Promise<{ root: string; picked: ContactFolderMatch }> {
  // 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다.
  const root = await requireExistingShareFolderRoot(rawRoot);
  // 폴더만 센다(`isDirectory()`) — 같은 이름의 파일도, 심볼릭 링크도 후보가 아니다.
  const names = await listShareFolderNames(root);
  const picked = pickContactFolder(intakeNumber, names);

  // 이름은 readdir 이 준 것이라 구분자가 들어 있을 수 없지만, 디스크의 이름을 그대로
  // 잇는 자리라 방어로 한 번 본다.
  const chosen = picked.status === "found" ? [picked.folderName] : picked.status === "multiple" ? picked.folderNames : [];
  for (const name of chosen) {
    assertInsideShareFolderRoot(root, path.join(root, name), OUTSIDE_ROOT_ON_FIND);
  }
  return { root, picked };
}
