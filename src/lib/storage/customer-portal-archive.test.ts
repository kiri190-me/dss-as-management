import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { findPortalExportSpec } from "@/lib/domain/customer-portal-export";

import {
  findLatestPortalExportFile,
  resolveCustomerPortalArchiveRoot,
  savePortalExportFile,
} from "./customer-portal-archive";

/*
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — **실제 공유폴더에 닿지 않는다.**
 * 끝나면 만든 임시 폴더를 통째로 지운다. 파일 이름의 모양만 실측을 따르고, 내용은 가짜다.
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "portal-archive-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
});

const JUSUNG = findPortalExportSpec("JUSUNG")!;
const ICD = findPortalExportSpec("ICD")!;

describe("직전 파일 찾기", () => {
  test("🔴 7) 이름 규칙에 맞는 파일이 없으면 만들지 않고 「없다」고 한다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "메모.txt"), "가짜");
    await writeFile(path.join(root, "JUSUNG 임시본.xlsx"), "가짜");

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status, "not-found");
    // 아무것도 만들지 않았다.
    assert.deepEqual((await readdir(root)).sort(), ["JUSUNG 임시본.xlsx", "메모.txt"].sort());
  });

  test("이름의 날짜가 가장 늦은 파일을 읽어 온다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "옛것");
    await writeFile(path.join(root, "JUSUNG_현황_260929.xlsx"), "새것");

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.fileName, "JUSUNG_현황_260929.xlsx");
    assert.equal(found.bytes.toString("utf8"), "새것");
    assert.equal(found.parsed.stamp, "260929");
  });

  test("🔴 하위 폴더(OLD)는 보지 않는다", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "OLD"));
    await writeFile(path.join(root, "OLD", "JUSUNG_현황_261231.xlsx"), "옛 판");
    await writeFile(path.join(root, "JUSUNG_현황_260929.xlsx"), "지금 것");

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status === "found" ? found.fileName : null, "JUSUNG_현황_260929.xlsx");
  });

  test("다른 고객사의 파일을 가져오지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "ICD 정리 자료_260929.xlsx"), "ICD");
    assert.equal((await findLatestPortalExportFile({ root, spec: JUSUNG })).status, "not-found");
    assert.equal((await findLatestPortalExportFile({ root, spec: ICD })).status, "found");
  });

  test("루트가 없으면 만들지 않고 사유로 끝난다", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "없는-폴더");
    const found = await findLatestPortalExportFile({ root: missing, spec: JUSUNG });
    assert.equal(found.status, "failed");
    if (found.status !== "failed") return;
    // 🔴 사유에 경로가 들어가지 않는다.
    assert.equal(found.reason.includes(missing), false);
    assert.equal(found.reason.includes(os.tmpdir()), false);
    assert.equal((await readdir(root)).length, 0);
  });

  test("설정이 비어 있으면 루트가 null 이다(기능이 꺼진 상태)", () => {
    const before = process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;
    try {
      delete process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;
      assert.equal(resolveCustomerPortalArchiveRoot(), null);
      process.env.CUSTOMER_PORTAL_ARCHIVE_DIR = "   ";
      assert.equal(resolveCustomerPortalArchiveRoot(), null);
      process.env.CUSTOMER_PORTAL_ARCHIVE_DIR = path.join(os.tmpdir(), "어딘가");
      assert.notEqual(resolveCustomerPortalArchiveRoot(), null);
    } finally {
      if (before === undefined) delete process.env.CUSTOMER_PORTAL_ARCHIVE_DIR;
      else process.env.CUSTOMER_PORTAL_ARCHIVE_DIR = before;
    }
  });
});

describe("저장 — 덮어쓰지 않는다", () => {
  test("새 이름으로 쓴다", async () => {
    const root = await makeRoot();
    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("새 파일"),
    });
    assert.deepEqual(saved, { status: "saved", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "새 파일");
  });

  test("🔴 같은 이름이 있으면 덮어쓰지 않고 번호를 붙인다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "사람이 손본 파일");

    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("우리가 만든 것"),
    });
    assert.deepEqual(saved, { status: "saved", fileName: "JUSUNG_현황_260930 (2).xlsx" });
    // 🔴 있던 파일은 한 글자도 바뀌지 않았다.
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "사람이 손본 파일");
  });

  test("내용이 똑같으면 새로 쓰지 않는다", async () => {
    const root = await makeRoot();
    const bytes = Buffer.from("같은 내용");
    const first = await savePortalExportFile({ root, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    const second = await savePortalExportFile({ root, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    assert.equal(first.status, "saved");
    assert.deepEqual(second, { status: "unchanged", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal((await readdir(root)).length, 1);
  });

  test("번호가 붙은 파일도 다음 날 직전 파일로 뽑힌다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "먼저");
    await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("나중"),
    });

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status === "found" ? found.fileName : null, "JUSUNG_현황_260930 (2).xlsx");
    assert.equal(found.status === "found" ? found.bytes.toString("utf8") : null, "나중");
  });

  test("루트가 없으면 아무것도 만들지 않는다", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "없는-폴더");
    const saved = await savePortalExportFile({
      root: missing,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("가짜"),
    });
    assert.equal(saved.status, "failed");
    assert.equal((await readdir(root)).length, 0);
  });

  test("이름 규칙에 안 맞는 이름으로는 저장하지 않는다", async () => {
    const root = await makeRoot();
    const saved = await savePortalExportFile({
      root,
      fileName: "../밖으로.xlsx",
      bytes: Buffer.from("가짜"),
    });
    assert.equal(saved.status, "failed");
    assert.equal((await readdir(root)).length, 0);
  });
});
