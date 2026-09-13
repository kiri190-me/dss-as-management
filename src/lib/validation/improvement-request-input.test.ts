import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { IMPROVEMENT_REQUEST_BODY_MAX_CHARS } from "@/lib/domain/improvement-request";
import { validateImprovementRequestFields } from "./improvement-request-input";

/**
 * 이 파일이 지키는 것은 셋이다.
 *
 *  1. **본문은 비울 수 없고 상한을 넘을 수 없다** — 앞뒤 공백을 걷은 뒤에 센다.
 *  2. **상한은 DB CHECK 와 같은 수다** — 스키마 파일은 도메인 상수를 가져오지
 *     않으므로 숫자를 글자로 적어 둔다. 한쪽만 바뀌면 여기서 걸린다.
 *  3. **오류는 칸 단위 한국어다.**
 */

describe("본문", () => {
  test("앞뒤 공백을 걷고, 가운데 줄바꿈은 남긴다", () => {
    const result = validateImprovementRequestFields({ body: "  첫 줄\n둘째 줄\n  " });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.body, "첫 줄\n둘째 줄");
  });

  test("CRLF 줄바꿈은 LF 로 통일한다", () => {
    const result = validateImprovementRequestFields({ body: "첫 줄\r\n둘째 줄\r셋째 줄" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.body, "첫 줄\n둘째 줄\n셋째 줄");
  });

  test("비었거나 공백뿐이면 거절한다", () => {
    for (const bad of ["", "   ", "\n\t \r\n"]) {
      const result = validateImprovementRequestFields({ body: bad });
      assert.equal(result.ok, false, JSON.stringify(bad));
      if (result.ok) return;
      assert.equal(result.fieldErrors.body, "내용을 입력해 주세요.");
    }
  });

  test("글자가 아니면 거절한다", () => {
    for (const bad of [undefined, null, 3, {}, ["가"]]) {
      const result = validateImprovementRequestFields({ body: bad });
      assert.equal(result.ok, false, String(bad));
      if (result.ok) return;
      assert.ok(result.fieldErrors.body, String(bad));
    }
  });

  test("상한까지는 받고, 한 글자라도 넘으면 거절한다", () => {
    const ok = validateImprovementRequestFields({ body: "가".repeat(IMPROVEMENT_REQUEST_BODY_MAX_CHARS) });
    assert.equal(ok.ok, true);

    const tooLong = validateImprovementRequestFields({
      body: "가".repeat(IMPROVEMENT_REQUEST_BODY_MAX_CHARS + 1),
    });
    assert.equal(tooLong.ok, false);
    if (tooLong.ok) return;
    assert.equal(tooLong.fieldErrors.body, `내용은 ${IMPROVEMENT_REQUEST_BODY_MAX_CHARS}자를 넘을 수 없습니다.`);
  });

  test("상한은 공백을 걷은 뒤에 센다", () => {
    const result = validateImprovementRequestFields({
      body: `   ${"가".repeat(IMPROVEMENT_REQUEST_BODY_MAX_CHARS)}   `,
    });
    assert.equal(result.ok, true);
  });

  test("이모지는 한 글자로 센다 — DB 의 char_length 와 같다", () => {
    // UTF-16 으로는 4000 단위지만 코드 포인트로는 2000 글자다.
    const result = validateImprovementRequestFields({ body: "😀".repeat(IMPROVEMENT_REQUEST_BODY_MAX_CHARS) });
    assert.equal(result.ok, true);
  });

  test("CRLF 는 한 글자로 센다 — 입력칸에서 상한에 맞춘 글이 서버에서 넘치지 않는다", () => {
    const half = IMPROVEMENT_REQUEST_BODY_MAX_CHARS / 2;
    const body = `${"가".repeat(half - 1)}\r\n${"나".repeat(half)}`; // LF 로는 딱 상한이다
    const result = validateImprovementRequestFields({ body });
    assert.equal(result.ok, true);
  });
});

describe("DB CHECK 와 검증이 같은 수를 쓴다", () => {
  test("스키마의 char_length 범위가 도메인 상수와 같다", () => {
    const schemaSource = readFileSync(
      new URL("../db/schema/improvement-requests.ts", import.meta.url),
      "utf8"
    );
    assert.ok(
      schemaSource.includes(`char_length(\${table.body}) BETWEEN 1 AND ${IMPROVEMENT_REQUEST_BODY_MAX_CHARS}`),
      "본문 CHECK 상한이 검증과 다르다"
    );
  });
});
