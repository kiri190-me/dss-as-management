import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { CONTENT_SNIFF_BYTES } from "@/lib/domain/attachment-allowlist";
import { resolveAttachmentAbsolutePath } from "@/lib/domain/attachment-path";
import {
  AttachmentAlreadyStoredError,
  AttachmentNotStoredError,
  AttachmentTooLargeError,
  type StorageAdapter,
  type TempWriteResult,
  type WriteTempOptions,
} from "./storage-adapter";

/**
 * ============================================================================
 * 로컬 디스크 저장소 — 지금 유일한 StorageAdapter 구현
 * ============================================================================
 * 저장 루트는 환경변수 `UPLOADS_DIR` 하나다(개발 환경: C:\DSS-AS-DATA\uploads).
 * **이 값은 DB에 들어가지 않는다** — 행에는 루트 아래의 상대 경로만 적히므로,
 * NAS로 옮기는 일이 "파일을 복사하고 설정 한 줄을 바꾸는 일"이 된다
 * (schema/attachments.ts의 stored_path 주석).
 *
 * 값이 없으면 **던진다.** 조용히 기본값(예: ./uploads)으로 넘어가면 파일이
 * 어디로 갔는지 아무도 모르는 상태로 한동안 잘 돌아가다가, 배포 뒤에야
 * "그때 올린 파일이 없다"로 발견된다.
 *
 * ── 임시 자리는 루트 안에 둔다 ───────────────────────────────────────────
 * `<루트>/.tmp-uploads`. OS 임시 폴더를 쓰지 않는 이유는 commit이 **이름 바꾸기
 * 한 번**이어야 하기 때문이다 — 다른 볼륨(또는 다른 도커 마운트)에 있으면
 * rename이 EXDEV로 실패해 결국 복사가 되고, 그 복사 도중 프로세스가 죽으면
 * 최종 자리에 반쯤 쓰인 파일이 남는다. 같은 루트 안이면 같은 볼륨이라
 * rename이 원자적이다. (그래도 EXDEV 대비 복사 경로를 남겨 둔다 — 마운트
 * 구성은 운영에서 바뀔 수 있다.)
 *
 * 이름이 점으로 시작하므로 stored_path의 첫 마디(`repair-cases`)와 절대
 * 겹치지 않는다.
 * ============================================================================
 */

const TEMP_DIRECTORY_NAME = ".tmp-uploads";
const TEMP_FILE_SUFFIX = ".part";

/**
 * 저장 루트. 없으면 던진다 — 조용한 기본값을 두지 않는다.
 *
 * 값 자체를 로그로 찍지 않는다(보안 규칙: .env 내용은 출력하지 않는다).
 */
export function resolveUploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR;
  if (!configured || configured.trim().length === 0) {
    throw new Error(
      "UPLOADS_DIR이 설정되지 않았습니다. 첨부 파일 저장 루트를 .env.local에 지정해야 합니다."
    );
  }
  return path.resolve(configured.trim());
}

class LocalFileSystemStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  private get tempDirectory(): string {
    return path.join(this.root, TEMP_DIRECTORY_NAME);
  }

  private absolute(relPath: string): string {
    // 루트 밖을 가리키면 여기서 던진다. DB에서 읽은 값이라도 그대로 믿지 않는다.
    return resolveAttachmentAbsolutePath(this.root, relPath);
  }

  async writeTemp(
    stream: ReadableStream<Uint8Array>,
    options: WriteTempOptions
  ): Promise<TempWriteResult> {
    const headerBytes = options.headerBytes ?? CONTENT_SNIFF_BYTES;
    await mkdir(this.tempDirectory, { recursive: true });

    // 임시 이름도 소문자 UUID다 — 이 파일이 최종 자리로 옮겨지지는 않지만,
    // 대소문자 규칙을 저장소 전체에서 한 가지로 유지한다.
    const tempPath = path.join(this.tempDirectory, `${randomUUID().toLowerCase()}${TEMP_FILE_SUFFIX}`);
    const handle = await open(tempPath, "wx");

    const hash = createHash("sha256");
    const headerParts: Uint8Array[] = [];
    let headerLength = 0;
    let size = 0;

    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        size += value.byteLength;
        if (size > options.maxBytes) {
          // 더 읽지 않는다. 남은 바이트를 끝까지 받아 두고 나서 버리면
          // 상한을 두는 의미가 없다.
          await reader.cancel().catch(() => undefined);
          throw new AttachmentTooLargeError(options.maxBytes);
        }

        hash.update(value);

        if (headerLength < headerBytes) {
          // subarray가 아니라 slice — 스트림이 넘겨준 버퍼는 다음 조각에서
          // 재사용될 수 있어서, 뷰만 들고 있으면 내용이 뒤바뀐다.
          const part = value.slice(0, Math.min(value.byteLength, headerBytes - headerLength));
          headerParts.push(part);
          headerLength += part.byteLength;
        }

        // await로 한 조각씩 쓴다 — 이것이 백프레셔다. 큐에 쌓아 두면 파일
        // 전체가 결국 메모리에 올라간다.
        await handle.write(value);
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }

    await handle.close();

    const header = new Uint8Array(headerLength);
    let offset = 0;
    for (const part of headerParts) {
      header.set(part, offset);
      offset += part.byteLength;
    }

    return { tempPath, size, sha256: hash.digest("hex"), header };
  }

  async commit(tempPath: string, relPath: string): Promise<void> {
    const target = this.absolute(relPath);
    await mkdir(path.dirname(target), { recursive: true });

    if (await pathExists(target)) {
      // 첨부 ID가 매번 새 UUID라 정상적으로는 일어나지 않는다. 그래도
      // 덮어쓰기로 넘어가지 않는다 — 남의 파일을 조용히 지우는 것보다
      // 업로드 하나가 실패하는 편이 낫다.
      throw new AttachmentAlreadyStoredError(relPath);
    }

    try {
      await rename(tempPath, target);
    } catch (error) {
      if (!isCrossDeviceError(error)) throw error;
      // 임시 자리와 최종 자리가 다른 볼륨이 된 경우(마운트 구성 변경 등).
      await copyFile(tempPath, target);
      await unlink(tempPath).catch(() => undefined);
    }
  }

  async discard(tempPath: string): Promise<void> {
    await unlink(tempPath).catch(() => undefined);
  }

  async read(relPath: string): Promise<ReadableStream<Uint8Array>> {
    const target = this.absolute(relPath);
    if (!(await pathExists(target))) {
      throw new AttachmentNotStoredError(relPath);
    }
    return Readable.toWeb(createReadStream(target)) as ReadableStream<Uint8Array>;
  }

  async delete(relPath: string): Promise<void> {
    const target = this.absolute(relPath);
    await rm(target, { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    return pathExists(this.absolute(relPath));
  }

  async sweepTemp(olderThanMs: number): Promise<number> {
    let entries: string[];
    try {
      entries = await readdir(this.tempDirectory);
    } catch {
      // 임시 폴더가 아직 없다 = 치울 것이 없다.
      return 0;
    }

    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const entry of entries) {
      if (!entry.endsWith(TEMP_FILE_SUFFIX)) continue;
      const candidate = path.join(this.tempDirectory, entry);
      try {
        const info = await stat(candidate);
        if (!info.isFile() || info.mtimeMs > cutoff) continue;
        await unlink(candidate);
        removed += 1;
      } catch {
        // 다른 요청이 방금 치웠거나 접근할 수 없다 — 훑기가 실패로 끝나지는 않는다.
      }
    }
    return removed;
  }
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function isCrossDeviceError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EXDEV";
}

/**
 * 테스트가 임시 루트를 넘겨 쓸 수 있도록 열어 둔다. 업무 코드는
 * getAttachmentStorage()만 부른다.
 */
export function createLocalFileSystemStorageAdapter(root: string): StorageAdapter {
  return new LocalFileSystemStorageAdapter(path.resolve(root));
}

let cachedAdapter: { root: string; adapter: StorageAdapter } | null = null;

/**
 * 업무 코드가 쓰는 저장소. UPLOADS_DIR을 **부르는 시점에** 읽는다 — 모듈을
 * 불러오는 것만으로 던지면 값이 없는 환경에서는 빌드조차 되지 않는다.
 */
export function getAttachmentStorage(): StorageAdapter {
  const root = resolveUploadsRoot();
  if (cachedAdapter?.root !== root) {
    cachedAdapter = { root, adapter: createLocalFileSystemStorageAdapter(root) };
  }
  return cachedAdapter.adapter;
}
