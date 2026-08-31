import { DEFAULT_INTAKE_MAIL_TEMPLATE } from "@/lib/domain/intake-mail-body";
import { SIGNATURE_HTML_MAX } from "@/lib/domain/mail-signature-html";

export { SIGNATURE_HTML_MAX };

/**
 * 접수 알림 메일 설정 입력 검증 — 순수 함수. 화면과 서버 액션이 같은 것을 쓴다.
 *
 * 길이를 막는 이유: 이 글은 전사원 메일로 나간다. 제목이 길면 메일함에서
 * 잘리고, 머리말·꼬리말이 길면 정작 봐야 할 자료가 스크롤 아래로 밀린다.
 */

/** 메일 제목 한 줄. 메일 클라이언트가 대개 이 근처에서 자른다. */
export const SUBJECT_MAX = 200;
/** 머리말·꼬리말. 문단 몇 개는 되고 그 이상은 자료를 가린다. */
export const TEXT_MAX = 2000;

export type IntakeMailSettingsInput = {
  /** 메일 아래에 붙는 서명 HTML. 정화 전 원문이 들어오고, 저장 직전에 걸러진다. */
  signatureHtml: string;
  isEnabled: boolean;
  subjectTemplate: string;
  introText: string;
  outroText: string;
  /** 고른 수신자의 user id. 빈 배열이면 아무에게도 보내지 않는다. */
  recipientUserIds: string[];
};

export type IntakeMailSettingsFieldErrors = Partial<
  Record<"subjectTemplate" | "introText" | "outroText" | "recipientUserIds", string>
>;

export type ValidateIntakeMailSettingsResult =
  | { ok: true; data: IntakeMailSettingsInput }
  | { ok: false; fieldErrors: IntakeMailSettingsFieldErrors };

export function validateIntakeMailSettingsInput(
  raw: unknown
): ValidateIntakeMailSettingsResult {
  const fieldErrors: IntakeMailSettingsFieldErrors = {};

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, fieldErrors: { subjectTemplate: "입력을 읽을 수 없습니다." } };
  }
  const input = raw as Record<string, unknown>;

  const isEnabled = input.isEnabled === true;

  const subjectTemplate = typeof input.subjectTemplate === "string" ? input.subjectTemplate.trim() : "";
  if (!subjectTemplate) {
    // 제목 없는 메일은 스팸으로 걸리거나 목록에서 아예 못 찾는다.
    fieldErrors.subjectTemplate = "제목 형식을 입력해 주세요.";
  } else if (subjectTemplate.length > SUBJECT_MAX) {
    fieldErrors.subjectTemplate = `제목 형식은 ${SUBJECT_MAX}자까지 입력할 수 있습니다.`;
  }

  // 머리말·꼬리말은 **비워도 된다.** 비우면 그 줄이 아예 빠진다
  // (domain/intake-mail-body.ts) — 빈 줄이 남지 않는다.
  const introText = typeof input.introText === "string" ? input.introText : "";
  if (introText.length > TEXT_MAX) {
    fieldErrors.introText = `머리말은 ${TEXT_MAX}자까지 입력할 수 있습니다.`;
  }
  const outroText = typeof input.outroText === "string" ? input.outroText : "";
  // 서명은 여기서 길이만 본다. 정화는 저장 직전에 한 번(mutations) — 자르는
  // 자리와 거르는 자리를 갈라 두면 어느 쪽이 방어선인지 흐려진다.
  const signatureHtml =
    typeof input.signatureHtml === "string" ? input.signatureHtml.slice(0, SIGNATURE_HTML_MAX) : "";
  if (outroText.length > TEXT_MAX) {
    fieldErrors.outroText = `꼬리말은 ${TEXT_MAX}자까지 입력할 수 있습니다.`;
  }

  const rawIds = Array.isArray(input.recipientUserIds) ? input.recipientUserIds : null;
  if (!rawIds) {
    fieldErrors.recipientUserIds = "수신자 목록을 읽을 수 없습니다.";
  }
  // 같은 사람이 두 번 들어오면 한 번으로 접는다. 화면이 그럴 일은 없지만
  // 유니크 인덱스에 걸려 저장 전체가 실패하는 것보다 낫다.
  const recipientUserIds = [...new Set((rawIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];

  /*
   * 🔴 "켰는데 수신자가 없다" 는 막는다.
   *
   * 저장은 되지만 한 통도 안 나가는 상태이고, 화면만 보면 켜져 있으므로
   * **아무도 이상하다고 생각하지 않는다.** 접수가 스무 건 쌓인 뒤에야
   * "메일이 안 오는데요" 로 발견된다. 끄거나, 고르거나 둘 중 하나여야 한다.
   */
  if (isEnabled && recipientUserIds.length === 0) {
    fieldErrors.recipientUserIds =
      "자동 발송을 켜려면 수신자를 한 명 이상 골라 주세요. (끈 상태로는 저장할 수 있습니다.)";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    data: { isEnabled, subjectTemplate, introText, outroText, signatureHtml, recipientUserIds },
  };
}

/** 저장된 설정이 없을 때 화면과 발송이 함께 쓰는 초기값. */
export const INTAKE_MAIL_SETTINGS_FALLBACK: Omit<IntakeMailSettingsInput, "recipientUserIds"> = {
  signatureHtml: "",
  isEnabled: false,
  subjectTemplate: DEFAULT_INTAKE_MAIL_TEMPLATE.subject,
  introText: DEFAULT_INTAKE_MAIL_TEMPLATE.intro,
  outroText: DEFAULT_INTAKE_MAIL_TEMPLATE.outro,
};

/**
 * ============================================================================
 * 서명 이미지 — 크기와 개수를 여기서 막는다
 * ============================================================================
 * 바이트를 DB 에 넣으므로(schema/intake-mail.ts 주석) 상한이 곧 안전장치다.
 * 그리고 메일에 동봉되는 값이라, 큰 그림 하나가 전 직원 메일함에 그대로
 * 스무 번 복사된다 — 로고에 3MB 를 쓸 이유가 없다.
 * ============================================================================
 */

/** 장당 상한. 로고·도장 이미지는 보통 수십 KB 다. */
export const SIGNATURE_IMAGE_MAX_BYTES = 300 * 1024;
/** 전체 장수 상한. */
export const SIGNATURE_IMAGE_MAX_COUNT = 5;

/**
 * 받는 형식. SVG 는 일부러 뺐다 — 그 안에 스크립트를 넣을 수 있고, 메일
 * 클라이언트 지원도 들쭉날쭉하다.
 */
export const SIGNATURE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif"] as const;

/** cid 는 사람이 서명 HTML 에 직접 적는다 — 헷갈리지 않게 좁게 받는다. */
const CID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/;

export type ValidateSignatureImageResult =
  | { ok: true; cid: string; mimeType: string }
  | { ok: false; message: string };

export function validateSignatureImage(input: {
  cid: string;
  mimeType: string;
  sizeBytes: number;
  currentCount: number;
}): ValidateSignatureImageResult {
  const cid = input.cid.trim();
  if (!CID_PATTERN.test(cid)) {
    return {
      ok: false,
      message: "이름은 영문·숫자·- 와 _ 만 쓸 수 있고 40자까지입니다(예: logo1).",
    };
  }

  if (!(SIGNATURE_IMAGE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return { ok: false, message: "PNG · JPG · GIF 만 올릴 수 있습니다." };
  }

  if (input.sizeBytes <= 0) {
    return { ok: false, message: "빈 파일입니다." };
  }
  if (input.sizeBytes > SIGNATURE_IMAGE_MAX_BYTES) {
    const kb = Math.round(SIGNATURE_IMAGE_MAX_BYTES / 1024);
    return { ok: false, message: `이미지는 ${kb}KB 까지 올릴 수 있습니다. 줄여서 다시 올려 주세요.` };
  }

  if (input.currentCount >= SIGNATURE_IMAGE_MAX_COUNT) {
    return {
      ok: false,
      message: `이미지는 ${SIGNATURE_IMAGE_MAX_COUNT}장까지 둘 수 있습니다. 쓰지 않는 것을 지우고 다시 올려 주세요.`,
    };
  }

  return { ok: true, cid, mimeType: input.mimeType };
}
