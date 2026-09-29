import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { swapStoredFiles } from "./attachment-file-swap";
import { createLocalFileSystemStorageAdapter } from "./local-fs-adapter";
import type { StorageAdapter } from "./storage-adapter";

/**
 * ============================================================================
 * 🔴 원본과 썸네일이 **함께** 바뀐다 — 하나만 바뀌는 길이 없다
 * ============================================================================
 * 「화면에서 돌린 사진을 원본에 저장」이 이것 위에 서 있다. 원본만 바뀌면 목록은
 * 옛 방향으로 남아 사용자가 「저장이 안 됐다」고 여기고, 썸네일만 바뀌면 목록과
 * 크게 보기가 서로 다른 그림을 보여 준다. **그리고 원본은 덮어쓰는 것이라
 * 되돌릴 수 없다.**
 *
 * 그래서 이 시험은 말이 아니라 **바이트로** 확인한다 — 실제 임시 폴더를 루트로
 * 삼은 진짜 저장소 어댑터를 쓰고, 일부러 실패시킨 뒤 두 파일을 다시 읽어 옛
 * 내용이 그대로인지 본다.
 *
 * ⚠️ 시험은 임시 폴더에서만 돈다. 실기의 저장 루트(UPLOADS_DIR)를 건드리지 않는다 —
 * 어댑터를 `createLocalFileSystemStorageAdapter(임시폴더)` 로 직접 만든다.
 * ============================================================================
 */

const ORIGINAL_PATH = "repair-cases/case-1/att-1.jpg";
const PREVIEW_PATH = "repair-cases/case-1/att-1.preview.jpg";

const OLD_ORIGINAL = "옛 원본";
const OLD_PREVIEW = "옛 썸네일";
const NEW_ORIGINAL = "돌린 원본";
const NEW_PREVIEW = "돌린 썸네일";

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function makeStorage(): Promise<StorageAdapter> {
  const root = await mkdtemp(path.join(tmpdir(), "dss-swap-"));
  roots.push(root);
  return createLocalFileSystemStorageAdapter(root);
}

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** 임시 자리에 써 두고 손잡이를 돌려준다 — 라우트가 본문을 받아 두는 것과 같은 모양. */
async function stage(storage: StorageAdapter, text: string): Promise<string> {
  const written = await storage.writeTemp(streamOf(text), { maxBytes: 1024 * 1024 });
  return written.tempPath;
}

async function place(storage: StorageAdapter, relPath: string, text: string): Promise<void> {
  await storage.commit(await stage(storage, text), relPath);
}

async function readText(storage: StorageAdapter, relPath: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = (await storage.read(relPath)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

describe("기록까지 성공하면 둘 다 새것이다", () => {
  test("원본과 썸네일이 함께 바뀐다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);
    await place(storage, PREVIEW_PATH, OLD_PREVIEW);

    const result = await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => ({ ok: true, value: "적었다" }),
    });

    assert.deepEqual(result, { ok: true, value: "적었다" });
    assert.equal(await readText(storage, ORIGINAL_PATH), NEW_ORIGINAL);
    assert.equal(await readText(storage, PREVIEW_PATH), NEW_PREVIEW);
  });

  test("성공하면 치워 둔 옛 파일도 남기지 않는다 — 임시 폴더가 비어 있다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);
    await place(storage, PREVIEW_PATH, OLD_PREVIEW);

    await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => ({ ok: true, value: null }),
    });

    // 0ms 보다 오래된 임시 파일을 전부 걷는다 — 남은 것이 있으면 세어진다.
    assert.equal(await storage.sweepTemp(0), 0, "치워 둔 옛 파일이 임시 폴더에 남았다");
  });
});

describe("🔴 기록이 실패하면 둘 다 옛것으로 돌아온다", () => {
  test("원본도 썸네일도 바뀌지 않는다 — 반만 저장된 상태가 없다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);
    await place(storage, PREVIEW_PATH, OLD_PREVIEW);

    const result = await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => ({ ok: false, code: "CHANGED", message: "그 사이 바뀌었습니다." }),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "CHANGED");
    assert.equal(result.failure.rollbackFailed, false);
    assert.equal(await readText(storage, ORIGINAL_PATH), OLD_ORIGINAL, "🔴 원본이 덮어써졌다");
    assert.equal(await readText(storage, PREVIEW_PATH), OLD_PREVIEW, "🔴 썸네일만 바뀌었다");
  });

  test("기록이 던져도 마찬가지다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);
    await place(storage, PREVIEW_PATH, OLD_PREVIEW);

    const result = await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => {
        throw new Error("DB 가 끊겼다");
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "RECORD_FAILED");
    assert.equal(await readText(storage, ORIGINAL_PATH), OLD_ORIGINAL);
    assert.equal(await readText(storage, PREVIEW_PATH), OLD_PREVIEW);
  });
});

describe("🔴 둘째 파일을 놓다 실패해도 첫째가 되돌아온다", () => {
  test("원본만 바뀐 채 남지 않는다", async () => {
    const base = await makeStorage();
    await place(base, ORIGINAL_PATH, OLD_ORIGINAL);
    await place(base, PREVIEW_PATH, OLD_PREVIEW);

    // 두 번째 commit 에서만 깨지는 저장소 — 옛 파일을 되돌리는 commit 은 그대로
    // 통과해야 하므로, 새로 놓는 두 번만 세어 두 번째를 막는다.
    let placing = 0;
    const brokenStorage = {
      stash: (relPath: string) => base.stash(relPath),
      commit: async (tempPath: string, relPath: string) => {
        placing += 1;
        if (placing === 2) throw new Error("일부러 낸 저장소 실패");
        return base.commit(tempPath, relPath);
      },
      delete: (relPath: string) => base.delete(relPath),
      discard: (tempPath: string) => base.discard(tempPath),
    };

    const result = await swapStoredFiles(brokenStorage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(base, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(base, NEW_PREVIEW) },
      ],
      record: async () => {
        assert.fail("파일을 다 놓지 못했는데 기록까지 갔다");
      },
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "STORAGE_FAILED");
    assert.equal(result.failure.rollbackFailed, false);
    assert.equal(await readText(base, ORIGINAL_PATH), OLD_ORIGINAL, "🔴 원본만 바뀐 채 남았다");
    assert.equal(await readText(base, PREVIEW_PATH), OLD_PREVIEW);
  });
});

describe("옛 사진 — 썸네일이 아예 없던 자리", () => {
  test("성공하면 새로 생긴다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);
    assert.equal(await storage.exists(PREVIEW_PATH), false);

    const result = await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => ({ ok: true, value: null }),
    });

    assert.equal(result.ok, true);
    assert.equal(await readText(storage, PREVIEW_PATH), NEW_PREVIEW);
  });

  test("🔴 실패하면 없던 그대로다 — 원본은 옛것, 썸네일은 없음", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);

    const result = await swapStoredFiles(storage, {
      entries: [
        { relPath: ORIGINAL_PATH, tempPath: await stage(storage, NEW_ORIGINAL) },
        { relPath: PREVIEW_PATH, tempPath: await stage(storage, NEW_PREVIEW) },
      ],
      record: async () => ({ ok: false, code: "CASE_LOCKED", message: "잠긴 접수 건입니다." }),
    });

    assert.equal(result.ok, false);
    assert.equal(await readText(storage, ORIGINAL_PATH), OLD_ORIGINAL);
    assert.equal(await storage.exists(PREVIEW_PATH), false, "🔴 실패했는데 썸네일만 생겼다");
  });
});

describe("치워 두는 일 자체", () => {
  test("stash 는 그 자리를 비우고 손잡이를 준다 — commit 으로 되돌아온다", async () => {
    const storage = await makeStorage();
    await place(storage, ORIGINAL_PATH, OLD_ORIGINAL);

    const handle = await storage.stash(ORIGINAL_PATH);
    assert.ok(handle, "손잡이를 주지 않았다");
    assert.equal(await storage.exists(ORIGINAL_PATH), false, "치웠는데 자리에 남아 있다");

    await storage.commit(handle, ORIGINAL_PATH);
    assert.equal(await readText(storage, ORIGINAL_PATH), OLD_ORIGINAL);
  });

  test("없는 자리를 치우면 null 이다 — 되돌릴 것이 없다는 뜻이다", async () => {
    const storage = await makeStorage();
    assert.equal(await storage.stash(PREVIEW_PATH), null);
  });

  test("갈아 끼울 자리를 하나도 안 주면 던진다 — 조용히 성공으로 넘어가지 않는다", async () => {
    const storage = await makeStorage();
    await assert.rejects(
      () => swapStoredFiles(storage, { entries: [], record: async () => ({ ok: true, value: null }) }),
      TypeError
    );
  });
});
