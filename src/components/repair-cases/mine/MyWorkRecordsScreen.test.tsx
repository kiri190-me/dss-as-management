import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import MyWorkRecordsScreen from "./MyWorkRecordsScreen";
import { MY_WORK_TAB_HREFS } from "./MineTabs";
import { resolveActiveTabHref } from "@/lib/domain/repair-case-detail-tabs";
import type { MyWorkRecordRow } from "@/lib/db/queries/my-work-records";

/**
 * 「내 작업기록」 화면. 값 쪽 판정(달 묶기·12개월 창·한국시간 경계)은
 * lib/domain/my-work-record-months.test.ts 가 보고, 여기서 못 박는 것은
 * **화면이 그 값을 어떻게 쓰는가**다 — 지워진 건에 링크를 안 거는가, 이번 달만
 * 펼치는가, 빈 달 줄을 안 그리는가, 메모의 줄바꿈이 살아 있는가.
 */

function row(overrides: Partial<MyWorkRecordRow> = {}): MyWorkRecordRow {
  return {
    id: "rec-1",
    createdAt: "2026-10-06T05:22:00.000Z", // 한국시간 10-06 14:22
    recordKind: "DIAGNOSIS_REPAIR_SUMMARY",
    memo: "전원부 커패시터 교체, 통전 정상",
    repairCaseId: "case-1",
    intakeNumber: "D261002",
    customerName: "INVENIA",
    modelName: "T2RCONT-AD2",
    status: "SHIPMENT_COMPLETED",
    isCaseDeleted: false,
    ...overrides,
  };
}

test("빈 상태: 12개월 내내 기록이 없으면 안내 문구만 그린다", () => {
  const html = renderToStaticMarkup(<MyWorkRecordsScreen rows={[]} currentYearMonth="2026-10" />);
  assert.ok(html.includes("최근 12개월 동안 적은 작업기록이 없습니다."));
  assert.ok(!html.includes("건</span>"), "묶음 줄이 하나도 없어야 한다");
});

test("한 줄에 날짜·구분·인수번호·고객사·모델명·상태가 함께 나온다", () => {
  const html = renderToStaticMarkup(<MyWorkRecordsScreen rows={[row()]} currentYearMonth="2026-10" />);
  assert.ok(html.includes("10-06 14:22"), "적은 시각은 한국시간으로 나온다");
  assert.ok(html.includes("진단/조치"), "기록 구분 라벨은 domain/types.ts 의 것을 쓴다");
  assert.ok(html.includes("D261002"));
  assert.ok(html.includes("INVENIA"));
  assert.ok(html.includes("T2RCONT-AD2"));
  assert.ok(html.includes("출하 완료"), "상태 배지(StatusBadge)를 그대로 재사용한다");
  assert.ok(html.includes("전원부 커패시터 교체, 통전 정상"));
});

test("인수번호는 기존 수리 건 상세로 가는 링크다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen rows={[row({ repairCaseId: "abc-123" })]} currentYearMonth="2026-10" />
  );
  assert.ok(html.includes('href="/repair-cases/abc-123"'));
});

test("⑥ 건이 영구 삭제된 기록도 나오되(메모·시각 그대로) 인수번호 링크가 없다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen
      rows={[
        row({
          repairCaseId: null,
          intakeNumber: null,
          customerName: null,
          modelName: null,
          status: null,
          memo: "지워진 건에 적었던 메모",
        }),
      ]}
      currentYearMonth="2026-10"
    />
  );
  assert.ok(html.includes("(삭제된 건)"), "건 정보 자리에 「(삭제된 건)」이라고 적는다");
  assert.ok(html.includes("지워진 건에 적었던 메모"), "메모는 그대로 보여 준다");
  assert.ok(html.includes("10-06 14:22"), "적은 시각도 그대로 보여 준다");
  assert.ok(!html.includes('href="/repair-cases/'), "가리킬 건이 없으므로 링크를 걸지 않는다");
});

test("⑥ 소프트 삭제된 건도 그 사실이 드러나고 링크를 걸지 않는다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen rows={[row({ isCaseDeleted: true })]} currentYearMonth="2026-10" />
  );
  assert.ok(html.includes("(삭제된 건)"));
  assert.ok(html.includes("D261002"), "인수번호는 남아 있으므로 글자로는 보인다");
  assert.ok(!html.includes('href="/repair-cases/'), "눌러도 없는 건으로 떨어지는 링크를 내밀지 않는다");
});

test("⑤ 기록이 없는 달은 줄 자체를 그리지 않는다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen
      rows={[
        row({ id: "oct", createdAt: "2026-10-06T05:22:00.000Z" }),
        row({ id: "aug", createdAt: "2026-08-11T01:00:00.000Z" }),
      ]}
      currentYearMonth="2026-10"
    />
  );
  assert.ok(html.includes("2026년 10월"));
  assert.ok(html.includes("2026년 8월"));
  assert.ok(!html.includes("2026년 9월"), "기록이 없는 9월은 줄이 아예 없어야 한다");
  assert.ok(!html.includes("0건"), "「0건」짜리 빈 줄을 만들지 않는다");
});

test("① 한국시간 10월 1일 00:30 에 적은 기록은 10월 묶음 아래에 그려진다", () => {
  // 그 시각의 UTC 값은 9월 30일이다 — UTC 로 묶었다면 「2026년 9월」이 그려진다.
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen
      rows={[row({ createdAt: "2026-09-30T15:30:00.000Z", memo: "첫날 아침 기록" })]}
      currentYearMonth="2026-10"
    />
  );
  assert.ok(html.includes("2026년 10월"), "한국시간 기준으로 10월에 묶여야 한다");
  assert.ok(!html.includes("2026년 9월"));
  assert.ok(html.includes("10-01 00:30"));
  assert.ok(html.includes("첫날 아침 기록"), "이번 달이므로 펼쳐진 채로 그려진다");
});

test("이번 달은 펼친 채, 나머지 달은 접힌 채로 열린다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen
      rows={[
        row({ id: "oct", createdAt: "2026-10-06T05:22:00.000Z", memo: "이번 달 메모" }),
        row({ id: "aug", createdAt: "2026-08-11T01:00:00.000Z", memo: "지난 달 메모" }),
      ]}
      currentYearMonth="2026-10"
    />
  );
  assert.ok(html.includes("이번 달 메모"), "이번 달 묶음은 펼쳐져 있다");
  assert.ok(!html.includes("지난 달 메모"), "나머지 달은 접혀 있어 본문이 그려지지 않는다");
  assert.ok(html.includes('aria-expanded="true"'), "펼친 묶음이 있다");
  assert.ok(html.includes('aria-expanded="false"'), "접힌 묶음이 있다");
  assert.ok(html.includes("2026년 8월"), "접혀 있어도 묶음 머리와 건수는 보인다");
  assert.ok(html.includes("1건"));
});

test("메모의 줄바꿈이 살아 있다", () => {
  const memo = "1. 외관 점검 이상 없음\n2. 전원부 측정\n3. 커패시터 교체";
  const html = renderToStaticMarkup(<MyWorkRecordsScreen rows={[row({ memo })]} currentYearMonth="2026-10" />);
  assert.ok(html.includes("whitespace-pre-wrap"), "줄바꿈을 살리는 자리여야 한다");
  assert.ok(html.includes(memo), "적은 글자가 줄바꿈까지 그대로 들어간다");
});

test("아주 긴 메모는 몇 줄에서 접히고 「더 보기」가 붙는다", () => {
  const longMemo = Array.from({ length: 20 }, (_, i) => `${i + 1}번째 줄`).join("\n");
  const html = renderToStaticMarkup(<MyWorkRecordsScreen rows={[row({ memo: longMemo })]} currentYearMonth="2026-10" />);
  assert.ok(html.includes("8번째 줄"), "접는 기준 줄까지는 보인다");
  assert.ok(!html.includes("9번째 줄"), "그 아래는 접힌다");
  assert.ok(html.includes("더 보기 (20줄)"), "몇 줄짜리인지 알려 준다");
});

test("짧은 메모에는 「더 보기」가 붙지 않는다", () => {
  const html = renderToStaticMarkup(
    <MyWorkRecordsScreen rows={[row({ memo: "한 줄짜리" })]} currentYearMonth="2026-10" />
  );
  assert.ok(!html.includes("더 보기"));
});

test("탭 둘은 서로 다른 주소를 가리키고, 하위 주소에서 두 탭이 함께 켜지지 않는다", () => {
  assert.equal(MY_WORK_TAB_HREFS.activeWork, "/repair-cases/mine");
  assert.equal(MY_WORK_TAB_HREFS.workRecords, "/repair-cases/mine/work-records");

  const hrefs = [MY_WORK_TAB_HREFS.activeWork, MY_WORK_TAB_HREFS.workRecords];
  // 🔴 「진행 중인 담당 건」의 주소가 「내 작업기록」 주소의 접두사다 — 단순
  // startsWith 로 판정하면 작업기록 화면에서 두 탭이 동시에 켜진다.
  assert.equal(resolveActiveTabHref("/repair-cases/mine", hrefs), MY_WORK_TAB_HREFS.activeWork);
  assert.equal(resolveActiveTabHref("/repair-cases/mine/work-records", hrefs), MY_WORK_TAB_HREFS.workRecords);
});
