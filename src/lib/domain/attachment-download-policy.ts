import type { MalwareScanStatus } from "./attachment-category";

/**
 * ============================================================================
 * 이 첨부를 내려받게 해도 되는가 — 판정을 한 자리에 모은다
 * ============================================================================
 * 다운로드 라우트 안에 if를 흩어 놓지 않는다. 판정이 라우트에 녹아 있으면
 * 검사기가 도입되는 날 "어디를 고쳐야 하는지"가 코드 전체를 훑어야 나오는
 * 질문이 되고, 그때 한 군데를 빠뜨리면 감염된 파일이 나가거나 멀쩡한 파일이
 * 전부 막힌다. 순수 함수 하나로 뽑아 두면 고칠 자리가 한 줄이고, 다섯 상태를
 * 각각 못박은 단위 테스트가 그 한 줄의 결과를 그 자리에서 알려 준다.
 *
 * **이 파일은 순수하다.** server-only / drizzle / next 를 import 하지 않는다 —
 * DB도 요청도 없이 값만 보고 답한다.
 *
 * ── ⚠️ NOT_SCANNED 는 지금 '허용'이다 ────────────────────────────────────
 * 악성코드 검사 엔진이 아직 이 시스템에 없다(schema/attachments.ts,
 * attachment-category.ts 주석). 그래서 지금 DB에 있는 **모든** 첨부가
 * NOT_SCANNED 이고, 여기서 NOT_SCANNED 를 막으면 단 한 개의 파일도 내려받을
 * 수 없다 — 기능이 있는 척만 하는 상태가 된다.
 *
 * 그러므로 NOT_SCANNED 는 "검사해서 깨끗했다"가 아니라 **"아직 검사 체계가
 * 없다"**는 사실의 기록으로 취급하고 통과시킨다.
 *
 *   ▶ **검사기를 붙이는 날 고칠 곳은 아래 SCAN_STATUS_ALLOWS_DOWNLOAD 의
 *     NOT_SCANNED 값 하나다.** true → false 로 바꾸면 미검사 파일이 그 즉시
 *     전부 막힌다. 그때는 기존 행들을 검사 큐에 태우는 절차
 *     (NOT_SCANNED → PENDING → CLEAN)를 함께 준비해야 한다. 그 절차 없이
 *     값만 뒤집으면 이미 올라와 있는 파일이 전부 잠긴다.
 *
 * ── 판정 순서 ────────────────────────────────────────────────────────────
 *  1. 주인이 아무도 없는 첨부(repair_case_id · product_model_id 둘 다 NULL) → 거부
 *  2. 휴지통에 있는 첨부(is_deleted) → 거부
 *  3. 검사 상태 → 표대로
 *
 * 1번이 맨 앞인 이유는 그것만이 **권한을 물을 대상 자체가 없는** 경우이기
 * 때문이다. 자세한 근거는 isDetachedAttachment 주석에 적었다.
 *
 * ── 주인이 둘로 늘어도 판정 지점은 하나다 ────────────────────────────────
 * 첨부의 주인은 접수 건 아니면 제품 모델이다(schema/attachments.ts의
 * attachments_owner_not_both). 주인마다 판정 함수를 따로 두지 않는다 — 그러면
 * 검사기를 붙이는 날, 휴지통 규칙을 바꾸는 날 고칠 자리가 둘이 되고 한쪽을
 * 빠뜨리면 그 종류의 파일만 조용히 다르게 동작한다. 주인에 따라 갈리는 것은
 * **물을 권한**뿐이고 그것은 라우트가 정한다. 여기서는 "주인이 있는가"만 본다.
 * ============================================================================
 */

/**
 * 검사 상태별 허용 여부. **검사기가 도입되면 NOT_SCANNED 를 false 로 옮긴다**
 * (파일 헤더의 ⚠️ 항목).
 */
const SCAN_STATUS_ALLOWS_DOWNLOAD: Record<MalwareScanStatus, boolean> = {
  // 검사 체계가 아직 없다는 사실의 기록. 지금 막으면 아무 파일도 나가지 않는다.
  NOT_SCANNED: true,
  // 검사 중이다 — 결과가 나오기 전에 내보내면 검사를 두는 의미가 없다.
  PENDING: false,
  // 검사해서 깨끗했다.
  CLEAN: true,
  // 감염이 확인됐다.
  INFECTED: false,
  // 검사 자체가 실패했다. '모른다'는 '괜찮다'가 아니다.
  FAILED: false,
};

export type AttachmentDownloadDenialReason =
  /**
   * 주인이 아무도 없다 — repair_case_id 와 product_model_id 가 둘 다 NULL.
   * 접수 건이나 모델이 영구 삭제되어 연결만 끊긴 첨부가 이 상태가 된다
   * (두 FK 모두 ON DELETE SET NULL).
   */
  | "DETACHED"
  /** 휴지통에 있다. 복원하면 다시 받을 수 있다. */
  | "DELETED"
  /** 검사 중이거나, 감염됐거나, 검사가 실패했다. */
  | "SCAN_BLOCKED";

export type AttachmentDownloadDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: AttachmentDownloadDenialReason;
      /** 사용자에게 그대로 보여 줄 수 있는 문장. 내부 경로는 담지 않는다. */
      message: string;
    };

/**
 * 판정에 쓰이는 첨부의 주인. 두 값이 동시에 채워진 첨부는 DB가 막고 있으므로
 * (attachments_owner_not_both) 여기서는 그 경우를 따로 다루지 않는다.
 */
export type AttachmentOwnerRef = {
  /** 접수 건 주인. NULL 이면 접수 건이 주인이 아니다. */
  repairCaseId: string | null;
  /** 제품 모델 주인. NULL 이면 모델이 주인이 아니다. */
  productModelId: string | null;
};

export type AttachmentDownloadSubject = AttachmentOwnerRef & {
  isDeleted: boolean;
  malwareScanStatus: MalwareScanStatus;
};

/**
 * 주인이 아무도 없는 첨부인가 — 접수 건도 모델도 가리키지 않는가.
 *
 * 판정 함수와 따로 뽑아 둔 이유는 **부르는 순서** 때문이다. 라우트는 주인을
 * 보고 물을 권한을 고른다(접수 건이면 repairCases.files, 모델이면
 * productModels.view). 주인이 아무도 없으면 고를 것이 없다 — 권한 확인 자체가
 * 성립하지 않으므로 그 앞에서 답이 나야 한다. decideAttachmentDownload 도 같은
 * 조건을 맨 앞에서 다시 보므로, 이 함수를 부르는 것을 잊어도 파일이 새어
 * 나가지는 않는다(닫히는 쪽으로 실패).
 *
 * ⚠️ **"접수 건이 없다"가 아니라 "주인이 아무도 없다"이다.** 모델 첨부는
 * repair_case_id 가 원래 NULL 이므로, 접수 건만 보면 정상적인 모델 회로도가
 * 전부 DETACHED 로 막힌다.
 */
export function isDetachedAttachment(owner: AttachmentOwnerRef): boolean {
  return owner.repairCaseId === null && owner.productModelId === null;
}

/**
 * 🔴 **주인이 접수 건인지 모델인지 말하지 않는다.** 이 문장이 나가는 때는 두
 * FK 가 모두 NULL 인 때이고, 그때는 이 파일이 접수 건에 붙어 있었는지 모델에
 * 붙어 있었는지를 **알 방법이 남아 있지 않다**(둘 다 ON DELETE SET NULL 이라
 * 지워진 쪽의 흔적이 없다). "접수 건이 없어져"라고 적으면 모델 회로도를 열려던
 * 사람에게 사실이 아닌 안내가 나간다.
 */
const DETACHED_MESSAGE =
  "이 파일이 붙어 있던 대상이 없어져 열람 권한을 확인할 수 없습니다. 관리자에게 문의해 주세요.";
const DELETED_MESSAGE = "휴지통에 있는 파일은 내려받을 수 없습니다. 복원한 뒤 다시 시도해 주세요.";

const SCAN_BLOCKED_MESSAGES: Record<MalwareScanStatus, string> = {
  NOT_SCANNED: "",
  CLEAN: "",
  PENDING: "악성코드 검사가 진행 중입니다. 검사가 끝난 뒤 다시 시도해 주세요.",
  INFECTED: "악성코드가 확인된 파일이라 내려받을 수 없습니다.",
  FAILED: "악성코드 검사에 실패한 파일이라 내려받을 수 없습니다.",
};

/**
 * 이 첨부를 내보내도 되는가. **다운로드 통로의 유일한 판정 지점이다.**
 *
 * 막을 때는 이유를 함께 돌려준다 — "안 됩니다"만 보여 주면 사용자는 고장으로
 * 여기고, 검사 중이라 잠시 뒤면 되는 경우와 영영 안 되는 경우를 구분하지 못한다.
 */
export function decideAttachmentDownload(
  subject: AttachmentDownloadSubject
): AttachmentDownloadDecision {
  if (isDetachedAttachment(subject)) {
    return { allowed: false, reason: "DETACHED", message: DETACHED_MESSAGE };
  }
  if (subject.isDeleted) {
    return { allowed: false, reason: "DELETED", message: DELETED_MESSAGE };
  }
  if (!SCAN_STATUS_ALLOWS_DOWNLOAD[subject.malwareScanStatus]) {
    return {
      allowed: false,
      reason: "SCAN_BLOCKED",
      // 목록에 없는 상태값이 DB에서 올라와도(옛 코드·손으로 넣은 SQL) 위
      // 표에서 undefined 가 되어 '막힘'으로 떨어진다. 그때 문장까지 비어
      // 있으면 화면이 빈 오류를 보이므로 마지막 문장을 준비해 둔다.
      message:
        SCAN_BLOCKED_MESSAGES[subject.malwareScanStatus] ||
        "악성코드 검사 상태를 확인할 수 없어 내려받을 수 없습니다.",
    };
  }
  return { allowed: true };
}
