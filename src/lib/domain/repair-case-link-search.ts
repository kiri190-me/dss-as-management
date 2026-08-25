import { normalizeEntityName } from "./entity-name-match";

/**
 * ============================================================================
 * 수리 건 연결 고르개 — 검색으로 거르는 계산
 * ============================================================================
 * 내자 정리 수정 폼의 '수리 건 연결'은 원래 `<select>` 하나였다. 건수가 200을
 * 넘기면 그 방식으로는 원하는 건을 찾을 수 없다 — 사람이 아는 것은 인수번호
 * 한 줄이고, 드롭다운은 그 번호를 찾아 주지 않는다.
 *
 * 그래서 검색 칸을 앞에 두고, **무엇이 남는지 정하는 규칙만** 이 파일에 둔다.
 * React 도 DB 도 들어오지 않는다(domestic-order-list.ts 와 같은 자리, 같은
 * 이유) — 화면 안에 두면 "대문자로 쳐도 걸리는가"를 시험할 방법이 브라우저를
 * 띄우는 것밖에 남지 않는다.
 *
 * ── 맞추는 방식은 이 저장소가 이미 쓰던 것이다 ──────────────────────────
 * 앞뒤 공백을 떼고, 사이 공백을 한 칸으로 줄이고, 대소문자를 무시한다
 * (entity-name-match.ts 의 normalizeEntityName — 접수 폼의 고객사·End-User
 * 고르개와 DB 의 정규화 유니크 인덱스가 쓰는 바로 그 규칙). 여기서 규칙을 새로
 * 적으면 같은 글자가 화면마다 다르게 걸린다.
 *
 * rankSimilarNames 는 쓰지 않는다 — 그쪽은 `{ name }` 하나를 이름순으로
 * 줄 세우는 함수이고, 여기서 걸러야 하는 것은 **세 칸(인수번호 · 고객사 ·
 * 형식)** 이며 순서는 이미 정해져 있다(최신 인수번호가 위 — 조회의 ORDER BY).
 *
 * ── 빈 검색어는 거르지 않는다 ───────────────────────────────────────────
 * 아직 아무것도 치지 않은 상태에서 목록이 비면, 사용자는 "고를 수 있는 건이
 * 없다"고 읽는다. 공백만 친 경우도 같다 — 스페이스 한 칸이 목록을 통째로
 * 지우면 안 된다.
 * ============================================================================
 */

/** 걸러 낼 때 실제로 보는 칸만 요구한다 — 조회의 전체 옵션 타입을 끌어오지 않는다. */
export type RepairCaseLinkSearchable = {
  id: string;
  intakeNumber: string;
  customerName: string | null;
  modelName: string | null;
};

/**
 * 검색어에 걸리는 수리 건만 남긴다. **입력 순서를 그대로 지킨다** — 부르는
 * 쪽이 최신 인수번호부터 정렬해 넘기므로, 여기서 다시 줄 세우면 "방금 들어온
 * 건이 위"라는 성질이 검색할 때만 사라진다.
 *
 * 인수번호 · 고객사명 · 형식 셋 중 **하나라도** 검색어를 품고 있으면 남는다.
 * 사람이 인수번호를 정확히 기억하지 못할 때 실제로 치는 것이 고객사 이름이다.
 * 검색어가 비었거나 공백뿐이면 전부 돌려준다(파일 헤더).
 */
export function filterRepairCaseLinkOptions<T extends RepairCaseLinkSearchable>(
  options: readonly T[],
  query: string
): T[] {
  const q = normalizeEntityName(query);
  if (q === "") return [...options];

  return options.filter((option) =>
    [option.intakeNumber, option.customerName, option.modelName].some(
      (field) => field !== null && field !== undefined && normalizeEntityName(field).includes(q)
    )
  );
}

/**
 * 지금 고른 건은 검색어에 걸리지 않아도 목록에 남긴다.
 *
 * 남기지 않으면 실제로 고장이 난다: `<select>` 의 value 가 어느 `<option>` 과도
 * 맞지 않게 되어 브라우저가 첫 항목('연결 없음')을 보여 준다. 상태에는 여전히
 * 그 건이 들어 있으므로 **화면이 거짓말을 하고**, 사용자는 연결을 지운 줄
 * 알았다가 저장하면 그대로 남아 있는 것을 보게 된다.
 *
 * 자리는 원본 순서 그대로다 — 고른 건이 갑자기 맨 위로 튀어 오르지 않는다.
 */
export function keepSelectedRepairCaseOption<T extends RepairCaseLinkSearchable>(
  options: readonly T[],
  filtered: readonly T[],
  selectedId: string | null | undefined
): T[] {
  if (!selectedId) return [...filtered];
  if (filtered.some((option) => option.id === selectedId)) return [...filtered];
  if (!options.some((option) => option.id === selectedId)) return [...filtered];

  const kept = new Set(filtered.map((option) => option.id));
  return options.filter((option) => kept.has(option.id) || option.id === selectedId);
}
