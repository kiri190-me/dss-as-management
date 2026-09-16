import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 작업 비용 화면 — 네 탭, 그리고 **저장이 한 벌 전부를 싣는가**
 * ============================================================================
 * 못 박는 것은 셋이다.
 *
 *  1. 바깥 탭이 넷이다 — 수리 작업 · 조사 · 통전 · 서류.
 *  2. **🔴 저장이 세 목록과 세 공수시간을 함께 싣는다.** 하나라도 빠지면 그 갈래가
 *     통째로 소프트 삭제된다(mutations/repair-labor.ts 의 계약). 저장된 뒤의 결과는
 *     통합 시험이 값으로 못 박고(repair-labor.integration.test.ts 의 「갈래 셋이
 *     서로를 지우는가」), 여기서 보는 것은 **화면이 애초에 셋을 다 보내는가**다.
 *  3. **🔴 기본 작업비는 적는 칸이 아니다.** 사람이 고쳐도 견적서 금액이 안 바뀌던
 *     자리라(2026-09-16 이전) 칸을 뗐다. 저장도 그 값을 보내지 않는다 — 보내면
 *     뮤테이션이 DB 의 옛 값을 덮어쓸 길이 열린다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * RepairLaborScreen 은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**라, 그
 * 사슬 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 이웃 시험(quote-edit-work-scope-suppression.test.ts)과 같은
 * 방법으로 원본을 글자로 읽는다. 금액 문구는 렌더 없이도 값으로 볼 수 있어 따로
 * 있다(base-cost-display.test.ts).
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const source = read("src/components/repair-labor/RepairLaborScreen.tsx");

/** `save()` 가 서버로 보내는 한 벌만 잘라낸다 — 파일 전체에 걸면 딴 자리에 걸린다. */
function savePayload(): string {
  const start = source.indexOf("saveRepairLaborAction({");
  assert.ok(start >= 0, "저장을 부르는 자리를 찾지 못했다");
  const end = source.indexOf("setBusy(false);", start);
  assert.ok(end > start, "저장 호출의 끝을 찾지 못했다");
  return flat(source.slice(start, end));
}

describe("바깥 탭", () => {
  test("탭이 넷이다 — 수리 작업 · 조사 · 통전 · 서류", () => {
    const tabs = flat(source.slice(source.indexOf("const SECTION_TABS"), source.indexOf("];", source.indexOf("const SECTION_TABS"))));
    assert.ok(tabs.includes(`{ key: "tasks", label: "수리 작업 비용" }`), "수리 작업 탭이 그대로여야 한다");
    // 갈래 셋의 이름은 `repairLaborScopeLabels` 에서 온다 — 손으로 셋을 적으면
    // 갈래 이름이 갈리는 날 화면과 오류 문구가 다른 말을 한다.
    assert.ok(tabs.includes("REPAIR_LABOR_SCOPES.map("), "갈래 탭은 갈래 목록에서 만들어져야 한다");
    assert.ok(
      tabs.includes("label: `${repairLaborScopeLabels[scope]} 작업 비용`"),
      "탭 이름이 갈래 이름표에서 나와야 한다"
    );
  });

  test("🔴 장비 탭의 건수가 **보고 있는 갈래의 목록**을 센다", () => {
    // 한 표(power_test_tasks)에 셋이 같이 살아서, 안 가르면 세 탭에 같은 숫자가 뜬다.
    assert.match(
      flat(source),
      /activeScope === null \? kind\.tasks\.length : kind\.scopeTasks\[activeScope\]\.length/
    );
  });

  test("갈래 셋이 몸통 하나를 나눠 쓴다 — 같은 화면을 세 벌 베끼지 않는다", () => {
    assert.match(source, /function scopeBody\(scope: RepairLaborScope\)/);
    assert.equal(
      (source.match(/function scopeBody\(/g) ?? []).length,
      1,
      "몸통이 둘 이상이면 한 곳을 고칠 때 나머지가 남는다"
    );
  });
});

describe("🔴 저장은 한 벌 전부를 싣는다", () => {
  const payload = savePayload();

  test("세 갈래의 목록이 모두 실린다", () => {
    for (const field of ["investigationTasks:", "powerTestTasks:", "documentTasks:"]) {
      assert.ok(payload.includes(field), `🔴 ${field} 가 빠지면 그 목록이 통째로 지워진다`);
    }
    // 각 목록은 **자기 갈래의 줄**을 싣는다 — 한 갈래를 세 번 보내면 나머지 둘이 사라진다.
    assert.match(payload, /investigationTasks: filledScopeTasks\("INVESTIGATION"\)/);
    assert.match(payload, /powerTestTasks: filledScopeTasks\("POWER_TEST"\)/);
    assert.match(payload, /documentTasks: filledScopeTasks\("DOCUMENT"\)/);
  });

  test("세 갈래의 공수시간이 모두 실린다", () => {
    assert.match(payload, /investigationHours: scopeHours\.INVESTIGATION/);
    assert.match(payload, /powerTestHours: scopeHours\.POWER_TEST/);
    assert.match(payload, /documentHours: scopeHours\.DOCUMENT/);
  });

  test("수리 작업 목록과 시간당 작업비도 그대로 실린다 — 갈래 탭에서 눌러도 안 지워진다", () => {
    assert.match(payload, /hourlyRate,/);
    assert.match(payload, /tasks: tasks/);
  });

  test("🔴 기본 작업비는 보내지 않는다 — DB 의 옛 값을 덮어쓰지 않기 위해서다", () => {
    assert.ok(
      !/baseCost:/.test(payload),
      "🔴 base_cost 를 보내면 뮤테이션이 그 칸을 다시 쓰게 되고, 넘어오기 전 금액을 잃는다"
    );
  });
});

test("🔴 기본 작업비는 적는 칸이 아니다 — 읽기 전용 표시다", () => {
  // AmountInput 은 이제 시간당 작업비 하나에만 붙는다. 기본 작업비 칸이 남아 있으면
  // 사람이 고쳐도 견적서 금액이 안 바뀌는 자리가 되살아난다.
  assert.equal(
    (source.match(/<AmountInput/g) ?? []).length,
    1,
    "적는 금액 칸은 시간당 작업비 하나뿐이어야 한다"
  );
  assert.match(flat(source), /기본 작업비 \(조사 \+ 통전 \+ 서류\)/);
  assert.match(source, /describeBaseCost\(/, "셈은 견적서와 같은 한 곳에서 와야 한다");
});

test("🔴 잘못된 공수시간은 서버에 보내기 전에 화면이 먼저 막는다", () => {
  // 조사에 0, 서류에 음수 같은 값이 DB CHECK 까지 가면 사람은 "일시적으로 처리할 수
  // 없습니다"를 듣는다. 잣대는 서버와 **같은 함수**를 쓴다.
  assert.match(source, /parseRepairLaborHours\(scope, scopeHours\[scope\]\)/);
  assert.match(
    flat(source),
    /const badHours = REPAIR_LABOR_SCOPES\.filter\(\(scope\) => hoursErrors\[scope\] !== null\); if \(badHours\.length > 0\) \{/,
    "막는 판정이 저장 호출보다 먼저 와야 한다"
  );
  assert.ok(
    source.indexOf("const badHours") < source.indexOf("saveRepairLaborAction({"),
    "🔴 보내고 나서 막으면 막은 것이 아니다"
  );
});
