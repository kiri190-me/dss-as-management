import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * GET /api/repair-cases/{id}/service-report/contact-folder/pdf — 규율 (2026-10-12)
 * ============================================================================
 * 보고서 [저장]이 꽂은 엑셀이 **PDF 가 되었는가**를 서버가 폴더를 다시 읽어 답하는 통로다.
 * 도우미는 답을 주지 않으므로 서버가 눈이 된다. 바뀌면 안 되는 것을 원본 글자로 본다:
 *
 *  · 🔴 **읽기 하나다** — 쓰지도 만들지도 않고, **변환을 시키지도 않는다**(도우미 주소도,
 *    주소를 만드는 함수도 없다)
 *  · 🔴 받은 자리 · 이름을 **다시 본다** — 이웃 목록 통로가 쓰는 그 검사다
 *  · 🔴 결과 이름을 **손으로 짓지 않는다** — 도우미와 같은 한 벌의 규칙이 짓는다
 *  · 🔴 「전에도 있었다」를 가를 **수정 시각**을 함께 내고, 못 읽으면 **칸이 빠진다**
 *  · 🔴 폴더가 여럿이면 **아무것도 내지 않는다**
 *  · 🔴 권한은 이웃 꽂기 통로와 **같은 원본**에서 읽는다
 *  · 🔴 응답에 절대 경로 · 루트 · 연락서 폴더 이름이 없다
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = code.replace(/\s+/g, " ");

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
}

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

describe("보고서 PDF 확인 통로 — 원본으로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — GET · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["GET", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 읽기 하나다 — 쓰기 · 지우기 · 파일 중계가 없다", () => {
    for (const forbidden of [
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bunlink\b/,
      /\brmdir\b/,
      /\brename\b/,
      /node:fs/,
      /\breadFile\b/,
      /Content-Disposition/,
      /copyIntoContactFolder/,
      /createContactFolder/,
    ]) {
      assert.equal(forbidden.test(code), false, `읽기 통로가 아니다: ${forbidden}`);
    }
    assert.equal(/\brm\(/.test(code), false, "지우기가 생겼다");
  });

  test("🔴 변환을 시키지 않는다 — 도우미 주소를 만들지도 열지도 않는다", () => {
    for (const forbidden of ["dss-folder:", "buildQuoteFolderXlsx2PdfLink", "iframe", "openLink"]) {
      assert.equal(code.includes(forbidden), false, `통로가 변환을 시킨다: ${forbidden}`);
    }
  });

  test("🔴 받은 자리 · 이름을 다시 본다 — 디스크를 보기 전에", () => {
    assert.ok(flat.includes('if (insidePath !== "" && checkQuoteFolderRelativePath(insidePath) !== null) {'), flat);
    assert.ok(flat.includes("if (!isQuoteFolderXlsx2PdfSourceName(sourceName)) {"), flat);
    // 🔴 검사는 **루트를 보기 전에** 끝난다 — 규칙 밖 값으로 NAS 를 두드리지 않는다.
    const check = code.indexOf("isQuoteFolderXlsx2PdfSourceName(sourceName)");
    const root = code.indexOf("resolveContactFolderArchiveRoot()");
    assert.ok(check >= 0 && root > check, "루트 검사가 자리 검사보다 앞이다");
  });

  test("🔴 결과 이름을 손으로 짓지 않는다 — 규칙이 짓는다", () => {
    assert.ok(code.includes("const pdfName = quoteFolderXlsx2PdfOutputName(source.name);"), code);
    for (const forbidden of ['".pdf"', '".xlsx"', "replace(", "slice(0,"]) {
      assert.equal(code.includes(forbidden), false, `통로가 이름을 짓는다: ${forbidden}`);
    }
  });

  test("🔴 수정 시각 — 못 읽으면 칸이 통째로 빠진다", () => {
    assert.ok(flat.includes("function modifiedAtOf(modifiedAtMs: number | null | undefined)"), flat);
    assert.ok(flat.includes("return {}; return { pdfModifiedAt: new Date(modifiedAtMs).toISOString() };"), flat);
    assert.ok(flat.includes("...modifiedAtOf(pdf?.modifiedAtMs),"), flat);
  });

  test("🔴 폴더가 여럿이면 아무것도 내지 않는다", () => {
    assert.ok(flat.includes('if (found.status === "multiple") {'), flat);
    assert.ok(flat.includes('return respond({ status: "multiple" });'), flat);
    // 이름 목록을 싣는 칸이 없다.
    assert.equal(code.includes("folderNames"), false, "폴더 이름 목록이 샌다");
  });

  test("🔴 권한은 이웃 꽂기 통로와 같은 원본에서 읽는다", () => {
    assert.ok(
      flat.includes(
        "hasPermission(actingUser, SERVICE_REPORT_PERMISSION_AREA, SERVICE_REPORT_REQUIRED_LEVELS.edit)"
      ),
      flat
    );
    for (const forbidden of ['"WRITE"', '"READ"', '"repairCases"', '"repairCases.files"']) {
      assert.equal(code.includes(forbidden), false, `문턱을 베껴 적었다: ${forbidden}`);
    }
  });

  test("🔴 응답에 절대 경로 · 루트 · 폴더 이름이 없다", () => {
    // 응답 **타입**에 그 칸이 아예 없다(폴더 이름은 저장소에 넘기는 입력일 뿐이다).
    const body = sliceBetween(code, "type ServiceReportContactFolderPdfResponse =", "const UNCONVERTIBLE_NAME_REASON");
    for (const forbidden of ["folderName", "relativePath", "uncPath", "root"]) {
      assert.equal(body.includes(forbidden), false, `응답 타입에 샌다: ${forbidden}`);
    }
    for (const forbidden of ["uncPath", "CONTACT_FOLDER_ARCHIVE_DIR", "process.env"]) {
      assert.equal(code.includes(forbidden), false, `코드에 설정값이 샌다: ${forbidden}`);
    }
  });

  test("🔴 감사를 남기지 않는다 — 기록할 변경이 없다", () => {
    for (const forbidden of ["insertAuditLog", "recordContactFolder", "mutations/"]) {
      assert.equal(code.includes(forbidden), false, `감사 기록이 생겼다: ${forbidden}`);
    }
  });
});
