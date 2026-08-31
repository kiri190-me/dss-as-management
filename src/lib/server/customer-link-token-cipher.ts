import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * ============================================================================
 * 고객사 전용 주소를 다시 볼 수 있게 보관한다 — 키는 DB 밖에 둔다
 * ============================================================================
 *
 * ■ 왜 보관하게 됐나
 *
 * 원래는 sha256 만 남기고 평문은 발급 순간에만 보여 줬다. 그러면 담당자가
 * "지금 이 고객사 주소가 무엇인지"를 알 방법이 재발급뿐인데, 재발급은 옛
 * 주소를 끊는 조작이라 **확인하려다 고객이 쓰던 주소를 죽이는** 일이
 * 벌어진다. 그래서 주소를 다시 꺼내 볼 수 있게 한다.
 *
 * ■ 그래도 DB 에 평문으로 두지는 않는다
 *
 * 주소 하나가 그 회사의 A/S 현황 전체를 여는 열쇠다. 평문으로 두면 DB 덤프나
 * 백업 파일이 한 번 새는 순간 **모든 고객사의 주소가 통째로** 넘어간다.
 * 여기서는 AES-256-GCM 으로 암호화해 넣고, **푸는 키는 서버 .env 에만** 둔다
 * (`CUSTOMER_LINK_TOKEN_KEY`). DB 만 새면 암호문뿐이라 아무것도 못 연다.
 *
 * 물론 서버 자체가 통째로 털리면 키도 함께 넘어간다 — 그건 이 계층이 막을 수
 * 있는 범위가 아니고, 막으려 한다고 말하지도 않는다. 여기서 없애는 것은
 * **"DB 만 새는" 훨씬 흔한 경로** 하나다.
 *
 * ■ 인증은 지금 그대로 sha256 이다
 *
 * 고객이 들어올 때 맞는 주소인지 판정하는 것은 여전히 `token_hash` 다. 이
 * 암호문은 **사람이 다시 읽기 위한 사본**일 뿐, 인증 경로에 끼지 않는다.
 * 그래서 이 값이 없거나 못 풀어도 고객 접속에는 아무 영향이 없다.
 *
 * ■ 고객사 id 를 AAD 로 묶는다
 *
 * 암호문을 다른 고객사 행에 옮겨 붙이면 복호화가 실패한다. 옮겨 붙이는 것
 * 만으로 A 사 화면에서 B 사 주소가 나오는 일을 구조적으로 막는다.
 * ============================================================================
 */

const KEY_ENV = "CUSTOMER_LINK_TOKEN_KEY";
const VERSION = "v1";
const IV_BYTES = 12; // GCM 표준 nonce 길이
const KEY_BYTES = 32; // AES-256

/**
 * 키를 읽는다.
 *
 *  - 아예 없으면 null → **기능이 꺼진 것이다.** 발급은 그대로 되고 주소만
 *    나중에 볼 수 없다. 키를 넣지 않은 환경(기존 배포)이 발급조차 못 하게
 *    되는 것이 더 나쁘다.
 *  - 있는데 형식이 틀리면 던진다. 오타 난 키로 조용히 "꺼진 것처럼" 도는 것이
 *    가장 위험하다 — 넣어 뒀다고 믿는 사람이 아무도 확인하지 않는다.
 */
function loadKey(): Buffer | null {
  const raw = process.env[KEY_ENV];
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(`${KEY_ENV} 가 base64 가 아닙니다.`);
  }
  if (key.length !== KEY_BYTES) {
    // 키 자체는 절대 메시지에 넣지 않는다 — 길이만 말한다.
    throw new Error(
      `${KEY_ENV} 는 base64 로 디코딩했을 때 ${KEY_BYTES}바이트여야 합니다(현재 ${key.length}바이트). ` +
        `openssl rand -base64 32 로 만든 값을 넣으세요.`
    );
  }
  return key;
}

/** 주소 보관이 켜져 있는가 — 화면이 "왜 주소가 안 보이는지" 말할 때 쓴다. */
export function isCustomerLinkTokenKeyConfigured(): boolean {
  return loadKey() !== null;
}

/**
 * 발급된 평문 토큰을 보관용 암호문으로 바꾼다.
 *
 * 키가 없으면 null — 부르는 쪽은 그대로 발급을 이어 간다(주소만 못 보게 된다).
 */
export function encryptCustomerLinkToken(
  token: string,
  customerId: string
): string | null {
  const key = loadKey();
  if (!key) return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(customerId, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * 보관해 둔 암호문에서 주소를 되꺼낸다.
 *
 * **실패는 전부 null 이다 — 던지지 않는다.** 옛 방식으로 발급돼 암호문이 아예
 * 없는 행, 키를 바꾼 뒤의 행, 손상된 값이 전부 여기로 온다. 화면은 그 셋을
 * 구분할 필요 없이 "이 주소는 확인할 수 없습니다 — 재발급하세요" 하나로
 * 안내하면 된다. 오류를 던지면 주소 하나 때문에 화면 전체가 멈춘다.
 */
export function decryptCustomerLinkToken(
  cipherText: string | null,
  customerId: string
): string | null {
  if (!cipherText) return null;
  const key = loadKey();
  if (!key) return null;

  const parts = cipherText.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_BYTES) return null;

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(customerId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // 태그 불일치(다른 키·다른 고객사·변조)도 여기로 온다.
    return null;
  }
}
