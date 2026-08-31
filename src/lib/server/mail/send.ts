import "server-only";
import { loadMailConfig } from "./config";
import { createMailTransport } from "./transport";

/**
 * ============================================================================
 * 메일 한 통 보내기 — 무엇을 보낼지는 부르는 쪽이 정한다
 * ============================================================================
 * 이 모듈은 **주소와 글자를 받아 SMTP 로 넘기는 일만** 한다. 누구에게 보낼지,
 * 무슨 내용인지, 보내도 되는 상황인지는 전부 부르는 쪽의 판단이다.
 *
 * ── 던지지 않는다 ───────────────────────────────────────────────────────
 * 결과를 값으로 돌려준다. 접수 흐름에 붙었을 때 **메일 실패가 접수를 되돌리면
 * 안 되기 때문**이고, 그 규율은 부르는 쪽이 try/catch 를 빠뜨려도 지켜져야
 * 한다. 여기서 던지지 않으면 빠뜨릴 수가 없다.
 *
 * ── 🔴 오류 메시지에 비밀번호가 섞이지 않게 ─────────────────────────────
 * nodemailer 의 오류는 서버 응답을 그대로 담는데, 인증 실패 응답에 계정이
 * 실려 오는 경우가 있다. 비밀번호가 실린 사례는 없지만, 이 문자열은 화면과
 * 감사 로그로 나가므로 길이를 자르고 config 는 절대 함께 담지 않는다.
 * ============================================================================
 */

export type SendMailResult =
  | { ok: true; accepted: number }
  | { ok: false; reason: "NOT_CONFIGURED" | "SEND_FAILED"; message: string };

/** 오류 문구가 화면과 감사 로그에 실려도 부담 없는 길이로 자른다. */
const MAX_ERROR_LENGTH = 300;

export async function sendMail(input: {
  /** 받는 사람 주소들. 비어 있으면 부르는 쪽의 실수다 — 보내지 않고 알린다. */
  to: string[];
  subject: string;
  /** 평문 본문. HTML 은 쓰지 않는다 — 자료가 고정폭으로 줄 맞춰 읽혀야 한다. */
  text: string;
}): Promise<SendMailResult> {
  if (input.to.length === 0) {
    return { ok: false, reason: "SEND_FAILED", message: "받는 사람이 없습니다." };
  }

  const loaded = loadMailConfig();
  if (!loaded.ok) {
    return { ok: false, reason: "NOT_CONFIGURED", message: loaded.message };
  }

  const transport = createMailTransport(loaded.config);
  try {
    const info = await transport.sendMail({
      from: loaded.config.from,
      // 여러 명에게 한 통으로 보내되 **서로의 주소가 보이지 않게** bcc 로 넣는다.
      // 전사 공지라 수신자 목록이 길고, to 에 늘어놓으면 모든 메일 헤더에 전
      // 직원 주소가 박혀 밖으로 전달될 때 함께 나간다.
      bcc: input.to,
      subject: input.subject,
      text: input.text,
    });
    return { ok: true, accepted: info.accepted?.length ?? input.to.length };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: "SEND_FAILED",
      message: raw.slice(0, MAX_ERROR_LENGTH),
    };
  } finally {
    transport.close();
  }
}
