import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { headerFactText, isPrintOnlyPathname } from "./detail-header-display";

/**
 * ============================================================================
 * 머리 카드가 탭 위에 있다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「수리건 상세에서 이 창을 **탭 위로 올려서 어떤 탭을 눌러도 같은 정보를
 * 볼 수 있게** 해 달라」. 그래서 머리 카드(DetailHeader)를 그리는 자리가
 * 「기본 정보」 탭(RepairCaseDetailView)에서 **[id]/layout.tsx** 로 옮겨 왔다.
 *
 * 🔴 이 시험은 **글자로 읽는다**. 레이아웃은 서버 컴포넌트이고 세션 · DB · server-only
 * 사슬을 물고 있어 이 환경에서 그려 볼 수 없다(이웃 contact-folder-open-screens.test.ts 가
 * 자리를 읽는 것과 같은 방법). 그려지는 조각 자체는 그 이웃이 본다.
 *
 * 못 박는 것 넷:
 *  ① 레이아웃이 카드를 그린다 — **탭 줄보다 위**에서
 *  ② 「기본 정보」 탭은 더 이상 안 그린다(두 번 보이지 않는다)
 *  ③ 🔴 카드가 **"use client" 경계**다 — 훅을 쓰는데 서버 컴포넌트에서 쓰이므로,
 *    이 한 줄이 빠지면 시험도 타입 검사도 아니라 `npm run build` 에서만 터진다
 *  ④ 카드 안의 [수정] 두 개가 그대로 있다
 * ============================================================================
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
const flat = (source: string) => source.replace(/\s+/g, " ");
const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

/**
 * `[id]` 아래에서 page.tsx 를 가진 폴더를 모아 주소로 바꾼다. 대괄호 조각은 글자
 * 그대로 남는다 — 여기서 보는 것은 **마지막 조각의 이름**뿐이라 그래도 된다.
 */
function collectRoutePathnames(dir: string, prefix: string): string[] {
  const found: string[] = [];
  if (existsSync(path.join(dir, "page.tsx"))) found.push(prefix);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // 라우트 그룹 `(…)` 은 주소에 나타나지 않는다.
    const segment = entry.name.startsWith("(") && entry.name.endsWith(")") ? "" : `/${entry.name}`;
    found.push(...collectRoutePathnames(path.join(dir, entry.name), `${prefix}${segment}`));
  }
  return found;
}

const layoutSource = read("src/app/(app)/repair-cases/[id]/layout.tsx");
const layout = flat(layoutSource);
const detailViewSource = read("src/components/repair-cases/detail/RepairCaseDetailView.tsx");
const headerSource = read("src/components/repair-cases/detail/DetailHeader.tsx");
const header = flat(headerSource);
const badgesSource = read("src/components/repair-cases/badges.tsx");
/**
 * 🔴 카드가 **실제로 그리는 부분**만 — 설명 주석을 걷어낸 것이다. 이 파일의
 * 머리말에는 「가운뎃점」·「·」 같은 글자가 설명으로 수없이 나오므로, 「가운뎃점을
 * 안 그린다」를 원본 전체에서 찾으면 영영 통과하지 못한다.
 */
const headerRender = flat(
  headerSource.slice(headerSource.indexOf("return (")).replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
);
const filesScreenSource = read("src/components/repair-cases/files/FilesScreen.tsx");
const approvalScreenSource = read("src/components/repair-cases/approval/DatabaseApprovalScreen.tsx");

describe("① 레이아웃이 머리 카드를 그린다 — 탭 줄보다 위에서", () => {
  test("카드를 가져와 그린다", () => {
    assert.ok(
      layoutSource.includes('import DetailHeader from "@/components/repair-cases/detail/DetailHeader";'),
      "레이아웃이 머리 카드를 가져오지 않는다"
    );
    assert.equal(layout.split("<DetailHeader").length - 1, 1, "레이아웃이 카드를 둘 이상 그린다");
  });

  test("🔴 <DetailTabs/> 보다 위다 — 어느 탭을 눌러도 카드가 먼저 온다", () => {
    const card = indexOrFail(layout, "<DetailHeader");
    const tabs = indexOrFail(layout, "<DetailTabs");
    assert.ok(card < tabs, "카드가 탭 줄보다 아래에 있다");
  });

  test("🔴 조건부가 아니다 — 「견적서」 탭처럼 사라지지 않는다", () => {
    // canViewQuotes 는 탭 하나를 그릴지 정하는 값이다. 카드가 그 값에 묶이면
    // 견적서를 못 보는 사람에게 카드까지 사라진다.
    const card = indexOrFail(layout, "<DetailHeader");
    const cardBlock = layout.slice(card, indexOrFail(layout, "<DetailTabs"));
    assert.equal(cardBlock.includes("canViewQuotes"), false, "카드가 견적서 권한에 묶여 있다");
    assert.equal(cardBlock.includes("&&"), false, "카드가 조건부로 그려진다");
  });
});

describe("② 「기본 정보」 탭은 더는 안 그린다 — 두 번 보이지 않는다", () => {
  test("RepairCaseDetailView 에 카드가 한 글자도 없다", () => {
    assert.equal(
      /<DetailHeader[\s/>]/.test(detailViewSource),
      false,
      "「기본 정보」 탭이 머리 카드를 또 그린다 — 카드가 둘로 보인다"
    );
    assert.equal(
      detailViewSource.includes('from "@/components/repair-cases/detail/DetailHeader"'),
      false,
      "쓰지 않는 가져오기가 남아 있다"
    );
  });
});

describe("③ 🔴 서버 · 브라우저 경계", () => {
  test('카드가 "use client" 로 시작한다 — 레이아웃(서버)에서 쓰이는데 훅을 쓴다', () => {
    assert.ok(headerSource.startsWith('"use client";'), "머리 카드에 use client 가 없다");
    assert.ok(header.includes("useUiText()"), "문구 훅을 쓰지 않는다");
  });

  test("🔴 워크플로 재정의는 어댑터 하나로만 입힌다 — 화면이 직접 섞지 않는다", () => {
    // 레이아웃은 서버라 localStorage 를 읽는 훅을 부를 수 없다. 그래서 원본
    // ResolvedRepairCase 를 넘기고, 카드가 제 안에서 같은 어댑터를 부른다.
    assert.ok(header.includes("useEffectiveRepairCase(resolved)"), "유효 상태 어댑터를 안 쓴다");
    assert.equal(header.includes("applyWorkflowOverride("), false, "화면이 재정의를 직접 병합한다");
    assert.ok(layout.includes("resolved={resolved}"), "레이아웃이 원본 건을 안 넘긴다");
  });

  test("🔴 건을 다시 조회하지 않는다 — 레이아웃의 resolveRepairCaseForServer 는 한 번뿐", () => {
    assert.equal(
      layoutSource.match(/resolveRepairCaseForServer\(/g)?.length,
      1,
      "레이아웃이 같은 건을 두 번 조회한다"
    );
  });
});

describe("④ 카드 안의 기능이 그대로다", () => {
  test("[수정] 두 자리가 카드에 그대로 있다", () => {
    assert.ok(header.includes("<EngineerEditCell"), "담당 엔지니어 수정 자리가 없다");
    assert.ok(header.includes("<ReportNumberEditCell"), "보고서번호 수정 자리가 없다");
    assert.ok(header.includes("canEdit={canEditEngineer}"), "담당 엔지니어 권한이 안 넘어간다");
    assert.ok(header.includes("canEdit={canEditReportNumber}"), "보고서번호 권한이 안 넘어간다");
  });

  test("🔴 권한 판정을 새로 만들지 않았다 — 옛 자리와 같은 함수 · 같은 열쇠", () => {
    assert.ok(
      layoutSource.includes('import { isFieldEditable } from "@/lib/auth/repair-case-edit-authorization";'),
      "레이아웃이 다른 판정 함수를 쓴다"
    );
    assert.ok(layout.includes('isFieldEditable(actingUser.role, "assignedEngineerId")'));
    assert.ok(layout.includes('isFieldEditable(actingUser.role, "legacyReportNumber")'));
    // DATABASE 소스 건에만 열린다 — 옛 RepairCaseDetailView 의 canEditAtAll 그대로.
    assert.ok(layout.includes('resolved.source === "DATABASE" && actingUser !== null'));
  });

  test("담당 엔지니어 후보 목록은 「기본 정보」 탭과 같은 조건에서 구한다", () => {
    assert.ok(layout.includes("await getIntakeReferenceData()"), "후보 목록을 안 구한다");
    assert.ok(
      layout.includes('resolved.source === "DATABASE" && getRepairCaseWriteSource() === "database"'),
      "조건이 「기본 정보」 탭과 다르다"
    );
  });

  test("🔴 요청당 한 번만 질의한다 — 레이아웃과 「기본 정보」 탭이 같은 함수를 부른다", () => {
    const referencesSource = read("src/lib/db/queries/repair-case-references.ts");
    assert.ok(
      referencesSource.includes('import { cache } from "react";'),
      "후보 목록 조회가 요청 캐시를 안 쓴다 — 레이아웃과 탭이 각각 질의한다"
    );
    assert.ok(
      /export const getIntakeReferenceData = cache\(/.test(referencesSource),
      "후보 목록 조회가 cache() 로 감싸여 있지 않다"
    );
  });
});

/**
 * ============================================================================
 * 🔴 ⑤ 세로를 한 줄로 줄였다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「상태 딱지들은 [폴더 열기] 버튼 옆에, [워크플로 유형]·[담당
 * 엔지니어]는 한 줄로 바꾸고 [보고서 번호] 왼쪽에 나란히. 그 옆에 모델·L/N·S/N 도.
 * 이 작업의 요점은 **머릿말 창의 세로 크기를 최대한 한 줄로 줄이는** 것」.
 *
 * 예전 모양은 세 줄이었다 — 제목 줄 · 배지 줄 · 두 칸짜리 정의 목록(dl/dt/dd).
 * 아래 시험들이 그 세 줄이 되살아나는 것을 막는다.
 * ============================================================================
 */
describe("🔴 ① 상태 배지는 [폴더 열기]와 **같은 줄**이다", () => {
  test("배지 여섯이 전부 단추 뒤, 같은 묶음 안에 있다", () => {
    const folder = indexOrFail(header, "<ContactFolderOpenButton");
    for (const badge of [
      "<StatusBadge",
      "<PriorityBadge",
      "<OverdueBadge",
      "<HoldBadge",
      "<WorkflowOverrideBadge",
      "<SourceBadge",
    ]) {
      const at = indexOrFail(header, badge);
      assert.ok(at > folder, `${badge} 가 [폴더 열기]보다 앞에 있다`);
      assert.equal(
        header.slice(folder, at).includes("</div>"),
        false,
        `${badge} 와 [폴더 열기] 사이에서 묶음이 닫힌다 — 배지가 다른 줄로 떨어졌다`
      );
    }
  });

  test("🔴 배지만 따로 서던 줄이 사라졌다", () => {
    // 옛 모양: 제목 줄이 닫힌 뒤 배지들만 든 묶음이 한 줄을 통째로 먹었다.
    const folder = indexOrFail(header, "<ContactFolderOpenButton");
    const badgeRow = headerSource.indexOf('<div className="flex flex-wrap items-center gap-2">');
    assert.equal(badgeRow, -1, "배지 전용 줄이 되살아났다");
    assert.ok(folder > 0);
  });
});

describe("🔴 ② 값 묶음은 한 줄이고 보고서번호 **왼쪽**이다", () => {
  const reportNumber = indexOrFail(header, "<ReportNumberEditCell");

  test("유형 · 담당 엔지니어 · 모델 · L/N · S/N 이 보고서번호보다 앞이다", () => {
    for (const [name, marker] of [
      ["유형", "uiText.workflowType[effective.workflowType]"],
      ["담당 엔지니어", "<EngineerEditCell"],
      ["모델", "effective.modelName"],
      ["L/N", "effective.lotNumber"],
      ["S/N", "effective.serialNumber"],
    ] as const) {
      const at = indexOrFail(header, marker);
      assert.ok(at < reportNumber, `${name} 이 보고서번호보다 뒤에 있다`);
    }
  });

  test("🔴 두 줄짜리 정의 목록이 사라졌다 — 이름표가 줄을 먹지 않는다", () => {
    for (const tag of ["<dl", "<dt", "<dd"]) {
      assert.equal(headerSource.includes(tag), false, `${tag} 가 남아 있다 — 세로가 다시 늘어난다`);
    }
  });

  test("값들이 **한 묶음**에서 줄바꿈만 허용하며 늘어선다", () => {
    const badges = indexOrFail(header, "<SourceBadge");
    const block = header.slice(badges, reportNumber);
    assert.ok(block.includes("facts.map("), "값들을 한 자리에서 늘어놓지 않는다");
    assert.match(block, /className="flex flex-wrap items-baseline/, "값 묶음이 한 줄 묶음이 아니다");
  });
});

/**
 * ============================================================================
 * 🔴 ⑤-2 이름표를 **보이게** 되살렸다 — 알약 안에 (2026-10-06, 같은 날 두 번째)
 * ============================================================================
 * 앞 조각이 세로를 줄이려고 이름표를 전부 없앴더니 사용자가 보고 말했다 —
 * 「워크플로 유형, 고객사, 모델명, L/N, S/N 가 구분감 있는 디자인이였으면
 * 좋겠어. **지금은 뭐가 뭔지 모르겠어**」.
 *
 * 고른 모양: **연한 배경 알약 + 알약 안의 짧은 이름표**. 가운뎃점 구분자는 뺀다
 * (알약이 가르는데 점까지 있으면 지저분하다). 담당 엔지니어는 알약을 안 입고
 * 보고서번호 왼쪽, 오른쪽 묶음으로 옮긴다.
 * ============================================================================
 */
describe("🔴 ⑤-2 다섯 조각이 **보이는 이름표**를 가진다", () => {
  test("유형은 늘 서는 조각이고 이름표가 「유형」이다", () => {
    assert.ok(
      header.includes('key: "workflowType", label: "유형"'),
      "유형 조각의 이름표가 「유형」이 아니다"
    );
  });

  test("빠질 수 있는 네 조각도 각자 이름표를 들고 있다", () => {
    for (const [key, label, field] of [
      ["customerName", "고객사", "effective.customerName"],
      ["modelName", "모델", "effective.modelName"],
      ["lotNumber", "L/N", "effective.lotNumber"],
      ["serialNumber", "S/N", "effective.serialNumber"],
    ] as const) {
      assert.ok(
        header.includes(`["${key}", "${label}", ${field}]`),
        `이름표가 값과 함께 서 있지 않다: ${label}`
      );
    }
  });

  test("🔴 이름표가 **화면에 그려진다** — title 로 숨지 않는다", () => {
    assert.ok(headerRender.includes("{fact.label}"), "이름표를 화면에 그리지 않는다");
    assert.ok(headerRender.includes("{fact.value}"), "값을 화면에 그리지 않는다");
    assert.equal(
      headerSource.includes("title={fact.label}"),
      false,
      "이름표가 보이는데 title 까지 들고 있다 — 같은 말이 두 벌이면 한쪽만 고쳐진다"
    );
    // 이름표가 값보다 앞이다 — 「유상 Matcher 유형」이 되면 안 된다.
    assert.ok(
      headerRender.indexOf("{fact.label}") < headerRender.indexOf("{fact.value}"),
      "이름표가 값 뒤에 붙었다"
    );
  });

  test("🔴 이름표는 작고 연하게, 값은 보통 굵기로 또렷하게", () => {
    const labelLine = indexOrFail(headerRender, "{fact.label}");
    const valueLine = indexOrFail(headerRender, "{fact.value}");
    const labelSpan = headerRender.slice(headerRender.lastIndexOf("<span", labelLine), labelLine);
    const valueSpan = headerRender.slice(headerRender.lastIndexOf("<span", valueLine), valueLine);
    assert.match(labelSpan, /text-xs/, "이름표가 값과 같은 크기다 — 값이 안 도드라진다");
    // 🔴 바탕을 100 으로 올리면서 이름표도 600 으로 올렸다 — 500 은 그 바탕 위에서
    // 명암비 4.45:1 이라 12px 글자 기준(4.5:1) 아래로 내려간다.
    assert.match(labelSpan, /text-zinc-600/, "이름표가 진한 바탕 위에서 묻히는 회색이다");
    assert.match(labelSpan, /dark:text-zinc-400/, "어두운 화면 쪽 이름표 색이 없다");
    assert.match(valueSpan, /text-sm/, "값이 이름표만큼 작아졌다");
    assert.match(valueSpan, /text-zinc-900/, "값이 또렷한 검정이 아니다");
    assert.match(valueSpan, /dark:text-zinc/, "어두운 화면에서 값 색이 안 맞춰져 있다");
  });

  test("🔴 알약 배경이 밝은 화면 · 어두운 화면 **둘 다** 깔린다", () => {
    // 🔴 처음 지시는 「상태 배지보다 연하게」였지만, 사용자가 화면을 보면서
    // 「배경 색이 조금 더 찐했으면 좋겠어」라고 해 한 칸 올렸다(50 → 100,
    // 어두운 쪽은 반투명 800 → 800). 한쪽만 올리면 밤에 보는 사람은 그대로다.
    assert.match(headerRender, /rounded-full/, "알약 모양이 아니다");
    assert.match(headerRender, /bg-zinc-100\b/, "밝은 화면 쪽 알약 배경이 없다 — 또는 다시 연해졌다");
    assert.match(headerRender, /dark:bg-zinc-800\b/, "어두운 화면 쪽 알약 배경이 없다");
    assert.equal(
      headerRender.includes("dark:bg-zinc-800/"),
      false,
      "어두운 화면 쪽만 반투명으로 남았다 — 밝은 쪽만 진해진다"
    );
  });

  test("🔴 알약 안쪽 여백이 상태 배지보다 좁다 — 가로를 아낀다", () => {
    // 상태 배지는 좌우 2, 알약은 좌우 1.5. 다섯 알약이면 그만큼 가로가 돌아온다.
    // 배경 단계는 배지와 같아졌지만(위 시험), 여백은 여전히 좁게 둔다.
    assert.ok(badgesSource.includes("px-2"), "상태 배지의 여백이 바뀌었다 — 알약 쪽을 다시 볼 것");
    assert.match(headerRender, /rounded-full bg-zinc-100 px-1\.5/, "알약 여백이 배지보다 좁지 않다");
  });

  test("🔴 가운뎃점 구분자가 없다 — 알약이 그 일을 한다", () => {
    assert.equal(headerRender.includes("·"), false, "가운뎃점이 알약과 같이 남아 있다");
  });
});

describe("🔴 ⑤-3 담당 엔지니어는 보고서번호 **왼쪽**, 오른쪽 묶음에 선다", () => {
  const rightGroup = indexOrFail(header, "ml-auto");
  const engineer = indexOrFail(header, "<EngineerEditCell");
  const reportNumber = indexOrFail(header, "<ReportNumberEditCell");

  test("둘 다 오른쪽으로 밀린 같은 묶음 안이다", () => {
    assert.ok(engineer > rightGroup, "담당 엔지니어가 오른쪽 묶음 밖이다");
    assert.ok(reportNumber > rightGroup, "보고서번호가 오른쪽 묶음 밖이다");
    // 🔴 알약 묶음은 그보다 앞 — 담당 엔지니어가 알약들 사이에 남아 있으면 안 된다.
    assert.ok(indexOrFail(header, "facts.map(") < rightGroup, "값 알약 묶음이 오른쪽 묶음 뒤에 있다");
  });

  test("🔴 담당 엔지니어가 보고서번호보다 **왼쪽**이다", () => {
    assert.ok(engineer < reportNumber, "담당 엔지니어가 보고서번호 오른쪽으로 갔다");
  });

  test("🔴 접혀도 오른쪽에 붙는다 — 자동 왼쪽 여백", () => {
    // 양끝 정렬이면 이 묶음만 아랫줄로 접혔을 때 왼쪽으로 가 버린다.
    assert.match(headerRender, /className="ml-auto flex flex-wrap/, "오른쪽 묶음이 오른쪽으로 안 밀린다");
  });

  test("담당 엔지니어에도 이름표가 붙는다 — 이름만 있으면 누구인지 모른다", () => {
    const block = header.slice(rightGroup, reportNumber);
    assert.ok(block.includes("담당"), "담당 엔지니어 자리에 이름표가 없다");
    assert.ok(header.slice(reportNumber - 400, reportNumber).includes("보고서번호"), "보고서번호 이름표가 없다");
  });

  test("🔴 알약을 입지 않는다 — 보고서번호와 같은 결이다", () => {
    const block = headerRender.slice(indexOrFail(headerRender, "ml-auto"));
    assert.equal(block.includes("rounded-full"), false, "오른쪽 묶음에 알약이 끼었다");
  });
});

describe("🔴 ③ 빈 값은 조각째 빠진다 — 자리표시가 줄을 먹지 않는다", () => {
  test("없음을 뜻하는 값들은 전부 null 이다", () => {
    for (const empty of [null, undefined, "", "   ", "-", "–", "—"]) {
      assert.equal(headerFactText(empty), null, `값이 남았다: ${String(empty)}`);
    }
  });

  test("🔴 값 안의 하이픈은 건드리지 않는다 — 모델명에 흔하다", () => {
    assert.equal(headerFactText("CMK300M-JS2"), "CMK300M-JS2");
    assert.equal(headerFactText("  WI3894  "), "WI3894");
    assert.equal(headerFactText("2107021"), "2107021");
  });

  test("카드가 고객사 · 모델 · L/N · S/N 을 그 판정에 건다", () => {
    const optional = header.slice(indexOrFail(header, "const optionalFacts"), indexOrFail(header, "return ("));
    for (const field of ["effective.customerName", "effective.modelName", "effective.lotNumber", "effective.serialNumber"]) {
      assert.ok(optional.includes(field), `빠질 수 있는 값이 아니다: ${field}`);
    }
    assert.ok(header.includes("headerFactText(raw)"), "판정을 거치지 않고 그린다");
    assert.ok(header.includes("if (text !== null) facts.push("), "빈 값이 조각째 빠지지 않는다");
  });

  test("🔴 워크플로 유형과 담당 엔지니어는 늘 선다 — [수정]이 서야 하기 때문이다", () => {
    const optional = header.slice(indexOrFail(header, "const optionalFacts"), indexOrFail(header, "return ("));
    assert.equal(optional.includes("workflowType"), false, "워크플로 유형이 빠질 수 있게 됐다");
    assert.equal(optional.includes("EngineerEditCell"), false, "담당 엔지니어가 빠질 수 있게 됐다 — [수정]이 사라진다");
  });
});

/**
 * ============================================================================
 * 🔴 ⑥ 파일 관리 · 검수/승인은 제 머리말 상자를 더는 안 그린다 (2026-10-06)
 * ============================================================================
 * 사용자 지시: 「파일관리와 검수/승인 탭 밑에 있는 저 창이 머릿말과 중복되니까,
 * 없애줘」. 겹치지 않던 칸(고객사 · 모델)은 머리 카드 한 줄로 옮겨 갔다.
 *
 * 🔴 검수/승인의 **안내문은 중복이 아니다** — 상자만 걷어내고 그 문장은 두 승인
 * 카드 바로 위로 옮겼다.
 * ============================================================================
 */
describe("🔴 ⑥ 탭의 머리말 상자 둘이 사라졌다", () => {
  test("조각 파일 자체가 없다", () => {
    for (const gone of [
      "src/components/repair-cases/files/FilesHeaderSummary.tsx",
      "src/components/repair-cases/approval/DatabaseApprovalHeaderSummary.tsx",
    ]) {
      assert.equal(existsSync(path.join(ROOT, gone)), false, `아직 남아 있다: ${gone}`);
    }
  });

  test("두 화면이 그 조각을 가져오지도 그리지도 않는다", () => {
    assert.equal(filesScreenSource.includes("FilesHeaderSummary"), false, "파일 관리가 아직 머리말 상자를 그린다");
    assert.equal(
      approvalScreenSource.includes("DatabaseApprovalHeaderSummary"),
      false,
      "검수/승인이 아직 머리말 상자를 그린다"
    );
  });

  test("🔴 안내문은 남아 있다 — 두 승인 카드보다 위에", () => {
    const notice = indexOrFail(
      approvalScreenSource,
      "이 승인 기록은 데이터베이스에 저장되며, 서버에서 권한과 요청 상태를 재검증합니다."
    );
    const cards = indexOrFail(approvalScreenSource, '<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">');
    assert.ok(notice < cards, "안내문이 카드 아래로 밀렸다 — 누르기 전에 읽히지 않는다");
  });

  test("머리 카드가 그 상자들이 들고 있던 칸을 대신 보여 준다", () => {
    // 고객사 · 모델은 두 상자에만 있던 칸이다. 상자를 걷어내면서 카드로 옮겼다.
    assert.ok(header.includes("effective.customerName"), "고객사가 어디에도 없다");
    assert.ok(header.includes("effective.modelName"), "모델이 어디에도 없다");
  });
});

/**
 * ============================================================================
 * 🔴 ⑦ 인쇄 전용 주소에서는 카드가 아예 안 그려진다 (2026-10-06)
 * ============================================================================
 * 서비스 보고서 인쇄 미리보기는 이 레이아웃 안쪽이라 카드가 양식 위에 얹혔다.
 * **고객사로 나가는 문서**라 그대로 둘 수 없다.
 *
 * 🔴 카드에 통짜 인쇄 숨김 클래스를 걸면 안 된다 — 「기본 정보」 탭을 종이로 뽑으면
 * 이 카드가 그 종이의 **유일한 제목**(인수번호)이다.
 * ============================================================================
 */
describe("🔴 ⑦ 인쇄 전용 주소에서만 빠진다", () => {
  test("`/print` 로 끝나면 숨긴다", () => {
    assert.equal(isPrintOnlyPathname("/repair-cases/case-1/report/service-report/print"), true);
    assert.equal(isPrintOnlyPathname("/repair-cases/case-1/report/service-report/print/"), true, "끝의 빗금이 붙어도 같은 주소다");
  });

  test("🔴 다른 주소에서는 그대로 그린다", () => {
    for (const visible of [
      "/repair-cases/case-1",
      "/repair-cases/case-1/report",
      "/repair-cases/case-1/report/service-report",
      "/repair-cases/case-1/files",
      "/repair-cases/case-1/approval",
      "/repair-cases/case-1/work-history",
      "",
      "/",
    ]) {
      assert.equal(isPrintOnlyPathname(visible), false, `숨으면 안 되는 주소에서 숨는다: ${visible}`);
    }
  });

  test("🔴 이름만 비슷한 이웃에는 안 걸린다", () => {
    for (const neighbour of ["/repair-cases/case-1/sprint", "/repair-cases/case-1/print-settings", "/printed"]) {
      assert.equal(isPrintOnlyPathname(neighbour), false, neighbour);
    }
  });

  test("카드가 그 판정을 실제로 쓴다 — 통짜 인쇄 숨김이 아니다", () => {
    assert.ok(header.includes("usePathname()"), "주소를 읽지 않는다");
    assert.ok(header.includes("if (isPrintOnlyPathname(pathname)) return null;"), "판정을 쓰지 않는다");
    assert.equal(
      headerSource.includes("print:hidden"),
      false,
      "카드에 통짜 인쇄 숨김이 걸렸다 — 「기본 정보」 탭 인쇄물에서 인수번호가 사라진다"
    );
  });

  test("🔴 이 레이아웃 아래의 인쇄 전용 주소를 **전부** 센다", () => {
    // 새 인쇄 라우트가 생기면 이 수가 달라진다 — 그때 사람이 한 번 더 보게 한다.
    const routeRoot = path.join(ROOT, "src/app/(app)/repair-cases/[id]");
    const routes = collectRoutePathnames(routeRoot, "/repair-cases/case-1").sort();
    const printRoutes = routes.filter((route) => route.split("/").pop() === "print");
    assert.deepEqual(
      printRoutes,
      ["/repair-cases/case-1/report/service-report/print"],
      "이 레이아웃 아래의 인쇄 전용 주소가 달라졌다 — 카드가 거기서도 빠지는지 확인할 것"
    );
    for (const route of routes) {
      assert.equal(isPrintOnlyPathname(route), printRoutes.includes(route), route);
    }
    assert.ok(routes.length > 5, "라우트를 못 찾았다 — 이 시험의 전제가 사라졌다");
  });
});

