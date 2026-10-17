import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * 접수 폼의 "예상 보고서번호" — 흐린 글씨가 실제 채번과 어긋나지 않는가
 * ============================================================================
 * 이 조각에서 깨지면 조용한 것만 모아 못 박는다. 셋 다 화면에는 멀쩡해 보이고,
 * 몇 주 뒤 번호가 겹치거나 비는 모양으로만 드러난다.
 *
 *  1. 🔴 **칸의 값이 아니라 placeholder 인가.** 값으로 넣으면 "사람이 적은 값"이
 *     되어 자동 채번이 아예 돌지 않는다(mutation 의 우선순위 ①). 그러면 예상값을
 *     본 두 사람이 같은 번호로 접수한다 — 이 조각에서 제일 위험한 실수다.
 *  2. 🔴 **예상값과 실제 번호가 같은 곳에서 나오는가.** 미리보기 조회와 실제
 *     채번이 같은 `nextReportNumber` 를 부르고, 같은 `{앞자리}%` 로 좁히고, 같은
 *     "오늘(한국 날짜)"을 기준으로 삼아야 한다. 한쪽에 규칙을 베끼면 어긋난다.
 *  3. 🔴 **매길 수 없을 때 흐린 글씨를 감추는가.** 2030년 이후·999 초과에는
 *     번호가 없다 — 지어내서 보여 주면 접수 뒤에 빈 칸을 보고 당황한다.
 *
 * 왜 소스를 읽어 재는가: 접수 폼은 서버 액션과 DB 를 함께 끌고 들어와 렌더해 볼
 * 수 없고(components 목록은 server-only 를 못 부른다), 미리보기 조회는 DB 가
 * 있어야 값을 낸다(그쪽은 db 목록의 일이다). 여기서 지키는 것은 **배선**이다 —
 * 번호 규칙 자체의 값은 domain/repair-case-report-number.test.ts 가 잰다.
 * ============================================================================
 */

const form = readFileSync("src/components/repair-cases/new/IntakeFormInner.tsx", "utf8");
const query = readFileSync("src/lib/db/queries/report-number-preview.ts", "utf8");
const action = readFileSync("src/lib/server/actions/report-number-preview.ts", "utf8");
const mutation = readFileSync("src/lib/db/mutations/repair-cases.ts", "utf8");

describe("① 흐린 글씨는 placeholder 다 — 칸의 값이 아니다", () => {
  test("🔴 placeholder 로만 쓴다", () => {
    assert.ok(
      form.includes(
        "placeholder={previewedReportNumber ? `${previewedReportNumber} (예상)` : undefined}"
      ),
      "보고서번호 칸의 placeholder 가 예상값을 가리키지 않는다"
    );
  });

  test("🔴 칸의 값은 여전히 사람이 친 글자다 — 예상값이 value 로 새지 않는다", () => {
    assert.ok(form.includes("value={draft.legacyReportNumber}"), "보고서번호 칸의 value 가 바뀌었다");
    assert.ok(
      !/value=\{previewedReportNumber/.test(form),
      "예상값이 value 로 들어갔다 — 자동 채번이 돌지 않는다"
    );
    assert.ok(
      !/setField\("legacyReportNumber", previewedReportNumber/.test(form),
      "예상값을 draft 에 써 넣고 있다 — 사람이 적은 값으로 굳는다"
    );
  });

  test("흐린 회색으로 보인다 — 인수번호 칸과 같은 class", () => {
    const placeholderClass = "placeholder:text-zinc-400 dark:placeholder:text-zinc-500";
    assert.equal(
      form.split(placeholderClass).length - 1,
      2,
      "흐린 placeholder 색이 두 칸(인수번호·보고서번호)에 걸려 있지 않다"
    );
  });
});

describe("② 예상값과 실제 번호는 같은 곳에서 나온다", () => {
  test("🔴 미리보기 조회와 실제 채번이 같은 모듈의 같은 함수를 부른다", () => {
    for (const [name, source] of [
      ["미리보기 조회", query],
      ["실제 채번(mutation)", mutation],
    ] as const) {
      assert.ok(
        source.includes(
          'import { nextReportNumber, reportNumberYearDigit } from "@/lib/domain/repair-case-report-number";'
        ),
        `${name} 가 순수 모듈에서 규칙을 가져오지 않는다`
      );
      assert.ok(source.includes("nextReportNumber("), `${name} 가 nextReportNumber 를 부르지 않는다`);
    }
  });

  test("🔴 좁히는 조건이 같다 — 세는 쪽과 끌어오는 쪽이 갈라지면 한 칸 어긋난다", () => {
    const narrowing = "like(repairCases.legacyReportNumber, `${yearDigit}%`)";
    assert.ok(query.includes(narrowing), "미리보기 조회의 좁히기가 다르다");
    assert.ok(mutation.includes(narrowing), "실제 채번의 좁히기가 다르다");
  });

  test("🔴 기준 날짜가 같다 — 둘 다 오늘(한국 날짜)이다, 인수일이 아니다", () => {
    const today = "const today = toKstDateOnly(new Date());";
    assert.ok(query.includes(today), "미리보기 조회의 기준일이 오늘이 아니다");
    assert.ok(mutation.includes(today), "실제 채번의 기준일이 오늘이 아니다");
    assert.ok(
      !/getNextReportNumberPreview\(\s*receivedAt/.test(query),
      "미리보기가 인수일을 받는다 — 보고서번호의 기준은 등록한 날이다"
    );
  });

  test("🔴 브라우저가 셈하지 않는다 — 규칙은 서버에서만 돈다", () => {
    assert.ok(
      !form.includes("repair-case-report-number"),
      "접수 폼이 번호 규칙 모듈을 직접 끌어다 쓴다 — 예전에 서버 값과 어긋나 뺐던 방식이다"
    );
    assert.ok(
      form.includes("void previewNextReportNumberAction().then((value) => {"),
      "폼이 서버 액션으로 예상값을 받지 않는다"
    );
  });
});

describe("③ 매길 수 없으면 아무것도 보이지 않는다", () => {
  test("🔴 조회가 지어내지 않는다 — 매길 수 없는 해와 999 초과는 null 이다", () => {
    assert.ok(query.includes("if (yearDigit === null) return null;"), "매길 수 없는 해에 조회를 막지 않는다");
    assert.ok(
      query.includes("return next.ok ? next.reportNumber : null;"),
      "못 매긴 결과(ok:false)를 null 로 바꾸지 않는다"
    );
  });

  test("🔴 값이 없으면 placeholder 자체가 없다 — 빈 문자열도 흐린 글씨도 남지 않는다", () => {
    assert.ok(
      form.includes("? `${previewedReportNumber} (예상)` : undefined"),
      "예상값이 없을 때 placeholder 를 undefined 로 두지 않는다"
    );
  });

  test("미리보기는 읽기만 한다 — 들여다보는 것만으로 번호가 소모되지 않는다", () => {
    assert.ok(!/\.insert\(/.test(query), "미리보기 조회에 INSERT 가 있다");
    assert.ok(!/\.update\(/.test(query), "미리보기 조회에 UPDATE 가 있다");
  });

  test("못 읽어도 접수는 그대로다 — 액션이 실패를 삼키고 null 을 낸다", () => {
    assert.ok(action.includes("} catch {"), "조회 실패를 삼키지 않는다");
    assert.ok(action.includes('hasAreaAccess("repairCaseNew", actingUser)'), "접수 화면 권한을 보지 않는다");
  });
});

describe("④ 칸 아래 도움말이 흐린 글씨를 가리킨다", () => {
  test("예상값이 있을 때만 그 번호를 짚어 준다", () => {
    assert.ok(
      form.includes(
        "<> ※ 칸에 흐리게 보이는 {previewedReportNumber} 는 예상값입니다 — 다른 접수가 먼저 등록되면 실제 번호는 달라질 수 있습니다.</>"
      ),
      "보고서번호 도움말이 칸의 흐린 글씨를 가리키지 않는다"
    );
  });

  test("박아 둔 예시 번호가 남아 있지 않다 — 진짜 예상값이 칸에 보인다", () => {
    assert.ok(!form.includes("예: 6076"), "도움말에 박아 둔 예시 번호가 그대로 있다");
  });

  test("매길 수 없는 경우의 안내가 남아 있다", () => {
    assert.ok(
      form.includes(
        "자동으로 매길 수 없는 경우에는 번호가 빈 채로 접수되고, 상세 화면 상단의 보고서번호에서 채울 수 있습니다."
      ),
      "번호가 비는 날의 안내가 사라졌다"
    );
  });
});
