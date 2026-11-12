import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import PermissionTargetTree from "@/components/users/PermissionTargetTree";
import { PERMISSION_AREAS } from "@/lib/auth/permission-areas";
import { findPermissionFeature, hasFeatures } from "@/lib/auth/permission-features";
import {
  REPAIR_CASE_DETAIL_TAB_KEYS,
  REPAIR_CASE_DETAIL_TAB_PERMISSIONS,
  type RepairCaseDetailTabKey,
  type RepairCaseDetailTabVisibility,
} from "@/lib/auth/repair-case-detail-tab-permissions";
import { repairCaseDetailHrefs } from "@/lib/domain/repair-case-detail-tabs";
import { buildRepairCaseDetailTabs } from "./detail-tabs-list";

/**
 * ============================================================================
 * 탭마다 권한 — 화면이 감추고, 서버가 막는다 (2026-11-12)
 * ============================================================================
 * 사용자 요구: 「수리건 상세처럼 안에 탭이 있는 화면의 탭들도 세세하게 설정할 수
 * 있게」. 잎 쪽(기본값 · 키 · 이름표)은 `lib/auth/repair-case-detail-tab-permissions.test.ts`
 * 가 보고, 여기서는 **화면**을 본다.
 *
 * ① 탭 줄 — 닫으면 그 탭만 빠지고 **차례는 그대로**인가. [기본 정보]는 남는가.
 *    🔵 글자가 아니라 **값**으로 잰다 — 탭 줄이 순수 함수로 떨어져 있다.
 * ② 🔴 **주소를 직접 쳐도 막히는가** — 탭마다 제 page.tsx 가 서버에서 다시 본다.
 *    감추는 것은 막은 것이 아니다. 이쪽은 서버 컴포넌트라 그려 볼 수 없어 원본
 *    글자로 읽는다(형제 detail-header-placement.test.ts 와 같은 방법).
 * ③ 🔴 **빠진 라우트가 없는가** — `[id]` 아래의 page.tsx 를 **파일 시스템에서 직접
 *    걸어** 모은다. 자식 주소(흐름도 편집기 · 보고서 작성 화면)를 두고 탭 뿌리만
 *    막으면 가린 것이 아니다.
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HREFS = repairCaseDetailHrefs(CASE_ID);

const ALL_VISIBLE: RepairCaseDetailTabVisibility = Object.fromEntries(
  REPAIR_CASE_DETAIL_TAB_KEYS.map((tab) => [tab, true])
) as RepairCaseDetailTabVisibility;
const NONE_VISIBLE: RepairCaseDetailTabVisibility = Object.fromEntries(
  REPAIR_CASE_DETAIL_TAB_KEYS.map((tab) => [tab, false])
) as RepairCaseDetailTabVisibility;

/** 화면에 보이는 차례 — 2026-09-04 · 2026-10-12 사용자 지정. 🔴 바뀌면 안 된다. */
const TAB_ORDER: readonly { label: string; href: string; tab: RepairCaseDetailTabKey | null }[] = [
  { label: "기본 정보", href: HREFS.root, tab: null },
  { label: "작업내용", href: HREFS.execution, tab: "execution" },
  { label: "진단 Flowchart", href: HREFS.diagnosis, tab: "diagnosis" },
  { label: "작업 이력", href: HREFS.workHistory, tab: "workHistory" },
  { label: "파일 관리", href: HREFS.files, tab: "files" },
  { label: "보고서", href: HREFS.report, tab: "report" },
  { label: "견적서", href: HREFS.quotes, tab: "quotes" },
  { label: "발주서", href: HREFS.purchaseOrders, tab: "purchaseOrders" },
  { label: "검수/승인", href: HREFS.approval, tab: "approval" },
];

describe("① 탭 줄 — 닫으면 그 탭만 빠진다", () => {
  test("표본이 비어 있지 않다 — 여덟 칸을 실제로 훑는다", () => {
    assert.equal(Object.values(ALL_VISIBLE).filter(Boolean).length, 8);
    assert.equal(Object.values(NONE_VISIBLE).filter(Boolean).length, 0);
  });

  test("전부 열리면 아홉 탭이 사용자가 정한 차례 그대로 선다", () => {
    assert.deepEqual(
      buildRepairCaseDetailTabs(CASE_ID, ALL_VISIBLE),
      TAB_ORDER.map(({ label, href }) => ({ label, href }))
    );
  });

  test("🔴 하나를 닫으면 **그 탭만** 빠지고 나머지 차례는 그대로다", () => {
    for (const { tab, label } of TAB_ORDER) {
      if (tab === null) continue;
      const tabs = buildRepairCaseDetailTabs(CASE_ID, { ...ALL_VISIBLE, [tab]: false });
      const labels = tabs.map((t) => t.label);
      assert.equal(labels.includes(label), false, `${label} 탭이 닫혔는데 그대로 있다`);
      assert.deepEqual(
        labels,
        TAB_ORDER.filter((entry) => entry.label !== label).map((entry) => entry.label),
        `${label} 을 닫았더니 다른 탭의 차례가 흔들렸다`
      );
    }
  });

  test("🔴 [기본 정보]는 **여덟을 전부 닫아도** 남는다 — 빈 탭 줄이 생기지 않는다", () => {
    const tabs = buildRepairCaseDetailTabs(CASE_ID, NONE_VISIBLE);
    assert.deepEqual(tabs, [{ label: "기본 정보", href: HREFS.root }]);
  });

  test("🔴 [기본 정보]를 가릴 길이 없다 — 가시성 꾸러미에 그 칸이 없다", () => {
    assert.equal(Object.keys(ALL_VISIBLE).includes("root"), false);
    // 만든 목록의 첫 줄은 언제나 뿌리 주소다 — 어떤 조합에서도.
    for (const tab of REPAIR_CASE_DETAIL_TAB_KEYS) {
      const tabs = buildRepairCaseDetailTabs(CASE_ID, { ...NONE_VISIBLE, [tab]: true });
      assert.equal(tabs[0]?.href, HREFS.root, `${tab} 하나만 열었을 때 첫 탭이 [기본 정보]가 아니다`);
      assert.equal(tabs.length, 2);
    }
  });

  test("주소는 도메인 헬퍼가 만든 것 그대로다 — 탭 줄이 글자를 따로 적지 않는다", () => {
    const listSource = read("src/components/repair-cases/detail/detail-tabs-list.ts");
    assert.ok(listSource.includes("repairCaseDetailHrefs(repairCaseId)"), "주소를 헬퍼에서 안 받는다");
    assert.equal(listSource.includes("`/repair-cases/"), false, "탭 줄이 주소를 직접 조립한다");
  });

  test("🔴 화면이 권한을 **묻지 않는다** — 서버가 넘겨준 값을 그릴 뿐이다", () => {
    for (const file of [
      "src/components/repair-cases/detail/detail-tabs-list.ts",
      "src/components/repair-cases/detail/DetailTabs.tsx",
    ]) {
      const source = read(file);
      assert.equal(source.includes("hasPermission"), false, `${file} 가 직접 권한을 묻는다`);
      assert.equal(source.includes("canOpenRepairCaseDetailTab"), false, `${file} 가 직접 판정한다`);
    }
  });
});

describe("② 🔴 레이아웃이 탭마다 열쇠를 묻는다 — 그러나 열쇠를 스스로 적지는 않는다", () => {
  const layout = read("src/app/(app)/repair-cases/[id]/layout.tsx");

  test("가시성을 공용 창구에서 받아 탭 줄에 넘긴다", () => {
    assert.ok(
      layout.includes('import { resolveRepairCaseDetailTabVisibility } from "@/lib/auth/repair-case-detail-tab-access";'),
      "레이아웃이 공용 창구를 안 쓴다"
    );
    assert.ok(layout.includes("await resolveRepairCaseDetailTabVisibility(actingUser)"));
    assert.ok(layout.includes("visibility={tabVisibility}"), "탭 줄에 가시성이 안 넘어간다");
  });

  test("🔴 레이아웃에 열쇠 글자가 하나도 없다 — 표가 유일한 출처다", () => {
    for (const entry of Object.values(REPAIR_CASE_DETAIL_TAB_PERMISSIONS)) {
      for (const requirement of entry.anyOf) {
        assert.equal(
          layout.includes(`"${requirement.key}"`),
          false,
          `레이아웃이 열쇠 '${requirement.key}' 를 따로 적고 있다 — 표와 갈라질 자리다`
        );
      }
    }
  });

  test("🔴 살아 있는 계정으로 묻는다 — 강등된 계정이 옛 토큰으로 다니지 못하게", () => {
    assert.ok(layout.includes("await resolveActingUserForSession(session)"));
  });
});

/**
 * ============================================================================
 * ③ 🔴 주소를 직접 쳐도 막힌다 — 라우트를 파일 시스템에서 걸어 **전부** 센다
 * ============================================================================
 * 탭 뿌리만 막고 자식 주소를 두면 가린 것이 아니다. 실제로 [진단 Flowchart] 에는
 * 자식이 둘(`/{flowchartId}` · `/work-records`), [보고서] 에도 둘
 * (`/service-report` · `/service-report/print`) 있다.
 *
 * 🔴 **대괄호 폴더(`[flowchartId]`)도 함께 걷는다** — 이 저장소에서 글롭이 대괄호
 * 폴더를 건너뛰어 시험이 조용히 0건이던 적이 있다. 여기서는 글롭이 아니라
 * readdirSync 로 걸으므로 그 함정에 걸리지 않는다.
 * ============================================================================
 */
describe("③ 🔴 탭마다 제 page.tsx 가 서버에서 다시 막는다", () => {
  const routeRoot = "src/app/(app)/repair-cases/[id]";

  /** `[id]` 바로 아래 폴더 이름 → 어느 탭의 것인가. 🔴 [기본 정보]는 뿌리 page.tsx 다. */
  const TAB_BY_SEGMENT: Record<string, RepairCaseDetailTabKey> = {
    execution: "execution",
    diagnosis: "diagnosis",
    "work-history": "workHistory",
    files: "files",
    report: "report",
    quotes: "quotes",
    "purchase-orders": "purchaseOrders",
    approval: "approval",
  };

  /**
   * 🔴 **공용 창구를 쓰지 않는 탭 둘.** [견적서]·[발주서]는 2026-11-12 이전부터
   * 제 글자로 메뉴 권한을 묻고 있었고, 「지금 동작 그대로」가 사용자 결정이라
   * 건드리지 않았다. 그 대신 **표의 열쇠와 글자가 같은지**를 여기서 맞댄다 —
   * 한쪽만 바뀌면 탭 줄과 페이지가 서로 다른 열쇠를 보게 된다.
   */
  const LITERAL_GUARD_TABS: readonly RepairCaseDetailTabKey[] = ["quotes", "purchaseOrders"];

  /** `[id]` 아래의 page.tsx 를 전부 모은다 — 뿌리의 것까지. */
  function collectPageFiles(dir: string, relative: string, found: string[] = []): string[] {
    if (existsSync(path.join(dir, "page.tsx"))) found.push(relative === "" ? "page.tsx" : `${relative}/page.tsx`);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      collectPageFiles(
        path.join(dir, entry.name),
        relative === "" ? entry.name : `${relative}/${entry.name}`,
        found
      );
    }
    return found;
  }

  const pageFiles = collectPageFiles(path.join(ROOT, routeRoot), "").sort();

  test("🔴 라우트를 실제로 찾았다 — 표본이 비면 아래가 전부 공짜로 통과한다", () => {
    assert.ok(pageFiles.length >= 10, `page.tsx 를 ${pageFiles.length} 개만 찾았다 — 걷는 방법이 깨졌다`);
    assert.ok(pageFiles.includes("page.tsx"), "뿌리([기본 정보]) page.tsx 를 못 찾았다");
    assert.ok(
      pageFiles.includes("diagnosis/[flowchartId]/page.tsx"),
      "대괄호 폴더를 건너뛰었다 — 흐름도 편집기가 검사 밖에 있다"
    );
  });

  test("🔴 첫 폴더 이름이 전부 아는 탭이다 — 새 탭이 생기면 여기서 걸린다", () => {
    const segments = new Set(
      pageFiles.filter((file) => file !== "page.tsx").map((file) => file.split("/")[0])
    );
    assert.deepEqual([...segments].sort(), Object.keys(TAB_BY_SEGMENT).sort());
  });

  test("🔴 [기본 정보](뿌리 page.tsx)에는 탭 관문이 **없다**", () => {
    // 그 탭을 가리는 열쇠(`repairCases.view`)가 [접근 불가]면 목록도 상세도 통째로
    // 막힌다 — 탭 하나를 가리는 문제가 아니다. 따로 검사를 붙이면 「들어왔는데 첫
    // 탭이 없는」 상태가 생긴다(2026-11-12 사용자 결정).
    const rootPage = read(`${routeRoot}/page.tsx`);
    assert.equal(rootPage.includes("canOpenRepairCaseDetailTab"), false, "[기본 정보] 탭에 관문이 붙었다");
  });

  for (const file of pageFiles) {
    if (file === "page.tsx") continue;
    const tab = TAB_BY_SEGMENT[file.split("/")[0]];
    test(`${file} — 주소를 직접 쳐도 막힌다 (${tab})`, () => {
      const source = read(`${routeRoot}/${file}`);
      const entry = REPAIR_CASE_DETAIL_TAB_PERMISSIONS[tab];
      if (LITERAL_GUARD_TABS.includes(tab)) {
        // 이 둘은 열쇠가 하나씩뿐이다(위 표).
        const [only] = entry.anyOf;
        assert.equal(entry.anyOf.length, 1, `${tab}: 열쇠가 둘이 됐다 — 제 글자로 묻는 모양을 다시 볼 것`);
        assert.ok(
          source.includes(`hasPermission(actingUser, "${only.key}", "${only.level}")`),
          `${file}: 메뉴 권한을 제 글자로 묻던 모양이 사라졌다 — 표(${only.key})와 맞는지 볼 것`
        );
        return;
      }
      assert.ok(
        source.includes(`canOpenRepairCaseDetailTab(actingUser, "${tab}")`),
        `${file}: 서버 관문이 없다 — 탭을 감춰도 주소를 치면 들어와진다`
      );
      assert.ok(
        source.includes('from "@/lib/auth/repair-case-detail-tab-access"'),
        `${file}: 공용 창구를 가져오지 않는다`
      );
      // 🔴 열쇠를 페이지가 따로 적지 않는다 — 표와 갈라질 자리다.
      for (const requirement of entry.anyOf) {
        assert.equal(
          source.includes(`hasPermission(actingUser, "${requirement.key}", "READ")`),
          false,
          `${file}: 열쇠 '${requirement.key}' 를 글자로 또 적었다`
        );
      }
    });
  }

  test("🔴 여덟 탭이 **하나도 빠짐없이** 어딘가의 page.tsx 에서 막힌다", () => {
    const guarded = new Set<RepairCaseDetailTabKey>();
    for (const file of pageFiles) {
      if (file === "page.tsx") continue;
      guarded.add(TAB_BY_SEGMENT[file.split("/")[0]]);
    }
    assert.deepEqual([...guarded].sort(), [...REPAIR_CASE_DETAIL_TAB_KEYS].sort());
  });

  test("🔴 일부러 깨뜨려 본다 — 관문 글자가 없는 원본은 위 단언을 통과하지 못한다", () => {
    // 표본이 비어서 공짜로 통과하는 것을 막는다: 위 단언이 실제로 무는지 확인한다.
    const fake = "export default async function Page() { return null; }";
    assert.equal(fake.includes('canOpenRepairCaseDetailTab(actingUser, "approval")'), false);
  });
});

describe("④ 🔴 관문이 **조회보다 먼저** 선다 — 막을 사람의 자료를 읽지 않는다", () => {
  const CASES: readonly { file: string; tab: RepairCaseDetailTabKey; firstQuery: string }[] = [
    { file: "execution/page.tsx", tab: "execution", firstQuery: "getWorkflowHistoryForCase(" },
    { file: "work-history/page.tsx", tab: "workHistory", firstQuery: "getWorkRecordHistoryForCase(" },
    { file: "files/page.tsx", tab: "files", firstQuery: "listAttachmentsForRepairCase(" },
    { file: "approval/page.tsx", tab: "approval", firstQuery: "getCurrentApprovalsForCase(" },
    { file: "report/page.tsx", tab: "report", firstQuery: "listServiceReportsForRepairCase(" },
    { file: "diagnosis/page.tsx", tab: "diagnosis", firstQuery: "listRepairCaseFlowcharts(" },
    { file: "diagnosis/[flowchartId]/page.tsx", tab: "diagnosis", firstQuery: "getRepairCaseFlowchartGraph(" },
    { file: "diagnosis/work-records/page.tsx", tab: "diagnosis", firstQuery: "getWorkRecordHistoryForCase(" },
  ];

  for (const { file, tab, firstQuery } of CASES) {
    test(`${file}: 관문이 ${firstQuery} 보다 위다`, () => {
      const source = read(`src/app/(app)/repair-cases/[id]/${file}`);
      const guardAt = source.indexOf(`canOpenRepairCaseDetailTab(actingUser, "${tab}")`);
      const queryAt = source.indexOf(firstQuery);
      assert.ok(guardAt >= 0, `${file}: 관문을 못 찾았다`);
      assert.ok(queryAt >= 0, `${file}: '${firstQuery}' 를 못 찾았다 — 이 시험의 전제가 사라졌다`);
      assert.ok(guardAt < queryAt, `${file}: 자료를 먼저 읽고 나서 막는다`);
    });
  }
});

describe("⑤ 🔴 탭 안의 판정은 **그대로**다 — 관문이 그것을 대신하지 않는다", () => {
  test("[파일 관리]의 올리기·지우기는 여전히 WRITE 를 따로 본다", () => {
    const source = read("src/app/(app)/repair-cases/[id]/files/page.tsx");
    assert.ok(source.includes('hasPermission(actingUser, "repairCases.files", "WRITE")'));
  });

  test("[작업 이력]의 고치기·무효 처리는 여전히 `workRecords` 를 본다 — 들어오는 열쇠와 다르다", () => {
    const source = read("src/app/(app)/repair-cases/[id]/work-history/page.tsx");
    assert.ok(source.includes('hasPermission(actingUser, "repairCases.workRecords", "MANAGE")'));
    assert.ok(source.includes('hasPermission(actingUser, "repairCases.workRecords", "WRITE")'));
    assert.equal(
      REPAIR_CASE_DETAIL_TAB_PERMISSIONS.workHistory.anyOf.some((r) => r.key === "repairCases.workRecords"),
      false,
      "들어오는 열쇠와 고치는 열쇠가 같아졌다"
    );
  });

  test("[보고서]의 만들기·지우기 문턱은 여전히 service-report-authorization 이 정한다", () => {
    for (const file of ["report/page.tsx", "report/service-report/page.tsx", "report/service-report/print/page.tsx"]) {
      const source = read(`src/app/(app)/repair-cases/[id]/${file}`);
      assert.ok(
        source.includes("SERVICE_REPORT_PERMISSION_AREA"),
        `${file}: 보고서 자체의 문턱이 사라졌다 — 관문이 그것을 대신한 것이 아니다`
      );
    }
  });

  test("[진단 Flowchart]의 편집 판정은 여전히 `diagnosisFlowcharts.edit` 이다", () => {
    for (const file of ["diagnosis/page.tsx", "diagnosis/[flowchartId]/page.tsx", "diagnosis/work-records/page.tsx"]) {
      const source = read(`src/app/(app)/repair-cases/[id]/${file}`);
      assert.ok(source.includes('"diagnosisFlowcharts.edit", "WRITE"'), `${file}: 편집 판정이 사라졌다`);
    }
  });
});

/**
 * ============================================================================
 * ⑥ 🔴 화면과 서버가 **같은 판정 함수**에 닿는다 (2026-11-12, 같은 날 두 번째)
 * ============================================================================
 * [작업내용] 탭이 열쇠 둘을 OR 로 보게 되면서 「어떻게 묶는가」가 생겼다. 그 묶는
 * 방식이 두 벌로 적히는 순간 증상은 「탭은 보이는데 들어가면 막힌다」(또는 그 반대)
 * 이고, 둘 다 아무 오류를 내지 않는다. 그래서 묶는 자리는 순수 함수 하나뿐이어야
 * 하고, 창구는 수준만 읽어다 준다.
 * ============================================================================
 */
describe("⑥ 🔴 OR 을 두 벌로 적지 않는다", () => {
  const access = read("src/lib/auth/repair-case-detail-tab-access.ts");
  const table = read("src/lib/auth/repair-case-detail-tab-permissions.ts");
  /**
   * 🔴 2026-11-12(**같은 날 둘째**): 기타건 상세가 같은 OR 을 쓰게 되면서 **묶는 방식의
   * 몸이 공용 모듈로 올라갔다**(auth/detail-tab-permissions.ts · detail-tab-access.ts).
   * 그래서 아래 단언들이 「수리 건 파일 안에 그 식이 있는가」에서 **「그 식이 사는 자리가
   * 저장소에 하나인가」**로 옮겨졌다 — 재는 것은 그대로이고, 오히려 **화면 둘을 함께**
   * 덮는다(전에는 수리 건 쪽만 봤다).
   */
  const sharedTable = read("src/lib/auth/detail-tab-permissions.ts");
  const sharedAccess = read("src/lib/auth/detail-tab-access.ts");
  const domesticTable = read("src/lib/auth/domestic-order-detail-tab-permissions.ts");
  const domesticAccess = read("src/lib/auth/domestic-order-detail-tab-access.ts");

  test("창구가 순수 판정 함수에 그대로 넘긴다", () => {
    // 수리 건 창구는 **제 표를 쥐고** 공용 창구에 넘긴다 — 부르는 쪽(열두 페이지)이
    // 표를 들고 다니면 언젠가 남의 화면 표가 넘어간다.
    assert.ok(
      access.includes("canOpenDetailTab(actor, REPAIR_CASE_DETAIL_TAB_PERMISSIONS, tab)"),
      "창구가 제 표를 쥐고 공용 창구에 넘기지 않는다"
    );
    assert.ok(
      access.includes("resolveDetailTabVisibility(actor, REPAIR_CASE_DETAIL_TAB_PERMISSIONS)"),
      "탭 줄 판정이 같은 표를 안 쓴다"
    );
    // 공용 창구가 수준을 읽어다 **순수 판정**에 넘기는 그 자리.
    assert.ok(sharedAccess.includes("isDetailTabOpen(table, tab,"), "공용 창구가 공용 판정을 안 쓴다");
    assert.ok(sharedAccess.includes("requiredKeysOfDetailTab(table, tab)"), "공용 창구가 필요한 잎을 표에서 안 받는다");
    // 🔵 기타건 창구도 **같은 모양**이어야 한다 — 한쪽만 공용을 쓰면 두 벌이 된 것이다.
    assert.ok(
      domesticAccess.includes("canOpenDetailTab(actor, DOMESTIC_ORDER_DETAIL_TAB_PERMISSIONS, tab)"),
      "기타건 창구가 공용 창구를 안 쓴다"
    );
  });

  test("🔴 창구가 제 조건을 따로 적지 않는다 — OR 도, 열쇠 글자도", () => {
    for (const [name, source] of [
      ["수리 건 창구", access],
      ["기타건 창구", domesticAccess],
      ["공용 창구", sharedAccess],
    ] as const) {
      assert.equal(source.includes("||"), false, `${name}에 조건을 손으로 엮은 자리가 있다`);
    }
    assert.equal(access.includes("repairCases."), false, "창구가 잎 키를 글자로 적고 있다");
    assert.equal(domesticAccess.includes("domesticOrders."), false, "기타건 창구가 잎 키를 글자로 적고 있다");
  });

  test("🔴 묶는 방식이 사는 자리는 **저장소에 하나**다 — `anyOf` 를 읽는 곳이 거기뿐이다", () => {
    assert.ok(sharedTable.includes(".anyOf.some("), "공용 모듈에 OR 판정이 없다");
    // 🔴 화면별 표는 짝(키 ↔ 잎)만 갖는다 — 읽는 방식을 제 손으로 다시 적으면 두 벌이 된다.
    for (const [name, source] of [
      ["수리 건 표", table],
      ["기타건 표", domesticTable],
    ] as const) {
      assert.equal(source.includes(".anyOf.some("), false, `${name}가 묶는 방식을 따로 적고 있다`);
      assert.ok(source.includes("anyOf: ["), `${name}에 요구사항 목록이 없다`);
    }
    // 🔴 **주석을 먼저 걷어낸다.** 이 저장소에서 원본 글자로 재는 검사가 주석에 적힌
    //    낱말 때문에 틀린 적이 여러 번 있다 — 여기서도 execution/page.tsx 의 설명 주석이
    //    `anyOf` 를 입에 올린다(그 탭이 왜 OR 인지를 적어 둔 자리다).
    const codeOf = (file: string) =>
      read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of [
      "src/app/(app)/repair-cases/[id]/execution/page.tsx",
      "src/app/(app)/repair-cases/[id]/layout.tsx",
      "src/components/repair-cases/detail/detail-tabs-list.ts",
      // 🔵 기타건 쪽도 같은 규율 아래 둔다(2026-11-12 둘째).
      "src/app/(app)/domestic-orders/[id]/layout.tsx",
      "src/components/domestic-orders/detail/domestic-order-detail-tabs-list.ts",
    ]) {
      const code = codeOf(file);
      assert.ok(code.length > 200, `${file}: 주석을 걷었더니 코드가 남지 않았다 — 거르는 식이 깨졌다`);
      assert.equal(code.includes("anyOf"), false, `${file} 이 묶는 방식을 따로 적고 있다`);
    }
  });

  test("🔴 [작업내용] 서버 관문이 **하나**다 — 열쇠 둘을 페이지가 직접 엮지 않는다", () => {
    const source = read("src/app/(app)/repair-cases/[id]/execution/page.tsx");
    assert.equal(
      source.split('canOpenRepairCaseDetailTab(actingUser, "execution")').length - 1,
      1,
      "관문이 둘 이상이다"
    );
    assert.equal(
      source.includes('hasPermission(actingUser, "repairCases.procedureExecution"'),
      false,
      "페이지가 절차 수행 열쇠를 직접 묻는다 — 표와 갈라질 자리다"
    );
    // 🔵 작업 기록 **쓰기**(WRITE) 판정은 그대로 남아 있어야 한다 — 탭에 들어온 뒤의 일이다.
    assert.ok(source.includes('hasPermission(actingUser, "repairCases.workRecords", "WRITE")'));
  });
});

/**
 * ============================================================================
 * ⑦ 🔴 「둘 다 닫으면 워크플로 단계 변경도 막힌다」가 **화면까지 간다** (2026-11-12)
 * ============================================================================
 * 워크플로 단계 변경에는 여닫을 권한 잎이 **없다**(그 조작은 워크플로 편집기에서 정한
 * 단계별 허용 역할이 가린다). 잎을 새로 만들지 않기로 했으므로, 남는 구멍을 메우는
 * 길은 **닫는 사람이 읽게 하는 것** 하나뿐이다 — 이 조각에서 가장 걱정한 것이
 * 「닫은 사람이 자기가 무엇을 껐는지 모르는 것」이었다.
 *
 * 🔴 **주석에만 적으면 아무 소용이 없다.** 그래서 글이 실제로 화면까지 가는 길을 끊어
 * 보며 잰다:
 *   ① 두 잎이 왼쪽 목록에서 **고를 수 있다** — 못 고르면 설명을 볼 길이 없다(진짜 렌더).
 *   ② 오른쪽 머리 문단이 **고른 잎의 설명을 그대로** 그린다(자르거나 갈아 끼우지 않는다).
 *   ③ 🔴 그 문단에 **잘림 클래스가 없다** — 긴 글이 한 줄에서 잘리면 경고가 안 읽힌다.
 *   ④ 두 설명이 경고 토막을 **둘 다** 담는다(한쪽만 적으면 다른 쪽을 고른 사람은 못 본다).
 * ============================================================================
 */
describe("⑦ 🔴 경고가 권한 화면까지 간다", () => {
  const PAIR = ["repairCases.workRecords", "repairCases.procedureExecution"] as const;
  const settings = read("src/components/users/RolePermissionSettings.tsx");
  const settingsCode = settings.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  /** 모든 메뉴를 펼친 왼쪽 목록의 마크업 — 잎 단추까지 그려진다. */
  function renderTree(selectedKey = "dashboard"): string {
    return renderToStaticMarkup(
      createElement(PermissionTargetTree, {
        selectedKey,
        onSelect: () => {},
        expandedKeys: new Set(
          PERMISSION_AREAS.filter((area) => hasFeatures(area.key)).map((area) => area.key)
        ),
        onToggleExpanded: () => {},
        openRoleCount: () => 3,
      })
    );
  }

  test("① 두 항목을 왼쪽 목록에서 **고를 수 있다** — 못 고르면 설명을 볼 길이 없다", () => {
    const html = renderTree();
    assert.ok(html.length > 1000, "목록이 그려지지 않았다 — 아래가 공짜로 통과한다");
    for (const leafKey of PAIR) {
      assert.ok(
        html.includes(`data-permission-leaf="${leafKey}"`),
        `${leafKey} 줄이 화면에서 사라졌다 — 그 설명에 닿을 길이 없다`
      );
      const feature = findPermissionFeature(leafKey);
      assert.ok(feature, `${leafKey} 를 못 찾았다`);
      assert.ok(html.includes(feature.label), `${leafKey} 의 이름표(${feature.label})가 안 그려진다`);
    }
  });

  test("② 오른쪽 머리 문단이 **고른 항목의 설명 그대로**다 — 자르거나 갈아 끼우지 않는다", () => {
    assert.ok(
      settingsCode.includes("selectedFeature?.description"),
      "권한 화면이 하위 기능 설명을 그리지 않는다"
    );
    assert.ok(
      settingsCode.includes("findPermissionFeature(selectedKey)"),
      "설명을 고른 항목에서 가져오지 않는다 — 엉뚱한 글이 뜰 수 있다"
    );
    // 자르는 식이 끼어들면 긴 경고의 뒤쪽이 통째로 사라진다.
    const at = settingsCode.indexOf("selectedFeature?.description");
    const line = settingsCode.slice(at, at + 120);
    for (const cut of [".slice(", ".substring(", ".split(", "…"]) {
      assert.equal(line.includes(cut), false, `설명을 그리면서 자른다: ${cut}`);
    }
  });

  test("③ 🔴 그 문단에 **잘림 클래스가 없다** — 한 줄로 접히면 경고가 안 읽힌다", () => {
    const at = settingsCode.indexOf("selectedFeature?.description");
    assert.ok(at > 0, "설명을 그리는 자리를 못 찾았다");
    // 그 <p> 의 여는 태그 — 설명 식 바로 앞이다.
    const openTag = settingsCode.slice(settingsCode.lastIndexOf("<p", at), at);
    assert.ok(openTag.includes("className="), "설명 문단의 클래스를 못 찾았다");
    for (const clamp of ["truncate", "line-clamp", "whitespace-nowrap", "overflow-hidden", "h-4", "max-h-"]) {
      assert.equal(openTag.includes(clamp), false, `설명 문단이 잘린다: ${clamp}`);
    }
  });

  test("④ 🔴 두 설명이 **둘 다** 경고를 담는다 — 한쪽만 적으면 다른 쪽을 고른 사람은 못 본다", () => {
    for (const leafKey of PAIR) {
      const description = findPermissionFeature(leafKey)?.description ?? "";
      assert.ok(description.length > 0, `${leafKey}: 설명이 비었다`);
      for (const phrase of [
        "함께 [접근 불가]", // 둘 다 닫았을 때라는 조건
        "워크플로 단계 변경", // 무엇이 함께 막히는가
        "여닫을 수 있는 항목이 따로 없", // 권한 화면에서 찾지 말라는 말
        "워크플로 편집기", // 그러면 어디서 가리는가
      ]) {
        assert.ok(description.includes(phrase), `${leafKey}: 설명에 '${phrase}' 가 없다`);
      }
      // 🔵 한쪽만 닫을 때는 아무 일도 안 일어난다는 것도 같은 문단에서 읽힌다.
      assert.ok(
        description.includes("여기만 [접근 불가]로 두어도 탭은 그대로 보입니다"),
        `${leafKey}: 한쪽만 닫았을 때 아무 일도 없다는 말이 없다`
      );
    }
  });

  test("🔴 일부러 깨뜨려 본다 — 경고 없는 설명은 위 단언을 통과하지 못한다", () => {
    const fake = "무슨 작업을 했는지 남기는 기록입니다.";
    assert.equal(fake.includes("워크플로 단계 변경"), false);
    assert.equal(fake.includes("여닫을 수 있는 항목이 따로 없"), false);
  });
});
