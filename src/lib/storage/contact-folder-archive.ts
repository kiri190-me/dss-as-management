import "server-only";

import { mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { AttachmentCategory } from "@/lib/domain/attachment-category";
import {
  CONTACT_FOLDER_DATA_FOLDER_NAME,
  CONTACT_FOLDER_MAX_NUMBERED_COPIES,
  contactFolderCategoryFolderName,
  contactFolderCopyFileName,
  contactFolderName,
  numberedContactFolderFileName,
  pickContactFolder,
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
 * 🔴 **2026-10-05 조각 11** — 만드는 폴더가 셋이 되었다(연락서 폴더 · 그 안의 `DATA` ·
 * 올린 파일의 분류 폴더). 그래도 **`mkdir` 을 부르는 자리는 `makeOneFolder` 하나**다 —
 * 세 자리에 흩어 적으면 `recursive` 가 하나에만 붙는 날이 온다.
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
 *
 * 🔴 **안전장치는 「인수번호로 먼저 찾는다」 하나뿐이다.** 조각 5 가 그 위에 S/N 으로
 * 「비슷한 폴더」를 훑는 장치를 하나 더 얹었지만 2026-10-05 사용자 결정으로 걷어냈다 —
 * 같은 S/N · 모델 · L/N 의 폴더가 이미 있어도 **새 인수번호면 새 폴더가 생겨야 한다**
 * (같은 장비가 다시 수리를 오는 것이 정상이다). 까닭 전부는
 * domain/contact-folder-naming.ts 의 「걷어낸 것」 머리말에 있다. **되살리지 말 것.**
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

  // ── 만든다 ─────────────────────────────────────────────────────────────
  // 🔴 여기까지 왔으면 **이 인수번호의 폴더가 없다.** 같은 S/N · 모델 · L/N 의 폴더가
  //    옆에 있어도 만든다 — 같은 장비가 다시 수리를 오면 그것이 정상이고, 새 인수번호에는
  //    새 폴더가 있어야 한다(걷어낸 S/N 훑기의 까닭은 머리말 참조).
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
  if (await makeOneFolder(target)) {
    // 🔴 **이번에 만들었을 때만** DATA 를 함께 둔다 — 이미 있던 폴더에는 만들지 않는다.
    //    곁다리라 결과를 보지 않는다(아래 makeDataFolder 머리말).
    await makeDataFolder(root, target);
    return { status: "created", folderName };
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
 * 폴더 **하나**를 만든다 — 만들었으면 `true`, 자리가 이미 차 있으면(`EEXIST`) `false`.
 *
 * 🔴 **이 모듈에서 `mkdir` 을 부르는 자리는 여기 하나뿐이다.** 연락서 폴더 · `DATA` ·
 * 분류 폴더 셋이 전부 이리로 들어온다. 세 자리에 흩어 적으면 `recursive` 가 하나에만
 * 붙거나 `EEXIST` 를 하나만 잡는 날이 온다(contact-folder-archive-source.test.ts 가
 * 「부르는 자리는 하나」를 원본 글자로 본다).
 *
 * 🔴 **`recursive` 를 주지 않는다** — 부모가 없으면 만들지 않고 실패해야 한다(루트를
 * 만들지 않는다는 규율이 거기에 걸려 있다).
 *
 * 자리를 막은 것이 **폴더인지 파일인지는 가리지 않는다** — 서류함마다 할 일이 달라서
 * (연락서 폴더는 `failed`, 분류 폴더는 바로 아래로 비켜 간다) 부르는 쪽이 정한다.
 */
async function makeOneFolder(target: string): Promise<boolean> {
  try {
    await mkdir(target);
    return true;
  } catch (error) {
    if (shareFolderErrorCode(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * 방금 만든 연락서 폴더 안에 **빈 `DATA` 폴더**를 함께 둔다 (조각 11 — 사용자 요청).
 * 사람이 측정 자료 같은 것을 넣는 자리다.
 *
 * 🔴 **새로 만든 폴더에만** 부른다 — 이미 있던 폴더에는 만들지 않는다. 운영 공유폴더의
 * 660 여 개에 우리가 폴더를 한꺼번에 늘리면 안 된다.
 *
 * 🔴 **곁다리다 — 실패해도 폴더 만들기는 성공이다.** 그래서 무엇이든 여기서 삼킨다.
 * `DATA` 가 없다고 「폴더를 못 만들었습니다」라고 답하면 감사 기록이 없는 폴더가 하나
 * 남고, 사람은 이미 생긴 폴더를 다시 만들려 든다. 없으면 사람이 탐색기에서 만든다.
 */
async function makeDataFolder(root: string, folder: string): Promise<void> {
  try {
    const target = path.join(folder, CONTACT_FOLDER_DATA_FOLDER_NAME);
    assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_ON_CREATE);
    // 이미 있으면(사람이 만들어 둔 경우) `false` 가 돌아온다 — 🔴 그대로 둔다.
    await makeOneFolder(target);
  } catch {
    // 삼킨다 — 위 머리말의 「곁다리」.
  }
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
 * ── 🔴 연락서 폴더를 만들지 않는다 ──────────────────────────────────────
 * 이 길은 **이미 있는 폴더에만** 꽂는다. 폴더가 없으면 `no-folder` 로 조용히 끝난다 —
 * 폴더를 만드는 일은 사람이 [폴더 만들고 열기]를 누르는 그때뿐이고(조각 5), 올리기가
 * 지나가며 폴더를 늘리면 폴더가 늘어난 것을 사람이 볼 기회가 없다.
 *
 * ── 🔴 하위 폴더 안에 꽂는다 (조각 11 · 12) ─────────────────────────────
 * 연락서 폴더 **바로 아래**가 아니라 한 겹 안에 꽂는다. 어느 겹인지는 **부르는 길**이
 * 정하고, 지금 둘이다:
 *
 *  · **올리기**(조각 11) — `연락서폴더/인수 사진/…` 처럼 그 파일의 **분류 이름표**로 된
 *    하위 폴더. 이름은 사람이 보는 한글 이름표다(`INTAKE_PHOTO` 가 아니라 `인수 사진` —
 *    domain/contact-folder-naming.ts 의 contactFolderCategoryFolderName).
 *  · **[DATA에 저장]**(조각 12) — `연락서폴더/DATA/…`. 사람이 측정 자료를 넣는 자리이고,
 *    분류와 무관하다(copyIntoContactFolderDataFolder).
 *
 * 🔴 **규율은 한 벌이다** — 없으면 만들고 · 있으면 쓰고 · 같은 이름의 **파일**이 막고
 * 있으면 연락서 폴더 바로 아래로 비켜 가 그 사실을 결과에 싣는다. 두 길에 따로 적지
 * 않는다(아래 openCategoryFolder 하나가 둘을 다 한다).
 *
 *  · 🔴 **쓰는 분류만 그때그때 만든다** — 분류 전부를 미리 만들지 않는다.
 *  · 🔴 **없으면 만들고 있으면 쓴다**(`EEXIST` 면 그대로 진행).
 *  · 🔴 **같은 이름의 파일이 그 자리를 막고 있으면**(사람의 서류함에 `견적서` 라는
 *    **파일**이 있을 수 있다) 실패로 끝내지 않고 **연락서 폴더 바로 아래**에 꽂은 뒤
 *    그 사실을 결과에 싣는다. 🔴 막은 파일을 지우지도 옮기지도 않는다.
 *  · 분류 이름표를 다듬은 결과가 빈 문자열이면(그런 분류는 없다) 역시 바로 아래다.
 *
 * 분류 폴더가 한 겹 들어가면서 **파일 이름 상한이 95 → 84 자로 내려갔다** — 계산은
 * domain/contact-folder-naming.ts 의 CONTACT_FOLDER_FILE_MAX_NAME_LENGTH 주석에 있다.
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
  /**
   * 🔴 그 파일의 분류. **한글 이름표**로 된 하위 폴더에 꽂는다(`인수 사진` · `견적서` …).
   * 이름표는 domain/attachment-category.ts 한 자리에만 있다.
   */
  category: AttachmentCategory;
  /** 올린 파일의 원본 이름. 다듬어서 **사람이 읽는 이름**으로 꽂는다. */
  originalFileName: string;
  /** 꽂을 내용. 시스템 창고에 이미 들어간 그 파일의 바이트다. */
  bytes: Uint8Array;
  /** 공유폴더 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
  /** 폴더를 **찾는** 동안의 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 사본을 **어디에** 꽂았는가 (조각 11 · 12).
 *
 *  · `categoryFolderName` 이 있으면 그 **하위 폴더 안**이다 — 올리기면 분류 이름표
 *    (`인수 사진`), [DATA에 저장]이면 `DATA` 다.
 *  · `null` 이면 **연락서 폴더 바로 아래**다 — 까닭은 둘뿐이고,
 *    `categoryFolderBlockedByFile` 이 참이면 같은 이름의 **파일**이 자리를 막은 것이다
 *    (거짓이면 하위 폴더 이름을 다듬은 결과가 비었다는 뜻 — 지금 그런 길은 없다).
 *
 * 🔴 **경로를 담지 않는다** — 담는 것은 폴더 이름 한 조각뿐이다(사유 규율과 같다).
 *
 * 🔴 칸 이름이 `category…` 인 것은 조각 11 이 먼저 썼기 때문이다. 조각 12 의 `DATA` 도
 * **같은 칸**을 쓴다 — 이름을 둘로 가르면 응답 · 화면 · 시험 네 자리가 함께 갈라진다.
 */
export type ContactFolderCopyPlace = {
  categoryFolderName: string | null;
  categoryFolderBlockedByFile: boolean;
};

export type ContactFolderCopy =
  /** 이번에 새로 꽂았다. `fileName` 은 디스크에 실제로 쓴 이름(번호가 붙었을 수 있다). */
  | ({ status: "copied"; folderName: string; fileName: string } & ContactFolderCopyPlace)
  /** 같은 내용의 파일이 이미 있어 **쓰지 않았다.** */
  | ({ status: "unchanged"; folderName: string; fileName: string } & ContactFolderCopyPlace)
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
  // 분류 폴더 이름은 domain 이 짓는다(한글 이름표 · 다듬기). 못 지으면 null 이고,
  // 그때는 연락서 폴더 바로 아래에 꽂는다.
  return copyInto({ ...input, subfolderName: contactFolderCategoryFolderName(input.category) });
}

export type CopyIntoContactFolderDataInput = {
  /** 🔴 찾는 열쇠. 이것 하나로만 찾는다(올리기 사본과 같다). */
  intakeNumber: string;
  /** 꽂을 이름의 바탕. 다듬어서 **사람이 읽는 이름**으로 꽂는다. */
  originalFileName: string;
  /** 꽂을 내용. 저장된 원본의 바이트이거나, 브라우저가 줄인 사진의 바이트다. */
  bytes: Uint8Array;
  /** 공유폴더 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
  /** 폴더를 **찾는** 동안의 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * ============================================================================
 * 🔴 **[DATA에 저장]** — 저장된 파일을 그 건의 `DATA` 폴더에 꽂는다 (연락서 조각 12)
 * ============================================================================
 * 사용자는 「내려받을 때 기본으로 `DATA` 에 저장되게」를 바랐지만 **웹페이지는 브라우저의
 * 저장 위치를 지정할 수 없다**(보안). 그래서 **서버가 직접 꽂는다** — 「받아서 탐색기로
 * 옮기기」 두 걸음이 한 번 누르기가 된다(2026-10-05 승인).
 *
 * 올리기 사본(copyIntoContactFolder)과 **다른 것은 꽂는 자리 하나뿐**이다:
 *  · 🔴 분류 폴더가 아니라 **`DATA`** 다 — 올리기와 자리가 다르다.
 *  · 🔴 `DATA` 가 **없으면 만든다.** 조각 11 은 **새로 만든 연락서 폴더에만** `DATA` 를
 *    두었으므로, 그 전에 생긴 폴더(운영 660 여 개)에는 없다. 만들지 않기로 하면 이
 *    기능이 정작 필요한 곳에서 전부 「폴더가 없습니다」가 된다. 🔴 조각 5 의 「사람이
 *    한 번 더 눌러야 만든다」는 **공유폴더 맨 위의 연락서 폴더** 이야기다(거기서 폴더가
 *    늘면 한 수리 건의 서류가 둘로 갈린다). `DATA` 는 **이미 있는 그 건의 폴더 안**에,
 *    우리가 이름까지 정해 둔 자리이고(contact-folder-naming.ts), 만드는 때도 사람이
 *    단추를 누른 그때다 — 올리기가 분류 폴더를 그때그때 만드는 것과 같은 규율이다.
 *  · 🔴 그래도 **연락서 폴더 자체는 만들지 않는다** — 없으면 `no-folder` 다.
 *
 * 덮어쓰지 않기 · 내용이 같으면 쓰지 않기 · NFC/NFD · 번호 비켜 가기는 **한 글자도
 * 다르지 않다**(같은 put 을 지난다).
 * ============================================================================
 */
export async function copyIntoContactFolderDataFolder(
  input: CopyIntoContactFolderDataInput
): Promise<ContactFolderCopy> {
  return copyInto({ ...input, subfolderName: CONTACT_FOLDER_DATA_FOLDER_NAME });
}

/**
 * 두 길(올리기 사본 · [DATA에 저장])이 **함께 쓰는 몸통**. 꽂을 하위 폴더 이름만 다르다.
 * **던지지 않는다.**
 */
async function copyInto(input: {
  intakeNumber: string;
  /** 꽂을 하위 폴더 이름. `null` 이면 연락서 폴더 바로 아래다. */
  subfolderName: string | null;
  originalFileName: string;
  bytes: Uint8Array;
  root?: string | null;
  timeoutMs?: number;
}): Promise<ContactFolderCopy> {
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
    return await put(root, picked.folderName, input.subfolderName, fileName, input.bytes);
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderWriteFailureReason(error),
    };
  }
}

async function put(
  root: string,
  folderName: string,
  categoryFolderName: string | null,
  fileName: string,
  bytes: Uint8Array
): Promise<ContactFolderCopy> {
  // 이을 때는 **디스크의 실제 이름**을 쓴다(look 이 돌려준 그대로).
  const folder = path.join(root, folderName);
  assertInsideShareFolderRoot(root, folder, OUTSIDE_ROOT_ON_COPY);

  // ── 🔴 분류 폴더 — 없으면 만들고, 있으면 쓰고, 막혀 있으면 바로 아래로 비켜 간다 ──
  const place = await openCategoryFolder(root, folder, categoryFolderName);
  const directory = place.categoryFolderName === null ? folder : path.join(folder, place.categoryFolderName);

  // 🔴 폴더를 **한 번만** 읽는다 — NAS 너머라 왕복 한 번이 비싸다. 이 한 벌로 「같은 내용이
  //    있는가」와 「빈 번호가 어디인가」를 둘 다 푼다.
  const existing = await listFileNamesByCompareKey(directory);

  const same = await findSameContentFile(root, directory, existing, fileName, bytes);
  if (same !== null) {
    return { status: "unchanged", folderName, fileName: same, ...place };
  }

  const written = await writeNewFile(root, directory, existing, fileName, bytes);
  return { status: "copied", folderName, fileName: written, ...place };
}

/**
 * 분류 폴더를 **없으면 만들고 있으면 쓴다.** 🔴 **실패로 끝내지 않는다** — 분류 폴더 하나
 * 때문에 올린 파일이 공유폴더에서 통째로 빠지면 안 된다. 쓸 수 없으면 **연락서 폴더 바로
 * 아래**를 돌려주고 그 까닭을 함께 싣는다.
 *
 * 🔴 자리를 **파일**이 막고 있어도 그 파일을 지우지 · 옮기지 않는다. 사람이 손으로 넣은
 * `견적서` 라는 파일이 실제로 있을 수 있다.
 */
async function openCategoryFolder(
  root: string,
  folder: string,
  categoryFolderName: string | null
): Promise<ContactFolderCopyPlace> {
  // 이름표를 다듬은 결과가 비었다 — 그런 분류는 없지만 조용히 깨지면 안 된다.
  if (categoryFolderName === null) {
    return { categoryFolderName: null, categoryFolderBlockedByFile: false };
  }

  const target = path.join(folder, categoryFolderName);
  assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_ON_COPY);

  // 🔴 recursive 없이 — 연락서 폴더가 없으면 여기서 실패해야 한다(이 길은 폴더를
  //    만들지 않는다). 다만 그 앞의 look 이 이미 폴더가 있는 것을 보았다.
  if (await makeOneFolder(target)) {
    return { categoryFolderName, categoryFolderBlockedByFile: false };
  }

  // EEXIST — 폴더면 그대로 쓰고, 폴더가 아니면(= 같은 이름의 파일) 바로 아래로 비켜 간다.
  if (await isExistingDirectory(target)) {
    return { categoryFolderName, categoryFolderBlockedByFile: false };
  }
  return { categoryFolderName: null, categoryFolderBlockedByFile: true };
}

/**
 * 그 자리가 **폴더**인가. 읽지 못하면(권한 · 사라짐) 「폴더가 아님」으로 친다 — 분류 폴더를
 * 쓰지 않고 바로 아래에 꽂는 쪽으로 틀린다(그래야 파일이 어딘가에는 들어간다).
 */
async function isExistingDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
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
