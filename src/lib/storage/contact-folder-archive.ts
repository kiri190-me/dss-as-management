import "server-only";

import path from "node:path";

import {
  pickContactFolder,
  type ContactFolderMatch,
} from "@/lib/domain/contact-folder-naming";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  listShareFolderNames,
  requireExistingShareFolderRoot,
  shareFolderReadFailureReason,
  withShareFolderTimeout,
} from "./share-folder-fs";

/**
 * ============================================================================
 * 사내 공유폴더에서 그 수리 건의 **연락서 폴더를 찾는다** — 찾기만 한다
 * ============================================================================
 *   <루트>/D260908 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청/
 *
 * 이름 규칙 · 찾기 판정은 domain/contact-folder-naming.ts 가 정한다. 이 모듈이 하는
 * 일은 **디스크에서 폴더 이름을 읽어 그 판정에 넘기는 것**뿐이다.
 *
 * ── 🔴 만들지 않는다 · 지우지 않는다 ────────────────────────────────────
 * 이 조각에서는 **찾기만** 한다(만들기는 뒤 조각이다). 그래서 `node:fs/promises` 를
 * 아예 가져오지 않는다 — 읽기는 공용 도우미(storage/share-folder-fs.ts)가 하고,
 * `mkdir` · `writeFile` · `unlink` · `rm` · `rmdir` · `rename` 은 **이 파일에 들어올
 * 길이 없다.** 앱은 사람의 서류함에서 파일을 지우지 않는다. 그 사실을
 * contact-folder-archive-source.test.ts 가 원본을 글자로 읽어 못 박는다.
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
 * ── 🔴 기다리는 시간에 상한을 둔다 ──────────────────────────────────────
 * NAS 가 느려지거나 멎으면 readdir 하나가 몇 십 초를 끈다. 그동안 요청 워커가 거기
 * 매달려 앱 전체가 느려진다. fs 작업 자체는 끊을 수 없지만 **요청은 돌려보낼 수
 * 있다** — 상한을 넘으면 `failed` 로 끝내고, 매달린 작업은 뒤에서 끝나게 둔다.
 * ============================================================================
 */

/** 공유폴더가 이만큼 안에 답하지 않으면 기다리기를 그만둔다. */
export const CONTACT_FOLDER_LOOKUP_TIMEOUT_MS = 1500;

/** 상한을 넘겼을 때의 사유. 사람이 다시 눌러 볼 수 있게 「잠시 뒤」를 적는다. */
export const CONTACT_FOLDER_SLOW_REASON = "공유폴더가 느려 응답이 없습니다(잠시 뒤 다시 시도하세요).";

const INTAKE_NUMBER_MISSING_REASON = "인수번호가 비어 있어 연락서 폴더를 찾을 수 없습니다.";
const OUTSIDE_ROOT_ON_FIND = "찾은 폴더가 공유폴더 밖을 가리켜 쓰지 않았습니다.";

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
    return await withShareFolderTimeout(look(configured, intakeNumber), timeoutMs);
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

async function look(rawRoot: string, intakeNumber: string): Promise<ContactFolderMatch> {
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
  return picked;
}
