import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_VISIBLE_FAULT_TAGS,
  faultTagMatchesQuery,
  selectVisibleFaultTags,
} from "./repair-case-flowchart-fault-tag-display";

/**
 * [진단 Flowchart 관리] 목록의 **고장 개소 알약을 몇 개 보일 것인가**
 * (2026-11-19 사용자 추가 지시: 「목록에 테그는 표에 지장되지 않을 정도로 2~3개만
 * 표시되고 … 누르면 숨겨진 테그들을 볼 수 있도록 해줘. **검색하면 숨겨져 있었던
 * 테그라도 표시될 수 있도록** 해줘.」).
 *
 * 🔴 같은 날 눈으로 확인한 뒤 **숨은 태그를 보여 주는 방식이 바뀌었다** — 줄 안에서
 * 펴지 않고 **떠 있는 메모**로 뜬다(「+N을 눌렀을 때 표 내용이 넓어지는데 그렇게 하지
 * 말고 플로팅으로 그 위치에 메모 형태로 …」). 그래서 이 함수는 「펼쳤는가」를 더 이상
 * 묻지 않고 **줄에 설 것과 메모로 갈 것**을 가른다. 가르는 규칙 자체는 안 바뀌었다 —
 * 아래 시험들도 재는 **뜻만** 그 모양으로 고쳤다(지우지 않았다).
 *
 * 🔴 여기서 겨냥하는 결함은 전부 **오류 없이 조용한** 것들이다:
 *  ① 검색에 걸린 태그가 메모 안에 숨는다 — 왜 이 줄이 나왔는지 알려고 손잡이를 또
 *    눌러야 하고, 검색이 고장 난 것으로 읽힌다. **이 지시의 핵심이 이 한 줄이다.**
 *  ② 걸린 것이 상한(셋)보다 많을 때 잘린다 — 「상한을 넘겨서라도 전부」가 규칙이다.
 *  ③ 찾기를 안 할 때까지 규칙이 달라진다 — 평소에는 **그냥 앞의 셋**이어야 한다.
 *  ④ 거르는 쪽(matchesSearch)과 걸림 판정이 갈린다 — `#우내` 로 치면 줄은 나오는데
 *    굵게 선 태그가 하나도 없는 모양이 된다.
 *
 * 🔵 「메모가 떠 있는가」는 화면만 아는 일이라 여기서 안 잰다 — 이 함수가 정하는 것은
 * **무엇이 줄에 서고 무엇이 메모로 가는가**뿐이고, 그 둘은 값으로 잴 수 있다. 메모가
 * 흐름에서 빠지는지·Escape 와 바깥 누르기로 닫히는지는 components 목록의
 * diagnosis-flowcharts/diagnosis-flowchart-fault-tag-search.test.ts 가 본다.
 */

const FOUR = ["우내", "우외", "제어반 상부", "전원부"];

describe("faultTagMatchesQuery — 태그 하나가 찾는 글에 걸리는가", () => {
  test("🔵 먼저 표본 확인 — 평범한 글자가 실제로 걸린다", () => {
    assert.equal(faultTagMatchesQuery("우내", "우내"), true);
    assert.equal(faultTagMatchesQuery("제어반 상부", "제어반"), true);
  });

  test("🔴 `#` 를 붙여 쳐도 걸린다 — 태그라고 하면 `#` 를 먼저 치는 손버릇이 있다", () => {
    assert.equal(faultTagMatchesQuery("우내", "#우내"), true);
    assert.equal(faultTagMatchesQuery("우내", "##우"), true);
    // `#` 뒤에 띄어 적는 사람도 있다.
    assert.equal(faultTagMatchesQuery("우내", "# 우내"), true);
  });

  test("가운데 공백이 둘이어도 걸린다 — 저장할 때 한 칸으로 줄이기 때문이다", () => {
    assert.equal(faultTagMatchesQuery("제어반 상부", "제어반  상부"), true);
  });

  test("대소문자는 가리지 않는다 — 영문 약어로 적은 개소를 소문자로 찾는다", () => {
    assert.equal(faultTagMatchesQuery("RF출력", "rf"), true);
    assert.equal(faultTagMatchesQuery("rf출력", "RF"), true);
  });

  test("🔴 빈 글자·공백·`#` 하나는 **아무것도 안 고른다** — 전부가 걸린 것이 되면 표시가 뜻을 잃는다", () => {
    for (const query of ["", "   ", "#", "##", "# "]) {
      assert.equal(faultTagMatchesQuery("우내", query), false, `「${query}」 에 걸렸다`);
    }
  });

  test("안 걸리는 것은 안 걸린다", () => {
    assert.equal(faultTagMatchesQuery("우내", "좌내"), false);
  });
});

describe("selectVisibleFaultTags — 찾기를 안 할 때", () => {
  test("🔵 먼저 표본 확인 — 상한이 셋이고 표본이 그보다 많다", () => {
    assert.equal(MAX_VISIBLE_FAULT_TAGS, 3);
    assert.ok(FOUR.length > MAX_VISIBLE_FAULT_TAGS, "표본이 상한보다 적으면 접는 규칙을 한 번도 안 잰다");
  });

  test("🔴 태그 넷이면 **셋 + 손잡이**다 — 차례는 저장된 그대로", () => {
    const { visible, hidden } = selectVisibleFaultTags(FOUR, "");
    assert.deepEqual(visible, ["우내", "우외", "제어반 상부"]);
    assert.deepEqual(hidden, ["전원부"]);
  });

  test("🔴 태그 셋 이하면 손잡이가 **안 보인다** — 메모로 갈 것이 하나도 없다", () => {
    for (const tags of [["우내"], ["우내", "우외"], ["우내", "우외", "전원부"]]) {
      const { visible, hidden } = selectVisibleFaultTags(tags, "");
      assert.deepEqual(visible, tags);
      assert.deepEqual(hidden, [], `${tags.length}개인데 메모로 가는 것이 있다`);
    }
  });

  test("태그가 없으면 보일 것도 메모로 갈 것도 없다", () => {
    const { visible, hidden } = selectVisibleFaultTags([], "");
    assert.deepEqual(visible, []);
    assert.deepEqual(hidden, []);
  });
});

/**
 * 🔵 이 묶음은 「펴고 접기」를 재던 자리다 — 2026-11-19 눈 확인 뒤 **숨은 태그가 줄
 * 안에서 펴지지 않고 떠 있는 메모로** 가게 바뀌어, 재는 **뜻**을 그 모양으로 고쳤다
 * (지우지 않았다). 재는 것은 그대로다: 숨은 것이 어디로 가고, 하나도 새지 않는가.
 */
describe("selectVisibleFaultTags — 넘치는 것은 메모로 간다", () => {
  test("🔴 숨은 태그가 **메모 쪽에** 전부 있다 — 넷 중 넷째", () => {
    const { hidden } = selectVisibleFaultTags(FOUR, "");
    assert.deepEqual(hidden, ["전원부"]);
  });

  test("🔴 줄과 메모를 합치면 **받은 그대로**다 — 새는 태그도 두 번 서는 태그도 없다", () => {
    const many = [...FOUR, "RF출력", "냉각팬"];
    const { visible, hidden } = selectVisibleFaultTags(many, "");
    assert.deepEqual([...visible, ...hidden].sort(), [...many].sort(), "어딘가에서 태그가 새거나 겹친다");
    assert.equal(visible.length, 3);
    assert.equal(hidden.length, 3);
    // 겹치는 것이 없어야 `+N` 과 사람이 세는 수가 맞는다.
    for (const tag of visible) assert.equal(hidden.includes(tag), false, `${tag} 가 줄과 메모에 둘 다 섰다`);
  });

  test("🔵 메모 쪽 차례도 **받은 그대로**다 — 열 때마다 달라 보이면 안 된다", () => {
    const many = [...FOUR, "RF출력", "냉각팬"];
    assert.deepEqual(selectVisibleFaultTags(many, "").hidden, ["전원부", "RF출력", "냉각팬"]);
  });

  test("🔵 돌려주는 둘 다 **새 배열**이다 — 받은 배열을 그대로 돌려주지 않는다", () => {
    const { visible, hidden } = selectVisibleFaultTags(FOUR, "");
    assert.notEqual(visible, FOUR);
    assert.notEqual(hidden, FOUR);
    visible.push("손댄 흔적");
    hidden.push("손댄 흔적");
    assert.equal(FOUR.length, 4, "돌려준 배열을 고쳤더니 원본이 바뀐다");
  });
});

describe("selectVisibleFaultTags — 검색 중", () => {
  test("🔴 **넷째 태그가 걸리면 메모를 안 열어도 줄에 선다** — 이 지시의 핵심", () => {
    const { visible, hidden } = selectVisibleFaultTags(FOUR, "전원");
    assert.ok(visible.includes("전원부"), `걸린 태그가 메모 안에 숨었다: ${visible.join(" · ")}`);
    // 걸린 것이 맨 앞에 서고, 남는 자리는 나머지로 상한까지 채운다.
    assert.deepEqual(visible, ["전원부", "우내", "우외"]);
    assert.deepEqual(hidden, ["제어반 상부"], "밀려난 것이 메모로 안 갔다");
  });

  test("🔴 걸린 태그가 **넷이면 네 개 다** 줄에 선다 — 상한을 넘겨서라도", () => {
    // 넷 모두에 없는 글자를 고를 수 없으니, 공통으로 든 글자로 건다.
    const tags = ["우내1", "우내2", "우내3", "우내4"];
    const { visible, hidden } = selectVisibleFaultTags(tags, "우내");
    assert.deepEqual(visible, tags);
    assert.deepEqual(hidden, [], "다 보이는데 손잡이가 선다");
  });

  test("🔴 걸린 것이 상한보다 많아도 **뒤에서 잘리지 않는다** — 음수 slice 의 함정", () => {
    // 🔴 안 걸린 것이 **둘 이상**이어야 이 함정이 드러난다. 남는 자리가 −1 이 되면
    // `rest.slice(0, -1)` 은 빈 배열이 아니라 **마지막 하나만 뺀 나머지**라, 안 걸린
    // 태그가 조용히 따라붙는다. 안 걸린 것이 하나뿐이면 결과가 우연히 같아져
    // 이 시험이 아무것도 안 잡는다(실제로 한 번 놓쳤다).
    const tags = ["우내1", "우내2", "우내3", "우내4", "전원부", "제어반 상부"];
    const { visible, hidden } = selectVisibleFaultTags(tags, "우내");
    assert.deepEqual(visible, ["우내1", "우내2", "우내3", "우내4"]);
    assert.deepEqual(hidden, ["전원부", "제어반 상부"]);
  });

  test("🔴 `#` 를 붙여 쳐도 숨은 태그가 줄로 끌려 나온다 — matchesSearch 와 같은 규칙이다", () => {
    const { visible } = selectVisibleFaultTags(FOUR, "#전원");
    assert.ok(visible.includes("전원부"), `${visible.join(" · ")}`);
  });

  test("걸린 것이 하나도 없으면 평소와 같다 — 앞의 셋", () => {
    const { visible, hidden } = selectVisibleFaultTags(FOUR, "없는글자");
    assert.deepEqual(visible, ["우내", "우외", "제어반 상부"]);
    assert.deepEqual(hidden, ["전원부"]);
  });

  test("🔵 이미 앞에 있던 태그가 걸려도 차례가 흔들리지 않는다", () => {
    const { visible } = selectVisibleFaultTags(FOUR, "우내");
    assert.deepEqual(visible, ["우내", "우외", "제어반 상부"]);
  });
});
