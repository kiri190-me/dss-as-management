import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatKstDayTime,
  formatMyWorkRecordMonthLabel,
  groupMyWorkRecordsByKstMonth,
  MY_WORK_RECORD_MONTH_WINDOW,
  myWorkRecordWindowStart,
  toMyWorkRecordMonthKey,
} from "./my-work-record-months";

/**
 * 「내 작업기록」의 달 묶기. 이 파일이 지키는 것은 **한국시간 경계** 하나로
 * 요약된다 — created_at 은 timestamptz 이고 서버는 UTC 로 돌 수 있어서,
 * UTC 로 달을 가르면 매달 첫날 아침(한국시간 00:00~09:00)에 적은 기록이 통째로
 * 전 달에 들어간다.
 */

// 한국시간 2026-10-01 00:30 = UTC 2026-09-30 15:30. 아래 시험 넷이 이 한
// 순간을 서로 다른 각도에서 본다.
const KST_OCT_FIRST_HALF_PAST_MIDNIGHT = "2026-09-30T15:30:00.000Z";

test("① 한국시간 10월 1일 00:30 에 적은 기록은 10월로 묶인다 (그 시각의 UTC 는 9월 30일이다)", () => {
  // 전제를 먼저 못 박는다 — 이 ISO 값이 정말 UTC 로는 9월인가.
  assert.equal(new Date(KST_OCT_FIRST_HALF_PAST_MIDNIGHT).getUTCMonth(), 8, "UTC 로는 9월(0-based 8)이어야 한다");

  assert.equal(toMyWorkRecordMonthKey(KST_OCT_FIRST_HALF_PAST_MIDNIGHT), "2026-10");

  const groups = groupMyWorkRecordsByKstMonth([{ createdAt: KST_OCT_FIRST_HALF_PAST_MIDNIGHT }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].yearMonth, "2026-10");
  assert.equal(groups[0].label, "2026년 10월");
});

test("① 같은 경계: 한국시간 9월 30일 23:30 은 9월에 남는다", () => {
  // UTC 로는 9월 30일 14:30 — 위 시험과 UTC 월이 같은데 한국시간 달은 다르다.
  assert.equal(toMyWorkRecordMonthKey("2026-09-30T14:30:00.000Z"), "2026-09");
});

test("시각 표기도 한국시간이다 — 10-01 00:30", () => {
  assert.equal(formatKstDayTime(KST_OCT_FIRST_HALF_PAST_MIDNIGHT), "10-01 00:30");
});

test("자정이 24시로 새지 않는다", () => {
  // 한국시간 2026-10-01 00:00 = UTC 2026-09-30 15:00.
  assert.equal(formatKstDayTime("2026-09-30T15:00:00.000Z"), "10-01 00:00");
});

test("⑤ 기록이 없는 달은 묶음 자체를 만들지 않는다 — 빈 달을 12줄 늘어놓지 않는다", () => {
  const groups = groupMyWorkRecordsByKstMonth([
    { createdAt: "2026-10-06T05:22:00.000Z" },
    { createdAt: "2026-08-11T01:00:00.000Z" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.yearMonth),
    ["2026-10", "2026-08"],
    "9월은 기록이 없으므로 줄이 아예 없어야 한다"
  );
  assert.equal(groups.length, 2);
});

test("기록이 하나도 없으면 묶음도 없다", () => {
  assert.deepEqual(groupMyWorkRecordsByKstMonth([]), []);
});

test("최근 달이 위, 달 안에서는 새것이 위", () => {
  const groups = groupMyWorkRecordsByKstMonth([
    { createdAt: "2026-08-11T01:00:00.000Z", id: "old-aug" },
    { createdAt: "2026-10-01T00:00:00.000Z", id: "oct-early" },
    { createdAt: "2026-08-29T01:00:00.000Z", id: "late-aug" },
    { createdAt: "2026-10-06T05:22:00.000Z", id: "oct-late" },
  ]);
  assert.deepEqual(
    groups.map((g) => g.yearMonth),
    ["2026-10", "2026-08"]
  );
  assert.deepEqual(
    groups[0].records.map((r) => r.id),
    ["oct-late", "oct-early"]
  );
  assert.deepEqual(
    groups[1].records.map((r) => r.id),
    ["late-aug", "old-aug"]
  );
});

test("묶음 머리의 건수는 그 달의 줄 수다", () => {
  const groups = groupMyWorkRecordsByKstMonth([
    { createdAt: "2026-10-06T05:22:00.000Z" },
    { createdAt: "2026-10-05T00:10:00.000Z" },
    { createdAt: "2026-08-11T01:00:00.000Z" },
  ]);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[1].count, 1);
});

test("④ 12개월 창의 시작은 11개월 전 1일의 한국시간 자정이다", () => {
  // 지금: 한국시간 2026-10-06 09:00.
  const start = myWorkRecordWindowStart(new Date("2026-10-06T00:00:00.000Z"));
  // 한국시간 2025-11-01 00:00 = UTC 2025-10-31 15:00.
  assert.equal(start.toISOString(), "2025-10-31T15:00:00.000Z");
  // 이번 달을 포함해 딱 12개월이다.
  assert.equal(MY_WORK_RECORD_MONTH_WINDOW, 12);
  assert.equal(toMyWorkRecordMonthKey(start.toISOString()), "2025-11");
});

test("④ 13개월 전 기록은 창 밖이고, 12개월 창의 첫날 아침은 창 안이다", () => {
  const now = new Date("2026-10-06T00:00:00.000Z");
  const start = myWorkRecordWindowStart(now);

  // 13개월 전(2025-09) — 창 밖.
  assert.ok(new Date("2025-09-20T01:00:00.000Z") < start, "13개월 전 기록은 창 시작보다 앞서야 한다");

  // 🔴 창 첫날의 한국시간 아침 — UTC 로는 전날(2025-10-31)이라, UTC 자정으로
  // 잘랐다면 여기서 떨어졌을 기록이다.
  const firstMorning = new Date("2025-10-31T16:00:00.000Z"); // 한국시간 2025-11-01 01:00
  assert.ok(firstMorning >= start, "창 첫날 아침에 적은 기록은 창 안이어야 한다");
  assert.equal(toMyWorkRecordMonthKey(firstMorning.toISOString()), "2025-11");

  // 그 바로 앞(한국시간 2025-10-31 23:59)은 창 밖.
  assert.ok(new Date("2025-10-31T14:59:00.000Z") < start);
});

test("④ 창 시작은 연도를 넘어가도 맞다 — 1월이면 전해 2월부터", () => {
  const start = myWorkRecordWindowStart(new Date("2026-01-15T00:00:00.000Z"));
  assert.equal(toMyWorkRecordMonthKey(start.toISOString()), "2025-02");
  assert.equal(start.toISOString(), "2025-01-31T15:00:00.000Z");
});

test("④ 창 시작도 한국시간 달을 기준으로 잡는다 — 한국시간 1월 1일 새벽은 이미 1월이다", () => {
  // UTC 로는 2026-12-31, 한국시간으로는 2027-01-01 00:30.
  const start = myWorkRecordWindowStart(new Date("2026-12-31T15:30:00.000Z"));
  assert.equal(toMyWorkRecordMonthKey(start.toISOString()), "2026-02", "2027년 1월 기준이면 창은 2026년 2월부터다");
});

test("묶음 머리 글자는 0 을 떼고 적는다", () => {
  assert.equal(formatMyWorkRecordMonthLabel("2026-10"), "2026년 10월");
  assert.equal(formatMyWorkRecordMonthLabel("2026-09"), "2026년 9월");
  assert.equal(formatMyWorkRecordMonthLabel("2026-01"), "2026년 1월");
});
