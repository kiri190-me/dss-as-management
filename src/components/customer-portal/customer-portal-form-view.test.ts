import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CUSTOMER_PORTAL_FORMS,
  manualColumnsOf,
} from "@/lib/domain/customer-portal-forms";

/**
 * ============================================================================
 * 「고객 안내 현황」의 고객사 양식 보기 — 화면과 통로가 그 값을 어떻게 쓰는가
 * ============================================================================
 * 값으로 도는 부분(어느 고객사가 어떤 열을 쓰는가 · 모르는 키를 버리는가)은
 * unit 목록의 lib/domain/customer-portal-forms.test.ts 가 본다. 여기서 못 박는
 * 것은 그 값이 **화면과 저장 통로에서 어떻게 쓰이는가**다:
 *
 *  1. 🔴 **고객에게 나가는 것이 안 바뀌었다.** 이 화면의 목록과 고객이 보는
 *     목록은 같은 함수에서 나오는데, 이번에 그 함수의 줄에 칸 넷이 늘었다.
 *     밖으로 보내는 자리가 줄을 통째로 펼치지 않고 하나씩 옮겨 적는지,
 *     그 목록이 **예전 그대로 열한 개**인지 본다. 새 칸이 하나라도 그 목록에
 *     들어가면 고객 화면에 사내 값이 샌다.
 *  2. 🔴 **기존 9열 표가 그대로 있다**(사용자: 「기존에 이 표는 그대로 사용하면서」).
 *  3. 🔴 **낙관적 잠금이 그대로다** — 저장이 여전히 expectedVersion 을 싣고,
 *     mutation 이 version 을 조건으로 건다. 그리고 한 줄의 저장이 **한 번**이다
 *     (나누면 첫 저장이 올린 version 때문에 둘째가 충돌로 막힌다).
 *  4. 🔴 **안 보낸 formValues 가 있던 값을 지우지 않는다** — 기본 보기의 저장은
 *     이 값을 모르는 채로 온다. 지우면 아무 오류 없이 적어 둔 값이 사라진다.
 *  5. 🔴 저장할 때 **서버가 스스로 고객사를 찾아** 양식을 고른다 — 화면이 보낸
 *     이름을 믿으면 남의 양식 칸을 이 접수에 적을 수 있다.
 *  6. 전환 단추는 **양식이 있는 고객사에서만** 보이고, 고른 보기를 글자로 말한다.
 *  7. 가로 스크롤을 **표를 감싼 상자가** 소유한다(표가 페이지를 밀지 않게).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * CustomerPortalScreen 은 서버 액션(actions/customer-portal)을 직접 import 하는
 * 클라이언트 컴포넌트라, 그 사슬 끝의 `server-only` 때문에 react-server 조건
 * 없이 도는 test:components 에서는 import 자체가 던진다. 조회·통로도 같은
 * 사정이다. 이웃(product-model-file-modified-date.test.ts)과 같은 방법이다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
/** CRLF 로 받아 둔 저장소에서도 표지가 맞도록 LF 로 맞춘다. */
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");
/**
 * 주석을 지운다. 이 파일들은 주석에 서로의 함수 이름과 칸 이름을 **까닭과 함께**
 * 길게 적어 두므로, 글자를 그냥 세면 주석 한 줄에 시험이 거짓으로 통과한다.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const screen = read("src/components/customer-portal/CustomerPortalScreen.tsx");
const sync = read("src/lib/server/services/customer-portal-sync.ts");
const action = read("src/lib/server/actions/customer-portal.ts");
const mutation = read("src/lib/db/mutations/customer-portal.ts");
const query = read("src/lib/db/queries/customer-portal.ts");

describe("🔴 1. 고객에게 나가는 것이 안 바뀌었다", () => {
  /**
   * 밖으로 보내는 body 는 두 자리에 있다(pushSnapshots · pushSnapshotForLink).
   * 둘 다 `items.map((item) => ({ ... }))` 꼴이라 그 안의 `item.<칸>` 을 센다.
   */
  const sentFieldGroups = [...code(sync).matchAll(/items\.map\(\(item\) => \(\{([\s\S]*?)\}\)\)/g)].map(
    (match) => [...match[1].matchAll(/(\w+): item\.(\w+)/g)].map((m) => m[2])
  );

  const EXPECTED_SENT = [
    "sourceKind",
    "sourceId",
    "intakeNumber",
    "modelName",
    "lotNumber",
    "serialNumber",
    "receivedAt",
    "statusLabel",
    "statusNote",
    "quoteNumber",
    "quoteIssuedDate",
  ];

  test("밖으로 내보내는 자리가 둘 다 있다", () => {
    assert.equal(sentFieldGroups.length, 2, "내보내는 자리의 개수가 달라졌다");
  });

  test("🔴 두 자리 모두 예전 그대로 열한 개를 보낸다", () => {
    for (const fields of sentFieldGroups) {
      assert.deepEqual(fields, EXPECTED_SENT);
    }
  });

  test("🔴 고객사 양식 쪽 새 칸 넷이 밖으로 나가지 않는다", () => {
    const body = code(sync);
    for (const leaked of [
      "item.endUserName",
      "item.orderIssuedDate",
      "item.deliveryRequestDates",
      "item.formValues",
    ]) {
      assert.ok(!body.includes(leaked), `${leaked} 가 고객 쪽으로 샌다`);
    }
  });

  test("🔴 줄을 통째로 펼치지 않는다 — 그 순간 앞으로 늘 칸이 전부 새어 나간다", () => {
    assert.ok(
      !/\.\.\.item\b/.test(code(sync)),
      "items 를 펼쳐 보내면 칸이 늘 때마다 고객 화면에 새로 나타난다"
    );
  });

  test("화면과 고객이 여전히 같은 조회를 쓴다", () => {
    assert.ok(code(sync).includes("listPortalItemsForCustomer"));
    assert.ok(
      code(query).includes("export async function listPortalItemsForCustomer"),
      "조회 이름이 바뀌면 둘이 갈릴 자리가 생긴다"
    );
  });
});

describe("🔴 2. 기존 9열 표가 그대로 있다", () => {
  const headers = flat(screen);

  test("아홉 개 머리글이 차례 그대로 남아 있다", () => {
    const pattern = [
      "접수번호",
      "Model",
      "L/N",
      "S/N",
      "접수일",
      "현재 상태",
      "비고",
      "견적서번호",
      "견적발행일",
    ]
      .map((label) => `<th className="px-3 py-2">${label}</th>`)
      .join(" ");
    assert.ok(headers.includes(pattern), "기본 표의 머리글이 바뀌었다");
  });

  test("기본 표를 그리는 ItemRow 가 그대로 있다", () => {
    assert.ok(code(screen).includes("function ItemRow("));
    assert.ok(flat(code(screen)).includes("<ItemRow"));
  });

  test("기본 표의 저장은 formValues 를 보내지 않는다", () => {
    const itemRow = code(screen).slice(
      code(screen).indexOf("function ItemRow("),
      code(screen).indexOf("function Cell(")
    );
    assert.ok(itemRow.includes("setCustomerStatusAction("), "기본 표의 저장이 사라졌다");
    assert.ok(
      !itemRow.includes("formValues"),
      "기본 보기가 formValues 를 보내면 그 값이 덮이거나 지워진다"
    );
  });
});

describe("🔴 3. 낙관적 잠금이 그대로다", () => {
  test("두 표의 저장 모두 expectedVersion 을 싣는다", () => {
    const calls = [...code(screen).matchAll(/setCustomerStatusAction\(\{([\s\S]*?)\}\)/g)];
    assert.equal(calls.length, 2, "저장하는 자리가 둘이 아니다");
    for (const call of calls) {
      assert.ok(
        /expectedVersion: item\.statusVersion/.test(call[1]),
        "expectedVersion 을 안 싣는 저장이 있다"
      );
    }
  });

  test("mutation 이 version 을 조건으로 걸고 올린다", () => {
    const body = flat(code(mutation));
    assert.ok(
      body.includes("eq(repairCaseCustomerStatus.version, expectedVersion)"),
      "version 조건이 사라졌다"
    );
    assert.ok(
      body.includes("version: sql`${repairCaseCustomerStatus.version} + 1`"),
      "version 을 올리지 않는다"
    );
  });

  test("🔴 한 줄의 저장은 한 번이다 — formValues 만 따로 저장하는 액션이 없다", () => {
    assert.ok(
      !/export async function set\w*FormValues/.test(code(action)),
      "저장이 둘로 나뉘면 첫 저장이 올린 version 때문에 둘째가 막힌다"
    );
  });
});

describe("🔴 4. 안 보낸 formValues 는 있던 값을 지우지 않는다", () => {
  test("update 는 안 넘겼을 때 키 자체를 넣지 않는다", () => {
    assert.ok(
      flat(code(mutation)).includes("...(formValues === undefined ? {} : { formValues })"),
      "안 넘긴 값을 비우지 않는다는 장치가 사라졌다"
    );
  });

  test("🔴 null 로 눕혀 넣는 길이 없다", () => {
    const body = flat(code(mutation));
    for (const forbidden of ["formValues ?? null", "formValues || null", "formValues: null"]) {
      assert.ok(!body.includes(forbidden), `${forbidden} 은 남의 값을 지운다`);
    }
  });

  test("새로 만드는 줄에서는 빈 것으로 시작한다", () => {
    assert.ok(flat(code(mutation)).includes("formValues: formValues ?? {}"));
  });
});

describe("🔴 5. 저장할 때 양식은 서버가 고른다", () => {
  const body = flat(code(action));

  test("접수에서 거슬러 올라가 고객사 이름을 읽는다", () => {
    assert.ok(
      body.includes("getCustomerNameForRepairCase(input.repairCaseId)"),
      "화면이 보낸 이름을 믿으면 남의 양식 칸을 적을 수 있다"
    );
    assert.ok(body.includes("findPortalFormForCustomerName(customerName)"));
  });

  test("걸러 내는 문을 반드시 지난다", () => {
    assert.ok(body.includes("sanitizeManualValues(form, input.formValues)"));
  });

  test("🔴 화면이 보낸 값이 그대로 mutation 으로 흘러가지 않는다", () => {
    assert.ok(
      !body.includes("formValues: input.formValues"),
      "거르지 않은 값이 그대로 저장되면 양식이 아무 뜻이 없다"
    );
  });

  test("양식 이름이나 id 를 입력으로 받지 않는다", () => {
    assert.ok(!/formId|formKey|portalFormId/.test(code(action)));
  });

  test("조회가 고객사를 접수에서 찾는다(화면 입력이 아니다)", () => {
    assert.ok(
      code(query).includes("export async function getCustomerNameForRepairCase"),
      "그 조회가 사라졌다"
    );
  });
});

describe("🔴 6. 보기 전환", () => {
  const body = flat(code(screen));

  test("양식이 있을 때만 단추가 그려진다", () => {
    assert.ok(
      body.includes("const form = findPortalFormForCustomerName(selected?.customerName)"),
      "고른 고객사의 양식을 찾는 자리가 사라졌다"
    );
    assert.ok(body.includes("{form ? ("), "양식이 없을 때도 단추가 보인다");
  });

  test("고른 보기를 이 저장소의 저장 장치에 기억한다", () => {
    assert.ok(body.includes("useStoredChoice(PORTAL_VIEW_STORAGE_KEY)"));
    assert.ok(body.includes("setStoredChoice(PORTAL_VIEW_STORAGE_KEY"));
    assert.ok(
      /const PORTAL_VIEW_STORAGE_KEY = "[\w-]+:[\w-]+";/.test(body),
      "키가 「무엇:어디」 꼴이 아니다(common/responsive-list.tsx 의 관례)"
    );
  });

  test("🔴 양식이 없으면 기억한 값과 무관하게 기본 보기다", () => {
    assert.ok(
      body.includes("const showForm = form !== null && storedView === PORTAL_VIEW_FORM"),
      "양식 없는 고객사에서 양식 보기로 떨어질 수 있다"
    );
  });

  test("어느 보기를 보고 있는지 글자로 말한다", () => {
    assert.ok(body.includes("지금 <strong className=\"text-zinc-900\">기본 보기</strong>로 보고"));
    assert.ok(body.includes("aria-pressed={showForm}"));
    assert.ok(body.includes("aria-pressed={!showForm}"));
  });

  test("두 표를 동시에 그리지 않는다 — 갈아 끼운다", () => {
    assert.ok(
      body.includes("showForm && form ? ( <CustomerFormTable"),
      "두 표를 위아래로 쌓으면 같은 건이 두 번 나온다"
    );
  });
});

describe("🔴 7. 표가 페이지를 옆으로 밀지 않는다", () => {
  test("고객사 양식 표도 넘침을 감싼 상자가 갖는다", () => {
    const body = flat(code(screen));
    assert.ok(
      /<div className="overflow-x-auto"> <table className="w-full min-w-\[80rem\]/.test(body),
      "가로 스크롤을 감싼 상자가 갖지 않으면 넘친 폭이 페이지로 퍼진다"
    );
  });

  test("가장 넓은 양식이 열 열세 개다 — 최소 폭을 그만큼 잡아 둔 근거", () => {
    const widest = Math.max(...CUSTOMER_PORTAL_FORMS.map((form) => form.columns.length));
    assert.equal(widest, 13);
  });
});

describe("표를 그리는 일은 양식 정의만 보고 한다", () => {
  const body = flat(code(screen));

  test("열 이름을 화면에 적어 두지 않는다", () => {
    assert.ok(body.includes("form.columns.map((column) =>"), "열 목록을 돌지 않는다");
    for (const form of CUSTOMER_PORTAL_FORMS) {
      for (const column of manualColumnsOf(form)) {
        assert.ok(
          !body.includes(`>${column.label}<`),
          `${column.label} 이 화면에 박혀 있다 — 정의와 두 벌이 된다`
        );
      }
    }
  });

  test("손으로 적는 칸의 길이 상한을 화면도 같은 상수로 건다", () => {
    assert.ok(body.includes("maxLength={PORTAL_MANUAL_VALUE_MAX_LENGTH}"));
  });

  test("저장된 값을 지금 양식으로 걸러 화면에 들인다", () => {
    assert.ok(body.includes("readManualValues(form, item.formValues)"));
  });

  test("여러 납기일은 내자 정리와 **같은 함수**로 그린다", () => {
    assert.ok(body.includes("formatDomesticOrderDueDateLines(item.deliveryRequestDates)"));
  });
});
