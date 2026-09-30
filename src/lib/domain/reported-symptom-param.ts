/**
 * ============================================================================
 * 주소의 `?reportedSymptom=` → 수리 건 목록의 신고 증상 필터
 * ============================================================================
 * 대시보드 「신고 증상별 현황」에서 조각을 펼치면 그 증상의 인수점검 결과가
 * 줄줄이 나온다. 그 줄을 누르면 **같은 신고 증상으로 걸러진 수리 건 목록**으로
 * 간다. 그 길을 나르는 것이 이 값 하나다.
 *
 * ── 왜 화면이 아니라 이 파일에 있나 ─────────────────────────────────────
 *   · **신고 증상은 자유 입력 칸이다.** 목록에서 고르는 코드가 아니라 사람이
 *     친 글자라, 길이도 글자 종류도 우리가 정하지 않는다. 그런 값을 주소에
 *     실으려면 "실을 수 있는가"를 판정해야 하고, 판정은 규칙이지 그리기가
 *     아니다.
 *   · **주소는 사람이 손으로 고칠 수 있는 자리다.** 주소창에 아무 글자나
 *     쳐 넣어도 목록이 깨지면 안 된다.
 *   · **순수 계산이라 시험이 붙는다. 페이지 안에 두면 붙지 않는다** —
 *     service-report-kind-param.ts 가 적어 둔 것과 같은 까닭이다.
 *
 * ── 🔴 만드는 쪽과 읽는 쪽이 같은 문을 지난다 ──────────────────────────
 * 링크를 짓는 repairCasesReportedSymptomHref 도, 주소를 읽는
 * reportedSymptomFromParam 도 **같은 판정 하나**를 쓴다. 두 곳에 규칙을 따로
 * 적으면 "링크는 만들어졌는데 눌러 보면 안 걸리는" 증상이 생기고, 그때는
 * 아무 오류도 나지 않아 아무도 모른다. 그래서 실을 수 없는 값이면
 * **링크를 아예 만들지 않는다**(null) — 화면은 그 줄을 누를 수 없는 글자로
 * 두고 까닭을 한 줄 적는다. 눌렀는데 아무 일도 안 일어나는 것보다 낫다.
 *
 * ── 이상한 값은 오류가 아니라 「필터 없음」이다 ────────────────────────
 * 읽을 수 없으면 null 이고, 목록은 **아무것도 거르지 않은 전체**를 보여 준다.
 * 주소가 이상하다고 오류 화면을 띄울 일은 아니다 — workflow-publish-counts-
 * param.ts 가 건수에 대해 내린 것과 같은 판단이다.
 * ============================================================================
 */

/**
 * 주소에 싣는 이름. 화면은 이 글자를 직접 적지 않고 아래 함수들을 부른다 —
 * 만드는 쪽과 읽는 쪽의 이름이 갈라질 자리를 없앤다.
 */
export const REPORTED_SYMPTOM_PARAM = "reportedSymptom";

/**
 * 받아들이는 신고 증상의 최대 글자 수.
 *
 * 신고 증상 칸은 DB 에서 text 라 길이 제한이 없다. 그런데 이 값은 주소에 실려
 * 퍼센트 인코딩되므로(한글 한 자가 9바이트가 된다) 길이를 열어 두면 주소가
 * 브라우저·프록시의 한도에 걸려 **눌렀을 때 아무 데도 못 가는** 일이 생긴다.
 * 200 자는 원 그래프에 이름표로 올라오는 증상(여러 건이 같은 글자로 묶인 값들)
 * 에는 넉넉하고, 주소로도 안전한 자리다.
 */
export const MAX_REPORTED_SYMPTOM_LENGTH = 200;

/**
 * 제어 문자가 섞여 있는가. 줄바꿈·탭·NUL 이 모두 여기 걸린다.
 *
 * 자유 입력 칸이라 여러 줄짜리 증상이 실제로 있을 수 있다. 그래도 싣지 않는
 * 이유: 목록 화면이 걸린 값을 한 줄로 적어 보여 주는데 거기에 줄바꿈이 들어오면
 * 안내 문구가 통째로 흐트러지고, 사람이 주소창에서 그 값을 다시 만들 수도 없다.
 * 그런 증상은 링크가 만들어지지 않아 **화면에서 바로 드러난다**(누를 수 없는
 * 줄 + 까닭 한 줄). 조용히 빗나가는 쪽보다 낫다.
 *
 * 정규식 대신 코드 포인트를 직접 센다 — 제어 문자를 정규식 리터럴에 적으려면
 * 이스케이프가 필요하고, 그 이스케이프가 한 겹 삼켜지면 **원본 파일에 진짜
 * 제어 문자가 박힌다**(이 파일을 만들 때 실제로 한 번 그렇게 됐다).
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * `?reportedSymptom=` 의 글자 → 걸 신고 증상. 걸 수 없으면 `null`(= 필터 없음).
 *
 * 앞뒤 공백은 걷어낸다 — 세는 쪽(fault-symptom-breakdown.ts)이 증상을 묶을 때
 * 쓰는 규칙과 같아야 대시보드에서 센 건수와 목록의 건수가 맞는다.
 */
export function reportedSymptomFromParam(
  value: string | string[] | undefined | null
): string | null {
  // 같은 이름이 두 번 올 수 있는 자리다(`?reportedSymptom=A&reportedSymptom=B`
  // → 배열). 어느 쪽을 고르든 근거가 없으므로 통째로 버린다 — 주간보고의
  // `?week=` · 발행 건수의 `?moved=` 과 같은 판단이다.
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_REPORTED_SYMPTOM_LENGTH) return null;
  if (hasControlCharacter(trimmed)) return null;
  return trimmed;
}

/**
 * URLSearchParams 에서 바로 읽는 자리. 이름을 이 파일 안에 가둔다 — 목록 화면이
 * `searchParams.get("reportedSymptom")` 을 직접 적으면 만드는 쪽 이름과 갈라진다.
 *
 * `get` 이 아니라 `getAll` 을 쓰는 이유: `get` 은 같은 이름이 두 번 와도 첫 값을
 * 조용히 돌려준다. 그러면 위의 "두 번 오면 버린다" 규칙이 이 자리에서만 사라진다.
 */
export function reportedSymptomFromSearchParams(searchParams: URLSearchParams): string | null {
  const all = searchParams.getAll(REPORTED_SYMPTOM_PARAM);
  if (all.length !== 1) return null;
  return reportedSymptomFromParam(all[0]);
}

/**
 * 신고 증상 → 그 증상으로 걸러진 수리 건 목록 주소. 실을 수 없는 값이면 `null`
 * 이고, 그때 화면은 **링크를 만들지 않는다**(파일 머리말).
 *
 * 인코딩은 URLSearchParams 에 맡긴다 — 손으로 encodeURIComponent 를 부르면
 * `&`·`#`·`+` 중 어느 것을 언제 바꿔야 하는지가 부르는 자리마다 달라진다.
 */
export function repairCasesReportedSymptomHref(symptom: string | null | undefined): string | null {
  const normalized = reportedSymptomFromParam(symptom);
  if (normalized === null) return null;
  const query = new URLSearchParams({ [REPORTED_SYMPTOM_PARAM]: normalized });
  return `/repair-cases?${query.toString()}`;
}
