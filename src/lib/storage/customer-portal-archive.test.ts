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

/**
 * ============================================================================
 * 🔴 저장 — 같은 이름이 있으면 **덮어쓴다** (사용자 결정 2026-09-30)
 * ============================================================================
 * 「같은 제목의 엑셀이 있다면 덮어씌워 달라」. 예전에는 ` (2)` 로 넘어갔다.
 * 덮어쓰면 사람이 손으로 고쳐 둔 내용이 사라지므로 **결과가 「새로 만듦(saved)」과
 * 「덮어씀(replaced)」을 가른다** — 화면이 그 둘을 다른 문장으로 말한다.
 * 🔴 견적서 저장(storage/quote-archive.ts)은 이 규칙과 무관하다 — 그쪽은 그대로
 * ` (2)` 로 넘어가고, 그 시험은 quote-archive.test.ts 가 따로 지킨다.
 * ============================================================================
 */
describe("저장 — 같은 이름이 있으면 덮어쓴다", () => {
  test("그 이름의 파일이 없으면 새로 만든다 — 결과는 saved", async () => {
    const root = await makeRoot();
    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("새 파일"),
    });
    assert.deepEqual(saved, { status: "saved", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "새 파일");
    // 찌꺼기(임시 파일)를 남기지 않는다.
    assert.deepEqual(await readdir(root), ["JUSUNG_현황_260930.xlsx"]);
  });

  test("🔴 같은 이름이 있으면 덮어쓴다 — 결과는 replaced, 번호를 붙이지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "먼저 저장한 것");

    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("우리가 만든 것"),
    });
    assert.deepEqual(saved, { status: "replaced", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "우리가 만든 것");
    // 🔴 ` (2)` 가 생기지 않았고 임시 파일도 남지 않았다 — 파일은 하나뿐이다.
    assert.deepEqual(await readdir(root), ["JUSUNG_현황_260930.xlsx"]);
  });

  test("🔴 「새로 만듦」과 「덮어씀」이 이어서 눌러도 갈린다", async () => {
    const root = await makeRoot();
    const first = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("첫째"),
    });
    const second = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("둘째"),
    });
    assert.equal(first.status, "saved");
    assert.equal(second.status, "replaced");
  });

  test("내용이 똑같으면 손대지 않는다 — 결과는 unchanged", async () => {
    const root = await makeRoot();
    const bytes = Buffer.from("같은 내용");
    const first = await savePortalExportFile({ root, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    const second = await savePortalExportFile({ root, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    assert.equal(first.status, "saved");
    assert.deepEqual(second, { status: "unchanged", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal((await readdir(root)).length, 1);
  });

  test("덮어쓴 파일이 다음 날 직전 파일로 뽑힌다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "먼저");
    await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("나중"),
    });

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status === "found" ? found.fileName : null, "JUSUNG_현황_260930.xlsx");
    assert.equal(found.status === "found" ? found.bytes.toString("utf8") : null, "나중");
  });

  test("🔴 예전에 만들어진 ` (2)` 파일은 그대로 둔다 — 지우지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "옛 첫째");
    await writeFile(path.join(root, "JUSUNG_현황_260930 (2).xlsx"), "옛 둘째");

    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("오늘 것"),
    });
    assert.equal(saved.status, "replaced");
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930 (2).xlsx"), "utf8"), "옛 둘째");
    assert.deepEqual((await readdir(root)).sort(), ["JUSUNG_현황_260930 (2).xlsx", "JUSUNG_현황_260930.xlsx"]);
  });

  test("🔴 ` (2)` 에 같은 바이트가 있어도 오늘 파일은 덮어쓴다 — 정본은 번호 없는 이름이다", async () => {
    const root = await makeRoot();
    const bytes = Buffer.from("오늘 것");
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "묵은 내용");
    await writeFile(path.join(root, "JUSUNG_현황_260930 (2).xlsx"), bytes);

    const saved = await savePortalExportFile({ root, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    assert.deepEqual(saved, { status: "replaced", fileName: "JUSUNG_현황_260930.xlsx" });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "오늘 것");
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

/**
 * ============================================================================
 * 🔴 덮어쓰다 실패하면 — 있던 파일은 그대로, 찌꺼기도 남기지 않는다
 * ============================================================================
 * 덮어쓰기는 **바꿔치기**다: 임시 이름(`~$…tmp`)에 다 쓴 뒤 rename 으로 제 이름에 밀어 넣는다.
 * 그래서 밀어 넣기가 막히면 있던 파일은 **한 글자도 바뀌지 않는다.** 여기서는 그 자리를 같은
 * 이름의 **폴더**가 차지하게 만들어 rename 을 막는다 — 실제로는 파일이 열려 있거나 권한이
 * 없을 때 같은 일이 일어난다(어느 쪽이든 원본을 먼저 비우지 않는 것이 요점이다).
 * ============================================================================
 */
describe("🔴 덮어쓰다 실패했을 때", () => {
  test("밀어 넣기가 막히면 실패로 끝나고, 있던 것은 그대로다 · 임시 파일을 남기지 않는다", async () => {
    const root = await makeRoot();
    // 같은 이름의 폴더가 자리를 차지하고 있다 — rename 이 거절한다.
    await mkdir(path.join(root, "JUSUNG_현황_260930.xlsx"));
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx", "안의 파일.txt"), "손대지 말 것");

    const saved = await savePortalExportFile({
      root,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("오늘 것"),
    });
    assert.equal(saved.status, "failed");
    assert.equal(saved.status === "failed" ? saved.reason.includes(root) : true, false, "사유에 경로가 들어 있다");

    // 자리에 있던 것은 그대로 · 임시 파일(`~$…`)이 남지 않았다.
    assert.deepEqual(await readdir(root), ["JUSUNG_현황_260930.xlsx"]);
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx", "안의 파일.txt"), "utf8"), "손대지 말 것");
  });

  test("🔴 남은 임시 파일이 있어도 직전 파일로 뽑히지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "~$dss-portal-남은것.tmp"), "반쯤 쓰인 것");
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "제대로 된 것");

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status === "found" ? found.fileName : null, "JUSUNG_현황_260930.xlsx");
  });
});
