/**
 * ============================================================================
 * 원본 파일이 **올린 사람 PC 에서 마지막으로 저장된 시각**
 * ============================================================================
 * 제품 모델 상세의 파일 목록이 「올린 날짜」 옆에 이것을 함께 보여 준다. 묻는
 * 것은 "우리 시스템에 언제 들어왔나"가 아니라 **"이 양식이 언제 갱신된 것인가"**
 * 다(사용자 요청 2026-09-30). 그래서 값의 출처도 우리 서버가 아니라 브라우저가
 * 주는 `File.lastModified`(에포크 밀리초) 하나뿐이다.
 *
 * ── 🔴 이 값은 믿을 수 없다 ─────────────────────────────────────────────
 * 올리는 PC 의 시계가 틀리면 그 틀린 값이 그대로 들어온다. 파일시스템이 수정
 * 시각을 모르면 0 이나 바닥값이 대신 들어오기도 한다. 그런 값을 그대로 표에
 * 적으면 화면은 **거짓을 사실처럼** 말하게 되고, 읽는 사람은 그것을 근거로
 * "이 양식은 오래됐다 / 최신이다"를 판단한다. 그래서 **터무니없는 값은 빈칸으로
 * 둔다** — 모른다고 말하는 쪽이 틀린 날짜를 말하는 쪽보다 낫다.
 *
 * ── 🔴 그래도 업로드는 막지 않는다 ──────────────────────────────────────
 * 이 판정이 무엇을 거절하든 **파일은 올라간다.** 날짜 하나 때문에 회로도를 못
 * 올리는 일은 없어야 한다(사용자 결정). 이 파일의 함수들이 실패를 던지지 않고
 * 늘 `Date | null` 로만 답하는 것이 그 성질의 전부다 — 부르는 쪽에 "거절"이라는
 * 갈래 자체를 주지 않는다.
 *
 * ── 왜 화면·통로가 아니라 이 파일에 있나 ────────────────────────────────
 * 순수 계산이라 시험이 붙는다. 화면이나 라우트 안에 두면 붙지 않는다 —
 * reported-symptom-param.ts 가 적어 둔 것과 같은 까닭이다.
 *
 * ── 🔴 보내는 쪽과 받는 쪽이 같은 문을 지난다 ──────────────────────────
 * 올리는 화면(originalModifiedAtParamValue)도, 받는 통로
 * (originalModifiedAtFromSearchParams)도 아래 판정 **하나**를 쓴다. 규칙을 두 곳에
 * 따로 적으면 "화면은 보냈는데 서버가 버리는" 어긋남이 생기고, 그때는 아무 오류도
 * 나지 않아 아무도 모른다. 실을 수 없는 값이면 화면은 **아예 보내지 않고**, 서버는
 * 그래도 다시 판정한다(통로는 화면만 부르는 것이 아니다).
 * ============================================================================
 */

/**
 * 주소에 싣는 이름. 브라우저가 준 속성 이름(`File.lastModified`)을 그대로 쓴다 —
 * 이 값이 **우리가 잰 것이 아니라 브라우저에게서 받은 것**임을 통로에서도 읽히게
 * 한다. 표와 DB 칸은 우리 말(원본 수정일 / original_modified_at)로 부른다.
 *
 * 화면도 통로도 이 글자를 직접 적지 않고 아래 함수들을 부른다.
 */
export const ORIGINAL_MODIFIED_AT_PARAM = "lastModified";

/**
 * 받아들이는 가장 이른 시각 — **1990-01-01T00:00:00Z**.
 *
 * 이 아래의 값은 "그때 저장했다"가 아니라 **"모른다"의 다른 표현**이다:
 *   · `0`(1970-01-01) — 파일시스템이 수정 시각을 주지 못했을 때 그대로 들어온다.
 *   · 1980-01-01 — FAT·zip 이 시각을 적지 못할 때 쓰는 바닥값이다. 압축을 풀어
 *     받은 양식 파일이 실제로 이 날짜를 달고 온다.
 *
 * 그리고 이 자리에 올라오는 것은 사람이 만든 엑셀·PDF 양식이다. **그 형식들이
 * 1990년에는 있지도 않았다**(PDF 1.0 은 1993년, xlsx 는 2007년). 즉 이 경계는
 * 진짜 값을 하나도 버리지 않으면서 위의 두 가짜만 걸러 낸다.
 */
export const MIN_ORIGINAL_MODIFIED_AT_MS = Date.UTC(1990, 0, 1);

/**
 * 앞선 시계를 봐주는 폭 — **24시간**.
 *
 * 사무실 PC 의 시계가 몇 분에서 몇 시간 어긋나 있는 일은 실제로 있고, 그런 파일의
 * 수정 시각은 여전히 쓸 만하다. 반대로 하루를 넘겨 앞선 값은 "언제 갱신된
 * 양식인가"에 답이 되지 못한다 — 아직 오지 않은 날에 저장된 양식은 없다.
 *
 * 값 자체는 UTC 에포크 밀리초라 시간대와는 상관이 없다. 봐주는 것은 오직 시계
 * 오차다.
 */
export const MAX_ORIGINAL_MODIFIED_AT_AHEAD_MS = 24 * 60 * 60 * 1000;

/** 주소에 실린 글자가 정수인가. 공백을 걷어낸 뒤에 본다. */
const INTEGER_TEXT = /^-?\d+$/;

/**
 * 에포크 밀리초 → 쓸 수 있는 시각. 쓸 수 없으면 `null`(= 빈칸).
 *
 * 버리는 것: 숫자가 아님 · NaN · 무한대 · 정수가 아님 · 0 과 음수를 포함한 아주 먼
 * 과거 · 하루를 넘겨 앞선 미래. `File.lastModified` 는 언제나 정수 밀리초라,
 * 정수가 아닌 값은 브라우저가 준 값이 아니라는 뜻이다.
 *
 * `now` 를 인자로 받는 것은 시험이 "미래"를 고정된 값으로 물을 수 있게 하기
 * 위해서다 — 안 넘기면 지금 시각이다.
 */
export function originalModifiedAtFromEpochMs(value: unknown, now: Date = new Date()): Date | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < MIN_ORIGINAL_MODIFIED_AT_MS) return null;
  if (value > now.getTime() + MAX_ORIGINAL_MODIFIED_AT_AHEAD_MS) return null;
  return new Date(value);
}

/**
 * `?lastModified=` 의 글자 → 쓸 수 있는 시각. 쓸 수 없으면 `null`(= 빈칸).
 *
 * 같은 이름이 두 번 오면(`?lastModified=1&lastModified=2` → 배열) 통째로 버린다 —
 * 어느 쪽을 고르든 근거가 없다. 주소의 다른 값들과 같은 판단이다
 * (reported-symptom-param.ts · workflow-publish-counts-param.ts).
 */
export function originalModifiedAtFromParam(
  value: string | string[] | undefined | null,
  now: Date = new Date()
): Date | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  // 글자 모양부터 본다. Number("") 는 0, Number("0x10") 은 16 처럼 **숫자가 아닌
  // 글자가 조용히 숫자가 되는** 길이 여럿이라, 정수 모양만 통과시킨 뒤에 센다.
  if (!INTEGER_TEXT.test(trimmed)) return null;

  return originalModifiedAtFromEpochMs(Number(trimmed), now);
}

/**
 * URLSearchParams 에서 바로 읽는 자리. 이름을 이 파일 안에 가둔다.
 *
 * `get` 이 아니라 `getAll` 을 쓰는 이유: `get` 은 같은 이름이 두 번 와도 첫 값을
 * 조용히 돌려준다. 그러면 위의 "두 번 오면 버린다" 규칙이 이 자리에서만 사라진다.
 */
export function originalModifiedAtFromSearchParams(
  searchParams: URLSearchParams,
  now: Date = new Date()
): Date | null {
  const all = searchParams.getAll(ORIGINAL_MODIFIED_AT_PARAM);
  if (all.length !== 1) return null;
  return originalModifiedAtFromParam(all[0], now);
}

/**
 * `File.lastModified` → 주소에 실을 글자. 실을 수 없으면 `null` 이고, 그때 올리는
 * 화면은 **이 값을 아예 보내지 않는다**(파일 머리말의 '같은 문을 지난다').
 *
 * 받는 쪽과 같은 판정을 지나므로, 보낸 값이 서버에서 버려지는 일이 없다.
 */
export function originalModifiedAtParamValue(value: unknown, now: Date = new Date()): string | null {
  const accepted = originalModifiedAtFromEpochMs(value, now);
  return accepted === null ? null : String(accepted.getTime());
}
