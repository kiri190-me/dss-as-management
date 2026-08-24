/**
 * ============================================================================
 * 파일 저장소 — 업무 코드가 아는 유일한 모양
 * ============================================================================
 * 이 시스템은 나중에 사내 NAS로 옮긴다. 그때 갈아 끼울 것이 **구현 하나뿐이게**
 * 하려고 인터페이스를 따로 둔다. 라우트 핸들러·mutation·화면은 이 타입만 알고,
 * `node:fs`를 직접 부르지 않는다 — 어디선가 한 번이라도 fs를 직접 부르면 그
 * 자리가 이식 때 빠뜨리는 자리가 된다.
 *
 * ── 파일 전체를 메모리에 올리지 않는다 ───────────────────────────────────
 * writeTemp는 스트림을 받는다. 20MB짜리 파일 하나를 통째로 Buffer에 담으면
 * 동시에 몇 명만 올려도 프로세스가 흔들리고, 상한을 올리는 날 그대로 사고가
 * 된다. 흘려보내면서 크기와 SHA-256을 **동시에** 계산하고, 상한을 넘는 순간
 * 더 읽지 않고 임시 파일을 버린다.
 *
 * ── 왜 임시 파일을 거치는가 ──────────────────────────────────────────────
 * 크기·체크섬·내용 대조는 전부 바이트를 다 읽어야 답이 나온다. 최종 자리에
 * 바로 쓰면 검증에 실패했을 때 이미 그 자리에 반쯤 쓰인 파일이 있다. 임시
 * 자리에 받아 두고 통과한 것만 commit(이동)하면, 실패한 업로드는 최종 자리에
 * 흔적을 남기지 않는다.
 *
 * ── 경로 인자의 뜻 ───────────────────────────────────────────────────────
 * `relPath`는 언제나 **저장 루트 기준 상대 경로**이고 구분자는 `/` 하나뿐이다
 * (attachment-path.ts가 만든 값 = DB의 stored_path). 절대 경로로 바꾸는 일은
 * 구현 안에서만 일어난다. `tempPath`는 구현이 돌려준 불투명한 손잡이로,
 * 부르는 쪽이 해석하거나 만들어 내지 않는다.
 * ============================================================================
 */

export type TempWriteResult = {
  /** 구현이 정한 임시 파일 손잡이. commit/discard에 그대로 되돌려준다. */
  tempPath: string;
  /** 실제로 받은 바이트 수. Content-Length가 아니라 센 값이다. */
  size: number;
  /** 받은 바이트의 SHA-256(소문자 hex). 흘려보내며 함께 계산한다. */
  sha256: string;
  /**
   * 파일 앞머리 바이트(최대 headerBytes개).
   *
   * 인터페이스에 이 필드가 있는 이유: 확장자와 실제 내용이 맞는지 대조하려면
   * 앞머리가 필요한데, 그것 때문에 임시 파일을 다시 열면 방금 흘려보낸 것을
   * 한 번 더 읽는 셈이 된다. 어차피 지나가는 바이트라 받는 김에 붙들어 둔다.
   */
  header: Uint8Array;
};

export type WriteTempOptions = {
  /**
   * 이 바이트 수를 넘기는 순간 중단하고 임시 파일을 버린 뒤 던진다.
   *
   * 상한 자체는 어댑터가 정하지 않는다 — 정책은 도메인
   * (attachment-allowlist.ts의 MAX_ATTACHMENT_SIZE_BYTES)에 있고, 저장소는
   * 시키는 대로 자를 뿐이다. 그래야 NAS 구현으로 갈아 끼워도 상한이 따라
   * 움직이지 않는다.
   */
  maxBytes: number;
  /** 붙들어 둘 앞머리 바이트 수. 기본은 구현이 정한다. */
  headerBytes?: number;
};

/** 상한을 넘겨 중단됐다. 임시 파일은 던지기 전에 이미 지워져 있다. */
export class AttachmentTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`파일이 허용된 최대 크기(${maxBytes} 바이트)를 넘습니다.`);
    this.name = "AttachmentTooLargeError";
  }
}

/** 최종 자리에 이미 파일이 있다. 첨부 ID가 새 UUID라 정상적으로는 일어나지 않는다. */
export class AttachmentAlreadyStoredError extends Error {
  constructor(readonly relPath: string) {
    super("같은 자리에 이미 파일이 있습니다.");
    this.name = "AttachmentAlreadyStoredError";
  }
}

/** 그 자리에 파일이 없다. */
export class AttachmentNotStoredError extends Error {
  constructor(readonly relPath: string) {
    super("저장된 파일을 찾을 수 없습니다.");
    this.name = "AttachmentNotStoredError";
  }
}

export interface StorageAdapter {
  /**
   * 스트림을 임시 자리로 흘려보내며 크기·체크섬·앞머리를 동시에 계산한다.
   * maxBytes를 넘으면 더 읽지 않고 임시 파일을 지운 뒤 AttachmentTooLargeError.
   */
  writeTemp(stream: ReadableStream<Uint8Array>, options: WriteTempOptions): Promise<TempWriteResult>;

  /** 검증을 통과한 임시 파일을 최종 자리로 옮긴다. 부모 폴더는 필요하면 만든다. */
  commit(tempPath: string, relPath: string): Promise<void>;

  /** 검증에 실패한 임시 파일을 버린다. 이미 없으면 조용히 넘어간다. */
  discard(tempPath: string): Promise<void>;

  /**
   * 저장된 파일을 읽는다. 다운로드 통로(3단계)가 쓸 자리이며, 지금은 구현만
   * 해 둔다 — 나중에 인터페이스를 다시 손대지 않으려는 것이다.
   */
  read(relPath: string): Promise<ReadableStream<Uint8Array>>;

  /** 저장된 파일을 지운다. 이미 없으면 조용히 넘어간다. */
  delete(relPath: string): Promise<void>;

  exists(relPath: string): Promise<boolean>;

  /**
   * olderThanMs보다 오래된 임시 파일을 지우고 그 개수를 돌려준다.
   *
   * 임시 파일은 정상 경로에서는 commit이나 discard로 반드시 사라지지만,
   * 프로세스가 그 사이에 죽으면 남는다. 24시간처럼 넉넉한 값으로 훑어서
   * 진행 중인 업로드를 건드리지 않고 찌꺼기만 치운다.
   */
  sweepTemp(olderThanMs: number): Promise<number>;
}
