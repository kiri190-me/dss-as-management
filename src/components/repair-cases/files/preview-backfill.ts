/**
 * ============================================================================
 * 옛 사진의 미리보기 채우기 — **언제 돌고 언제 돌지 않는가**
 * ============================================================================
 * 목록은 사진을 480px짜리 미리보기(preview_path)로 보여 준다. 그것이 없는 옛
 * 사진은 원본을 그대로 받아 오므로 느리다. 예전에는 노란 띠의 「미리보기
 * 만들기」를 **사람이 눌러** 채웠는데, 2026-09-04 요구로 화면이 스스로 채운다.
 *
 * 저절로 도는 것은 사람이 누르는 것과 위험이 다르다. 그래서 "돌아도 되는가"를
 * 화면 안에 두지 않고 여기로 뽑았다 — 화면 안에만 있으면 아무도 확인할 수 없다.
 *
 * 🔴 **한 번만 돈다. 실패해도 다시 시도하지 않는다.**
 *    채우기는 사진마다 **원본을 통째로 내려받는다**(fetchAttachmentBlob).
 *    자동 재시도를 넣으면 서버가 거절할 때 원본을 계속 받아 오며 무한히
 *    두드리게 된다 — 사내망에서 이것은 곧 장애다. 그래서 판정에
 *    `hasStarted` 가 들어 있고, 시작한 뒤에는 무슨 일이 있어도 다시 참이
 *    되지 않는다.
 *
 * 🔴 **고칠 권한이 있는 사람만 돈다.**
 *    미리보기를 붙이는 통로(PUT /api/attachments/{id}/preview)는 '보기'가
 *    아니라 '쓰기'라 files WRITE 를 묻는다. 읽기만 되는 사람이 열면 사진마다
 *    원본을 받아 놓고 마지막에 403 을 받는다 — 아무것도 얻지 못하면서 대역폭만
 *    쓴다. 그래서 아예 시작하지 않는다.
 *
 * 만드는 쪽은 언제나 브라우저다. 서버는 이미지 처리를 전혀 하지 않는다
 * (preview 라우트 헤더 참조 — NAS 컨테이너로 옮길 때 네이티브 라이브러리를
 * 짐으로 지지 않기로 했다).
 * ============================================================================
 */

export type AutoPreviewBackfillInput = {
  /** 파일을 고칠 권한이 있는가. 없으면 사진마다 서버가 거절한다. */
  canManage: boolean;
  /** 미리보기가 없는 사진 수. */
  missingCount: number;
  /** 이 화면에서 자동 채우기를 **이미 시작했는가**. 한 번 참이면 되돌리지 않는다. */
  hasStarted: boolean;
  /** 지금 채우는 중인가(사람이 누른 경우 포함). */
  isRunning: boolean;
  /** 지우기·되살리기 같은 다른 조작이 도는 중인가. */
  isBusy: boolean;
};

export type AutoPreviewBackfillSkipReason =
  /** 고칠 권한이 없다 — 사진마다 거절당한다. */
  | "NO_PERMISSION"
  /** 이미 한 번 시작했다 — 실패했더라도 다시 시도하지 않는다. */
  | "ALREADY_STARTED"
  /** 지금 돌고 있다. */
  | "RUNNING"
  /** 다른 조작이 도는 중이다. */
  | "BUSY"
  /** 채울 것이 없다. */
  | "NOTHING_MISSING";

export type AutoPreviewBackfillDecision =
  | { run: true }
  | { run: false; reason: AutoPreviewBackfillSkipReason };

/**
 * 지금 자동으로 채워야 하는가.
 *
 * 순서에 뜻이 있다. 권한을 맨 앞에 둔 것은 그것이 가장 근본적인 이유이고,
 * `hasStarted` 를 그 다음에 둔 것은 **다른 어떤 조건보다 먼저** "두 번은
 * 없다"를 못박기 위해서다.
 */
export function decideAutoPreviewBackfill(
  input: AutoPreviewBackfillInput
): AutoPreviewBackfillDecision {
  if (!input.canManage) return { run: false, reason: "NO_PERMISSION" };
  if (input.hasStarted) return { run: false, reason: "ALREADY_STARTED" };
  if (input.isRunning) return { run: false, reason: "RUNNING" };
  if (input.isBusy) return { run: false, reason: "BUSY" };
  if (input.missingCount <= 0) return { run: false, reason: "NOTHING_MISSING" };
  return { run: true };
}

/**
 * 「미리보기 다시 만들기」 단추를 내밀어야 하는가.
 *
 * 🔴 단추를 없애지 않는다. 자동으로 채우다 **막혀서 남은 것이 있을 때만**
 *    빠져나갈 길로 내민다 — 저절로 도는 길이 서버 거절·네트워크 문제로 끊기면
 *    남은 사진은 영영 원본으로 받아 오게 되고, 자동 재시도는 하지 않기로 했기
 *    때문이다. 평소에는(다 채워졌거나 아직 돌기 전) 사람이 볼 일이 없다.
 */
export function shouldOfferManualPreviewRebuild(input: {
  canManage: boolean;
  /** 자동이든 수동이든 채우기가 **한 번 끝났는가**. */
  hasFinishedRun: boolean;
  missingCount: number;
  isRunning: boolean;
}): boolean {
  if (!input.canManage) return false;
  if (!input.hasFinishedRun) return false;
  if (input.isRunning) return false;
  return input.missingCount > 0;
}

/**
 * 채우는 중임을 알리는 한 줄. 경고가 아니라 진행 표시다 — 사람이 할 일이
 * 아니게 됐으니 경고할 일도 아니다.
 */
export function formatPreviewBackfillProgress(progress: {
  current: number;
  total: number;
}): string {
  return `미리보기 만드는 중… ${progress.current}/${progress.total}`;
}
