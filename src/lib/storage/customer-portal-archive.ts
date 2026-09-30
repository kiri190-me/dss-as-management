import "server-only";

import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import {
  matchesPortalExportPrefix,
  numberedPortalExportFileName,
  parsePortalExportFileName,
  pickLatestPortalExportFile,
  PORTAL_EXPORT_MAX_NUMBERED_COPIES,
  type CustomerPortalExportSpec,
  type ParsedPortalExportFileName,
  type PortalExportFolderEntry,
} from "@/lib/domain/customer-portal-export";

/**
 * ============================================================================
 * 「업체별 수리품현황」 공유폴더 — 직전 파일을 읽고, 오늘 이름으로 쓴다
 * ============================================================================
 * 폴더 하나뿐이다(연도 폴더 · 건별 폴더가 없다). 그 안에 고객사마다 파일 하나가
 * 있고 이름 끝이 만든 날짜다. 옛 판은 사람이 `OLD` 하위 폴더로 옮긴다 — 우리는
 * **맨 위 칸만** 본다(하위 폴더로 내려가지 않는다).
 *
 * ── 견적서 공유폴더(storage/quote-archive.ts)와 무엇이 같고 다른가 ────────
 * 같은 것: 루트를 만들지 않는다 · 같은 내용이면 새로 쓰지 않는다 · 던지지 않고
 * `{ status: "failed", reason }` 으로 돌아간다 · 사유에 경로와 설정값을 담지 않는다.
 * 다른 것: **설정이 따로다**(`CUSTOMER_PORTAL_ARCHIVE_DIR`) · 🔴 **덮어쓴다**(아래).
 * 견적서 쪽은 지금까지 그대로 ` (2)` 로 넘어간다 — 그 코드는 한 글자도 건드리지 않는다.
 *
 * ── 🔴 같은 이름이 있으면 덮어쓴다 (사용자 결정 2026-09-30) ────────────────
 * 같은 날 두 번 내보내면 이름이 겹친다. 예전에는 ` (2)`, ` (3)` … 으로 넘어갔는데,
 * 사람이 「같은 제목의 엑셀이 있다면 덮어씌워 달라」고 정했다 — 그 고객사의 오늘 파일은
 * **하나**여야 한다.
 * 🔴 덮어쓰면 사람이 그 파일을 손으로 고쳐 둔 내용이 사라진다. 그래서 돌려주는 값이
 * 「새로 만듦(`saved`)」과 「덮어씀(`replaced`)」을 **가른다** — 화면이 그 둘을 다른
 * 문장으로 말한다(actions/customer-portal-export.ts). 조용히 덮어쓰지 않는다.
 * 다만 **바이트가 똑같으면** 손대지 않고 그 파일을 가리킨다(`unchanged`) — 미리보기
 * 뒤 저장을 두 번 눌러도 수정 시각만 흔들리지 않게.
 * 이미 만들어져 있는 옛 ` (2)` 파일은 **그대로 둔다**(지우지 않는다). 그 파일도 다음 날
 * 직전 파일 후보로 그대로 뽑힌다(domain 의 parsePortalExportFileName 이 번호까지 읽는다).
 *
 * ── 🔴 반쯤 쓰인 파일이 제 이름을 얻지 않게 ───────────────────────────────
 * 덮어쓰기는 **바꿔치기**다: 같은 폴더의 임시 이름(`~$…tmp`)에 다 쓴 뒤 `rename` 으로
 * 제 이름에 밀어 넣는다. 쓰다가 끊기면(공간 부족 · 연결 끊김) 임시 파일만 지우고 끝나므로
 * **있던 파일은 한 글자도 바뀌지 않는다.** 예전처럼 제 이름으로 바로 열어 쓰면 그 순간
 * 파일이 비워지고, 거기서 끊기면 고객사에 보낼 현황표가 반쪽으로 남는다.
 * 임시 이름을 `~$` 로 시작하고 끝을 `.xlsx` 가 아니게 두는 까닭: 어쩌다 남더라도 직전 파일
 * 고르기가 그것을 보지 않는다(parsePortalExportFileName 이 `~$` 와 다른 확장자를 버린다).
 *
 * ── 🔴 저장한 **뒤에** 날짜가 다른 옛 파일을 `OLD` 로 옮긴다 (사용자 요청 2026-09-30) ──
 * 지금까지 사람이 손으로 하던 일이다. 옮기는 것은 «그 고객사의 · 방금 저장한 파일과 날짜가
 * 다른 · 이름 규칙에 맞는» 맨 위 칸의 파일뿐이다. 사람이 만든 `임시본.xlsx` 도, 다른 고객사의
 * 파일도, 하위 폴더도 건드리지 않는다.
 * 🔴 **차례가 안전의 전부다.** 옮기기는 `savePortalExportFile` **안에서**, 저장이 끝난 뒤에만
 * 돈다 — 먼저 옮기면 바탕으로 삼을 직전 파일이 사라지고, 저장이 실패한 뒤에 옮기면 새 파일도
 * 없이 폴더가 비어 버린다. 저장이 던지면 이 줄까지 오지 않는다.
 * 🔴 **옮기기가 실패해도 저장은 살아 있다.** 옮기는 쪽은 던지지 않고 못 옮긴 이름을 모아
 * 돌려준다(`archived.failedFileNames`) — 화면이 「손으로 옮겨 주세요」라고 말하고 끝낸다.
 * 사람이 손으로 옮기면 되는 일 때문에 다 된 저장을 되돌리지 않는다.
 * 🔴 옮기는 방법은 **`rename` 하나뿐이다**(같은 볼륨 안이라 한 걸음이다). 복사 후 삭제는
 * 쓰지 않는다 — 복사가 반만 되고 원본을 지우면 그 날치가 사라진다. 그래서 이 파일에서
 * `unlink` 가 닿는 것은 **우리가 방금 만든 임시 파일 · 빈 자리표**뿐이다.
 * 🔴 `OLD` 에 같은 이름이 있으면 **덮어쓰지 않고** ` (2)`, ` (3)` … 으로 비켜 간다. `OLD` 는
 * 지난 기록을 쌓아 두는 곳이라 덮어쓰면 그 날치가 없어진다. 자리는 `wx` 로 빈 파일을 만들어
 * **잡아 둔 뒤** 그 위로 밀어 넣는다 — 「비었는지 보고 나서 쓴다」 사이의 틈으로 남의 기록을
 * 덮는 일이 없게. `OLD` 안의 이름은 직전 파일 고르기가 보지 않으므로 번호가 다른 뜻을 얻지 않는다.
 * ============================================================================
 */

/** 파일 하나를 읽어 들이는 상한 — 실측 파일은 171KB 다. 폭주 방지다. */
export const PORTAL_EXPORT_MAX_FILE_BYTES = 32 * 1024 * 1024;

/**
 * 공유폴더 루트. `CUSTOMER_PORTAL_ARCHIVE_DIR` 을 **부르는 시점에** 읽는다.
 * 비었거나 공백이면 null(= 이 기능이 꺼져 있다). 값 자체는 로그로 찍지 않는다.
 */
export function resolveCustomerPortalArchiveRoot(): string | null {
  const configured = process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

class PortalArchiveFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "PortalArchiveFailure";
  }
}

export type PortalArchiveLatestFile =
  | { status: "found"; fileName: string; parsed: ParsedPortalExportFileName; bytes: Buffer }
  /** 🔴 이름 규칙에 맞는 파일이 하나도 없다 — **만들지 않는다.** 사람에게 알린다. */
  | { status: "not-found" }
  | { status: "failed"; reason: string };

/**
 * 그 고객사의 **직전 파일**을 찾아 읽는다. 던지지 않는다.
 * 고르는 규칙과 근거는 domain/customer-portal-export.ts 의 pickLatestPortalExportFile.
 */
export async function findLatestPortalExportFile(input: {
  root: string;
  spec: CustomerPortalExportSpec;
}): Promise<PortalArchiveLatestFile> {
  try {
    const root = await requireExistingRoot(input.root);
    const entries = await listFolderEntries(root);
    const latest = pickLatestPortalExportFile(input.spec, entries);
    if (latest === null) return { status: "not-found" };

    const target = path.join(root, latest.entry.fileName);
    assertInsideRoot(root, target);
    const info = await stat(target);
    if (!info.isFile()) return { status: "not-found" };
    if (info.size > PORTAL_EXPORT_MAX_FILE_BYTES) {
      throw new PortalArchiveFailure("직전 파일이 너무 커서 읽지 않았습니다.");
    }
    return {
      status: "found",
      fileName: latest.entry.fileName,
      parsed: latest.parsed,
      bytes: await readFile(target),
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PortalArchiveFailure ? error.reason : reasonFromReadError(error),
    };
  }
}

/** 맨 위 칸의 **파일만**. 하위 폴더(`OLD`)와 링크는 보지 않는다. */
async function listFolderEntries(root: string): Promise<PortalExportFolderEntry[]> {
  const dirents = await readdir(root, { withFileTypes: true });
  const entries: PortalExportFolderEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    if (parsePortalExportFileName(dirent.name) === null) continue;
    let modifiedAtMs = 0;
    try {
      modifiedAtMs = (await stat(path.join(root, dirent.name))).mtimeMs;
    } catch {
      // 수정 시각을 못 읽어도 이름의 날짜로 고를 수 있다 — 곁가지 기준일 뿐이다.
    }
    entries.push({ fileName: dirent.name, modifiedAtMs });
  }
  return entries;
}

/** 옛 판을 쌓아 두는 하위 폴더 이름. 직전 파일 고르기는 이 안을 보지 않는다. */
export const PORTAL_EXPORT_OLD_FOLDER_NAME = "OLD";

/** 저장한 뒤 옛 파일을 `OLD` 로 치운 결과. 저장의 성패와는 **무관하다**(머리말). */
export type PortalArchiveMoveOutcome = {
  /** `OLD` 로 옮긴 파일 수. 0 이면 화면이 아무 말도 하지 않는다. */
  movedCount: number;
  /** 🔴 옮기지 못한 파일 이름 — 저장은 끝났고, 이것만 사람이 손으로 옮기면 된다. */
  failedFileNames: string[];
};

/** 「하나도 안 옮겼다」 — 부를 때마다 **새로 만든다**(같은 배열을 여럿이 나눠 쥐지 않게). */
const nothingMoved = (): PortalArchiveMoveOutcome => ({ movedCount: 0, failedFileNames: [] });

export type PortalArchiveSaveResult =
  /** 그 이름의 파일이 없어 **새로 만들었다.** */
  | { status: "saved"; fileName: string; archived: PortalArchiveMoveOutcome }
  /** 🔴 같은 이름의 파일이 있어 **덮어썼다.** 사람이 손으로 고쳐 둔 내용은 사라졌다. */
  | { status: "replaced"; fileName: string; archived: PortalArchiveMoveOutcome }
  /** 같은 바이트의 파일이 이미 있어 손대지 않았다. */
  | { status: "unchanged"; fileName: string; archived: PortalArchiveMoveOutcome }
  /** 🔴 저장하지 못했다 — **아무것도 옮기지 않았다.** */
  | { status: "failed"; reason: string };

/**
 * 만든 파일을 **오늘 이름으로** 저장하고, 그 뒤에 날짜가 다른 옛 파일을 `OLD` 로 치운다.
 * 던지지 않는다. 같은 이름이 있으면 덮어쓰고, 그 사실을 `replaced` 로 알린다(머리말).
 *
 * 🔴 `spec` 을 받는 까닭: 옮길 파일을 **그 고객사의 것으로만** 가리기 위해서다. 한 폴더에
 * 세 고객사의 파일이 함께 있어, 주성을 저장하면서 ICD 파일을 치우면 안 된다.
 */
export async function savePortalExportFile(input: {
  root: string;
  spec: CustomerPortalExportSpec;
  fileName: string;
  bytes: Uint8Array;
}): Promise<PortalArchiveSaveResult> {
  try {
    const root = await requireExistingRoot(input.root);
    if (parsePortalExportFileName(input.fileName) === null) {
      throw new PortalArchiveFailure("저장할 파일 이름을 만들지 못했습니다.");
    }

    const existing = await inspectTarget(root, input.fileName, input.bytes);
    if (existing !== "same") await replaceThroughTemporaryFile(root, input.fileName, input.bytes);

    // 🔴 여기부터는 **저장이 끝난 뒤**다. 위에서 던졌으면 이 줄에 오지 않는다 — 저장하지
    //    못했는데 옛 파일을 치워 폴더를 비우는 일이 없다.
    const archived = await moveOutdatedFilesToOldFolder({
      root,
      spec: input.spec,
      keepFileName: input.fileName,
    });
    const status = existing === "same" ? "unchanged" : existing === "absent" ? "saved" : "replaced";
    return { status, fileName: input.fileName, archived };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof PortalArchiveFailure ? error.reason : reasonFromWriteError(error),
    };
  }
}

/**
 * 그 이름의 자리에 지금 무엇이 있는가 — 없는가(`absent`) · 같은 바이트인가(`same`) ·
 * 다른 것이 있는가(`different`).
 *
 * 크기가 같을 때만 읽어 맞춘다. **읽지 못하면**(엑셀이 열어 둔 파일 · 권한) 「다르다」로 친다 —
 * 덮어쓰는 쪽으로 틀린다. 지금 만든 것이 정본이기 때문이다.
 * 🔴 다만 stat 자체가 권한 · 연결 문제로 막히면 **던진다.** 자리에 무엇이 있는지도 모르는 채
 * 밀어붙이면 「새로 만들었습니다」라고 거짓말하면서 남의 파일을 지울 수 있다.
 */
async function inspectTarget(
  root: string,
  fileName: string,
  bytes: Uint8Array
): Promise<"absent" | "same" | "different"> {
  const target = path.join(root, fileName);
  assertInsideRoot(root, target);

  let info;
  try {
    info = await stat(target);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") return "absent";
    throw error;
  }

  // 파일이 아니면(같은 이름의 폴더가 자리를 차지하고 있다) 바꿔치기가 거절한다 — 여기서
  // 「다르다」로 두고 rename 이 울게 한다. 폴더를 지우는 일은 하지 않는다.
  if (!info.isFile() || info.size !== bytes.byteLength) return "different";
  try {
    return (await readFile(target)).equals(Buffer.from(bytes)) ? "same" : "different";
  } catch {
    return "different";
  }
}

/**
 * 같은 폴더의 임시 이름에 다 쓴 뒤 `rename` 으로 제 이름에 밀어 넣는다(머리말 「반쯤 쓰인
 * 파일이 제 이름을 얻지 않게」). 같은 폴더라 바꿔치기가 한 걸음이다 — 다른 디스크로 옮기면
 * 그 자체가 복사가 되어 뜻이 사라진다.
 *
 * 어디서 실패하든 **임시 파일만 지우고** 던진다. 있던 파일은 손대지 않았으므로 그대로 남는다.
 */
async function replaceThroughTemporaryFile(root: string, fileName: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(root, fileName);
  assertInsideRoot(root, target);
  // 이름이 겹치지 않게 UUID 로 — 두 사람이 같은 순간에 저장해도 서로의 임시 파일을 밟지 않는다.
  const temporary = path.join(root, `~$dss-portal-${randomUUID()}.tmp`);
  assertInsideRoot(root, temporary);

  // `wx` — 있으면 실패한다(우리가 만든 이름이 아니면 건드리지 않는다).
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(bytes);
    // 디스크에 밀어 넣은 뒤 바꿔치기한다. 못 해도(공유폴더가 받지 않는 경우가 있다) 그냥 간다 —
    // 여기서 던지면 다 쓴 파일을 버리게 된다.
    await handle.sync().catch(() => undefined);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

// ── 🔴 옛 파일을 `OLD` 로 치운다 ──────────────────────────────────────────

/**
 * ============================================================================
 * 🔴 «그 고객사의 · 날짜가 다른 · 이름 규칙에 맞는» 맨 위 칸의 파일만 옮긴다
 * ============================================================================
 * 세 가지를 **모두** 만족해야 옮긴다 — 하나라도 어긋나면 그대로 둔다:
 *   ① `matchesPortalExportPrefix` — 그 고객사의 파일인가. 한 폴더에 세 고객사가 산다.
 *   ② `parsePortalExportFileName` — `…_YYMMDD.xlsx` 모양인가. 사람이 만든 `임시본.xlsx`,
 *      `사본.xlsx`, 메모, 남은 임시 파일(`~$…`)은 여기서 전부 떨어진다.
 *   ③ 날짜가 **방금 저장한 파일과 다른가.** 같은 날짜는 ` (2)` 가 붙어 있어도 남긴다 —
 *      오늘치 기록이고, 그중 무엇이 정본인지는 우리가 정할 일이 아니다.
 * 하위 폴더는 `isFile()` 에서 떨어진다(`OLD` 안을 다시 뒤지지 않는다).
 *
 * 🔴 **던지지 않는다.** 여기서 던지면 다 끝난 저장이 「실패」로 뒤집힌다.
 * ============================================================================
 */
async function moveOutdatedFilesToOldFolder(input: {
  root: string;
  spec: CustomerPortalExportSpec;
  /** 방금 저장한 파일 이름. 이 이름 · 이 **날짜**의 파일은 남긴다. */
  keepFileName: string;
}): Promise<PortalArchiveMoveOutcome> {
  const keep = parsePortalExportFileName(input.keepFileName);
  if (keep === null) return nothingMoved();

  let dirents: Dirent[];
  try {
    dirents = await readdir(input.root, { withFileTypes: true });
  } catch {
    // 폴더를 다시 읽지 못했다(연결이 끊겼다). 저장은 이미 끝났으니 조용히 둔다 —
    // 옮길 파일이 무엇인지조차 모르므로 사람에게 댈 이름도 없다.
    return nothingMoved();
  }

  const outdated = dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name)
    .filter((fileName) => {
      // 방금 쓴 그 파일은 어떤 경우에도 옮기지 않는다(날짜 대조가 이미 막지만 못 박아 둔다).
      if (fileName === input.keepFileName) return false;
      if (!matchesPortalExportPrefix(input.spec, fileName)) return false;
      const parsed = parsePortalExportFileName(fileName);
      return parsed !== null && parsed.stamp !== keep.stamp;
    })
    .sort();
  // 옮길 것이 없으면 `OLD` 폴더를 만들지도 않는다 — 빈 폴더를 남기지 않는다.
  if (outdated.length === 0) return nothingMoved();

  let oldFolder: string;
  try {
    oldFolder = await requireOldFolder(input.root, dirents);
  } catch {
    // `OLD` 자리에 같은 이름의 **파일**이 있거나 만들 권한이 없다 — 하나도 옮기지 못했다.
    return { movedCount: 0, failedFileNames: outdated };
  }

  const failedFileNames: string[] = [];
  let movedCount = 0;
  for (const fileName of outdated) {
    try {
      await moveIntoOldFolder(input.root, oldFolder, fileName);
      movedCount += 1;
    } catch {
      // 엑셀이 열어 둔 파일 · 권한 · 읽는 사이에 없어진 파일. 이름만 모아 사람에게 넘긴다.
      failedFileNames.push(fileName);
    }
  }
  return { movedCount, failedFileNames };
}

/**
 * `OLD` 폴더를 찾거나 만든다.
 * 🔴 대소문자가 다른 폴더(`old` · `Old`)가 이미 있으면 **그것을 쓴다** — 리눅스(NAS)에서는
 * 이름이 다르면 다른 폴더라, 그냥 만들면 지난 기록이 두 곳으로 갈린다.
 */
async function requireOldFolder(root: string, dirents: readonly Dirent[]): Promise<string> {
  const existing = dirents.find(
    (dirent) =>
      dirent.isDirectory() &&
      dirent.name.toLowerCase() === PORTAL_EXPORT_OLD_FOLDER_NAME.toLowerCase()
  );
  const oldFolder = path.join(root, existing?.name ?? PORTAL_EXPORT_OLD_FOLDER_NAME);
  assertInsideRoot(root, oldFolder);
  if (existing !== undefined) return oldFolder;

  try {
    await mkdir(oldFolder);
  } catch (error) {
    // 그 사이에 누가 만들었으면 그대로 쓴다. **파일**이 자리를 차지하고 있으면 던진다.
    if (errorCode(error) !== "EEXIST") throw error;
    if (!(await stat(oldFolder)).isDirectory()) throw error;
  }
  return oldFolder;
}

/**
 * 파일 하나를 `OLD` 로 **옮긴다** — `rename` 한 걸음이다(같은 볼륨이라 복사가 일어나지 않는다).
 * 🔴 복사 후 삭제를 쓰지 않는다. 밀어 넣기가 막히면 원본은 있던 자리에 그대로 남는다.
 */
async function moveIntoOldFolder(root: string, oldFolder: string, fileName: string): Promise<void> {
  const source = path.join(root, fileName);
  assertInsideRoot(root, source);

  const destination = await reserveOldFileName(oldFolder, fileName);
  try {
    await rename(source, destination);
  } catch (error) {
    // 🔴 지우는 것은 **방금 만든 빈 자리표**뿐이다 — 옮기려던 원본도, `OLD` 에 쌓인 지난
    //    기록도 지우지 않는다. 자리표를 두고 가면 다음번에 ` (2)` 로 밀린다.
    await unlink(destination).catch(() => undefined);
    throw error;
  }
}

/**
 * `OLD` 안에서 아직 비어 있는 이름을 **잡아 둔다** — `wx`(있으면 실패)로 빈 파일을 만들어
 * 자리를 맡고 그 위로 밀어 넣는다. 「비었는지 보고 나서 쓴다」 사이의 틈으로 지난 기록을
 * 덮는 일이 없다. 같은 이름이 있으면 ` (2)`, ` (3)` … 으로 비켜 간다(덮어쓰지 않는다).
 */
async function reserveOldFileName(oldFolder: string, fileName: string): Promise<string> {
  for (let copyNumber = 1; copyNumber <= PORTAL_EXPORT_MAX_NUMBERED_COPIES; copyNumber += 1) {
    const candidate = path.join(oldFolder, numberedPortalExportFileName(fileName, copyNumber));
    assertInsideRoot(oldFolder, candidate);
    let handle;
    try {
      handle = await open(candidate, "wx");
    } catch (error) {
      if (errorCode(error) === "EEXIST") continue;
      throw error;
    }
    await handle.close();
    return candidate;
  }
  throw new PortalArchiveFailure("OLD 폴더에 같은 이름의 파일이 너무 많습니다.");
}

/** 루트는 이미 있는 폴더여야 한다 — 없으면 만들지 않고 실패한다. */
async function requireExistingRoot(rawRoot: string): Promise<string> {
  if (typeof rawRoot !== "string" || rawRoot.trim().length === 0) {
    throw new PortalArchiveFailure("공유폴더 위치가 설정되지 않았습니다.");
  }
  const root = path.resolve(rawRoot.trim());
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new PortalArchiveFailure("공유폴더에 접근할 권한이 없습니다.");
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new PortalArchiveFailure("공유폴더를 찾을 수 없습니다(연결이 끊겼을 수 있습니다).");
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new PortalArchiveFailure("공유폴더를 찾을 수 없습니다(폴더가 아닙니다).");
  }
  return root;
}

/** 이은 경로가 루트 밖이면 거절한다. 이름을 다듬으므로 일어나지 않아야 하는 방어다. */
function assertInsideRoot(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PortalArchiveFailure("저장 위치가 공유폴더 밖을 가리켜 저장하지 않았습니다.");
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 🔴 오류의 message 는 쓰지 않는다 — 경로가 들어 있다. 코드만 보고 짧은 문장으로. */
function reasonFromReadError(error: unknown): string {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더를 읽을 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더의 파일을 찾을 수 없습니다(읽는 중 옮겨졌을 수 있습니다).";
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

function reasonFromWriteError(error: unknown): string {
  switch (errorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "공유폴더에 쓸 권한이 없습니다.";
    case "ENOENT":
    case "ENOTDIR":
      return "공유폴더를 찾을 수 없습니다(저장 중 옮겨졌거나 연결이 끊겼을 수 있습니다).";
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
