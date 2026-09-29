import type { StorageAdapter } from "./storage-adapter";

/**
 * ============================================================================
 * 이미 있는 파일 여럿을 **함께** 갈아 끼운다 — 하나만 바뀌는 길을 없앤다
 * ============================================================================
 * 「화면에서 돌린 사진을 원본에 저장」이 이것을 필요로 한다. 돌린 사진은 파일이
 * **둘**이다 — 원본과 목록에 쓰는 썸네일. 원본만 돌리고 썸네일을 그대로 두면
 * 목록은 옛 방향으로 남고, 사용자는 「저장이 안 됐다」고 여긴다. 반대로 썸네일만
 * 바뀌면 크게 보기와 목록이 서로 다른 그림을 보여 준다.
 *
 * ── 🔴 지우고 놓지 않는다. 치웠다가 되돌린다 ─────────────────────────────
 * `delete` 뒤에 `commit` 을 하면 그 사이 무엇이 실패하는 순간 **원본이 영영
 * 사라진다.** 되돌릴 수 없는 손실이고, 화면은 그 사실을 알려 줄 방법도 없다.
 *
 * 그래서 옛 파일을 지우지 않고 임시 자리로 **물려 둔다**(storage.stash). 새
 * 파일을 놓다가, 또는 그 뒤 DB 기록이 실패하면 물려 둔 것을 같은 자리로
 * 되돌린다. 성공했을 때만 물려 둔 것을 버린다.
 *
 * ── 차례가 곧 안전이다 ───────────────────────────────────────────────────
 *   1) 옛 파일 전부를 치운다        (실패하면 여기까지 치운 것을 되돌린다)
 *   2) 새 파일 전부를 놓는다        (실패하면 놓은 것을 걷고 1) 을 되돌린다)
 *   3) DB 에 적는다(record)         (실패하면 2)·1) 을 그대로 되돌린다)
 *   4) 물려 둔 옛 파일을 버린다
 *
 * **파일이 먼저, 기록이 나중**이라는 이 저장소의 관행(업로드 라우트 4·5단계)을
 * 그대로 따르되, 기록이 실패하면 파일을 되돌릴 수 있게 한 것이 3) 이다.
 *
 * ── 남는 틈 ─────────────────────────────────────────────────────────────
 * 2) 안에서 파일 두 개를 놓는 사이에 **프로세스가 통째로 죽으면** 되돌릴 코드가
 * 돌지 못한다. 그때 옛 파일은 지워진 것이 아니라 임시 폴더에 남아 있고
 * (`.tmp-uploads`), 24시간 뒤 `sweepTemp` 가 걷기 전까지는 손으로 되살릴 수 있다.
 * 파일 시스템 위에서 여러 파일을 한 번에 바꾸는 진짜 원자성은 얻을 수 없으므로,
 * **실패할 수 있는 검사를 전부 이 함수에 들어오기 전에 끝내는 것**이 실제 방어다
 * (라우트가 두 덩어리를 다 받고 앞머리까지 대조한 뒤에 부른다).
 *
 * ── 저장소가 없어도 시험된다 ─────────────────────────────────────────────
 * `StorageAdapter` 를 인자로 받는다. 시험은 임시 폴더를 루트로 삼은 실제
 * 어댑터를 넘겨, **기록이 실패했을 때 두 파일이 모두 옛 내용으로 돌아오는지**를
 * 실제 바이트로 확인한다(attachment-file-swap.test.ts).
 * ============================================================================
 */

/** 갈아 끼울 한 자리 — 어디를(relPath) 무엇으로(tempPath). */
export type StoredFileSwap = {
  /** 저장 루트 기준 상대 경로. 이미 파일이 있어도 되고 없어도 된다. */
  relPath: string;
  /** 검증을 마친 임시 파일 손잡이(storage.writeTemp 가 준 값). */
  tempPath: string;
};

export type SwapFailure = {
  code: string;
  message: string;
  /**
   * 되돌리기까지 실패했는가. 참이면 디스크가 어중간한 상태로 남았다는 뜻이고,
   * 부르는 쪽은 이것을 **반드시 서버 로그로 남긴다** — 조용히 넘어가면 어느
   * 파일이 어긋났는지 나중에 알 길이 없다.
   */
  rollbackFailed: boolean;
};

export type SwapStoredFilesResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: SwapFailure };

/** 기록 단계가 돌려주는 값 — 실패는 코드와 문장으로 말한다(던지지 않아도 된다). */
export type SwapRecordResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

type SwapCapableStorage = Pick<StorageAdapter, "stash" | "commit" | "delete" | "discard">;

export async function swapStoredFiles<T>(
  storage: SwapCapableStorage,
  params: {
    entries: readonly StoredFileSwap[];
    /**
     * 새 파일이 전부 자리에 놓인 **뒤에** 부른다. 여기서 실패하거나 던지면 파일이
     * 전부 옛 상태로 되돌아간다.
     */
    record: () => Promise<SwapRecordResult<T>>;
  }
): Promise<SwapStoredFilesResult<T>> {
  const { entries, record } = params;
  if (entries.length === 0) {
    throw new TypeError("갈아 끼울 자리가 하나도 없습니다.");
  }

  /** 치워 둔 옛 파일. 자리마다 하나씩, 없던 자리는 null. */
  const stashed: (string | null)[] = [];
  /** 새 파일을 실제로 놓은 자리 수 — 되돌릴 때 여기까지만 걷는다. */
  let committed = 0;

  /**
   * 되돌린다. 놓은 새 파일을 걷고, 치워 둔 옛 파일을 제자리로. 한 자리가
   * 실패해도 나머지는 마저 되돌린다 — 도중에 멈추면 더 어중간해진다.
   */
  async function rollback(): Promise<boolean> {
    let clean = true;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (index < committed) {
        try {
          await storage.delete(entry.relPath);
        } catch {
          clean = false;
        }
      } else {
        // 아직 놓지 못한 임시 파일은 찌꺼기다.
        await storage.discard(entry.tempPath).catch(() => undefined);
      }
      const previous = stashed[index];
      if (previous === undefined || previous === null) continue;
      try {
        await storage.commit(previous, entry.relPath);
      } catch {
        clean = false;
      }
    }
    return clean;
  }

  // ── 1) 옛 파일을 치운다 ────────────────────────────────────────────────
  for (const entry of entries) {
    try {
      stashed.push(await storage.stash(entry.relPath));
    } catch {
      const clean = await rollback();
      return {
        ok: false,
        failure: {
          code: "STORAGE_FAILED",
          message: "기존 파일을 옮기지 못했습니다.",
          rollbackFailed: !clean,
        },
      };
    }
  }

  // ── 2) 새 파일을 놓는다 ────────────────────────────────────────────────
  for (const entry of entries) {
    try {
      await storage.commit(entry.tempPath, entry.relPath);
      committed += 1;
    } catch {
      const clean = await rollback();
      return {
        ok: false,
        failure: {
          code: "STORAGE_FAILED",
          message: "파일을 저장하지 못했습니다.",
          rollbackFailed: !clean,
        },
      };
    }
  }

  // ── 3) 기록 ────────────────────────────────────────────────────────────
  let recorded: SwapRecordResult<T>;
  try {
    recorded = await record();
  } catch (error) {
    const clean = await rollback();
    return {
      ok: false,
      failure: {
        code: "RECORD_FAILED",
        message: error instanceof Error ? error.message : "파일 기록을 저장하지 못했습니다.",
        rollbackFailed: !clean,
      },
    };
  }
  if (!recorded.ok) {
    const clean = await rollback();
    return {
      ok: false,
      failure: { code: recorded.code, message: recorded.message, rollbackFailed: !clean },
    };
  }

  // ── 4) 치워 둔 옛 파일을 버린다 ────────────────────────────────────────
  // 여기서 실패해도 결과는 성공이다 — 임시 폴더에 파일 하나가 남을 뿐이고
  // sweepTemp 가 걷는다.
  for (const previous of stashed) {
    if (previous !== null) await storage.discard(previous).catch(() => undefined);
  }

  return { ok: true, value: recorded.value };
}
