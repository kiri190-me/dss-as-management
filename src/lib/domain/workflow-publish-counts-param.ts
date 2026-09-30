/**
 * ============================================================================
 * 워크플로 발행 결과의 건수 → 주소 → 도착 화면의 문장
 * ============================================================================
 * 초안을 발행하면 그 종류의 **진행 중인 접수 건이 새 버전으로 함께 옮겨진다**
 * (db/mutations/workflow-drafts.ts 의 migrateInFlightCasesToVersion). 수십 건이
 * 한 번에 움직이는데, 초안 편집기는 발행하자마자 화면을 떠나므로(navigateTo)
 * 그 자리에서 알릴 수가 없다 — 떠나는 화면의 메시지는 사람이 읽기 전에 사라진다.
 *
 * 그래서 옮긴 수·남은 수를 **주소에 실어** 도착 화면이 말하게 한다. 이 저장소가
 * `?done=published` 로 이미 쓰고 있는 길을 그대로 넓힌 것이다(새 장치가 아니다).
 *
 * ── 이 파일에 모아 둔 까닭 ──────────────────────────────────────────────
 *   · **문장이 한 곳에만 있게 한다.** 같은 두 문장을 Server Action(발행 결과
 *     메시지)과 도착 화면(주소에서 읽은 값)이 함께 쓴다. 양쪽에 베껴 적으면
 *     한쪽만 고쳐지는 날이 오고, 그때 증상은 "옮겼다는 건수가 화면마다 다르다"다.
 *   · **주소는 사람이 손으로 고칠 수 있는 자리다.** `?moved=-5` · `?moved=abc` ·
 *     `?moved=99999999999` 를 그대로 믿고 그리면 화면이 거짓말을 한다. 읽는
 *     규칙을 화면 안에 두면 시험이 붙지 않아, 여기(순수 계산)에 둔다 —
 *     service-report-kind-param.ts 와 같은 판단이다.
 * ============================================================================
 */

/**
 * 주소에 싣는 두 이름. 화면은 이 이름을 직접 적지 않고 아래 함수에 searchParams
 * 를 통째로 넘긴다 — 만드는 쪽과 읽는 쪽의 이름이 갈라질 자리를 없앤다.
 */
const MOVED_PARAM = "moved";
const STRANDED_PARAM = "stranded";

/**
 * 받아들이는 건수의 윗값. 접수 건 전체보다 넉넉하게 잡되, 주소에 적힌 터무니없는
 * 수(`?moved=99999999999`)는 걸러낸다. 걸러진 값은 **그 문장을 통째로 빼는 것**
 * 으로 끝난다 — 주소가 이상하다고 오류 화면을 띄울 일은 아니다.
 */
export const MAX_PUBLISH_CASE_COUNT = 100_000;

/**
 * 말할 값인가. 🔴 `0`은 말하지 않는다 — "0건을 옮겼습니다"는 읽는 사람에게
 * 아무것도 알려 주지 않으면서 문장만 길게 만든다. 옮길 것이 없었다는 뜻이라
 * 굳이 말할 필요가 없다. 주소에서 온 값과 서버가 센 값이 같은 문을 지난다.
 */
function isCountToTell(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_PUBLISH_CASE_COUNT;
}

/**
 * `?moved=` · `?stranded=` 의 글자 → 건수. 읽을 수 없으면 `null`(= 그 문장 없음).
 *
 * 🔴 `Number()` 하나로 끝내지 않는다. 그러면 `" 5"`·`"5.5"`·`"1e3"`·`"0x10"` 이
 * 전부 숫자가 되어 통과한다. 우리가 만드는 링크는 언제나 10진 정수만 싣는다.
 */
export function workflowPublishCountFromParam(value: string | string[] | undefined | null): number | null {
  // 같은 이름이 두 번 올 수 있는 자리다(`?moved=1&moved=2` → 배열). 어느 쪽을
  // 고르든 근거가 없으므로 통째로 버린다 — 주간보고의 `?week=` 과 같은 판단.
  if (typeof value !== "string") return null;
  // 자릿수부터 막는다 — 길이를 열어 두면 parseInt 가 아주 긴 글자를 읽고 나서야
  // 걸러진다. 음수 기호·소수점·공백·지수 표기는 이 한 줄에서 함께 떨어진다.
  if (!/^\d{1,6}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return isCountToTell(parsed) ? parsed : null;
}

/**
 * 발행 결과를 사람이 읽는 문장으로. 말할 것이 없으면 빈 배열이다.
 *
 * Server Action 은 서버가 센 수로, 도착 화면은 주소에서 읽은 수로 이 함수를
 * 부른다 — 그래서 두 곳의 문장이 언제나 같다.
 */
export function workflowPublishCaseSentences(counts: {
  migrated: number | null | undefined;
  stranded: number | null | undefined;
}): string[] {
  const { migrated, stranded } = counts;
  const sentences: string[] = [];
  if (isCountToTell(migrated)) {
    sentences.push(`진행 중인 접수 건 ${migrated}건을 새 버전으로 옮겼습니다.`);
  }
  if (isCountToTell(stranded)) {
    // 남은 건은 사람이 손으로 처리해야 하는 일이므로 이유와 함께 알린다.
    sentences.push(`현재 단계가 새 버전에 없는 ${stranded}건은 이전 버전에 그대로 두었습니다.`);
  }
  return sentences;
}

/**
 * 도착 화면의 주소. 말할 것이 없는 수는 아예 싣지 않는다 — `?moved=0` 은 주소만
 * 길게 만들고 도착 화면에서 어차피 빠진다.
 */
export function workflowPublishDoneHref(
  templateCode: string,
  counts: { migrated: number | null | undefined; stranded: number | null | undefined }
): string {
  const query = new URLSearchParams({ done: "published" });
  if (isCountToTell(counts.migrated)) query.set(MOVED_PARAM, String(counts.migrated));
  if (isCountToTell(counts.stranded)) query.set(STRANDED_PARAM, String(counts.stranded));
  return `/workflows/${templateCode}?${query.toString()}`;
}

/**
 * 도착 화면이 부르는 자리. searchParams 를 통째로 받아 이름을 이 파일 안에
 * 가둔다 — 화면이 `searchParams.moved` 를 직접 적으면 만드는 쪽 이름과 갈라진다.
 */
export function workflowPublishCaseSentencesFromParams(params: {
  moved?: string | string[];
  stranded?: string | string[];
}): string[] {
  return workflowPublishCaseSentences({
    migrated: workflowPublishCountFromParam(params[MOVED_PARAM]),
    stranded: workflowPublishCountFromParam(params[STRANDED_PARAM]),
  });
}
