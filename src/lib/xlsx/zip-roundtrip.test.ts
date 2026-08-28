import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ZipArchive } from "./zip-reader";
import { crc32, writeZip } from "./zip-writer";

/**
 * ============================================================================
 * 이 파일이 엔진이 맞다고 말하는 근거다
 * ============================================================================
 * 아무것도 바꾸지 않고 읽어서 다시 쓴 결과가 원본과 **모든 파트에서 같아야**
 * 한다. 이게 통과해야 "값만 갈아 끼운 견적서"라는 말을 할 수 있다 — 통과하지
 * 못하면 우리가 채운 칸이 맞는지와 무관하게 나머지 어딘가가 조용히 망가진
 * 파일을 고객사에 보내는 셈이 된다.
 *
 * zip **컨테이너 바이트**를 비교하지 않는 이유: 압축 수준·타임스탬프·엔트리
 * 헤더가 Excel 이 쓴 것과 같을 이유가 없고, 같아야 할 이유도 없다. 같아야 하는
 * 것은 압축을 푼 **내용**이다.
 * ============================================================================
 */

const templatePath = process.env.QUOTE_TEMPLATE_PATH;

test("crc32: 알려진 값", () => {
  assert.equal(crc32(Buffer.from("", "utf8")), 0);
  assert.equal(crc32(Buffer.from("123456789", "utf8")), 0xcbf43926);
  assert.equal(crc32(Buffer.from("The quick brown fox jumps over the lazy dog", "utf8")), 0x414fa339);
});

test("writeZip → ZipArchive: 이름·순서·내용이 그대로 돌아온다", () => {
  const entries = [
    { name: "[Content_Types].xml", data: Buffer.from("<Types/>", "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from("<worksheet>가나다</worksheet>", "utf8") },
    // 압축이 안 먹는 바이트(무작위)도 그대로 돌아와야 한다 — stored 로 떨어지는 경로.
    { name: "xl/media/image1.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    { name: "xl/empty.bin", data: Buffer.alloc(0) },
  ];

  const archive = ZipArchive.fromBuffer(writeZip(entries));
  assert.deepEqual(
    archive.list(),
    entries.map((entry) => entry.name),
    "엔트리 순서가 입력 순서와 같아야 한다"
  );
  for (const entry of entries) {
    assert.deepEqual(archive.readEntry(entry.name), entry.data, entry.name);
  }
});

test("writeZip: 출력이 결정적이다 — 같은 입력이면 같은 바이트", () => {
  const entries = [{ name: "a.xml", data: Buffer.from("<a>같은 내용</a>", "utf8") }];
  assert.deepEqual(writeZip(entries), writeZip(entries));
});

test("writeZip: 이름이 겹치면 던진다", () => {
  assert.throws(
    () =>
      writeZip([
        { name: "a.xml", data: Buffer.from("1") },
        { name: "a.xml", data: Buffer.from("2") },
      ]),
    /중복/
  );
});

test(
  "원본 양식 라운드트립 — 아무것도 안 바꾸고 다시 쓰면 모든 파트가 동일하다",
  { skip: templatePath ? false : "QUOTE_TEMPLATE_PATH 가 설정되지 않았습니다" },
  () => {
    assert.ok(templatePath);
    const original = readFileSync(templatePath);
    const source = ZipArchive.fromBuffer(original);

    const names = source.list();
    assert.ok(names.includes("xl/workbook.xml"), "양식이 xlsx 가 아닙니다");

    const rewritten = writeZip(
      names.map((name) => {
        const data = source.readEntry(name);
        assert.ok(data, `파트를 읽지 못했습니다: ${name}`);
        return { name, data };
      })
    );

    const result = ZipArchive.fromBuffer(rewritten);
    assert.deepEqual(result.list(), names, "파트 목록과 순서가 원본과 같아야 한다");
    for (const name of names) {
      assert.deepEqual(result.readEntry(name), source.readEntry(name), `파트 내용이 다릅니다: ${name}`);
    }

    // 원본 파일은 읽기 전용이다. 우리가 만지지 않았음을 파일 자체로 확인한다.
    assert.deepEqual(readFileSync(templatePath), original, "원본 양식 파일이 바뀌었습니다");
  }
);
