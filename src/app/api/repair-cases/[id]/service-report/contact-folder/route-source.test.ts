import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * ============================================================================
 * POST /api/repair-cases/{id}/service-report/contact-folder — 규율 (2026-10-12)
 * ============================================================================
 * 이 저장소는 라우트를 직접 부르지 않는다(세션 · DB · 디스크가 필요하다). 그래서 이
 * 통로에서 **바뀌면 안 되는 것**을 원본 글자로 본다:
 *
 *  · 🔴 **보고서 저장(DB)을 건드리지 않는다** — 보고서 표를 쓰는 코드가 없다
 *  · 🔴 **새 쓰기 길을 만들지 않았다** — `copyIntoContactFolder` 하나를 지난다
 *    (`mkdir` · `writeFile` · `unlink` · `rm` · `rename` 이 한 글자도 없다)
 *  · 🔴 **연락서 폴더를 만들지 않는다**(없으면 `no-folder`)
 *  · 🔴 분류는 **저장된 장의 종류**가 정한다 — 화면이 보낸 값으로 자리를 고르지 않고,
 *    `"INSPECTION_REPORT"` 같은 글자를 통로가 손으로 적지 않는다
 *  · 🔴 양식 채우기를 **다시 적지 않는다** — 이웃 `../xlsx` 의 GET 과 같은 사슬이다
 *  · 🔴 권한 문턱을 **손으로 적지 않는다** — 원본 한 자리에서 읽는다
 *  · 🔴 설정이 비면 **엑셀을 만들지도 않는다**(루트 검사가 양식 읽기보다 앞이다)
 *  · 🔴 응답 · 로그에 절대 경로 · 루트 · 폴더 이름이 없다
 *
 * 꽂기 자체는 lib/storage/contact-folder-report-copy.test.ts 가 임시 폴더에서,
 * 분류 고르기는 lib/domain/service-report-contact-folder.test.ts 가 값으로 본다.
 * ============================================================================
 */

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** 주석을 뺀 코드 — 머리말이 까닭을 설명하느라 적은 낱말에 걸리지 않게. */
const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const flat = code.replace(/\s+/g, " ");

function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(
      /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm
    ),
  ]
    .map((match) => match[1])
    .sort();
}

function indexOrFail(source: string, marker: string): number {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
}

describe("보고서 → 연락서 폴더 통로 — 원본으로 지킨다", () => {
  test("🔴 Next 가 정한 이름만 export 한다 — POST · runtime · dynamic 뿐", () => {
    assert.deepEqual(exportedNames(route), ["POST", "dynamic", "runtime"]);
    assert.ok(route.includes('export const runtime = "nodejs";'));
    assert.ok(route.includes('export const dynamic = "force-dynamic";'));
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) {
      assert.equal(
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(route),
        false,
        `${method} 가 생겼다`
      );
    }
  });

  test("🔴 새 쓰기 길을 만들지 않았다 — fs 를 직접 두드리지 않는다", () => {
    for (const forbidden of [
      /\bmkdir\b/,
      /\bwriteFile\b/,
      /\bunlink\b/,
      /\brmdir\b/,
      /\brename\b/,
      /\btruncate\b/,
      /node:fs/,
      /\bopen\(/,
    ]) {
      assert.equal(forbidden.test(code), false, `통로가 직접 쓴다: ${forbidden}`);
    }
    // 🔴 `rm` 은 낱말 경계로 센다(`form` 같은 낱말에 걸리지 않게).
    assert.equal(/\brm\(/.test(code), false, "지우기가 생겼다");
    // 꽂는 길은 **하나**다 — 올리기 사본이 쓰는 그것.
    assert.equal(code.split("copyIntoContactFolder(").length - 1, 1);
    assert.ok(code.includes('from "@/lib/storage/contact-folder-archive"'));
  });

  test("🔴 연락서 폴더를 만들지 않는다 — 만드는 함수를 가져오지 않는다", () => {
    for (const forbidden of ["createContactFolder", "contactFolderName("]) {
      assert.equal(code.includes(forbidden), false, `폴더를 만든다: ${forbidden}`);
    }
    assert.ok(flat.includes('if (copied.status === "no-folder") return respond({ status: "no-folder" });'), flat);
  });

  test("🔴 보고서 저장(DB)을 건드리지 않는다 — 쓰는 코드가 없다", () => {
    for (const forbidden of [
      /mutations\//,
      /\bdb\.insert\b/,
      /\bdb\.update\b/,
      /\bdb\.delete\b/,
      /\bdb\.transaction\b/,
      /ServiceReportAction\b/,
    ]) {
      assert.equal(forbidden.test(code), false, `저장 흐름을 건드린다: ${forbidden}`);
    }
    // 읽는 것 둘뿐이다 — 수리 건과 저장된 보고서.
    assert.ok(code.includes("await resolveRepairCaseForServer(id)"));
    assert.ok(code.includes("await getServiceReportForEdit(serviceReportId)"));
  });

  test("🔴 분류는 **저장된 장의 종류**가 정한다 — 글자를 손으로 적지 않는다", () => {
    assert.ok(code.includes("const category = serviceReportContactFolderCategory(input.kind);"), code);
    for (const forbidden of ['"INSPECTION_REPORT"', '"REPAIR_REPORT"', '"검사 보고서"', '"수리 보고서"']) {
      assert.equal(route.includes(forbidden), false, `통로가 분류를 손으로 적는다: ${forbidden}`);
    }
    // 🔴 요청에서 종류를 읽지 않는다 — 주소에서 읽는 것은 보고서 id 하나다.
    assert.equal(/searchParams\.get\("kind"\)/.test(code), false);
    assert.equal(code.split("searchParams.get(").length - 1, 1);
  });

  test("🔴 양식 채우기를 다시 적지 않는다 — `../xlsx` 의 GET 과 같은 사슬", () => {
    const xlsx = readFileSync(new URL("../xlsx/route.ts", import.meta.url), "utf8");
    // 🔴 줄바꿈 자리는 서로 다를 수 있다 — **글자 차례**가 같은지만 본다.
    const squeeze = (source: string) => source.replace(/\s+/g, "");
    const chain = squeeze(
      "validateServiceReportFields(buildServiceReportRequestBody(serviceReportFormValues(saved.values, SERVICE_REPORT_FINDINGS_INTRO)))"
    );
    assert.ok(squeeze(code).includes(chain), "이 통로의 사슬이 바뀌었다");
    assert.ok(squeeze(xlsx).includes(chain), "이웃 통로의 사슬이 바뀌었다");
    assert.ok(
      code.includes("fillServiceReportWorkbook(await readServiceReportTemplate(input.kind), input)"),
      code
    );
  });

  test("🔴 파일 이름은 내려받기와 **같은 규칙**이다 — 통로가 짓지 않는다", () => {
    assert.ok(code.includes("originalFileName: buildServiceReportFileName({"), code);
    assert.equal(/\.xlsx"/.test(code), false, "통로가 확장자를 손으로 붙인다");
  });

  test("🔴 권한 문턱을 손으로 적지 않는다 — 원본 한 자리에서 읽는다", () => {
    assert.ok(
      flat.includes(
        "hasPermission(actingUser, SERVICE_REPORT_PERMISSION_AREA, SERVICE_REPORT_REQUIRED_LEVELS.edit)"
      ),
      flat
    );
    for (const forbidden of ['"WRITE"', '"repairCases"', '"repairCases.files"']) {
      assert.equal(code.includes(forbidden), false, `문턱을 베껴 적었다: ${forbidden}`);
    }
    // 🔴 바꾸는 요청이라 출처를 본다(올리기 · 폴더 만들기와 같은 첫 관문).
    assert.ok(code.includes("if (!isTrustedOrigin(request))"), code);
  });

  test("🔴 차례 — 설정이 비면 엑셀을 만들지도, 보고서를 읽지도 않는다", () => {
    const origin = indexOrFail(code, "isTrustedOrigin(request)");
    const permission = indexOrFail(code, "SERVICE_REPORT_REQUIRED_LEVELS.edit");
    const root = indexOrFail(code, "const archiveRoot = resolveContactFolderArchiveRoot();");
    const repairCase = indexOrFail(code, "await resolveRepairCaseForServer(id)");
    const report = indexOrFail(code, "await getServiceReportForEdit(serviceReportId)");
    const render = indexOrFail(code, "fillServiceReportWorkbook(");
    const copy = indexOrFail(code, "copyIntoContactFolder(");
    assert.ok(origin < permission, "출처가 권한보다 뒤다");
    assert.ok(permission < root, "권한이 루트 검사보다 뒤다");
    assert.ok(root < repairCase && repairCase < report, "루트 검사가 조회보다 뒤다");
    assert.ok(report < render && render < copy, "차례가 틀렸다");
    assert.ok(code.includes('if (archiveRoot === null) {'), code);
  });

  test("🔴 남의 건의 보고서를 그 폴더에 꽂을 수 없다", () => {
    assert.ok(flat.includes("if (saved.repairCaseId !== repairCase.id) {"), flat);
  });

  test("🔴 응답에 절대 경로 · 루트가 없다 — 나가는 것은 상대 폴더 경로 한 칸뿐", () => {
    for (const forbidden of ["uncPath", "archiveRoot:", "CONTACT_FOLDER_ARCHIVE_DIR", "process.env"]) {
      assert.equal(code.includes(forbidden), false, `응답 · 코드에 설정값이 샌다: ${forbidden}`);
    }
    // 상대 경로는 domain 이 조립하고, 규칙 밖이면 칸이 통째로 빠진다.
    assert.ok(flat.includes("const relativePath = serviceReportContactFolderRelativePath("), flat);
    assert.ok(flat.includes("...(relativePath === null ? {} : { relativePath }),"), flat);
  });

  test("🔴 로그에 본문 · 폴더 이름 · 경로가 없다", () => {
    const logs = [...code.matchAll(/console\.(?:error|warn|log)\(([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);
    assert.equal(logs.length, 1, "로그가 늘었다");
    for (const forbidden of ["folderName", "fileName", "relativePath", "values"]) {
      assert.equal(logs[0].includes(forbidden), false, `로그에 샌다: ${forbidden}`);
    }
  });

  test("🔴 감사를 남기지 않는다 — 견적서 [저장]에 딸린 공유폴더 사본과 같은 판단", () => {
    for (const forbidden of ["insertAuditLog", "recordContactFolder", "recordServiceReportExport", "audit"]) {
      assert.equal(code.includes(forbidden), false, `감사 기록이 생겼다: ${forbidden}`);
    }
  });
});
