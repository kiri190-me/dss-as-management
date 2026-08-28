import assert from "node:assert/strict";
import { test } from "node:test";

import { buildQuoteFileName, quoteContentDisposition } from "./quote-file-name";

test("받는 사람이 다운로드 폴더에서 알아볼 수 있는 이름", () => {
  assert.equal(
    buildQuoteFileName({ quoteNumber: "DSS 2026-077", customerName: "ICD Co.,Ltd" }),
    "견적서_DSS 2026-077_ICD Co.,Ltd.xlsx"
  );
});

test("파일 이름에 쓸 수 없는 글자를 지운다 — 슬래시가 든 상호가 실제로 있다", () => {
  const name = buildQuoteFileName({
    quoteNumber: "DSS 2026-077",
    customerName: "㈜디에스에스 A/S 사업부",
  });
  assert.equal(name, "견적서_DSS 2026-077_㈜디에스에스 A S 사업부.xlsx");
  for (const forbidden of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(!name.includes(forbidden), `${forbidden} 가 남아 있다`);
  }
});

test("제어문자는 헤더를 깨뜨린다 — 통째로 뺀다", () => {
  const name = buildQuoteFileName({
    quoteNumber: "DSS\u00002026",
    customerName: "ICD\u001fCo",
  });
  assert.ok(!/[\u0000-\u001F\u007F]/.test(name), "제어문자가 남았다");
});

test("이름이 길어도 상한에서 잘린다", () => {
  const name = buildQuoteFileName({ quoteNumber: "Q".repeat(200), customerName: "C".repeat(200) });
  assert.ok(name.length < 200, `너무 길다: ${name.length}`);
  assert.ok(name.endsWith(".xlsx"));
});

test("Content-Disposition: 한글은 RFC 5987 로도 함께 보낸다", () => {
  const header = quoteContentDisposition("견적서_DSS 2026-077_ICD.xlsx");
  assert.match(header, /^attachment; /);
  // 옛 형식에는 ASCII 로 접을 수 없는 글자가 남지 않는다 — 그 값을 읽는
  // 브라우저는 어차피 한글을 못 쓴다.
  const asciiPart = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
  assert.ok(!/[^\x20-\x7E]/.test(asciiPart), `ASCII 대체값에 비ASCII 가 남았다: ${asciiPart}`);
  // 진짜 이름은 UTF-8 퍼센트 인코딩으로 간다.
  assert.ok(header.includes(`filename*=UTF-8''${encodeURIComponent("견적서_DSS 2026-077_ICD.xlsx")}`));
});

test("Content-Disposition: 따옴표와 역슬래시가 헤더를 깨뜨리지 않는다", () => {
  const header = quoteContentDisposition('견적서_A"B\\C.xlsx');
  const asciiPart = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
  assert.ok(!asciiPart.includes('"'));
  assert.ok(!asciiPart.includes("\\"));
});
