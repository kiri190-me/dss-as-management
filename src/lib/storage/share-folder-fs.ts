import "server-only";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { compareShareFolderNames } from "@/lib/domain/share-folder-naming";

/**
 * ============================================================================
 * 사내 공유폴더를 다루는 **공용 도우미** — 루트 확인 · 폴더 찾기 · 실패 사유
 * ============================================================================
 * 견적서(storage/quote-archive.ts)와 연락서(storage/contact-folder-archive.ts)가
 * 함께 쓴다. 2026-10-05 연락서 조각 1 에서 견적서 쪽 비공개 도우미를 그대로
 * 끌어냈다 — 🔴 **견적서 동작은 한 글자도 바뀌지 않았다.**
 *
 * ── 루트는 만들지 않는다 ─────────────────────────────────────────────────
 * 운영에서는 공유폴더를 컨테이너에 연결(마운트)해 쓴다. 연결이 빠진 채 루트를
 * 만들면 컨테이너 안 임시 디스크에 쓰고 「되었습니다」라고 거짓말하게 된다.
 * 루트가 없거나 폴더가 아니면 실패다.
 *
 * ── 던지지 않는 쪽을 돕는다 ─────────────────────────────────────────────
 * 여기서는 ShareFolderFailure 를 던지고, 부르는 모듈이 그것을 잡아
 * `{ status: "failed", reason }` 으로 바꾼다. `reason` 은 화면 · 응답 헤더로
 * 나가므로 **절대 경로 · 루트 값을 담지 않는다** — fs 오류의 `message` 에는 경로가
 * 들어 있으므로 쓰지 않고 **오류 코드만 보고** 짧은 한국어로 바꾼다.
 *
 * ── 🔴 지우지 않는다 ────────────────────────────────────────────────────
 * 이 모듈은 **읽기만** 한다(stat · readdir). 만들기 · 쓰기 · 지우기는 각 모듈이
 * 제 책임으로 한다 — 여기에 unlink · rm · rename 을 들이지 않는다.
 * ============================================================================
 */

/** 사람이 읽는 실패 사유를 들고 나오는 내부 오류. 부르는 쪽이 잡아서 바꾼다. */
export class ShareFolderFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ShareFolderFailure";
  }
}

/** 공유폴더가 제때 답하지 않았다 — 기다리기를 그만두었다는 표시(아래 withShareFolderTimeout). */
export class ShareFolderTimeout extends Error {
  constructor() {
    super("share folder timed out");
    this.name = "ShareFolderTimeout";
  }
}

/**
 * 공유폴더 일을 **기다리는 시간에 상한**을 둔다. 상한을 넘으면 ShareFolderTimeout 을
 * 던져 요청을 돌려보낸다.
 *
 * 🔴 fs 작업 자체는 끊을 수 없다 — NAS 가 느리면 그 readdir 은 뒤에서 계속 돈다.
 * 여기서 끊는 것은 **기다리기**뿐이다. 그래야 NAS 가 멎었을 때 요청 워커가 거기
 * 매달려 앱 전체가 느려지는 일이 없다.
 *
 * 매달린 작업이 나중에 실패해도 unhandled rejection 이 되지 않게 미리 손을 붙여 둔다.
 */
export async function withShareFolderTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  // 나중에 깨지는 약속에 미리 손을 붙인다(값은 버린다 — race 는 원래 약속을 그대로 본다).
  void work.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ShareFolderTimeout()), Math.max(0, timeoutMs));
        // 이 타이머 하나 때문에 프로세스가 안 끝나는 일이 없게.
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다(머리말 「루트는 만들지 않는다」). */
export async function requireExistingShareFolderRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.trim().length === 0) {
    throw new ShareFolderFailure("공유폴더 위치가 설정되지 않았습니다.");
  }
  const root = path.resolve(rawRoot.trim());
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    const code = shareFolderErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new ShareFolderFailure("공유폴더에 접근할 권한이 없습니다.");
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new ShareFolderFailure("공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다).");
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new ShareFolderFailure("공유폴더를 찾을 수 없습니다(폴더가 아닙니다).");
  }
  return root;
}

/**
 * 부모 폴더 안의 **폴더 이름**들을 이름순으로 돌려준다 — `isDirectory()` 만 본다.
 * readdir 의 withFileTypes 는 링크를 따라가지 않으므로 **심볼릭 링크는 폴더로 치지
 * 않는다**(링크가 공유폴더 밖을 가리킬 수 있다). 파일은 후보가 아니다.
 *
 * `matches` 를 주면 그 이름만 남긴다.
 */
export async function listShareFolderNames(
  parent: string,
  matches?: (name: string) => boolean
): Promise<string[]> {
  const entries = await readdir(parent, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && (matches === undefined || matches(entry.name)))
    .map((entry) => entry.name)
    .sort(compareShareFolderNames);
}

export type ShareFolderPick = { name: string; multiple: boolean };

/**
 * 맞는 폴더 하나를 고른다. 여럿이면 이름순 첫째이고 `multiple` 이 참이다 — 사람이
 * 폴더를 둘 만들어 두었다는 뜻이라 부르는 쪽이 그 사실을 함께 나른다.
 */
export async function findShareFolder(
  parent: string,
  matches: (name: string) => boolean
): Promise<ShareFolderPick | null> {
  const names = await listShareFolderNames(parent, matches);
  if (names.length === 0) return null;
  return { name: names[0], multiple: names.length > 1 };
}

/**
 * 이은 경로가 루트 밖이면 거절한다. 이름을 다듬으므로 일어나지 않아야 하지만,
 * 디스크의 이름을 그대로 잇는 자리가 있어 방어로 둔다. 사유는 부르는 쪽이 정한다.
 */
export function assertInsideShareFolderRoot(root: string, target: string, reason: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ShareFolderFailure(reason);
  }
}

export function shareFolderErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 쓰기 쪽 fs 오류 → 사람이 읽는 짧은 사유. **오류의 message 는 쓰지 않는다**(경로가 들어 있다). */
export function shareFolderWriteFailureReason(error: unknown): string {
  switch (shareFolderErrorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더에 쓸 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더의 폴더를 찾을 수 없습니다(저장 중 옮겨졌거나 연결이 끊겼을 수 있습니다).";
    case "ENOSPC":
    case "EDQUOT":
      return "공유폴더에 남은 공간이 없습니다.";
    case "ENAMETOOLONG":
      return "파일 이름이나 경로가 너무 깁니다.";
    case "EROFS":
      return "공유폴더가 읽기 전용입니다.";
    case "EBUSY":
      return "공유폴더의 파일이 사용 중이라 저장하지 못했습니다.";
    case "EIO":
    case "ETIMEDOUT":
    case "EHOSTDOWN":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
      return "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요).";
    default:
      return "공유폴더에 저장하지 못했습니다.";
  }
}

/** 읽기 쪽 fs 오류 → 짧은 사유. 쓰기와 같은 규칙(**message 는 쓰지 않는다**), 낱말만 「읽기」다. */
export function shareFolderReadFailureReason(error: unknown): string {
  switch (shareFolderErrorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더를 읽을 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더의 폴더를 찾을 수 없습니다(찾는 중 옮겨졌거나 연결이 끊겼을 수 있습니다).";
    case "ENAMETOOLONG":
      return "폴더 경로가 너무 깁니다.";
    case "EIO":
    case "ETIMEDOUT":
    case "EHOSTDOWN":
    case "EHOSTUNREACH":
    case "ENETUNREACH":
    case "ECONNRESET":
      return "공유폴더에 연결할 수 없습니다(네트워크 · NAS 상태를 확인하세요).";
    default:
      return "공유폴더를 읽지 못했습니다.";
  }
}
