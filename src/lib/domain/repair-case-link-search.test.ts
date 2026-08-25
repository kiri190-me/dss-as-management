import { test } from "node:test";
import assert from "node:assert/strict";

import {
  filterRepairCaseLinkOptions,
  keepSelectedRepairCaseOption,
} from "./repair-case-link-search";

/**
 * 이 시험이 지키는 것 넷.
 *  1. 인수번호 일부만 쳐도 걸린다 — 사람이 아는 것은 번호 조각이다.
 *  2. 대소문자와 앞뒤/사이 공백은 무시한다(entity-name-match 의 정규화 규칙).
 *  3. **빈 검색어와 공백뿐인 검색어는 아무것도 거르지 않는다** — 목록이 비면
 *     "고를 수 있는 건이 없다"로 읽힌다.
 *  4. **지금 고른 건은 검색어에 걸리지 않아도 사라지지 않는다** — 사라지면
 *     `<select>` 가 '연결 없음'을 보여 주면서 상태에는 연결이 남는다.
 */

type Option = {
  id: string;
  intakeNumber: string;
  customerName: string | null;
  modelName: string | null;
};

const options: Option[] = [
  { id: "a", intakeNumber: "D2602-003", customerName: "한화시스템", modelName: "RF-Amp-200" },
  { id: "b", intakeNumber: "D2602-001", customerName: "LIG넥스원", modelName: "rf-mixer-10" },
  { id: "c", intakeNumber: "D2601-017", customerName: null, modelName: null },
];

// ── 거르기 ────────────────────────────────────────────────────────────

test("인수번호 일부로 걸러진다", () => {
  const found = filterRepairCaseLinkOptions(options, "2602");
  assert.deepEqual(found.map((o) => o.id), ["a", "b"]);
});

test("인수번호를 끝까지 치면 한 건만 남는다", () => {
  const found = filterRepairCaseLinkOptions(options, "D2602-003");
  assert.deepEqual(found.map((o) => o.id), ["a"]);
});

test("대소문자를 무시한다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "d2602-003").map((o) => o.id),
    ["a"]
  );
  // 형식 쪽도 같다 — 자료에는 소문자, 사용자는 대문자로 친다.
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "RF-MIXER").map((o) => o.id),
    ["b"]
  );
});

test("앞뒤 공백과 겹친 공백은 무시한다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "  2602  ").map((o) => o.id),
    ["a", "b"]
  );
});

test("고객사명·형식으로도 걸러진다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "넥스원").map((o) => o.id),
    ["b"]
  );
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "Amp").map((o) => o.id),
    ["a"]
  );
});

test("고객사·형식이 비어 있는 건도 인수번호로는 걸린다 — null 에 걸려 넘어지지 않는다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "D2601").map((o) => o.id),
    ["c"]
  );
});

test("빈 검색어면 전부 나온다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "").map((o) => o.id),
    ["a", "b", "c"]
  );
});

test("공백만 친 경우에도 전부 나온다 — 스페이스 한 칸이 목록을 지우면 안 된다", () => {
  assert.deepEqual(
    filterRepairCaseLinkOptions(options, "   ").map((o) => o.id),
    ["a", "b", "c"]
  );
});

test("아무것도 걸리지 않으면 빈 결과다", () => {
  assert.deepEqual(filterRepairCaseLinkOptions(options, "없는번호"), []);
});

test("원본 순서를 그대로 지킨다 — 최신 인수번호가 위라는 성질이 검색할 때만 사라지면 안 된다", () => {
  const found = filterRepairCaseLinkOptions(options, "d");
  assert.deepEqual(found.map((o) => o.id), ["a", "b", "c"]);
});

test("원본 배열을 건드리지 않는다", () => {
  const before = options.map((o) => o.id);
  filterRepairCaseLinkOptions(options, "");
  assert.deepEqual(options.map((o) => o.id), before);
});

// ── 고른 건 붙잡아 두기 ────────────────────────────────────────────────

test("검색에 걸리지 않는 건이라도 지금 고른 것이면 남는다", () => {
  const filtered = filterRepairCaseLinkOptions(options, "D2601");
  const visible = keepSelectedRepairCaseOption(options, filtered, "a");
  assert.deepEqual(visible.map((o) => o.id), ["a", "c"]);
});

test("붙잡아 둔 건도 원본 순서 자리에 들어간다 — 맨 위로 튀지 않는다", () => {
  const filtered = filterRepairCaseLinkOptions(options, "2602-001");
  const visible = keepSelectedRepairCaseOption(options, filtered, "c");
  assert.deepEqual(visible.map((o) => o.id), ["b", "c"]);
});

test("고른 것이 이미 걸려 있으면 두 번 들어가지 않는다", () => {
  const filtered = filterRepairCaseLinkOptions(options, "2602");
  const visible = keepSelectedRepairCaseOption(options, filtered, "a");
  assert.deepEqual(visible.map((o) => o.id), ["a", "b"]);
});

test("고른 것이 없으면('연결 없음') 걸러진 목록 그대로다", () => {
  const filtered = filterRepairCaseLinkOptions(options, "D2601");
  assert.deepEqual(
    keepSelectedRepairCaseOption(options, filtered, "").map((o) => o.id),
    ["c"]
  );
  assert.deepEqual(
    keepSelectedRepairCaseOption(options, filtered, null).map((o) => o.id),
    ["c"]
  );
});

test("목록에 없는 id 를 고르고 있어도(휴지통에 들어간 건) 없는 항목을 지어내지 않는다", () => {
  const filtered = filterRepairCaseLinkOptions(options, "D2601");
  assert.deepEqual(
    keepSelectedRepairCaseOption(options, filtered, "지워진-건").map((o) => o.id),
    ["c"]
  );
});
