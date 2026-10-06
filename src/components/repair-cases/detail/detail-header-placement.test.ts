import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const layoutSource = read("src/app/(app)/repair-cases/[id]/layout.tsx");
const layout = flat(layoutSource);
const detailViewSource = read("src/components/repair-cases/detail/RepairCaseDetailView.tsx");
const headerSource = read("src/components/repair-cases/detail/DetailHeader.tsx");
const header = flat(headerSource);

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
