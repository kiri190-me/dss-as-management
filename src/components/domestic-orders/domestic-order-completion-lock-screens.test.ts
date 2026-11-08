import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 🔴 **완료된 것은 잠근다 — 화면 쪽** (2026-11-08)
 * ============================================================================
 * 사용자 결정 원문: 「해제하지 않으면 **내자정리의 어떤 내용도 수정할 수 없도록**
 * 해줘. … 만약 수리건 상세에서 내용을 바꾸려 한다면 **[내자정리에서 완료 상태이므로
 * 수정이 불가능합니다.]**라는 팝업이 뜨도록 해줘.」
 *
 * 🔴 **막는 일은 서버가 한다**(db/mutations 세 곳). 화면이 할 일은 넷이다:
 *  ① 완료된 줄의 편집칸과 [수정]을 아예 안 연다 — 그러나 🔴 **[완료 해제]는 연다.**
 *  ② 완료된 회차의 입력칸만 잠그고 **까닭을 늘 보이는 한 줄로** 적는다.
 *  ③ 회차 **[N차 해제]** 는 한 번의 클릭으로 되지 않는다(확인 창).
 *  ④ 수리 건 상세는 서버가 돌려준 **코드**를 보고 읽고 닫는 알림을 띄운다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 목록 화면도 두 편집칸도 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는 import
 * 자체가 던진다(이웃 misc-case-completion-blocked-notice.test.ts 와 같은 방법·같은 까닭).
 *
 * 🔵 **「막힌다」만 재지 않는다** — 같은 자리에서 「열려 있어야 하는 것」을 함께 센다.
 * 특히 [완료 해제]·[N차 해제]가 잠금과 **같은 변수**를 보고 있지 않다는 것을 센다:
 * 거기까지 막으면 한 번 완료한 줄은 **영영 못 고치는 문**이 된다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 주석을 걷어낸다 — 이 조각의 주석이 세는 낱말을 그대로 적고 있다.
 *
 * ⚠️ **블록 주석을 먼저 지운다.** 이웃 시험들이 쓰는 차례(JSX 주석 `{/* … *␀/}` 를
 * 먼저)는 이 화면에서 **코드를 통째로 삼킨다**: 함수 본문이 `{` 로 열리고 바로 다음
 * 줄에 JSDoc 이 오는 자리가 있어서, `\{\s*\/\*[\s\S]*?\*\/\s*\}` 가 그 `{` 부터 한참
 * 아래의 `*␀/}` 까지를 한 덩어리로 집는다(2026-11-08 실측 — `openRow` 와 상태 선언
 * 여럿이 그렇게 사라져 멀쩡한 화면에서 이 시험이 빨개졌다).
 * 🔵 블록 주석을 먼저 지우면 JSX 주석은 속이 빈 `{ }` 만 남는다 — 아래 단언들은
 * 그 자리를 건너뛰고 읽으므로 **지우지 않는다**(지우려 들면 `?? {}` 같은 빈 객체까지
 * 함께 사라져 다른 단언이 깨진다).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석(JSX 주석의 속도 여기서 함께 사라진다)
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line)) // 줄 주석
    .join("\n");
}

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const listScreen = flat(stripComments(read("src/components/domestic-orders/DomesticOrderListScreen.tsx")));
const dueDatesCell = flat(stripComments(read("src/components/domestic-orders/DomesticOrderDueDatesCell.tsx")));
const deliveriesCell = flat(stripComments(read("src/components/domestic-orders/DomesticOrderDeliveriesCell.tsx")));
const rowReleaseDialog = flat(
  stripComments(read("src/components/domestic-orders/DomesticOrderDueDateRowReleaseDialog.tsx"))
);
const submitHook = flat(
  stripComments(read("src/components/repair-cases/detail/edit/useSectionEditSubmit.ts"))
);
const detailView = flat(
  stripComments(read("src/components/repair-cases/detail/RepairCaseDetailView.tsx"))
);

describe("① 완료된 줄은 편집칸도 [수정]도 안 열린다 — [완료 해제]는 열린다", () => {
  test("🔵 **못** — 표와 카드 **둘 다** 잠금 변수를 세운다", () => {
    const declared = listScreen.match(/const rowEditable = canEdit && !completed;/g) ?? [];
    assert.equal(declared.length, 2, "표와 카드 둘 중 한쪽에만 잠금이 있다");
  });

  test("🔴 자리편집 칸이 전부 그 변수를 본다 — `canEdit ?` 가 한 군데도 안 남았다", () => {
    assert.ok(
      !/\{canEdit \?/.test(listScreen),
      "완료 잠금을 안 보는 편집칸이 남아 있다 — 그 칸만 완료된 줄에서 열린다"
    );
    // 🔵 못 — 바뀐 쪽이 실제로 여럿이다(한 칸만 고치고 끝낸 것이 아니다).
    const gated = listScreen.match(/\{rowEditable \?/g) ?? [];
    assert.ok(gated.length >= 14, `잠금을 보는 편집칸이 ${gated.length}개뿐이다`);
  });

  test("🔴 [수정] 단추도 그 변수를 본다 — 표와 카드 둘 다", () => {
    const buttons = listScreen.match(/\{rowEditable && <EditRowButton row=\{row\} onOpen=\{openRow\} \/>\}/g) ?? [];
    assert.equal(buttons.length, 2, "완료된 줄에서도 열리는 [수정] 단추가 남아 있다");
  });

  test("🔴 `줄 수정` 폼을 여는 길 자체가 막힌다 — 단추를 감추는 것과 **따로** 둔다", () => {
    assert.match(
      listScreen,
      /function openRow\(id: string\) \{ if \(!canEdit\) return; if \(rows\.some\(\(row\) => row\.id === id && isDomesticOrderCompleted\(row\)\)\) return;/,
      "폼을 여는 함수가 완료 여부를 안 본다"
    );
  });

  test("🔴 **[완료 해제]는 잠금을 보지 않는다** — 영영 못 고치는 문이 되면 안 된다", () => {
    // 완료 단추는 `canEdit` 만 본다. `rowEditable` 을 보면 완료된 줄에서 단추 자체가
    // 사라져 해제할 길이 없어진다.
    const toggles = listScreen.match(/\{canEdit && \( <CompletionToggle/g) ?? [];
    assert.equal(toggles.length, 2, "완료 단추가 잠금 변수를 보고 있다(또는 자리가 둘이 아니다)");
    assert.ok(
      !/\{rowEditable && \( <CompletionToggle/.test(listScreen),
      "완료 단추가 잠금 변수를 본다 — 완료된 줄에서 [완료 해제]가 사라진다"
    );
  });
});

describe("② 완료된 회차의 입력칸만 잠긴다 — 까닭은 늘 보이는 한 줄로", () => {
  for (const [name, source, inputs] of [
    ["납기요청일 칸", dueDatesCell, ["line.dueDate", "line.note"]],
    ["납품 칸", deliveriesCell, ["line.deliveredDate", "line.deliveredBy"]],
  ] as const) {
    test(`🔴 ${name} — 두 입력이 모두 잠기고, 서버와 **같은 함수**에 묻는다`, () => {
      assert.match(
        source,
        /const rowLocked = domesticOrderDueDateRowEditBlockReason\(\{ rowOrder: index \+ 1, row: line, \}\);/,
        "회차 잠금을 묻지 않거나 규칙을 화면이 다시 적고 있다"
      );
      for (const input of inputs) {
        // 그 입력칸의 value 바로 뒤에 잠금이 붙어 있는가 — 한 칸만 잠그면 나머지
        // 한 칸으로 같은 회차를 고칠 수 있다.
        assert.ok(
          source.includes(`value={${input}} disabled={disabled || rowLocked !== null} title={rowLocked ?? undefined}`),
          `${input} 입력칸이 완료된 회차에서도 열려 있다`
        );
      }
    });

    test(`🔵 ${name} — 까닭이 **늘 보이는 한 줄**로 뜬다(title 만으로는 모자라다)`, () => {
      assert.ok(
        source.includes("{rowLocked !== null && <p className={cellHintClass}>{rowLocked}</p>}"),
        "왜 안 열리는지가 화면에 글로 안 보인다 — 까닭 없이 안 열리는 칸은 고장으로 읽힌다"
      );
    });
  }
});

describe("③ 회차 [N차 해제]는 묻고 나서 보낸다", () => {
  test("🔴 해제는 **보내지 않고** 창을 열어 달라고 올려 보낸다", () => {
    assert.match(
      listScreen,
      /if \(completed\) \{ event\.stopPropagation\(\); onError\(null\); onRequestRelease\(\{/,
      "[N차 해제]가 한 번의 클릭으로 바로 보내진다"
    );
  });

  test("🔵 **[완료 처리] 쪽은 그대로 바로 보낸다** — 묻는 것은 되돌리는 쪽뿐이다", () => {
    assert.match(
      listScreen,
      /void toggle\(event, rowOrder, true\);/,
      "완료 처리까지 창을 거치게 되었다 — 사용자가 말한 것은 해제다"
    );
  });

  test("🔴 창은 **표 칸 밖**에서 그려진다 — 칸의 CSS 를 물려받으면 글이 쏠린다", () => {
    assert.match(
      listScreen,
      /const \[rowReleaseTarget, setRowReleaseTarget\] = useState</,
      "창의 상태를 목록 화면이 갖고 있지 않다"
    );
    assert.match(listScreen, /<DomesticOrderDueDateRowReleaseDialog isOpen=\{rowReleaseTarget !== null\}/);
    // 🔵 표와 카드 둘 다 그 통로를 넘겨받는다.
    const passed = listScreen.match(/onRequestRowRelease=\{setRowReleaseTarget\}/g) ?? [];
    assert.equal(passed.length, 2, "완료 단추가 그려지는 자리는 표와 카드 둘이다");
  });

  test("🔴 창이 **줄 단위 창과 다른 글**을 쓴다 — 수리 건 이야기를 하지 않는다", () => {
    assert.ok(
      !/수리 건/.test(rowReleaseDialog),
      "회차 해제 창이 수리 건 이야기를 한다 — 기타건 전용이라 일어나지 않을 일이다"
    );
    // 🔴 회차 해제가 **무엇을 여는지**를 말한다(그것이 2026-11-08 에 바뀐 뜻이다).
    assert.ok(rowReleaseDialog.includes("납기요청일·비고·납품일·납품자"), rowReleaseDialog.slice(0, 200));
    // 🔴 **납품일은 안 지워진다**는 사실도 말한다 — 안 적으면 되돌아갈 줄 안다.
    assert.ok(rowReleaseDialog.includes("이미 적힌 납품일은 지워지지 않습니다"));
    // 🔵 줄까지 함께 풀리는 경우에만 그 말을 한다.
    assert.ok(rowReleaseDialog.includes("{releasesLine && ("));
  });

  test("🔵 저장 팝업이 아니다 — 읽고 고르는 창은 저절로 닫히면 안 된다", () => {
    assert.ok(!/showSavePopup/.test(rowReleaseDialog));
    assert.ok(!/window\.confirm|confirm\(/.test(rowReleaseDialog));
    assert.match(rowReleaseDialog, /dialog\.showModal\(\);/);
  });
});

describe("④ 수리 건 상세 — 서버가 준 **코드**를 보고 읽고 닫는 알림을 띄운다", () => {
  test("🔴 `DOMESTIC_ORDER_COMPLETED` 를 코드로 가른다 — 글자를 견주지 않는다", () => {
    assert.match(
      submitHook,
      /if \(result\.code === "DOMESTIC_ORDER_COMPLETED" && params\.onDomesticOrderCompleted\) \{ params\.onDomesticOrderCompleted\(result\.message\); \}/,
      "막혔다는 답을 읽는 길이 없다"
    );
  });

  test("🔴 **폼을 닫지 않는다** — 아무것도 저장되지 않았다", () => {
    // 성공 경로(onDone)가 이 분기보다 **뒤**에 있어야 한다. 앞에 있으면 막힌 저장이
    // 폼을 닫아 사람이 적어 둔 값이 사라진다.
    assert.ok(
      submitHook.indexOf('result.code === "DOMESTIC_ORDER_COMPLETED"') < submitHook.indexOf("params.onDone();"),
      "막힌 저장이 폼을 닫는 자리에 섞여 있다"
    );
    // 🔵 칸 밑 빨간 줄도 **함께** 남는다 — 어느 칸이 막혔는지는 거기가 말한다.
    assert.ok(
      submitHook.indexOf("setFieldErrors(result.fieldErrors ?? {});") <
        submitHook.indexOf('result.code === "DOMESTIC_ORDER_COMPLETED"')
    );
  });

  test("🔴 알림은 상세 화면이 띄운다 — 폼 안에서 태어나면 격자의 정렬을 물려받는다", () => {
    assert.match(
      detailView,
      /const \[domesticOrderCompletedBlock, setDomesticOrderCompletedBlock\] = useState<string \| null>\(null\);/
    );
    assert.match(
      detailView,
      /\{domesticOrderCompletedBlock !== null && \( <NoticePopup title="내자 정리에서 완료된 줄입니다" lines=\{\[domesticOrderCompletedBlock\]\}/
    );
    assert.match(detailView, /onDomesticOrderCompleted=\{setDomesticOrderCompletedBlock\}/);
  });

  test("🔵 **못** — 이웃한 「못 따라갔다」 알림과 상태가 **갈라져 있다**", () => {
    // 둘은 할 말이 정반대다(저장됐다 ↔ 아무것도 저장되지 않았다). 한 상태로 합치면
    // 제목이 어느 쪽도 가리키지 못한다.
    assert.match(detailView, /setRequestedDueDateNotLinked/);
    assert.notEqual(
      detailView.indexOf("setDomesticOrderCompletedBlock"),
      detailView.indexOf("setRequestedDueDateNotLinked")
    );
  });
});
