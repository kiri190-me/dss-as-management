/**
 * 절차의 **코드를 서버가 짓는다**(2026-11-05). 순수 함수 하나뿐이다 — DOM 도
 * React 도 DB 도 안 건드린다.
 *
 * ──────────────────────────────────────────────────────────────────────
 * 왜 사람이 더는 안 적는가
 * ──────────────────────────────────────────────────────────────────────
 * 사용자 요구: "새 기술 절차를 만들 때, 코드를 적는 칸을 없애줘. 코드가 필요하다고
 * 못 느끼겠어." 실제로 손으로 적힌 값이 쓸모를 잃고 있었다 — 개발 DB 의
 * TECHNICAL_TASK 코드는 `1` · `2` · `7` · `고객` 이거나, 아예 **이름을 그대로 복사한
 * 것**이다(`기본 통전 검사 (3상 입력)`). 그 복사본 때문에 요약 카드에
 * 「이름 (이름)」이 뜬 적도 있다(procedure-template-title.ts 머리말).
 *
 * ──────────────────────────────────────────────────────────────────────
 * 🔴 그래도 코드 자체는 없앨 수 없다 — 판본을 묶는 열쇠다
 * ──────────────────────────────────────────────────────────────────────
 * `procedure_templates` 에 `UNIQUE (code, version)` 이 걸려 있고, **같은 code 를 가진
 * 행들이 한 절차의 여러 판**이다. 판본 목록 · 게시(계열을 통째로 잠근다) · 다음 판
 * 번호(`max(version) + 1`) · 「다음 절차」 후보에서 자기 계열 빼기 — 넷이 전부 이
 * 값으로 돈다. 그러니 사람 눈에서만 걷어내고, 값은 **서버가 대신 짓는다.**
 *
 * ──────────────────────────────────────────────────────────────────────
 * 모양 — `TECH-20261105-K7M2QX`
 * ──────────────────────────────────────────────────────────────────────
 * 가운데가 **만든 날(KST)** 이다. 사람이 이 값을 읽는 자리는 이제 없지만, 로그·DB 를
 * 들여다보는 날에 「언제 생긴 줄기인가」가 값 자체에 적혀 있으면 한 번 덜 묻는다.
 * 날짜는 toKstDateOnly 를 그대로 쓴다 — 이 시스템은 한국에서 돌고, 호스트 프로세스가
 * UTC 로 서면 00~09시 사이에 **하루 전 날짜**가 박히기 때문이다(date-only.ts 머리말).
 *
 * 🔴 **유일성을 뒤 여섯 글자에만 맡기지 않는다.** 32^6 ≈ 10.7억이라 하루에 수백 개를
 * 만들어도 부딪힐 일이 사실상 없지만, 「사실상 없다」는 보장이 아니다. 진짜 보장은
 * DB 의 `UNIQUE (code, version)` 하나뿐이고, 부르는 쪽(mutations/procedure-templates.ts)
 * 이 **유일 제약 위반을 잡아 코드를 다시 지어 재시도**한다. 여기서 미리 SELECT 해
 * 보는 길은 안 골랐다 — 조회와 INSERT 사이에 남이 끼어들 수 있어 경합을 못 막으면서
 * 질의만 한 번 늘고, 「확인했으니 안전하다」는 틀린 안심을 남긴다.
 *
 * 🔵 글자는 **헷갈리는 넷(I · L · O · U)을 뺀** 32개다. 사람이 평소에 볼 일은 없지만
 * 장애를 쫓는 날에는 입으로 읽고 손으로 옮겨 적게 된다. 32개(2^5)인 것도 일부러다 —
 * 무작위 바이트의 아래 5비트를 그대로 쓰면 나머지 연산에서 생기는 **치우침이 없다**.
 */

import { toKstDateOnly } from "./date-only";

/** 지어진 코드의 맨 앞. 들여온 절차의 코드(`rfg-full-lifecycle` 등)와 한눈에 갈린다. */
export const GENERATED_PROCEDURE_CODE_PREFIX = "TECH";

/** 뒤 꼬리에 쓰는 글자 32개 — I · L · O · U 를 뺀 숫자+대문자(Crockford base32). */
export const GENERATED_PROCEDURE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 꼬리 길이. 32^6 ≈ 10.7억 — 날짜가 앞에 붙으므로 **하루치** 경우의 수다. */
export const GENERATED_PROCEDURE_CODE_SUFFIX_LENGTH = 6;

/** 지어진 코드가 이 모양인가. 시험이 「무엇을 재는지」 먼저 못 박는 데 쓴다. */
export const GENERATED_PROCEDURE_CODE_PATTERN = /^TECH-\d{8}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/**
 * 새 절차의 코드를 하나 짓는다. `now` 를 받는 것은 시험이 날짜 부분을 값으로 재기
 * 위해서다(실제 호출부는 아무것도 안 넘긴다).
 *
 * 🔴 **같은 입력으로 불러도 매번 달라야 한다.** 날짜만 쓰면 같은 날 만든 두 절차가
 * 같은 코드를 받아 두 번째가 조용히 CONFLICT 로 막힌다 — 사람 쪽에는 「만들기가
 * 안 된다」로만 보이고 까닭이 화면 어디에도 없는 종류의 결함이다.
 */
export function generateProcedureTemplateCode(now: Date = new Date()): string {
  const day = toKstDateOnly(now).replace(/-/g, "");

  // Web Crypto 의 전역 API 를 쓴다 — `node:crypto` 를 들여오면 이 파일을 (실수로라도)
  // 화면 조각이 부르는 날 번들이 깨진다. src/lib/domain 은 서버·화면이 함께 읽는 자리다.
  const bytes = new Uint8Array(GENERATED_PROCEDURE_CODE_SUFFIX_LENGTH);
  crypto.getRandomValues(bytes);

  let suffix = "";
  for (const byte of bytes) {
    // 아래 5비트만 쓴다(0~31). 글자가 정확히 32개라 나머지 연산의 치우침이 없다.
    suffix += GENERATED_PROCEDURE_CODE_ALPHABET[byte & 31];
  }

  return `${GENERATED_PROCEDURE_CODE_PREFIX}-${day}-${suffix}`;
}
