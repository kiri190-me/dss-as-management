import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
 *  1. (없어짐) 밖으로 내보내던 자리가 **무엇을 보내는가**를 보던 묶음이었다.
 *     2026-10-04 에 서버 쪽 동기화(services/customer-portal-sync.ts)를 걷어내면서
 *     보낼 자리 자체가 없어졌다 — 번호는 아래 차례를 흔들지 않으려고 비워 둔다.
 *  2. 🔴 **기본 9열 표와 보기 전환이 없어졌다**(사용자 요청 2026-10-04 —
 *     「[기본보기]도 없애주고 각사별 양식만 남겨줘」). 남은 표는 양식 표 하나다.
 *  3. 🔴 **낙관적 잠금이 그대로다** — 저장이 여전히 expectedVersion 을 싣고,
 *     mutation 이 version 을 조건으로 건다. 그리고 한 줄의 저장이 **한 번**이다
 *     (나누면 첫 저장이 올린 version 때문에 둘째가 충돌로 막힌다).
 *  4. 🔴 **안 보낸 formValues 가 있던 값을 지우지 않는다** — 양식을 모르는 다른
 *     저장 길이 이 값을 싣지 않고 온다. 지우면 아무 오류 없이 적어 둔 값이 사라진다.
 *  5. 🔴 저장할 때 **서버가 스스로 고객사를 찾아** 양식을 고른다 — 화면이 보낸
 *     이름을 믿으면 남의 양식 칸을 이 접수에 적을 수 있다.
 *  6. 단추는 **양식**이고(고객사가 아니다), 지금 어느 양식을 보는지 글자로 말한다.
 *  7. 가로 스크롤을 **표를 감싼 상자가** 소유한다(표가 페이지를 밀지 않게).
 *  8. 🔴 화면 표와 엑셀이 **같은 조회**를 쓴다(2026-10-04) — 각자 모으면 담당자가
 *     본 표와 저장된 파일이 갈리고, 그 어긋남은 아무도 눈치채지 못한 채 굳는다.
 *  9. 🔴 **`전체 / RFG / MB` 고르개**(2026-10-07) — 낱말과 판정을 주간보고에서
 *     그대로 가져오고, 기본은 `전체` 이며, 걸렀으면 그 사실을 화면에 적고, 종류를
 *     알 수 없는 줄은 어느 보기에서도 감추지 않는다.
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
const action = read("src/lib/server/actions/customer-portal.ts");
const mutation = read("src/lib/db/mutations/customer-portal.ts");
const query = read("src/lib/db/queries/customer-portal.ts");

describe("🔴 1. 밖으로 내보내던 길이 통째로 없어졌다 (2026-10-04)", () => {
  const existsInRepo = (relativePath: string) =>
    existsSync(new URL(relativePath, repoUrl));

  test("동기화 서비스와 그 실행 스크립트가 저장소에 없다", () => {
    for (const gone of [
      "src/lib/server/services/customer-portal-sync.ts",
      "scripts/sync-customer-portal.ts",
    ]) {
      assert.equal(existsInRepo(gone), false, `되살아났다: ${gone}`);
    }
  });

  test("🔴 액션에 밖으로 미는 자리가 하나도 없다 — 되살리려면 이 시험을 먼저 본다", () => {
    const body = code(action);
    for (const gone of [
      "issueCustomerLinkAction",
      "revealCustomerLinkUrlAction",
      "revokeCustomerLinkAction",
      "syncNowAction",
      "DSS_HOME_URL",
    ]) {
      assert.ok(!body.includes(gone), `전용 주소 쪽 자취가 남았다: ${gone}`);
    }
  });

  test("남은 액션은 상태 저장과 상태 목록 셋뿐이다", () => {
    const exported = [...code(action).matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    assert.deepEqual(exported, [
      "setCustomerStatusAction",
      "createStatusOptionAction",
      "updateStatusOptionAction",
    ]);
  });

  test("조회는 그대로 남아 화면과 엑셀이 함께 쓴다", () => {
    assert.ok(
      code(query).includes("export async function listPortalItemsForCustomer"),
      "조회 이름이 바뀌면 화면과 엑셀이 갈릴 자리가 생긴다"
    );
  });
});

describe("🔴 2. 기본 9열 표와 보기 전환이 없어졌다", () => {
  const body = flat(code(screen));

  test("아홉 개 머리글이 화면에 없다", () => {
    const headers = flat(screen);
    for (const label of ["접수번호", "접수일", "현재 상태", "견적서번호", "견적발행일"]) {
      assert.ok(
        !headers.includes(`<th className="px-3 py-2">${label}</th>`),
        `기본 9열 표의 머리글이 남아 있다: ${label}`
      );
    }
  });

  test("기본 표를 그리던 ItemRow 가 사라졌다", () => {
    assert.ok(!code(screen).includes("function ItemRow("));
    assert.ok(!body.includes("<ItemRow"));
  });

  test("🔴 보기 전환 장치가 통째로 사라졌다 — 고를 것이 하나면 전환은 뜻을 잃는다", () => {
    for (const gone of [
      "PORTAL_VIEW_STORAGE_KEY",
      "PORTAL_VIEW_FORM",
      "PORTAL_VIEW_DEFAULT",
      "useStoredChoice",
      "setStoredChoice",
      "showForm",
      "기본 보기",
    ]) {
      assert.ok(!body.includes(gone), `보기 전환의 자취가 남았다: ${gone}`);
    }
  });

  test("🔴 전용 주소에 매달린 것들이 화면에서 사라졌다", () => {
    // 「고객이 보낸 수리 의뢰」 목록으로 가던 주소는 여기서 글자로 세지 않는다 —
    // 2026-10-04 에 **저장소 어디에도 없게** 만들었고(src·scripts 전부), 그 주소를
    // 적어 두면 그 사실을 확인하는 grep 이 이 시험 파일에 걸린다. 서버 쪽이
    // 되살아나지 않는 것은 위 「1.」 묶음이 지킨다.
    for (const gone of [
      "CustomerLinkAddress",
      "issueCustomerLinkAction",
      "revokeCustomerLinkAction",
      "syncNowAction",
      "customersWithoutLink",
      "canManageLinks",
    ]) {
      assert.ok(!body.includes(gone), `전용 주소 쪽 자취가 남았다: ${gone}`);
    }
  });

  test("🔴 거짓이 될 문구를 지웠다 — 고객 화면이 없다", () => {
    const text = flat(screen);
    assert.ok(!text.includes("고객 화면도 비어 있습니다"));
    assert.ok(!text.includes("고객 화면으로 나가지 않습니다"));
    assert.ok(!text.includes("고객사가 전용 주소로 들어왔을 때"));
  });

  test("남은 표는 양식 표 하나다", () => {
    assert.ok(body.includes("<CustomerFormTable"), "양식 표가 사라졌다");
    assert.equal(
      (body.match(/<table /g) ?? []).length,
      1,
      "표가 하나가 아니다 — 기본 표가 남았거나 표가 더 늘었다"
    );
  });
});

describe("🔴 3. 낙관적 잠금이 그대로다", () => {
  test("양식 표의 저장이 expectedVersion 을 싣는다", () => {
    const calls = [...code(screen).matchAll(/setCustomerStatusAction\(\{([\s\S]*?)\}\)/g)];
    // 2026-10-04 에 기본 9열 표가 없어지면서 저장하는 자리가 둘에서 하나로 줄었다.
    assert.equal(calls.length, 1, "저장하는 자리가 하나가 아니다");
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

describe("🔴 6. 단추는 고객사가 아니라 양식이다", () => {
  const body = flat(code(screen));
  const page = read("src/app/(app)/customer-portal/page.tsx");

  test("페이지가 양식 묶음을 읽어 넘긴다 — 링크 목록이 아니다", () => {
    const pageBody = flat(code(page));
    assert.ok(pageBody.includes("listPortalFormGroups()"), "양식 묶음을 읽지 않는다");
    assert.ok(
      pageBody.includes("listPortalItemsForForm(group.formId)"),
      "양식 단위로 목록을 읽지 않는다"
    );
    assert.ok(!pageBody.includes("listActiveLinks"), "아직 발급된 주소로 화면을 만든다");
  });

  test("🔴 고른 식별자를 양식 정의로 되짚는다 — 화면 글자를 그대로 믿지 않는다", () => {
    assert.ok(
      body.includes("const form = findPortalFormById(selectedFormId)"),
      "고른 양식을 되짚는 자리가 사라졌다"
    );
    assert.ok(body.includes("{form ? ("), "양식이 없을 때도 표가 보인다");
  });

  test("🔴 단추 글자는 짧은 양식 식별자다 — `form.label` 은 「ICD 양식」이라 길다", () => {
    assert.ok(body.includes("formIds.map((formId) => ("), "양식 목록을 돌지 않는다");
    assert.ok(body.includes("aria-pressed={formId === selectedFormId}"));
    assert.ok(body.includes("> {formId} </button>"), "단추 글자가 식별자가 아니다");
  });

  test("처음 고르는 것은 첫 양식이다", () => {
    assert.ok(body.includes("useState<string | null>( formIds[0] ?? null )"));
  });

  test("지금 어느 양식을 보고 있는지 글자로 말한다 — 양식마다 열이 다르다", () => {
    assert.ok(
      body.includes('지금 <strong className="text-zinc-900">{form.label}</strong>으로 보고'),
      "어느 양식인지 말하는 문장이 사라졌다"
    );
  });
});

describe("🔴 8. 화면 표와 엑셀이 같은 조회를 쓴다", () => {
  const service = read("src/lib/server/services/customer-portal-export.ts");
  const exportAction = read("src/lib/server/actions/customer-portal-export.ts");
  const panel = read("src/components/customer-portal/CustomerFormExportPanel.tsx");

  test("내보내기가 양식 단위 조회를 그대로 쓴다", () => {
    assert.ok(
      flat(code(service)).includes("listPortalItemsForForm(form.id)"),
      "엑셀이 화면 표와 다른 집합을 모은다"
    );
    assert.ok(
      !code(service).includes("listActiveLinks"),
      "내보내기가 아직 발급된 주소로 대상을 정한다"
    );
  });

  test("🔴 양식은 서버가 목록과 맞춰 본다 — 화면이 보낸 글자를 그대로 쓰지 않는다", () => {
    assert.ok(flat(code(service)).includes("const form = findPortalFormById(formId)"));
    assert.ok(flat(code(service)).includes("if (form === null) return failure(\"NO_FORM\""));
  });

  test("화면 → 통로 → 서비스가 모두 양식 식별자 하나를 나른다", () => {
    const panelBody = flat(code(panel));
    assert.ok(panelBody.includes("previewCustomerFormExportAction({ formId })"));
    assert.ok(panelBody.includes("saveCustomerFormExportAction({ formId })"));
    assert.ok(!panelBody.includes("customerId"), "아직 고객사 id 를 나른다");
    const actionBody = flat(code(exportAction));
    assert.equal(
      (actionBody.match(/prepareCustomerPortalExport\(input\.formId\)/g) ?? []).length,
      2,
      "미리보기 · 저장 둘 다 양식 식별자로 부르지 않는다"
    );
    assert.ok(!actionBody.includes("input.customerId"), "통로가 아직 고객사 id 를 받는다");
  });

  test("🔴 조회가 그 양식에 묶인 고객사를 **전부** 모은다 — 같은 회사의 표가 둘로 갈리지 않게", () => {
    const body = flat(code(query));
    assert.ok(body.includes("export async function listPortalItemsForForm"));
    assert.ok(
      body.includes("group.customerIds.map((customerId) => listPortalItemsForCustomer(customerId))"),
      "한 고객사만 보고 있다 — INVENIA 와 INVENIA Co.,Ltd 가 갈린다"
    );
    assert.ok(
      body.includes("sortPortalRowsByReceivedAt(merged)"),
      "합친 뒤 반출일 차례로 세우지 않는다"
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

describe("🔴 9. 전체 / RFG / MB 고르개", () => {
  const body = flat(code(screen));
  const queryBody = flat(code(query));

  test("조회가 줄마다 종류를 싣는다 — 질의를 한 번 더 쏘지 않는다", () => {
    assert.ok(
      queryBody.includes("kind: foldPortalKind(row.workflowType)"),
      "줄에 종류가 실리지 않는다 — 화면이 거를 근거가 없어진다"
    );
    assert.ok(
      !queryBody.includes("workflowTypeCodeColumn"),
      "조회가 작업 종류를 직접 또 읽는다 — listRepairCasesByCustomerId 가 이미 싣고 온다"
    );
  });

  test("🔴 판정은 주간보고와 같은 함수다 — 규칙을 여기 다시 적지 않는다", () => {
    assert.ok(
      queryBody.includes("foldWeeklyReportKind(workflowType)"),
      "RFG/MB 판정이 주간보고와 갈렸다 — 같은 건이 화면마다 다른 종류가 된다"
    );
    for (const rule of ["_MATCHER", "_GENERATOR", "_TOTAL_CONTROLLER"]) {
      assert.ok(
        !queryBody.includes(rule),
        `접는 규칙을 조회에 다시 적었다: ${rule}`
      );
    }
  });

  test("🔴 접을 수 없는 줄은 null 이다 — 레거시 workflow_type 이 남아 있다", () => {
    assert.ok(
      queryBody.includes("const kind: WeeklyReportKind | undefined = foldWeeklyReportKind("),
      "undefined 를 받을 수 있게 넓혀 담는 자리가 사라졌다"
    );
    assert.ok(queryBody.includes("return kind ?? null;"));
    assert.ok(
      queryBody.includes("kind: WeeklyReportKind | null;"),
      "줄의 종류 칸이 null 을 말하지 않는다"
    );
  });

  test("🔴 낱말을 새로 적지 않고 주간보고의 것을 쓴다", () => {
    assert.ok(
      body.includes("WEEKLY_REPORT_KIND_FILTERS") &&
        body.includes("weeklyReportKindFilterLabels"),
      "고르개의 값·글자를 주간보고에서 가져오지 않는다"
    );
    // 종류 이름을 화면에 박으면 주간보고와 갈린다. 값은 WEEKLY_REPORT_KINDS 가,
    // 글자는 weeklyReportKindFilterLabels 가 갖는다.
    for (const label of ['"RFG"', '"MB"', ">RFG<", ">MB<"]) {
      assert.ok(!body.includes(label), `종류 이름을 화면에 적었다: ${label}`);
    }
  });

  test("🔴 기본은 전체다 — 고르개가 붙기 전과 같은 표가 먼저 보인다", () => {
    assert.ok(
      body.includes('useState<WeeklyReportKindFilter>("ALL")'),
      "기본값이 전체가 아니다"
    );
  });

  test("표가 거른 줄을 그리고, 거르기 전의 수는 따로 들고 있다", () => {
    assert.ok(body.includes("const allItems = form ? (itemsByForm[form.id] ?? []) : [];"));
    assert.ok(body.includes("const items = filterPortalItemsByKind(allItems, kindFilter);"));
    assert.ok(body.includes("<CustomerFormTable form={form} items={items}"));
  });

  test("🔴 종류를 알 수 없는 줄은 어느 보기에서도 빠지지 않는다", () => {
    assert.ok(
      body.includes("items.filter((item) => item.kind === filter || item.kind === null)"),
      "거르면서 종류를 모르는 줄까지 떨어뜨린다 — 「있던 줄이 없어졌다」가 된다"
    );
    assert.ok(
      body.includes('if (filter === "ALL") return items;'),
      "전체일 때 배열을 그대로 돌려주지 않는다"
    );
  });

  test("🔴 걸렀으면 그 사실을 화면에 적는다 — 줄 수만 줄면 「건이 줄었다」로 읽힌다", () => {
    assert.ok(
      body.includes('{kindFilter !== "ALL" ? ( <KindFilterBanner'),
      "걸렀을 때 안내 줄이 나오지 않는다"
    );
    const banner = flat(code(screen)).slice(flat(code(screen)).indexOf("function KindFilterBanner("));
    assert.ok(banner.includes("totalCount"), "전체가 몇 건인지 적지 않는다");
    assert.ok(banner.includes("shownCount"), "보이는 것이 몇 건인지 적지 않는다");
    assert.ok(banner.includes("unknownKindCount"), "종류를 모르는 줄을 말하지 않는다");
    assert.ok(
      banner.includes("엑셀 미리보기 · 공유폴더에 저장은 이 고르개를 따르지 않습니다"),
      "엑셀이 고르개를 따르지 않는다는 사실을 적지 않는다 — 보이는 대로 저장된다고 믿게 된다"
    );
  });

  test("🔴 빈 표의 까닭을 가른다 — 걸러서 비었는데 「건이 없습니다」는 거짓말이다", () => {
    assert.ok(
      body.includes("{allItems.length === 0 ? \"이 양식에 묶인 고객사에 진행 중인 건이 없습니다.\""),
      "걸러서 빈 표와 정말 빈 표가 같은 말을 한다"
    );
  });

  test("🔴 고르개는 화면 상태다 — 주소를 바꾸지 않는다(양식 고르개와 같은 방식)", () => {
    const pageBody = flat(code(read("src/app/(app)/customer-portal/page.tsx")));
    assert.ok(
      !pageBody.includes("searchParams"),
      "페이지가 주소 인자를 읽는다 — 주소로 옮긴다면 양식 고르개도 함께 옮겨야 한다(화면 머리말)"
    );
    assert.ok(
      body.includes("aria-pressed={filter === current}"),
      "눌린 단추를 색으로만 말한다"
    );
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

  test("🔴 「납품 요청일」은 접수 건의 고객 요청 납기일을 그대로 그린다", () => {
    assert.ok(
      body.includes("case \"customerRequestedDueDate\": return item.customerRequestedDueDate;"),
      "그 칸을 그리는 자리가 사라졌다"
    );
    // 내자 납기요청일로 되돌아가면 이 화면이 그 함수를 다시 부르게 된다.
    assert.ok(
      !code(screen).includes("formatDomesticOrderDueDateLines"),
      "내자 정리의 납기요청일로 되돌아갔다 — 2026-09-30 사용자 확인을 먼저 읽을 것"
    );
  });
});
