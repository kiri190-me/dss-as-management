import {
  countImprovementRequestBodyChars,
  IMPROVEMENT_REQUEST_BODY_MAX_CHARS,
  isImprovementRequestMenuKey,
} from "@/lib/domain/improvement-request";

/**
 * ============================================================================
 * 개선 요청 입력 검증 — 형식만 본다
 * ============================================================================
 * weekly-report-goal-input.ts 와 같은 자리의 파일이다. **DB 도 세션도 여기서 만지지
 * 않는다.** 누가 적고 고칠 수 있는가는 정책이라 서버 액션이, 동시 수정(version)은
 * 자료의 문제라 mutation 이 맡는다.
 *
 * ── 본문은 비울 수 없고 2000자를 넘을 수 없다 ────────────────────────────
 * 앞뒤 공백을 걷은 뒤에 센다. 상한은 도메인의 IMPROVEMENT_REQUEST_BODY_MAX_CHARS
 * 하나이고, 스키마의 CHECK 와 같은 수인지는 시험이 대조한다. 글자는 코드 포인트로
 * 센다 — DB 의 char_length 와 같은 방식이다.
 *
 * ── 줄바꿈은 LF 로 통일한다 ─────────────────────────────────────────────
 * 폼으로 보낸 여러 줄 글은 줄바꿈이 CRLF 로 온다. 입력칸은 줄바꿈을 한 글자로
 * 세는데 CRLF 그대로 저장하면 두 글자가 되어, 화면에서 2000자에 맞춘 글이 서버에서
 * 넘친다고 거절된다. 그래서 세기 전에 LF 로 바꾼다.
 *
 * ── 오류는 칸 단위 한국어다 ─────────────────────────────────────────────
 * fieldErrors 의 키는 필드명 그대로이고, 화면은 그 키로 입력칸 밑에 문장을 붙인다.
 * 오류 문장에 본문을 싣지 않는다 — 자유 입력이라 PII 가 섞일 수 있다
 * (schema/improvement-requests.ts 헤더).
 *
 * ── 메뉴는 따로 된 함수가 본다 (2026-09-13) ─────────────────────────────
 * validateImprovementRequestMenuKey 는 「이 요청이 어느 메뉴 아래의 일인가」를 본다.
 * 비울 수 없고, 도메인의 고를 수 있는 열쇠(사이드바 항목 + 기타)만 받는다 — DB 에는
 * CHECK 가 없으므로(스키마 헤더) 여기가 유일한 문이다. 받은 값을 오류 문장에 싣지
 * 않는다(무엇이 올지 모르는 값이다).
 *
 * 본문 검증(validateImprovementRequestFields)에 섞지 않은 것은 그 함수의 결과 모양과
 * 동작을 이미 저장·액션·통합 시험이 쓰고 있어서다. 두 결과를 합치는 것은 부르는 쪽이다.
 * ============================================================================
 */

export type ImprovementRequestFields = {
  /** 앞뒤 공백을 걷고 줄바꿈을 LF 로 통일한 본문. 비어 있지 않다. */
  body: string;
};

export type ValidateImprovementRequestResult =
  | { ok: true; data: ImprovementRequestFields }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateImprovementRequestFields(
  raw: Record<string, unknown>
): ValidateImprovementRequestResult {
  const bodyRaw = raw.body;
  if (typeof bodyRaw !== "string") {
    return { ok: false, fieldErrors: { body: "내용을 확인할 수 없습니다." } };
  }

  const body = bodyRaw.replace(/\r\n?/g, "\n").trim();
  if (body === "") {
    return { ok: false, fieldErrors: { body: "내용을 입력해 주세요." } };
  }
  if (countImprovementRequestBodyChars(body) > IMPROVEMENT_REQUEST_BODY_MAX_CHARS) {
    return {
      ok: false,
      fieldErrors: {
        body: `내용은 ${IMPROVEMENT_REQUEST_BODY_MAX_CHARS}자를 넘을 수 없습니다.`,
      },
    };
  }

  return { ok: true, data: { body } };
}

export type ImprovementRequestMenuFields = {
  /** 고를 수 있는 메뉴 열쇠(navItems 의 key, 또는 기타). 비어 있지 않다. */
  menuKey: string;
};

export type ValidateImprovementRequestMenuResult =
  | { ok: true; data: ImprovementRequestMenuFields }
  | { ok: false; fieldErrors: Record<string, string> };

/** 메뉴 열쇠 검증 — 파일 헤더의 '메뉴는 따로 된 함수가 본다'. 오류 칸 이름은 `menuKey`. */
export function validateImprovementRequestMenuKey(
  raw: Record<string, unknown>
): ValidateImprovementRequestMenuResult {
  const menuKeyRaw = raw.menuKey;
  if (menuKeyRaw === undefined || menuKeyRaw === null || menuKeyRaw === "") {
    return { ok: false, fieldErrors: { menuKey: "메뉴를 골라 주세요." } };
  }
  if (!isImprovementRequestMenuKey(menuKeyRaw)) {
    return { ok: false, fieldErrors: { menuKey: "고를 수 있는 메뉴가 아닙니다. 다시 골라 주세요." } };
  }
  return { ok: true, data: { menuKey: menuKeyRaw } };
}
