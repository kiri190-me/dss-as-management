import { normalizeFlowchartFaultTag } from "@/lib/validation/repair-case-flowchart-input";

/**
 * [진단 Flowchart 관리] 목록에서 **고장 개소 태그를 몇 개나 보일 것인가**
 * (2026-11-19 사용자 추가 지시).
 *
 * 사용자가 말한 것 — 「목록에 테그는 표에 지장되지 않을 정도로 2~3개만 표시되고
 * [더보기]라던가 어떤 도형 혹은 이모티콘을 누르면 숨겨진 테그들을 볼 수 있도록 해줘.
 * 검색하면 숨겨져 있었던 테그라도 표시될 수 있도록 해줘.」
 *
 * 🔴 같은 날 눈으로 확인한 뒤 **숨은 태그를 보여 주는 방식이 바뀌었다** — 「+N을
 * 눌렀을 때 표 내용이 넓어지는데 그렇게 하지 말고 **플로팅으로 그 위치에 메모
 * 형태로** 숨겨진 테그들이 표시되도록 해줘.」 그래서 이 함수는 더 이상 「펼쳤는가」를
 * 묻지 않는다: 줄에 서는 것과 **메모에 들어갈 것**을 가를 뿐이고, 메모가 떠 있는지는
 * 화면만 아는 일이다. 가르는 규칙 자체는 그 변경 전후로 한 글자도 안 바뀌었다.
 *
 * ── 🔴 왜 화면 파일이 아니라 여기 있나 ──────────────────────────────────
 * 고르는 **규칙**은 값으로 재야 하는데, 그 화면
 * (components/diagnosis-flowcharts/DiagnosisFlowchartManagementScreen.tsx)은 서버
 * 액션을 직접 import 해 사슬 끝에 `server-only` 가 있다 — 시험에서 import 하는 순간
 * 던진다. 규칙을 화면 안에 두면 「넷째 태그가 검색에 걸리면 접힌 채로도 보이는가」
 * 같은 것을 **글자로만** 재게 되고, 그런 시험은 규칙이 틀려도 통과한다.
 *
 * ── 🔴 걸리는지 판정하는 규칙은 **한 곳**이다 ───────────────────────────
 * 거르는 쪽(matchesSearch · matchesTrashSearch)과 보여 주는 쪽(FaultTagPills)이
 * faultTagMatchesQuery 하나를 함께 본다. 두 곳에 따로 적으면 「검색엔 걸렸는데 굵게
 * 선 태그가 하나도 없는」 줄이 생기고, 그 어긋남은 오류 없이 조용하다.
 */

/**
 * 접었을 때 펴 보이는 수. 🔵 **표와 카드가 같다** — 카드가 자리는 더 넓지만, 같은
 * 줄이 창 폭에 따라 다르게 읽히면(표에서는 셋, 카드에서는 다섯) 「접힌 것이 있다」는
 * 사실 자체가 창 크기에 따라 달라진다. 이 목록은 표와 카드를 실제 넘침으로
 * 오가므로(common/responsive-list.tsx) 그 어긋남이 수시로 눈에 띈다.
 *
 * 🔴 셋을 넘기지 않는 까닭은 **표 폭**이다 — 하나에 20개까지 달 수 있고
 * (validateFlowchartFaultTags), 다 펴면 「Flowchart 이름」 칸이 태그 수만큼 넓어져
 * 좁은 화면에서 카드로 넘어가는 폭이 줄 내용에 따라 달라진다.
 */
export const MAX_VISIBLE_FAULT_TAGS = 3;

/**
 * 태그 하나가 찾는 글에 걸리는가.
 *
 * 🔴 찾는 글은 **`#` 를 떼고** 견준다 — 사람은 `#우내` 로 친다(태그라고 하면 `#` 를
 * 먼저 치는 손버릇이다). 저장할 때 떼므로, 안 떼고 견주면 「분명히 달아 뒀는데 안
 * 나오는」 칸이 된다. 다듬는 규칙은 태그를 적어 넣는 자리와 **같은 함수**를 쓴다
 * (normalizeFlowchartFaultTag) — 여기서 새로 짜면 저장된 모양과 조용히 갈린다.
 * 🔵 대소문자는 가리지 않는다 — 영문 약어로 적은 개소(`RF출력`)를 소문자로 찾는다.
 *
 * 🔵 **빈 글자는 아무것도 안 고른다**(`true` 가 아니다). 「찾기를 안 하는 상태」에서
 * 모든 태그가 「걸린 것」이 되면 굵게 서는 표시가 뜻을 잃고, 접는 규칙도 무너진다
 * (걸린 것은 상한을 넘겨서라도 보이므로 20개가 통째로 펴진다). 줄 전체를 통과시키는
 * 일은 부르는 쪽(matchesSearch)이 먼저 하고 여기까지 오지 않는다.
 */
export function faultTagMatchesQuery(tag: string, query: string): boolean {
  const key = normalizeFlowchartFaultTag(query).toLowerCase();
  if (key.length === 0) return false;
  return tag.toLowerCase().includes(key);
}

export type FaultTagDisplay = {
  /** **줄에 그대로 서는** 태그. */
  visible: string[];
  /**
   * **메모 안에 서는** 태그 — `+N` 손잡이를 누르면 뜨는 쪽이다. 수가 곧 `N` 이고,
   * 비어 있으면 손잡이 자체를 안 그린다.
   *
   * 🔵 `visible` 과 합치면 받은 태그 전부이고, 겹치는 것은 없다 — 한쪽에서 새거나
   * 양쪽에 다 서는 태그가 생기면 사람이 세는 수와 `+N` 이 어긋난다.
   */
  hidden: string[];
};

/**
 * 줄에 보일 것과 **메모로 보낼 것**을 가른다.
 *
 * 🔴 **검색에 걸린 태그가 먼저이고, 상한을 넘겨서라도 줄에 선다.** 걸렸는데 메모
 * 안에 숨어 있으면 **왜 이 줄이 나왔는지 알려고 손잡이를 또 눌러야 하고**, 그러면
 * 검색이 고장 난 것으로 읽힌다(2026-11-19 사용자 지시의 핵심이 이 한 줄이다).
 * 그 다음 자리가 남으면 나머지 태그로 상한까지 채운다 — 찾기를 안 하는 평소에는
 * 걸린 것이 없으므로 **그냥 앞의 셋**이고, 차례도 저장된 그대로다.
 *
 * 🔵 메모 쪽(`hidden`)의 차례도 **받은 그대로**다 — 걸린 것은 이미 줄로 올라갔으니
 * 여기서 다시 섞을 까닭이 없고, 섞으면 같은 줄을 두 번 열 때마다 차례가 달라 보인다.
 *
 * 🔵 돌려주는 배열 둘은 **늘 새 배열**이다 — 받은 배열을 그대로 돌려주면 부르는
 * 쪽이 그것을 고쳐 원본까지 바꿀 수 있다.
 */
export function selectVisibleFaultTags(tags: readonly string[], query: string): FaultTagDisplay {
  const matched: string[] = [];
  const rest: string[] = [];
  for (const tag of tags) {
    if (faultTagMatchesQuery(tag, query)) matched.push(tag);
    else rest.push(tag);
  }
  // 🔴 걸린 것이 상한보다 많으면 남는 자리는 음수가 된다 — slice 에 음수를 넘기면
  // **뒤에서부터** 잘라 엉뚱한 태그가 따라붙는다. 0 으로 막는다.
  const room = Math.max(0, MAX_VISIBLE_FAULT_TAGS - matched.length);
  return {
    visible: [...matched, ...rest.slice(0, room)],
    hidden: rest.slice(room),
  };
}
