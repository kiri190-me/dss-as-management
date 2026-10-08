import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  MAX_ATTACHMENT_SIZE_BYTES,
  isExecutableExtension,
  normalizeFileExtension,
} from "@/lib/domain/attachment-allowlist";
import { checkQuoteFolderRelativePath } from "@/lib/domain/quote-folder-link";
import { findRepairDocsEntry } from "./repair-docs-entries";
import {
  ShareFolderFailure,
  ShareFolderTimeout,
  assertInsideShareFolderRoot,
  shareFolderReadFailureReason,
  withShareFolderTimeout,
} from "./share-folder-fs";

/**
 * ============================================================================
 * 사내 「수리 관련」 서류 공유폴더 — 서버가 **읽을** 루트 (2026-10-07)
 * ============================================================================
 * 제품 종류마다 **같은 서류를 돌려 쓰는** 곳이다 — 인수시 체크시트 · 작업 수순과 자료 ·
 * 통전 체크시트처럼, 모델 한 대가 아니라 **제품 종류 전체**가 쓰는 서류가 모여 있다.
 * 앞으로 제품 모델 화면이 이 서류들을 **올리지 않고 자리만 가리킨다**(사용자 결정
 * 2026-10-07) — 올리면 같은 파일이 모델 수만큼 복사되고, 사내에서 원본을 고쳐도 앱에
 * 담긴 사본은 그대로 남는다.
 *
 * ── 🔴 설정이 **쌍**인 까닭 ───────────────────────────────────────────────
 * 자리 하나에 설정이 둘이고, **값이 서로 다르다**(이웃 셋과 같은 모양이다):
 *  · `REPAIR_DOCS_ARCHIVE_DIR`      — 🔴 **서버가 읽을** 경로. 운영에서는 컨테이너에
 *    연결(마운트)한 공유폴더의 **컨테이너 안** 경로다. 이 파일이 쓰는 값이다.
 *  · `REPAIR_DOCS_ARCHIVE_UNC_ROOT` — 사람 PC 의 탐색기가 보는 주소(UNC). 폴더 열기
 *    도우미의 **설치본에만** 심긴다(server/quote-folder-helper.ts). 이 파일은 안 읽는다.
 * 둘을 섞어 적으면 한쪽은 조용히 꺼지고 다른 쪽은 열리지 않는다.
 *
 * ── 비면 조용히 꺼진다 ───────────────────────────────────────────────────
 * 비었거나 공백이면 null 이다 — 그 기능만 꺼지고 나머지 화면은 그대로 돈다
 * (`resolveQuoteArchiveRoot` · `resolveContactFolderArchiveRoot` 와 같은 약속).
 * 🔴 루트를 **만들지 않는다.** 연결이 빠진 채 만들면 컨테이너 안 임시 디스크를 보고
 * 「없습니다」라고 거짓말하게 된다 — 폴더를 실제로 여는 쪽(다음 조각)이 그 자리에서
 * 있는지 본다.
 *
 * ── 🔴 읽기만 한다 ──────────────────────────────────────────────────────
 * 사람이 수년째 손으로 쌓아 온 서류함이다. 이 갈래에는 쓰기 · 만들기 · 지우기가 **한
 * 글자도 없다** — 지금도, 앞으로도 그렇다면 그 사실을 여기 적어 둔다. 🔴 운영에서는
 * 이 볼륨이 **읽기 전용으로** 붙어 있다(2026-10-08) — `mkdir` · `writeFile` · `rm` ·
 * `rename` 은 애초에 성공할 수도 없다.
 * ============================================================================
 */

/**
 * 「수리 관련」 서류 공유폴더 루트. `REPAIR_DOCS_ARCHIVE_DIR` 을 **부르는 시점에** 읽는다 —
 * 모듈을 불러오는 것만으로 값이 굳지 않게. 비었거나 공백이면 null(= 이 기능만 꺼져 있다).
 *
 * 값 자체를 로그로 찍지 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolveRepairDocsArchiveRoot(): string | null {
  const configured = process.env.REPAIR_DOCS_ARCHIVE_DIR;
  if (!configured || configured.trim().length === 0) return null;
  return path.resolve(configured.trim());
}

/**
 * ============================================================================
 * 🔴 **가리킨 서류의 바이트를 읽는다** — 「이 건 폴더로 가져오기」 하나를 위해 (2026-10-08)
 * ============================================================================
 * 수리 건 상세 「파일 관리」의 두 구역(그 종류의 공통 서류 · 이 제품 모델 전용 서류)에서
 * 사람이 [연락서 폴더에 저장]을 누르면, 서버가 그 파일을 읽어 **그 건의 연락서 폴더
 * `공통` 에 곧바로 꽂는다**(copyIntoContactFolderCommonFolder — 접수 자동 복사가 쓰는
 * 바로 그 함수다. 이 길은 그 흐름을 **나중에 손으로도** 하게 하는 것이라 자리가 같다).
 *
 * ── 🔴 왜 여기에 `readFile` 이 생겼는가 ─────────────────────────────────
 * 이웃 모듈(repair-docs-entries.ts)은 「파일을 여는 일은 그 PC 의 도우미가 한다. 그래서
 * `readFile` · 스트림이 여기 없다」고 적어 두었다. 그 규율을 **한 칸만** 넓힌다:
 *
 *  · 🔴 **브라우저로 바이트를 내보내지 않는다.** 서버가 읽어서 **곧바로 다른 폴더에
 *    쓸** 뿐이고, 읽은 바이트가 우리 출처(same-origin)로 흐르는 길은 이 모듈에도
 *    이 모듈을 부르는 통로에도 **없다** — 내려받기 · 미리보기 · 스트림 갈래를 만들지
 *    않았다. 응답으로 나가는 것은 꽂은 결과(상태 · 파일 이름)뿐이다.
 *  · 그래서 「공유폴더 파일이 첨부 통로의 방어선 밖에 있다」는 걱정이 여기서는
 *    성립하지 않는다 — 그 파일은 **사람에게 가지 않는다.** 사내 폴더에서 사내
 *    폴더로 옮겨 갈 뿐이다.
 *
 * ── 🔴 그래도 두 문턱을 둔다 ────────────────────────────────────────────
 *  · **크기** — 첨부와 **같은 상한**(MAX_ATTACHMENT_SIZE_BYTES, 20MB)이다. 읽으면
 *    통째로 메모리에 올라오므로 상한이 없으면 서류함의 큰 파일 하나가 서버를 넘어뜨린다.
 *    🔴 **읽기 전에 `stat` 으로 먼저 잰다** — 올리고 나서 거절하면 상한이 없는 것과 같다.
 *  · **실행 파일** — 「1. 수리 관련」에는 아무 형식이나 있고 우리가 검사한 적이 없는
 *    폴더다. `isExecutableExtension` 으로 거절한다(사내 서류함에 실행 파일을 퍼뜨리는
 *    길이 되면 안 된다). 🔵 `.xlsm` 은 2026-10-08 부터 그 목록 밖이라 통과한다.
 *
 * ── 🔴 경로 규칙을 **읽는 쪽에서 다시 본다** ────────────────────────────
 * 화면이 보낸 경로를 믿지 않는다(주소는 아무 웹페이지나 만들 수 있다). 검사는 목록
 * 통로가 쓰는 것을 **그대로 부른다 — 베끼지 않는다**:
 *  · `checkQuoteFolderRelativePath` (domain/quote-folder-link.ts) — 빈 마디 · `.` ·
 *    `..` · 드라이브 문자 · UNC · 제어문자 · Windows 금지 글자 · 끝이 점 · 공백.
 *    디스크를 보기 **전에** 끝난다.
 *  · `findRepairDocsEntry` (repair-docs-entries.ts) — 마디마다 **그 자리에 보이는 폴더
 *    줄인가**를 보고 한 칸씩 내려간다. 바로가기(정션 · 심볼릭 링크)는 폴더로 치지
 *    않고, 한 칸마다 `assertInsideShareFolderRoot` 가 울타리를 본다. 깊이 상한도
 *    그쪽 것이다. 🔴 여기서 걷기를 다시 짜면 두 길이 갈라진다.
 *  · 이은 경로에 한 번 더 `assertInsideShareFolderRoot` — 세 겹째다.
 *
 * ── 🔴 던지지 않는다 · 사유에 경로가 한 글자도 없다 ─────────────────────
 * 모든 결과가 `{ status, … }` 다. 이 서류함의 폴더 이름에는 **고객사명이 섞여 있어**
 * 사유로 새 나가면 안 된다 — fs 오류의 `message` 도 쓰지 않고 **오류 코드만 보고**
 * 짧은 한국어로 바꾼다(이웃 모듈들과 같은 규율).
 * ============================================================================
 */

/** 읽을 수 있는 가장 큰 파일 — 🔴 첨부 상한과 **같은 값**이다(따로 적지 않는다). */
export const REPAIR_DOCS_FILE_MAX_BYTES = MAX_ATTACHMENT_SIZE_BYTES;

/**
 * 파일 하나를 읽는 데 이만큼 안에 답하지 않으면 그만둔다.
 *
 * 🔴 목록 읽기(3000)보다 길다 — 20MB 를 NAS 너머에서 끌어오는 일이라 왕복 한 번이 아니다.
 * 🔴 그래도 상한을 **두는** 까닭은 읽기에 **되돌릴 것이 없기** 때문이다(쓰기는 끊어도
 * 뒤에서 파일이 생겨 상한을 두지 않는다 — contact-folder-archive.ts 의 판단). 끊어도
 * 남는 것이 없으니 요청 워커를 돌려보내는 편이 낫다.
 */
export const REPAIR_DOCS_FILE_READ_TIMEOUT_MS = 15000;

/** 🔴 사유에는 경로가 한 글자도 들어가지 않는다 — 폴더 이름에 고객사명이 섞여 있다. */
const INVALID_PATH_REASON = "가리킨 자리가 올바르지 않습니다.";
const NOT_FOUND_REASON = "가리킨 자리에서 파일을 찾을 수 없습니다(옮겨졌거나 이름이 바뀌었을 수 있습니다).";
const NOT_A_FILE_REASON = "가리킨 자리가 파일이 아닙니다 — 폴더는 통째로 가져오지 않습니다.";
const EXECUTABLE_REASON = "실행 파일은 연락서 폴더에 넣을 수 없습니다.";
const TOO_LARGE_REASON = `파일이 ${Math.floor(REPAIR_DOCS_FILE_MAX_BYTES / (1024 * 1024))}MB 를 넘어 넣지 않았습니다.`;
const OUTSIDE_ROOT_REASON = "읽으려는 자리가 공유폴더 밖을 가리켜 읽지 않았습니다.";
const SLOW_REASON = "공유폴더가 느려 파일을 읽지 못했습니다(잠시 뒤 다시 시도하세요).";

/**
 * 거절한 까닭의 **갈래**. 통로가 이것을 보고 HTTP 상태를 고른다 — 사유 글귀로 갈라
 * 보지 않게(글귀가 바뀌면 조용히 틀린다).
 */
export type RepairDocsFileRejection =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "NOT_A_FILE"
  | "EXECUTABLE"
  | "TOO_LARGE";

export type RepairDocsFileRead =
  /** 읽었다. `fileName` 은 **마디 하나**(꽂을 때 이름의 바탕이 된다). */
  | { status: "read"; fileName: string; bytes: Uint8Array }
  /** 설정이 비었다 — 이 기능만 꺼져 있다. 실패가 아니다. */
  | { status: "disabled" }
  /** 🔴 **읽지 않기로 한 것**이다 — 규칙 밖 · 없음 · 폴더 · 실행 파일 · 상한 초과. */
  | { status: "rejected"; rejection: RepairDocsFileRejection; reason: string }
  /** 읽으려다 막혔다(권한 · 연결 · 느림) — 다시 눌러 볼 만한 일이다. */
  | { status: "failed"; reason: string };

export type ReadRepairDocsFileInput = {
  /** 🔴 공유폴더 루트 **기준 상대 경로**(마디 구분 `/`). 화면이 보낸 값이라 다시 본다. */
  relativePath: string;
  /** 루트. 주지 않으면 설정을 읽는다. 시험에서는 임시 폴더를 준다. */
  root?: string | null;
  /** 크기 상한. 시험에서만 바꾼다. */
  maxBytes?: number;
  /** 기다리기 상한. 시험에서만 바꾼다. */
  timeoutMs?: number;
};

/**
 * 「수리 관련」 서류함의 파일 하나를 읽는다. **던지지 않는다.**
 *
 * 🔴 차례가 곧 안전장치다 — **디스크를 보기 전에** 경로 규칙과 실행 파일을 먼저 거르고,
 * **바이트를 올리기 전에** 크기를 먼저 잰다.
 */
export async function readRepairDocsFile(input: ReadRepairDocsFileInput): Promise<RepairDocsFileRead> {
  const configured =
    input.root === undefined || input.root === null ? resolveRepairDocsArchiveRoot() : input.root;
  if (configured === null || configured.trim().length === 0) {
    return { status: "disabled" };
  }

  // ── 1) 경로 규칙 — 🔴 목록 통로가 쓰는 바로 그 검사다(베끼지 않는다) ────
  if (checkQuoteFolderRelativePath(input.relativePath) !== null) {
    return { status: "rejected", rejection: "INVALID_PATH", reason: INVALID_PATH_REASON };
  }
  // 여기까지 왔으면 마디가 비지 않았고 구분자도 `/` 하나뿐이다(위 검사가 본다).
  const segments = input.relativePath.split("/");
  const fileName = segments[segments.length - 1];

  // ── 2) 실행 파일 — 🔴 디스크를 보기 전에 끝낸다 ────────────────────────
  const extension = normalizeFileExtension(fileName);
  if (extension !== null && isExecutableExtension(extension)) {
    return { status: "rejected", rejection: "EXECUTABLE", reason: EXECUTABLE_REASON };
  }

  // ── 3) 그 자리에 **무엇이** 서 있는가 — 목록 통로와 **같은 걷기** ───────
  const found = await findRepairDocsEntry({ root: configured, relativePath: input.relativePath });
  if (found.status === "failed") return { status: "failed", reason: found.reason };
  if (found.status === "not-found") {
    // 바로가기(정션 · 심볼릭 링크) · 숨은 이름 · 없는 이름이 전부 여기로 모인다.
    return { status: "rejected", rejection: "NOT_FOUND", reason: NOT_FOUND_REASON };
  }
  if (found.isDirectory) {
    return { status: "rejected", rejection: "NOT_A_FILE", reason: NOT_A_FILE_REASON };
  }

  const maxBytes =
    typeof input.maxBytes === "number" && Number.isFinite(input.maxBytes) && input.maxBytes > 0
      ? Math.floor(input.maxBytes)
      : REPAIR_DOCS_FILE_MAX_BYTES;
  const timeoutMs = typeof input.timeoutMs === "number" ? input.timeoutMs : REPAIR_DOCS_FILE_READ_TIMEOUT_MS;

  try {
    return await withShareFolderTimeout(readOne(configured, segments, fileName, maxBytes), timeoutMs);
  } catch (error) {
    if (error instanceof ShareFolderTimeout) {
      return { status: "failed", reason: SLOW_REASON };
    }
    return {
      status: "failed",
      reason: error instanceof ShareFolderFailure ? error.reason : shareFolderReadFailureReason(error),
    };
  }
}

/**
 * 🔴 **재고 먼저, 읽기는 그 다음.** `stat` 으로 크기를 보고 상한을 넘으면 `readFile` 에
 * 닿지 않는다 — 넘겨 읽고 나서 버리면 메모리는 이미 다 쓴 뒤다.
 *
 * 이은 경로에 울타리를 한 번 더 본다(세 겹째 — 머리말).
 */
async function readOne(
  rawRoot: string,
  segments: readonly string[],
  fileName: string,
  maxBytes: number
): Promise<RepairDocsFileRead> {
  const root = path.resolve(rawRoot.trim());
  const target = path.join(root, ...segments);
  assertInsideShareFolderRoot(root, target, OUTSIDE_ROOT_REASON);

  const info = await stat(target);
  // 걷는 동안 바뀌었을 수 있다 — 폴더면 여기서도 막는다(위 판정과 같은 사유).
  if (!info.isFile()) {
    return { status: "rejected", rejection: "NOT_A_FILE", reason: NOT_A_FILE_REASON };
  }
  if (info.size > maxBytes) {
    return { status: "rejected", rejection: "TOO_LARGE", reason: TOO_LARGE_REASON };
  }

  // 🔴 여기서 읽은 바이트는 **다른 폴더에 쓰러** 갈 뿐이다 — 브라우저로 나가지 않는다.
  return { status: "read", fileName, bytes: await readFile(target) };
}
