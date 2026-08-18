/**
 * ============================================================================
 * 브라우저에서 UUID를 만들 때는 반드시 이 함수를 쓴다 — `crypto.randomUUID()`를
 * 직접 호출하지 않는다.
 * ============================================================================
 * `crypto.randomUUID()`는 Web Crypto 스펙상 "secure context"에서만 존재한다 —
 * `https://`와 `http://localhost`에서는 되지만, `http://10.150.71.135:3000`
 * 같은 평문 HTTP LAN 주소에서는 **undefined**다. 즉 PC에서 localhost로 열면
 * 멀쩡하고 폰에서 LAN 주소로 열면 그 화면 전체가 죽는다.
 *
 * 실제 사고 이력(2026-08-18): 작업내용 탭의 WorkRecordForm이 useState 초기화에서
 * 이 함수를 호출해, 폰에서 그 탭에 들어갈 때마다
 * "TypeError: crypto.randomUUID is not a function"으로 에러 경계가 떴다
 * (repair-cases/error.tsx의 "A/S 데이터를 불러오지 못했습니다"). 서버 로그에는
 * 아무것도 남지 않는다 — 클라이언트 렌더 오류를 에러 경계가 삼키기 때문이다.
 * 같은 원인이 그 이전에 접수 폼(intake-idempotency-key.ts)에서도 한 번 터졌고,
 * 그때는 그 파일 안에서만 고쳐 나머지 호출부는 그대로 남아 재발했다. 그래서
 * 이번에는 공용 모듈로 분리한다.
 *
 * `crypto.getRandomValues()`는 secure-context 제약이 없어 평문 HTTP에서도
 * 동작하므로, 그 난수로 RFC 4122 v4 UUID를 직접 조립한다 — 형식이 표준과
 * 동일해야 하는 이유는 이 값들이 Postgres `uuid` 컬럼에 그대로 들어가기
 * 때문이다(`repair_case_work_records.client_request_id`,
 * `idempotency_keys.idempotency_key`). 아무 랜덤 문자열이나 쓰면 INSERT가
 * 실패한다.
 *
 * Math.random() 폴백은 두지 않는다 — 이 프로젝트에 선례가 없고, 위 두 단계로
 * 현실적인 모든 브라우저가 커버된다. 멱등성 키가 예측 가능해지는 것도 곤란하다.
 */
export function generateClientUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }
  throw new Error("No secure random UUID source available in this browser.");
}
