import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { contactFolderCategoryFolderName, contactFolderName } from "@/lib/domain/contact-folder-naming";
import { serviceReportContactFolderCategory } from "@/lib/domain/service-report-contact-folder";
import { copyIntoContactFolder, createContactFolder } from "./contact-folder-archive";

/**
 * ============================================================================
 * 보고서 엑셀이 **그 종류의 분류 폴더**에 꽂히는가 — 임시 폴더에서만 (2026-10-12)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더(`\\192.168.0.222\…`)에
 * 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다. 고객사 · 모델 · S/N 은 가짜다.
 *
 * 🔴 **새 쓰기 길을 만들지 않았다**는 것을 값으로 확인하는 자리이기도 하다 — 보고서도
 * 올리기 사본이 쓰는 `copyIntoContactFolder` 그대로를 지난다.
 *
 * 못 박는 것:
 *  · 🔴 검사 보고서는 **검사 폴더**, 수리 보고서는 **수리 폴더** — 섞이지 않는다
 *  · 🔴 분류 폴더가 없으면 **그때 만든다**(안 쓴 분류 폴더는 서지 않는다)
 *  · 🔴 연락서 폴더가 없으면 **만들지 않는다**(`no-folder`)
 *  · 🔴 공유폴더가 **꺼져 있으면**(`disabled`) 디스크를 한 번도 보지 않는다
 *  · 🔴 쓰기가 **실패해도** 던지지 않는다 — 값으로 끝난다(부르는 쪽이 저장을 되돌리지 않게)
 *  · 🔴 같은 이름이 있으면 **덮어쓰지 않고** 번호로 비켜 간다
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-report-copy-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const NAMING = {
  intakeNumber: "D260908",
  customerName: "INVENIA",
  modelName: "T2RCONT-AD2",
  lotNumber: "WN3947",
  serialNumber: "1802034",
  reportedSymptom: "점검요청",
};

const INTAKE = NAMING.intakeNumber;
/** 🔴 기대하는 이름은 **domain 이 짓는 것 그대로**다 — 시험이 다시 짓지 않는다. */
const FOLDER = contactFolderName(NAMING);
const INSPECTION_FOLDER = contactFolderCategoryFolderName(serviceReportContactFolderCategory("INSPECTION"));
const REPAIR_FOLDER = contactFolderCategoryFolderName(serviceReportContactFolderCategory("REPAIR"));

/** 보고서 내려받기 이름 규칙이 내놓는 모양 그대로(domain/service-report-file-name.ts). */
const INSPECTION_FILE = "검사보고서_T2RCONT-AD2_WN3947_1802034.xlsx";
const REPAIR_FILE = "수리보고서_T2RCONT-AD2_WN3947_1802034.xlsx";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function entries(...segments: string[]): Promise<string[]> {
  return (await readdir(path.join(...segments))).sort();
}

async function copyReport(
  root: string,
  kind: "INSPECTION" | "REPAIR",
  originalFileName: string,
  content: string
) {
  return copyIntoContactFolder({
    root,
    intakeNumber: INTAKE,
    category: serviceReportContactFolderCategory(kind),
    originalFileName,
    bytes: bytes(content),
  });
}

describe("🔴 검사는 검사 폴더, 수리는 수리 폴더", () => {
  test("두 종류를 한 건에 넣어도 섞이지 않는다", async () => {
    const root = await makeRoot();
    assert.equal((await createContactFolder({ root, naming: NAMING })).status, "created");

    const inspection = await copyReport(root, "INSPECTION", INSPECTION_FILE, "검사");
    const repair = await copyReport(root, "REPAIR", REPAIR_FILE, "수리");

    assert.equal(inspection.status, "copied");
    assert.equal(repair.status, "copied");
    if (inspection.status !== "copied" || repair.status !== "copied") return;

    assert.equal(inspection.categoryFolderName, INSPECTION_FOLDER);
    assert.equal(repair.categoryFolderName, REPAIR_FOLDER);
    assert.equal(inspection.categoryFolderBlockedByFile, false);
    assert.equal(repair.categoryFolderBlockedByFile, false);

    // 🔴 디스크에서도 자리가 갈린다 — 한쪽 폴더에 다른 쪽 파일이 없다.
    assert.deepEqual(await entries(root, FOLDER, INSPECTION_FOLDER ?? ""), [INSPECTION_FILE]);
    assert.deepEqual(await entries(root, FOLDER, REPAIR_FOLDER ?? ""), [REPAIR_FILE]);
    assert.equal(
      await readFile(path.join(root, FOLDER, INSPECTION_FOLDER ?? "", INSPECTION_FILE), "utf8"),
      "검사"
    );
  });
});

describe("🔴 분류 폴더는 쓰는 것만 그때그때 만든다", () => {
  test("검사 보고서 하나만 넣으면 수리 폴더는 서지 않는다", async () => {
    const root = await makeRoot();
    assert.equal((await createContactFolder({ root, naming: NAMING })).status, "created");
    // 폴더를 막 만든 뒤에는 `DATA` 하나뿐이다 — 분류 폴더가 미리 서 있지 않다.
    assert.deepEqual(await entries(root, FOLDER), ["DATA"]);

    assert.equal((await copyReport(root, "INSPECTION", INSPECTION_FILE, "검사")).status, "copied");

    assert.deepEqual(await entries(root, FOLDER), ["DATA", INSPECTION_FOLDER ?? ""].sort());
  });

  test("이미 있는 분류 폴더는 그대로 쓴다 — 두 번째 보고서가 그 안에 쌓인다", async () => {
    const root = await makeRoot();
    assert.equal((await createContactFolder({ root, naming: NAMING })).status, "created");

    assert.equal((await copyReport(root, "INSPECTION", INSPECTION_FILE, "처음")).status, "copied");
    // 🔴 내용이 달라졌다 — 덮어쓰지 않고 번호로 비켜 간다(사람이 손으로 넣은 파일일 수 있다).
    const second = await copyReport(root, "INSPECTION", INSPECTION_FILE, "고친 것");
    assert.equal(second.status, "copied");
    if (second.status !== "copied") return;
    assert.equal(second.fileName, "검사보고서_T2RCONT-AD2_WN3947_1802034 (2).xlsx");

    // 🔴 처음 것이 그대로 남아 있다.
    assert.equal(
      await readFile(path.join(root, FOLDER, INSPECTION_FOLDER ?? "", INSPECTION_FILE), "utf8"),
      "처음"
    );
  });

  test("같은 내용이면 다시 쓰지 않는다 — ` (2)` 가 쌓이지 않는다", async () => {
    const root = await makeRoot();
    assert.equal((await createContactFolder({ root, naming: NAMING })).status, "created");

    assert.equal((await copyReport(root, "REPAIR", REPAIR_FILE, "같은 것")).status, "copied");
    assert.equal((await copyReport(root, "REPAIR", REPAIR_FILE, "같은 것")).status, "unchanged");
    assert.deepEqual(await entries(root, FOLDER, REPAIR_FOLDER ?? ""), [REPAIR_FILE]);
  });
});

describe("🔴 보고서 저장을 깨지 않는다 — 공유폴더 쪽은 값으로만 끝난다", () => {
  test("공유폴더가 꺼져 있으면 disabled — 디스크를 보지 않는다", async () => {
    const result = await copyIntoContactFolder({
      root: "",
      intakeNumber: INTAKE,
      category: serviceReportContactFolderCategory("INSPECTION"),
      originalFileName: INSPECTION_FILE,
      bytes: bytes("검사"),
    });
    assert.deepEqual(result, { status: "disabled" });
  });

  test("🔴 연락서 폴더가 없으면 no-folder — **만들지 않는다**", async () => {
    const root = await makeRoot();
    const result = await copyReport(root, "INSPECTION", INSPECTION_FILE, "검사");
    assert.deepEqual(result, { status: "no-folder" });
    assert.deepEqual(await entries(root), []);
  });

  test("🔴 쓰기가 실패해도 던지지 않는다 — 루트가 없는 자리면 failed", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "없는 자리");
    const result = await copyReport(missing, "REPAIR", REPAIR_FILE, "수리");
    assert.equal(result.status, "failed");
    if (result.status !== "failed") return;
    // 🔴 사유에 경로가 들어가지 않는다.
    assert.equal(result.reason.includes(root), false, result.reason);
    assert.equal(result.reason.includes("없는 자리"), false, result.reason);
  });

  test("🔴 분류 폴더 자리를 **파일**이 막고 있어도 꽂는다 — 그 파일을 지우지 않는다", async () => {
    const root = await makeRoot();
    assert.equal((await createContactFolder({ root, naming: NAMING })).status, "created");
    // 사람이 「검사 보고서」라는 **파일**을 넣어 두었다.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, FOLDER, INSPECTION_FOLDER ?? ""), "사람이 넣은 파일", "utf8");

    const result = await copyReport(root, "INSPECTION", INSPECTION_FILE, "검사");
    assert.equal(result.status, "copied");
    if (result.status !== "copied") return;
    assert.equal(result.categoryFolderName, null);
    assert.equal(result.categoryFolderBlockedByFile, true);

    // 🔴 막은 파일이 그대로 있고, 보고서는 연락서 폴더 바로 아래에 들어갔다.
    assert.equal(
      await readFile(path.join(root, FOLDER, INSPECTION_FOLDER ?? ""), "utf8"),
      "사람이 넣은 파일"
    );
    assert.deepEqual(await entries(root, FOLDER), ["DATA", INSPECTION_FOLDER ?? "", INSPECTION_FILE].sort());
  });
});
