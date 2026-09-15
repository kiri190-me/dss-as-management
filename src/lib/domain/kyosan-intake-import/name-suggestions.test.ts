import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nfkcNameKey, suggestSimilarNames } from "./name-suggestions";

describe("nfkcNameKey", () => {
  test("전각/반각 · 대소문자 · 공백 차이를 지운다", () => {
    assert.equal(nfkcNameKey("  ＴＥＳＴ－Customer   Ａ\t"), "test-customer a");
    assert.equal(nfkcNameKey("TEST-CUSTOMER A"), nfkcNameKey("ｔｅｓｔ－ｃｕｓｔｏｍｅｒ　ａ"));
    assert.equal(nfkcNameKey("   "), "");
  });
});

describe("suggestSimilarNames", () => {
  const CANDIDATES = [
    { id: "same-fullwidth", name: "ＲＦ－３０００ Ａ" },
    { id: "same-case-space", name: "  rf-3000   a " },
    { id: "typo-1", name: "RF-3000 B" },
    { id: "typo-2", name: "RF-3001 C" },
    { id: "far", name: "MB-9999 Z" },
    { id: "contains-longer", name: "RF-3000 A PLUS" },
    { id: "contained-shorter", name: "RF-3000" },
    { id: "blank", name: "   " },
  ];

  test("같은 키는 빼고, 오타 1~2자와 포함 관계를 가까운 순으로", () => {
    assert.deepEqual(
      suggestSimilarNames("RF-3000 A", CANDIDATES).map((candidate) => candidate.id),
      // 거리: typo-1 1 · contained-shorter 2 · typo-2 2 · contains-longer 5(길이 차이)
      ["typo-1", "contained-shorter", "typo-2", "contains-longer"]
    );
  });

  test("limit 과 빈 이름", () => {
    assert.deepEqual(
      suggestSimilarNames("RF-3000 A", CANDIDATES, 2).map((candidate) => candidate.id),
      ["typo-1", "contained-shorter"]
    );
    assert.deepEqual(suggestSimilarNames("RF-3000 A", CANDIDATES, 0), []);
    assert.deepEqual(suggestSimilarNames("   ", CANDIDATES), []);
  });

  test("한자·한글도 한 글자가 한 칸 — 오타 한 자", () => {
    assert.deepEqual(
      suggestSimilarNames("테스트고객사", [
        { id: "1", name: "테스트고객시" },
        { id: "2", name: "전혀다른회사명" },
      ]).map((candidate) => candidate.id),
      ["1"]
    );
    assert.deepEqual(
      suggestSimilarNames("試験電機", [{ id: "1", name: "試験電気" }]).map((candidate) => candidate.id),
      ["1"]
    );
  });

  test("받은 후보 객체를 그대로 돌려주고, 같은 거리·같은 이름이면 id 순", () => {
    const first = { id: "b", name: "RF-3000 B", extra: 1 };
    const second = { id: "a", name: "RF-3000 B", extra: 2 };
    const result = suggestSimilarNames("RF-3000 A", [first, second]);
    assert.deepEqual(result.map((candidate) => candidate.id), ["a", "b"]);
    assert.equal(result[1], first);
  });
});
