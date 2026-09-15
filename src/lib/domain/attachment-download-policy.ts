import { ATTACHMENT_OWNER_KINDS, type AttachmentOwnerKind, type MalwareScanStatus } from "./attachment-category";

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
 *  1. 주인이 아무도 없는 첨부(repair_case_id · product_model_id ·
 *     improvement_request_id · quote_id 넷 다 NULL) → 거부
 *  2. 휴지통에 있는 **견적서**의 첨부(2026-09-15 Q2) → 거부
 *  3. 휴지통에 있는 첨부(is_deleted) → 거부
 *  4. 검사 상태 → 표대로
 *
 * 1번이 맨 앞인 이유는 그것만이 **권한을 물을 대상 자체가 없는** 경우이기
 * 때문이다. 자세한 근거는 isDetachedAttachment 주석에 적었다. 2번이 3번보다 앞인
 * 까닭은 decideAttachmentDownload 주석에 있다.
 *
 * ── 주인이 넷으로 늘어도 판정 지점은 하나다 ──────────────────────────────
 * 첨부의 주인은 접수 건 · 제품 모델 · 개선 요청 · 견적서 중 하나다(schema/attachments.ts의
 * attachments_owner_not_both · attachments_improvement_owner_alone ·
 * attachments_quote_owner_alone).
 * 주인마다 판정 함수를 따로 두지 않는다 — 그러면
 * 검사기를 붙이는 날, 휴지통 규칙을 바꾸는 날 고칠 자리가 둘이 되고 한쪽을
 * 빠뜨리면 그 종류의 파일만 조용히 다르게 동작한다. 주인에 따라 갈리는 것은
 * **물을 권한**뿐이고 그것은 라우트가 정한다. 여기서는 "주인이 있는가"만 본다.
 * (견적서 휴지통 한 줄은 예외처럼 보이지만 "주인이 지금 있는가"의 한 갈래다 —
 * 휴지통의 견적서는 목록에도 주소에도 없는 것으로 다룬다: getQuoteForEdit.)
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
   * 주인이 아무도 없다 — repair_case_id · product_model_id · improvement_request_id ·
   * quote_id 가 넷 다 NULL. 주인이 영구 삭제되어 연결만 끊긴 첨부가 이 상태가 된다
   * (네 FK 모두 ON DELETE SET NULL).
   */
  | "DETACHED"
  /**
   * 주인인 **견적서가 휴지통에 있다**(2026-09-15 Q2). 견적서를 되살리면 다시 받을 수
   * 있다. 견적서를 휴지통에 넣으면 그 첨부도 함께 첨부 휴지통으로 가므로(quote-trash.ts)
   * 보통은 아래 DELETED 와 겹친다 — 겹칠 때 이것이 앞서는 까닭은 decideAttachmentDownload
   * 주석에 있다.
   */
  | "QUOTE_IN_TRASH"
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
 * 판정에 쓰이는 첨부의 주인. 둘 이상이 동시에 채워진 첨부는 DB가 막고 있으므로
 * (attachments_owner_not_both · attachments_improvement_owner_alone ·
 * attachments_quote_owner_alone) 여기서는 그 경우를 따로 다루지 않는다.
 */
export type AttachmentOwnerRef = {
  /** 접수 건 주인. NULL 이면 접수 건이 주인이 아니다. */
  repairCaseId: string | null;
  /** 제품 모델 주인. NULL 이면 모델이 주인이 아니다. */
  productModelId: string | null;
  /**
   * 개선 요청 주인. NULL 이면 개선 요청이 주인이 아니다. 앞의 두 주인과 동시에
   * 채워지지 않는다(attachments_improvement_owner_alone CHECK).
   *
   * **필수 칸이다**(2026-09-13 S2 에서 선택 칸을 바꿨다). 선택 칸이던 동안에는 이
   * 칸을 넘기지 않는 경로가 개선 요청 스크린샷을 주인 없음(DETACHED)으로 막았다.
   * 필수로 바꾸면서 컴파일러가 이 칸을 빠뜨린 경로(내려받기 · 미리보기 · 지우기 ·
   * 감사 기록)를 전부 짚었고, 지금은 모두 넘긴다.
   */
  improvementRequestId: string | null;
  /**
   * 견적서 주인(2026-09-15 Q2). NULL 이면 견적서가 주인이 아니다. 앞의 세 주인과 동시에
   * 채워지지 않는다(attachments_quote_owner_alone CHECK).
   *
   * **필수 칸이다** — 개선 요청 칸을 필수로 바꿀 때와 같은 까닭이다. Q1 은 이 칸 없이
   * 견적서 주인을 권한 판정의 타입에서 빼 두기만 했고(`Exclude<…, "QUOTE">` — 견적서
   * 파일은 그동안 「주인 없음」으로 막혔다), Q2 가 이 칸을 필수로 더하면서 그 Exclude 를
   * 거뒀다. 컴파일러가 이 칸과 견적서 권한을 빠뜨린 경로(내려받기 · 미리보기 · 지우기 ·
   * 감사 기록)를 전부 짚었고, 지금은 모두 넘긴다.
   */
  quoteId: string | null;
};

export type AttachmentDownloadSubject = AttachmentOwnerRef & {
  isDeleted: boolean;
  malwareScanStatus: MalwareScanStatus;
  /**
   * 주인인 견적서가 휴지통에 있는가(2026-09-15 Q2). 견적서 주인이 아니면 언제나 false 다.
   *
   * 첨부 행의 is_deleted 와 다른 사실이다 — 그쪽은 **파일**이 휴지통에 있는가이고, 이쪽은
   * **주인**이 휴지통에 있는가다. 내려받기 조회(queries/attachment-download.ts)가 견적서
   * 표를 붙여 읽는다. 다른 주인(접수 건 · 모델)의 휴지통은 여기서 보지 않는다 — 그쪽은
   * 예전 동작 그대로다(이 칸을 넓히는 것은 따로 정할 일이다).
   *
   * `true` 만 막는다. 칸이 빠진 채(undefined) 오면 막지 않는 쪽이지만, 견적서를 휴지통에
   * 넣으면 그 첨부도 함께 첨부 휴지통으로 가므로(quote-trash.ts) 그 파일은 DELETED 로
   * 여전히 막힌다.
   */
  quoteInTrash: boolean;
};

/**
 * 주인이 아무도 없는 첨부인가 — 접수 건도 모델도 개선 요청도 견적서도 가리키지 않는가.
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
 * 전부 DETACHED 로 막힌다. 개선 요청 · 견적서 첨부도 앞의 칸들이 원래 NULL 이다.
 *
 * improvementRequestId · quoteId 는 타입으로는 필수지만, 런타임에 칸이 빠진 채
 * (undefined) 와도 **NULL 과 같이 "없음"**으로 본다 — 타입을 거치지 않은 값(손으로
 * 만든 객체, 옛 직렬화)이 오면 주인 없음으로 막히는 쪽, 닫히는 쪽으로 떨어진다.
 * `== null` 을 쓰지 않고 두 경우를 적어 둔 것은, 빈 문자열을 없음으로 보지 않는다는
 * 기존 두 칸의 성질("NULL 인가"만 본다)을 이 칸들도 그대로 따르게 하려는 것이다.
 */
export function isDetachedAttachment(owner: AttachmentOwnerRef): boolean {
  const improvementRequestAbsent =
    owner.improvementRequestId === null || owner.improvementRequestId === undefined;
  const quoteAbsent = owner.quoteId === null || owner.quoteId === undefined;
  return owner.repairCaseId === null && owner.productModelId === null && improvementRequestAbsent && quoteAbsent;
}

/**
 * 이 첨부의 주인은 어느 종류인가 — 물을 권한을 고르는 근거다. 주인이 아무도 없으면 null.
 *
 * 넷 중 둘 이상이 차는 행은 DB CHECK 가 막으므로 보는 차례에 뜻은 없지만, 예전 두
 * 갈래(`productModelId ? 모델 : 접수 건`)와 같게 모델을 먼저 본다.
 */
export function attachmentOwnerKindOf(owner: AttachmentOwnerRef): AttachmentOwnerKind | null {
  if (owner.productModelId !== null) return "PRODUCT_MODEL";
  if (owner.improvementRequestId !== null && owner.improvementRequestId !== undefined) {
    return "IMPROVEMENT_REQUEST";
  }
  if (owner.quoteId !== null && owner.quoteId !== undefined) return "QUOTE";
  if (owner.repairCaseId !== null) return "REPAIR_CASE";
  return null;
}

/**
 * 주인 종류마다 이 사람이 그 종류의 파일을 다룰 수 있는가 — 라우트·서버 액션이
 * hasPermission 으로 계산해 채운다. 무엇을 묻는지는 부르는 쪽이 정한다:
 *
 *              내려받기(보기)            미리보기 PUT · 지우기 · 되살리기(쓰기)
 *   접수 건    repairCases.files READ    repairCases.files WRITE
 *   제품 모델  productModels.view READ   productModels.files WRITE
 *   개선 요청  improvementRequests READ  improvementRequests WRITE
 *   견적서     quotes READ               quotes WRITE          (2026-09-15 Q2)
 *
 * 견적서 파일(결재 PDF · 수기 엑셀)을 보는 데 READ 면 되는 까닭은 견적서 받기
 * (/api/quotes/{id}/xlsx)가 READ 인 것과 같다 — 목록에서 그 견적서를 볼 수 있는
 * 사람은 그 문서도 받을 수 있어야 한다. 붙이고 떼는 것은 견적서를 고치는 일이라
 * WRITE 다. 올리기 통로(/api/quotes/{id}/attachments)도 WRITE 다.
 *
 * 키가 주인 종류 전부(AttachmentOwnerKind)다 — 주인이 하나 더 늘면 이 표를 채우는
 * 모든 통로가 컴파일에서 멈춘다(Q1 이 견적서를 잠시 뺐던 Exclude 를 Q2 가 거뒀다).
 */
export type AttachmentOwnerAccess = Readonly<Record<AttachmentOwnerKind, boolean>>;

/** 첨부 권한을 무엇에 쓰는가 — 보기(내려받기)인가, 바꾸기(올리기 · 미리보기 붙이기 · 지우기 · 되살리기)인가. */
export type AttachmentAccessPurpose = "VIEW" | "CHANGE";

export type AttachmentOwnerPermission = {
  /** permission-areas.ts 의 영역 키. hasPermission 에 그대로 넘긴다. */
  readonly areaKey: string;
  readonly level: "READ" | "WRITE";
};

/**
 * 위 표를 **값으로** 둔 것이다(2026-09-15 Q2). 내려받기 라우트 · 미리보기 라우트 · 지우기 ·
 * 되살리기 액션이 이 표 하나로 AttachmentOwnerAccess 를 채운다(resolveAttachmentOwnerAccess),
 * 견적서 올리기 통로도 CHANGE.QUOTE 를 본다. 예전에는 통로마다 hasPermission 을 한 줄씩
 * 적었다 — 값은 그때와 한 글자도 다르지 않다. 표로 모은 까닭은 「견적서: 내려받기는 READ,
 * 나머지는 WRITE」 같은 규칙을 **단위 시험이 볼 수 있게** 하려는 것이다. 라우트 안에
 * 흩어져 있으면 세션 없이는 시험할 길이 없다.
 *
 * 모델 파일을 **보는** 권한이 productModels.files 가 아니라 view 인 까닭은 내려받기
 * 라우트 헤더의 '권한이 주인에 따라 갈린다'에 있다.
 */
export const ATTACHMENT_OWNER_PERMISSIONS: Readonly<
  Record<AttachmentAccessPurpose, Readonly<Record<AttachmentOwnerKind, AttachmentOwnerPermission>>>
> = {
  VIEW: {
    REPAIR_CASE: { areaKey: "repairCases.files", level: "READ" },
    PRODUCT_MODEL: { areaKey: "productModels.view", level: "READ" },
    IMPROVEMENT_REQUEST: { areaKey: "improvementRequests", level: "READ" },
    QUOTE: { areaKey: "quotes", level: "READ" },
  },
  CHANGE: {
    REPAIR_CASE: { areaKey: "repairCases.files", level: "WRITE" },
    PRODUCT_MODEL: { areaKey: "productModels.files", level: "WRITE" },
    IMPROVEMENT_REQUEST: { areaKey: "improvementRequests", level: "WRITE" },
    QUOTE: { areaKey: "quotes", level: "WRITE" },
  },
};

/**
 * 표대로 권한을 물어 AttachmentOwnerAccess 를 채운다. 묻는 일(hasPermission)은 부르는
 * 쪽이 `check` 로 넘긴다 — 이 파일은 순수하게 남는다. 주인 종류 차례대로 하나씩 묻는다
 * (예전 라우트가 한 줄씩 await 하던 것과 같다 — 여러 번 물어도 DB 는 한 번만 읽힌다:
 * permission-resolver 의 cache()).
 */
export async function resolveAttachmentOwnerAccess(
  purpose: AttachmentAccessPurpose,
  check: (areaKey: string, level: "READ" | "WRITE") => Promise<boolean>
): Promise<AttachmentOwnerAccess> {
  const rules = ATTACHMENT_OWNER_PERMISSIONS[purpose];
  const access = {} as Record<AttachmentOwnerKind, boolean>;
  for (const kind of ATTACHMENT_OWNER_KINDS) {
    access[kind] = await check(rules[kind].areaKey, rules[kind].level);
  }
  return access;
}

/**
 * 넓은 문턱 — 넷 중 **어느 주인의 파일도** 다룰 수 없는 사람인가. 그런 사람은 첨부를
 * 조회하기 **전에** 403 이다(HANDOFF W-1-3 — 존재 여부를 알리지 않는다).
 */
export function hasAnyAttachmentOwnerAccess(access: AttachmentOwnerAccess): boolean {
  return access.REPAIR_CASE || access.PRODUCT_MODEL || access.IMPROVEMENT_REQUEST || access.QUOTE;
}

/**
 * 주인별 판정 — 이 첨부의 주인 종류에 대한 권한이 있는가. 거짓이면 부르는 쪽은
 * **403 이 아니라 404**(「없음」과 같은 응답)로 답한다 — 문턱을 넘은 사람에게 403 으로
 * 갈라 답하면 「그 ID 는 실재하는 이런 종류의 첨부」가 새어 나간다(W-1-3).
 *
 * 주인이 아무도 없는 첨부는 **접수 건 권한으로** 판정한다. 예전 두 갈래 코드의
 * else 쪽이 그랬고, 그 동작을 바꾸지 않는다 — 그 뒤 내려받기는 decideAttachmentDownload
 * 가 DETACHED 로 막고, 지우기는 감사에 ownerType "NONE" 을 남긴다.
 */
export function isAttachmentOwnerAccessAllowed(
  owner: AttachmentOwnerRef,
  access: AttachmentOwnerAccess
): boolean {
  return access[attachmentOwnerKindOf(owner) ?? "REPAIR_CASE"];
}

/**
 * 🔴 **주인이 접수 건인지 모델인지 개선 요청인지 견적서인지 말하지 않는다.** 이
 * 문장이 나가는 때는 네 FK 가 모두 NULL 인 때이고, 그때는 이 파일이 어디에 붙어
 * 있었는지를 **알 방법이 남아 있지 않다**(넷 다 ON DELETE SET NULL 이라 지워진
 * 쪽의 흔적이 없다). "접수 건이 없어져"라고 적으면 모델 회로도나 개선 요청
 * 스크린샷을 열려던 사람에게 사실이 아닌 안내가 나간다.
 */
const DETACHED_MESSAGE =
  "이 파일이 붙어 있던 대상이 없어져 열람 권한을 확인할 수 없습니다. 관리자에게 문의해 주세요.";
/**
 * 견적서가 휴지통에 있을 때. 여기서는 주인이 견적서라고 **말해도 된다** — 이 문장은
 * 주인이 휴지통의 견적서라는 사실을 판정이 알고 있을 때만 나가고, 이 문장을 보는
 * 사람은 이미 견적서 파일을 볼 권한(quotes READ)을 확인받았다.
 */
const QUOTE_IN_TRASH_MESSAGE =
  "휴지통에 있는 견적서의 파일은 내려받을 수 없습니다. 견적서를 되살린 뒤 다시 시도해 주세요.";
const DELETED_MESSAGE = "휴지통에 있는 파일은 내려받을 수 없습니다. 복원한 뒤 다시 시도해 주세요.";

const SCAN_BLOCKED_MESSAGES: Record<MalwareScanStatus, string> = {
  NOT_SCANNED: "",
  CLEAN: "",
  PENDING: "악성코드 검사가 진행 중입니다. 검사가 끝난 뒤 다시 시도해 주세요.",
  INFECTED: "악성코드가 확인된 파일이라 내려받을 수 없습니다.",
  FAILED: "악성코드 검사에 실패한 파일이라 내려받을 수 없습니다.",
};

/**
 * 이 첨부를 내보내도 되는가. **다운로드 통로의 유일한 판정 지점이다.** 견적서 받기
 * (/api/quotes/{id}/xlsx)가 엑셀 전용 견적서의 붙인 엑셀을 내보낼 때도 이 함수를 거친다.
 *
 * 막을 때는 이유를 함께 돌려준다 — "안 됩니다"만 보여 주면 사용자는 고장으로
 * 여기고, 검사 중이라 잠시 뒤면 되는 경우와 영영 안 되는 경우를 구분하지 못한다.
 *
 * 견적서 휴지통(QUOTE_IN_TRASH)이 파일 휴지통(DELETED)보다 **앞**이다. 견적서를 휴지통에
 * 넣으면 그 파일도 함께 첨부 휴지통으로 가서 둘이 늘 겹치는데, 그때 「파일을 복원하라」고
 * 안내하면 틀린 길이다 — 휴지통 견적서의 파일은 따로 되살릴 수 없고(attachment-trash.ts),
 * 견적서를 되살리면 함께 돌아온다(quote-trash.ts).
 */
export function decideAttachmentDownload(
  subject: AttachmentDownloadSubject
): AttachmentDownloadDecision {
  if (isDetachedAttachment(subject)) {
    return { allowed: false, reason: "DETACHED", message: DETACHED_MESSAGE };
  }
  if (subject.quoteInTrash === true) {
    return { allowed: false, reason: "QUOTE_IN_TRASH", message: QUOTE_IN_TRASH_MESSAGE };
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
