import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { referencedCids, sanitizeSignatureHtml } from "./mail-signature-html";

/**
 * ============================================================================
 * 서명 HTML 정화 — 무엇이 반드시 떨어져 나가야 하는가
 * ============================================================================
 * 이 글은 전사원 메일로 나가고, 설정 화면에서 dangerouslySetInnerHTML 로
 * 그려진다. 후자 때문에 **우리 화면에서 스크립트가 도는 길**이 되므로, 여기
 * 시험은 "예쁘게 남는가"가 아니라 **위험한 것이 반드시 사라지는가**를 본다.
 * ============================================================================
 */

describe("서명 HTML 정화", () => {
  test("🔴 script 태그는 통째로 사라진다", () => {
    const out = sanitizeSignatureHtml('<p>안녕</p><script>alert(1)</script>');
    assert.doesNotMatch(out, /script/i);
    assert.doesNotMatch(out, /alert/);
    assert.match(out, /안녕/);
  });

  test("🔴 이벤트 속성(onerror·onclick)은 사라진다", () => {
    const out = sanitizeSignatureHtml('<img src="cid:logo" onerror="alert(1)"><p onclick="x()">글</p>');
    assert.doesNotMatch(out, /onerror/i);
    assert.doesNotMatch(out, /onclick/i);
    assert.doesNotMatch(out, /alert/);
    // 이미지 자체는 남아야 한다 — 속성만 떨어진다.
    assert.match(out, /cid:logo/);
  });

  test("🔴 javascript: 링크는 사라진다", () => {
    const out = sanitizeSignatureHtml('<a href="javascript:alert(1)">누르지 마시오</a>');
    assert.doesNotMatch(out, /javascript:/i);
    // 글자는 남는다 — 링크만 죽는다.
    assert.match(out, /누르지 마시오/);
  });

  test("🔴 data: 이미지는 허용하지 않는다", () => {
    const out = sanitizeSignatureHtml('<img src="data:image/png;base64,AAAA">');
    assert.doesNotMatch(out, /data:/);
  });

  test("🔴 iframe·form·style 블록은 남지 않는다", () => {
    const out = sanitizeSignatureHtml(
      '<iframe src="https://x"></iframe><form action="/x"><input></form><style>body{display:none}</style>'
    );
    assert.doesNotMatch(out, /iframe/i);
    assert.doesNotMatch(out, /<form/i);
    // style 은 nonTextTags 라 안의 글자까지 사라져야 한다.
    assert.doesNotMatch(out, /display:none/);
  });

  test("정상적인 서명은 그대로 살아남는다", () => {
    const signature = [
      '<p><b><span style="color:#c00000">DSS Co.,Ltd.</span></b></p>',
      "<p>16-10, LS-ro 166beon-gil, Gunpo-si, Gyeonggi-do, Republic of Korea [15807]</p>",
      "<p>Tel : 070-5227-3024 Fax : +82-31-273-7567</p>",
      '<p>Website : <a href="http://www.dss21.com">http://www.dss21.com</a>',
      ' E-mail : <a href="mailto:chm@dss21.com">chm@dss21.com</a></p>',
      '<p><img src="cid:logo1" alt="로고" width="120"></p>',
    ].join("");

    const out = sanitizeSignatureHtml(signature);
    assert.match(out, /DSS Co\.,Ltd\./);
    assert.match(out, /color:#c00000/);
    assert.match(out, /16-10, LS-ro/);
    assert.match(out, /href="http:\/\/www\.dss21\.com"/);
    assert.match(out, /mailto:chm@dss21\.com/);
    assert.match(out, /src="cid:logo1"/);
    assert.match(out, /width="120"/);
  });

  test("Outlook 이 딸려 보내는 잡동사니는 떨어진다", () => {
    const out = sanitizeSignatureHtml(
      '<p class="MsoNormal">주소<o:p></o:p></p><w:WordDocument><w:View>Normal</w:View></w:WordDocument>'
    );
    assert.doesNotMatch(out, /MsoNormal/);
    assert.doesNotMatch(out, /o:p/);
    assert.doesNotMatch(out, /WordDocument/);
    // 글자는 남는다.
    assert.match(out, /주소/);
  });

  test("링크에는 noopener 가 붙는다", () => {
    const out = sanitizeSignatureHtml('<a href="https://dss21.com">DSS</a>');
    assert.match(out, /rel="noopener noreferrer"/);
  });

  test("빈 값은 빈 문자열이다", () => {
    assert.equal(sanitizeSignatureHtml(""), "");
    assert.equal(sanitizeSignatureHtml("   "), "");
  });
});

describe("서명이 참조하는 cid 찾기", () => {
  test("쓰인 cid 만 모으고 중복은 접는다", () => {
    const html = '<img src="cid:a"><p>x</p><img src="cid:b"><img src="cid:a">';
    assert.deepEqual(referencedCids(html).sort(), ["a", "b"]);
  });

  test("이미지가 없으면 빈 배열", () => {
    assert.deepEqual(referencedCids("<p>글만 있는 서명</p>"), []);
  });

  test("작은따옴표와 대문자 SRC 도 찾는다", () => {
    assert.deepEqual(referencedCids("<img SRC='cid:logo'>"), ["logo"]);
  });
});
