import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { toNodemailerAttachments, type MailAttachment } from "./send";

/*
 * ============================================================================
 * 🔴 nodemailer 에 **실제로 넘어가는 값** — 인라인이냐 내려받는 첨부냐 (2026-10-19)
 * ============================================================================
 * 수리 의뢰서를 접수 메일에 붙이면서 `cid` 를 **선택**으로 열었다. 그 한 칸이
 * 눈에 안 보이는 곳에서 두 가지를 가른다:
 *
 *   cid 가 있다  → 본문의 `<img src="cid:…">` 이 가리키는 **인라인 자원**(서명 그림)
 *   cid 가 없다  → 받는 사람이 **내려받는 첨부**(수리 의뢰서)
 *
 * 🔴 **잘못 갈려도 발송은 성공한다.** 받는 사람 메일함을 열어야만 드러나고, 증상은
 * 「첨부가 안 보인다」 하나뿐이다 — 그래서 값을 여기서 글자 그대로 본다.
 *
 * 🔴 **서명 그림이 안 깨지는 것**을 함께 못 박는다. 이 조각이 건드린 자리라
 * 「새 첨부는 되는데 서명이 사라졌다」가 가장 그럴듯한 사고다.
 *
 * 왜 `sendMail` 을 부르지 않는가: 그 함수는 SMTP 설정을 읽고 실제 연결을 연다.
 * 여기서 재는 것은 **넘기는 값**이고, 그 값을 만드는 자리는 한 곳뿐이라는 것까지
 * 아래 마지막 시험이 원본 글자로 본다.
 * ============================================================================
 */

const SIGNATURE: MailAttachment = {
  cid: "sig-1",
  fileName: "signature.png",
  mimeType: "image/png",
  content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
};

/** 🔴 `cid` 칸 자체가 없다 — `undefined` 로도 적지 않는다. */
const REPAIR_REQUEST: MailAttachment = {
  fileName: "수리의뢰서.pdf",
  mimeType: "application/pdf",
  content: Buffer.from("%PDF-1.4 fake", "utf8"),
};

describe("메일 첨부 — nodemailer 에 넘어가는 값", () => {
  test("🔴 cid 가 없으면 **내려받는 첨부**다 — cid 칸이 없고 contentDisposition 이 attachment 다", () => {
    const [attachment] = toNodemailerAttachments([REPAIR_REQUEST]);

    // 🔴 칸이 아예 없어야 한다. `cid: undefined` 로 넘기면 라이브러리가 그 칸을
    //    어떻게 읽는지에 기대게 된다.
    assert.equal("cid" in attachment, false, "🔴 cid 칸이 붙어 나간다 — 인라인 자원이 될 수 있다");
    assert.equal(
      (attachment as { contentDisposition?: string }).contentDisposition,
      "attachment",
      "🔴 내려받는 첨부라고 못 박지 않았다"
    );
    assert.equal(attachment.filename, "수리의뢰서.pdf");
    assert.equal(attachment.contentType, "application/pdf");
    assert.equal(attachment.content, REPAIR_REQUEST.content, "바이트가 그대로 넘어가지 않는다");
  });

  test("🔴 서명 그림은 그대로다 — cid 가 넘어가고 contentDisposition 을 적지 않는다", () => {
    const [attachment] = toNodemailerAttachments([SIGNATURE]);

    assert.equal((attachment as { cid?: string }).cid, "sig-1", "🔴 서명의 cid 가 사라졌다 — 본문 그림이 깨진다");
    // 🔴 inline 으로 다루는 것은 nodemailer 의 기본 판정이다. 여기서 "attachment"
    //    를 적으면 서명이 본문에서 떨어져 나와 첨부 목록에 뜬다.
    assert.equal(
      "contentDisposition" in attachment,
      false,
      "🔴 서명에 contentDisposition 이 붙었다 — 본문 그림이 첨부로 떨어진다"
    );
    assert.equal(attachment.filename, "signature.png");
    assert.equal(attachment.contentType, "image/png");
  });

  test("🔴 둘이 한 통에 섞여도 각자의 모양을 지킨다 — 차례도 그대로다", () => {
    const made = toNodemailerAttachments([SIGNATURE, REPAIR_REQUEST]);

    assert.equal(made.length, 2, "첨부 수가 달라졌다");
    assert.equal((made[0] as { cid?: string }).cid, "sig-1", "서명이 첫째가 아니다");
    assert.equal("contentDisposition" in made[0], false, "서명이 첨부로 떨어졌다");
    assert.equal("cid" in made[1], false, "의뢰서에 cid 가 붙었다");
    assert.equal(
      (made[1] as { contentDisposition?: string }).contentDisposition,
      "attachment",
      "의뢰서가 내려받는 첨부가 아니다"
    );
  });

  test("빈 배열은 빈 배열이다 — 동봉할 것이 없을 때 지어내지 않는다", () => {
    assert.deepEqual(toNodemailerAttachments([]), []);
  });
});

describe("메일 첨부 — 모양을 만드는 자리는 하나뿐이다", () => {
  const source = readFileSync(new URL("./send.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("🔴 sendMail 이 제 손으로 첨부 모양을 만들지 않는다", () => {
    // 🔴 여기서 한 벌을 더 만들면 두 자리가 갈리고, 갈린 쪽이 조용히 인라인이 된다.
    assert.ok(
      code.includes("toNodemailerAttachments(input.attachments)"),
      "sendMail 이 한 자리를 거치지 않는다"
    );
    assert.equal(
      /attachments:\s*input\.attachments\?\.map/.test(code),
      false,
      "🔴 sendMail 안에서 첨부 모양을 다시 만든다"
    );
    // 모양을 만드는 자리(= contentDisposition 을 적는 자리)가 한 곳뿐이다.
    assert.equal(code.split("contentDisposition").length - 1, 1, "첨부 성향을 적는 자리가 둘 이상이다");
  });
});
