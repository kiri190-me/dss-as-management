import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { CUSTOMER_PORTAL_FORMS } from "@/lib/domain/customer-portal-forms";

/**
 * ============================================================================
 * 고객사 상세 [고객 안내 양식] — **화면에서 고른다** (2026-10-17, C-3)
 * ============================================================================
 * 2026-10-17 에 쓰는 분이 고객사 세 곳의 이름을 정식 상호로 바꾸자, 양식을 코드에
 * 박아 둔 이름 글자로 가리던 판정이 하나도 못 맞춰 「고객 안내 현황」의 표 셋이
 * 통째로 사라졌다. 오류가 아니라 「아무것도 없음」이라 원인이 안 보인다. 판정의
 * 근거를 `customers.portal_form_id` 칸으로 옮긴 마지막 조각이 이 화면이다 —
 * 이제 새 고객사가 생기거나 이름이 바뀌어도 **코드를 안 고치고** 여기서 지정한다.
 *
 * 값 판정은 unit 목록이 본다 — 등록부와 판정 규칙은 domain/customer-portal-forms.
 * test.ts, 문지기는 validation/customer-update-input.test.ts, 실제로 저장되고
 * 묶음이 따라 바뀌는지는 db/mutations/customers.integration.test.ts 다.
 *
 * 🔴 여기서 못 박는 것은 **화면과 저장 통로가 그 값을 어떻게 쓰는가**다:
 *  1. 고를 수 있는 양식과 그 이름을 **화면에 베껴 적지 않는가**(등록부에서 가져오고
 *     `label` 을 그대로 쓴다). 베껴 적으면 양식이 늘 때 한쪽만 고쳐지고, 그때 아무
 *     오류도 나지 않는다.
 *  2. 🔴 **「없음」이 정상임이 보이는가.** 대부분의 고객사가 그렇다 — 결함으로
 *     읽히면 안 고쳐도 되는 고객사를 하나씩 열어 보게 된다.
 *  3. 수정 폼이 그 값을 **보내고**, 상세 조회가 **싣고**, 읽기 화면이 **보이는가.**
 *     셋 중 하나만 빠져도 「고르면 그 자리에서는 바뀌는데 저장이 안 된다」 또는
 *     「저장은 됐는데 확인할 길이 없다」가 된다.
 *  4. 🔴 **판정 함수를 화면이 다시 적지 않는가** — 판정은 domain 한 곳뿐이다.
 *  5. 🔴 **인가가 그대로인가** — 고르개는 canEdit 로 가린 수정 폼 안에만 있고,
 *     서버 액션은 화면이 보낸 값과 무관하게 `customers.edit` 를 다시 본다.
 *
 * ── 🔴 왜 그려 보지 않고 원본을 글자로 읽는가 ───────────────────────────────
 * 이웃 customer-detail-product-models.test.ts 와 같은 까닭이다 — 이 사슬은
 * 클라이언트 컴포넌트에서 서버 액션을 거쳐 `server-only` 에 닿아서, react-server
 * 조건을 켜지 않는 test:components 에서는 import 자체가 던진다.
 *
 * 🔴 그래서 **주석을 걷어 낸 본문**(code)만 보고 잰다. 이 파일들의 주석에는 양식
 * 이름도 「없음」도 그대로 적혀 있어서, 날것을 재면 코드를 다 지워도 통과한다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 🔴 주석을 걷는다 — 단언이 주석의 글자에 걸려 통과하면 안 된다. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const pickerSource = read("src/components/customers/CustomerPortalFormField.tsx");
const picker = code(pickerSource);
const editForm = code(read("src/components/customers/CustomerEditForm.tsx"));
const detailScreen = code(read("src/components/customers/CustomerDetailScreen.tsx"));
const customerQueries = code(read("src/lib/db/queries/customers.ts"));
const validation = code(read("src/lib/validation/customer-update-input.ts"));
const mutation = code(read("src/lib/db/mutations/customers.ts"));
const action = code(read("src/lib/server/actions/update-customer.ts"));

describe("1. 고를 수 있는 양식은 등록부에서 온다", () => {
  test("🔴 고르개가 CUSTOMER_PORTAL_FORMS 를 그려서 목록을 만든다", () => {
    assert.match(
      picker,
      /import \{[\s\S]*?CUSTOMER_PORTAL_FORMS[\s\S]*?\} from "@\/lib\/domain\/customer-portal-forms"/,
      "등록부를 안 가져오면 목록이 두 벌이 된다"
    );
    assert.match(
      picker,
      /CUSTOMER_PORTAL_FORMS\.map\(/,
      "등록부를 펼쳐 칸을 만들지 않으면 양식이 늘어도 화면이 그대로다"
    );
  });

  test("🔴 보이는 이름은 양식이 가진 label 이다 — 화면이 글자를 지어내지 않는다", () => {
    assert.match(picker, /label: form\.label/, "양식의 label 을 그대로 쓰지 않는다");
    // 등록부의 이름(「ICD 양식」 …)이 화면 본문에 글자로 박혀 있으면 안 된다.
    for (const form of CUSTOMER_PORTAL_FORMS) {
      assert.ok(
        !picker.includes(`"${form.label}"`),
        `${form.label} 이 화면에 베껴 적혀 있다 — 양식이 늘면 한쪽만 고쳐진다`
      );
      assert.ok(
        !picker.includes(`"${form.id}"`),
        `${form.id} 가 화면에 베껴 적혀 있다 — 등록부에서 가져와야 한다`
      );
      assert.ok(
        !editForm.includes(form.id) && !detailScreen.includes(form.id),
        `${form.id} 가 수정 폼·상세 화면에 박혀 있다`
      );
    }
  });

  test("🔴 저장된 값을 이름으로 바꾸는 자리도 등록부에 묻는다", () => {
    assert.match(
      picker,
      /findPortalFormById\(portalFormId\)\?\.label \?\? NO_CUSTOMER_PORTAL_FORM_LABEL/,
      "등록부에서 못 찾는 값은 「없음」이어야 한다 — 표를 그리는 길이 그렇게 다룬다"
    );
  });
});

describe("2. 🔴 「없음」이 정상임이 보인다", () => {
  test("「없음」이 칸 맨 앞에 있고 그 이름이 한 곳에서 온다", () => {
    assert.match(picker, /NO_CUSTOMER_PORTAL_FORM_LABEL = "없음"/);
    assert.match(
      picker,
      /\{ key: NO_CUSTOMER_PORTAL_FORM_KEY, label: NO_CUSTOMER_PORTAL_FORM_LABEL \},\s*\.\.\.CUSTOMER_PORTAL_FORMS/,
      "「없음」이 맨 앞이 아니면 대부분의 고객사가 고르는 칸을 맨 끝에서 찾게 된다"
    );
  });

  test("🔴 무엇을 뜻하는지 한 줄이 붙는다 — 「아직 안 골랐다」로 읽히면 안 된다", () => {
    assert.ok(
      picker.includes("대부분의 고객사는 「없음」이 정상"),
      "「없음」이 정상이라는 말이 화면에 없다"
    );
    assert.ok(
      picker.includes("현황표를 주고받는 고객사만"),
      "어떤 고객사가 양식을 고르는지 알려 주는 말이 없다"
    );
    assert.match(
      picker,
      /\{CUSTOMER_PORTAL_FORM_HELP_TEXT\}/,
      "설명을 실제로 그리지 않으면 글자만 있고 화면에는 안 보인다"
    );
  });

  test("「없음」은 빈 문자열로 다루고 저장할 때 null 로 돌아간다", () => {
    assert.match(picker, /NO_CUSTOMER_PORTAL_FORM_KEY = ""/);
    assert.match(
      editForm,
      /portalFormId: portalFormId \|\| null/,
      "빈 글자를 그대로 보내면 「없음」이 빈 문자열로 저장된다"
    );
  });
});

describe("3. 고른 값이 저장되고 되읽힌다", () => {
  test("수정 폼이 지금 값으로 칸을 채우고, 저장할 때 다시 보낸다", () => {
    assert.match(
      editForm,
      /useState\(customer\.portalFormId \?\? ""\)/,
      "폼이 지금 값을 안 채우면 열 때마다 「없음」으로 보인다"
    );
    assert.match(
      editForm,
      /<CustomerPortalFormPicker[\s\S]{0,200}value=\{portalFormId\}/,
      "고르개가 폼의 값을 안 받는다"
    );
    assert.match(
      editForm,
      /onChange=\{setPortalFormId\}/,
      "고른 값이 폼으로 안 올라오면 저장되는 것은 옛 값이다"
    );
  });

  test("🔴 상세 조회가 그 칸을 싣는다 — 안 실으면 저장 한 번에 지워진다", () => {
    assert.match(customerQueries, /portalFormId: string \| null;/);
    assert.match(
      customerQueries,
      /portalFormId: customers\.portalFormId/,
      "조회가 칸을 안 읽으면 폼이 언제나 「없음」을 다시 보낸다"
    );
  });

  test("mutation 이 그 칸을 쓴다", () => {
    assert.match(
      mutation,
      /\.set\(\{[\s\S]*?portalFormId: params\.portalFormId,[\s\S]*?\}\)/,
      "updateCustomer 가 칸을 안 쓰면 고른 값이 어디에도 안 남는다"
    );
  });

  test("읽기 화면에도 지금 양식이 보인다 — 확인하려고 수정 단추를 누르지 않는다", () => {
    assert.match(detailScreen, /고객 안내 양식/);
    assert.match(
      detailScreen,
      /customerPortalFormLabel\(customer\.portalFormId\)/,
      "읽기 화면이 고르개와 다른 말을 하면 안 된다"
    );
  });

  test("고르개 밑에 그 칸의 오류가 뜬다", () => {
    assert.match(
      editForm,
      /fieldErrors\.portalFormId/,
      "거절당한 까닭이 화면에 안 뜨면 저장이 왜 안 되는지 알 길이 없다"
    );
  });
});

describe("4. 🔴 문지기와 판정은 한 자리씩만", () => {
  test("등록부에 없는 값은 검증이 거절한다 — DB 에 CHECK 가 없어서 여기가 유일한 문이다", () => {
    assert.match(
      validation,
      /findPortalFormById\(trimmed\) === null/,
      "등록부에 묻지 않으면 오타가 그대로 저장된다"
    );
    assert.match(validation, /fieldErrors\.portalFormId = "고를 수 없는 양식입니다\."/);
  });

  test("🔴 화면도 mutation 도 판정 함수를 다시 적지 않는다", () => {
    for (const [name, source] of [
      ["고르개", picker],
      ["수정 폼", editForm],
      ["상세 화면", detailScreen],
      ["mutation", mutation],
    ] as const) {
      assert.ok(
        !/resolvePortalFormForCustomer|findPortalFormForCustomerName|groupCustomersByPortalForm/.test(
          source
        ),
        `${name} 이 판정을 한 벌 더 적고 있다 — 두 판단은 언젠가 갈라진다`
      );
    }
  });

  test("🔴 이름 안전망(customerNames)은 그대로 남아 있다", () => {
    // 사용자 결정 2026-10-17 — 칸이 빈 줄은 이름으로 가린다. 한 개도 지우지 않는다.
    const forms = code(read("src/lib/domain/customer-portal-forms.ts"));
    assert.equal(
      [...forms.matchAll(/customerNames: \[/g)].length,
      CUSTOMER_PORTAL_FORMS.length,
      "양식마다 이름 목록이 하나씩 있어야 한다"
    );
    assert.equal(
      CUSTOMER_PORTAL_FORMS.flatMap((form) => form.customerNames).length,
      11,
      "안전망 이름이 열한 개에서 줄었다 — 마이그레이션 0116 이 채운 수와 같아야 한다"
    );
  });
});

describe("5. 🔴 인가는 그대로다", () => {
  test("고르개는 canEdit 로 가린 수정 폼 안에만 있다", () => {
    assert.ok(
      !detailScreen.includes("CustomerPortalFormPicker"),
      "읽기 화면이 고르개를 직접 그리면 권한 없는 사람에게도 보인다"
    );
    assert.match(
      detailScreen,
      /canEdit && !isEditing/,
      "수정 단추의 canEdit 관문이 사라졌다"
    );
    assert.match(
      detailScreen,
      /isEditing \? \(\s*<CustomerEditForm/,
      "수정 폼이 isEditing 밖으로 나왔다"
    );
  });

  test("🔴 서버 액션이 화면과 무관하게 권한을 다시 본다", () => {
    assert.match(
      action,
      /hasPermission\(actingUser, "customers\.edit", "WRITE"\)/,
      "고객사 수정 권한 검사가 사라졌다"
    );
    assert.match(
      action,
      /validateCustomerUpdateFields\(input\.fields\)/,
      "화면이 보낸 값을 거르지 않고 넘기면 문지기가 통째로 비켜난다"
    );
  });

  test("고르개는 폼이 얼었을 때 함께 잠긴다", () => {
    assert.match(picker, /<fieldset disabled=\{disabled\}/);
    assert.match(editForm, /<CustomerPortalFormPicker[\s\S]{0,200}disabled=\{disabled\}/);
  });
});
