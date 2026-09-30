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
      spec: JUSUNG,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("새 파일"),
    });
    assert.deepEqual(saved, {
      status: "saved",
      fileName: "JUSUNG_현황_260930.xlsx",
      // 옮길 옛 파일이 없었다 — OLD 폴더도 만들지 않았다.
      archived: { movedCount: 0, failedFileNames: [] },
    });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "새 파일");
    // 찌꺼기(임시 파일)를 남기지 않는다.
    assert.deepEqual(await readdir(root), ["JUSUNG_현황_260930.xlsx"]);
  });

  test("🔴 같은 이름이 있으면 덮어쓴다 — 결과는 replaced, 번호를 붙이지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "먼저 저장한 것");

    const saved = await savePortalExportFile({
      root,
      spec: JUSUNG,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("우리가 만든 것"),
    });
    assert.deepEqual(saved, {
      status: "replaced",
      fileName: "JUSUNG_현황_260930.xlsx",
      // 옮길 옛 파일이 없었다 — OLD 폴더도 만들지 않았다.
      archived: { movedCount: 0, failedFileNames: [] },
    });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "우리가 만든 것");
    // 🔴 ` (2)` 가 생기지 않았고 임시 파일도 남지 않았다 — 파일은 하나뿐이다.
    assert.deepEqual(await readdir(root), ["JUSUNG_현황_260930.xlsx"]);
  });

  test("🔴 「새로 만듦」과 「덮어씀」이 이어서 눌러도 갈린다", async () => {
    const root = await makeRoot();
    const first = await savePortalExportFile({
      root,
      spec: JUSUNG,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("첫째"),
    });
    const second = await savePortalExportFile({
      root,
      spec: JUSUNG,
      fileName: "JUSUNG_현황_260930.xlsx",
      bytes: Buffer.from("둘째"),
    });
    assert.equal(first.status, "saved");
    assert.equal(second.status, "replaced");
  });

  test("내용이 똑같으면 손대지 않는다 — 결과는 unchanged", async () => {
    const root = await makeRoot();
    const bytes = Buffer.from("같은 내용");
    const first = await savePortalExportFile({ root, spec: JUSUNG, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    const second = await savePortalExportFile({ root, spec: JUSUNG, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    assert.equal(first.status, "saved");
    assert.deepEqual(second, {
      status: "unchanged",
      fileName: "JUSUNG_현황_260930.xlsx",
      // 옮길 옛 파일이 없었다 — OLD 폴더도 만들지 않았다.
      archived: { movedCount: 0, failedFileNames: [] },
    });
    assert.equal((await readdir(root)).length, 1);
  });

  test("덮어쓴 파일이 다음 날 직전 파일로 뽑힌다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "먼저");
    await savePortalExportFile({
      root,
      spec: JUSUNG,
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
      spec: JUSUNG,
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

    const saved = await savePortalExportFile({ root, spec: JUSUNG, fileName: "JUSUNG_현황_260930.xlsx", bytes });
    assert.deepEqual(saved, {
      status: "replaced",
      fileName: "JUSUNG_현황_260930.xlsx",
      // 옮길 옛 파일이 없었다 — OLD 폴더도 만들지 않았다.
      archived: { movedCount: 0, failedFileNames: [] },
    });
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930.xlsx"), "utf8"), "오늘 것");
  });

  test("루트가 없으면 아무것도 만들지 않는다", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "없는-폴더");
    const saved = await savePortalExportFile({
      root: missing,
      spec: JUSUNG,
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
      spec: JUSUNG,
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
      spec: JUSUNG,
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

/**
 * ============================================================================
 * 🔴 저장한 뒤 — 날짜가 지난 파일을 `OLD` 로 옮긴다 (사용자 요청 2026-09-30)
 * ============================================================================
 * 「공유폴더에 저장을 눌렀을 때, 파일의 날짜가 다른 파일은 OLD 파일을 만들어서 거기로
 * 옮겨가도록 해줘.」 지금까지 사람이 손으로 하던 일이다.
 *
 * 🔴 여기서 지키는 것은 **사내 공유폴더의 파일이 사라지지 않는 것**이다. 되돌리려면 사람이
 * 손으로 해야 한다. 그래서 시험마다 옮기기 전후의 «내용»을 통째로 세어 맞춘다
 * (`assertNothingVanished`) — 「몇 개가 어디 있다」만 보면 덮어써서 없어진 것을 못 잡는다.
 * ============================================================================
 */

/** 루트와 그 아래 폴더의 **모든 파일**을 「상대 경로 → 내용」으로 읽는다(시험 전용). */
async function readAllFiles(root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const walk = async (folder: string, prefix: string): Promise<void> => {
    for (const dirent of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, dirent.name);
      if (dirent.isDirectory()) await walk(full, `${prefix}${dirent.name}/`);
      else if (dirent.isFile()) found.set(`${prefix}${dirent.name}`, await readFile(full, "utf8"));
    }
  };
  await walk(root, "");
  return found;
}

/**
 * 🔴 완료 기준 8) — **어떤 경우에도 파일이 사라지지 않는다.**
 * 이름이 아니라 «내용»을 센다. 파일이 `OLD` 로 자리를 옮기는 것은 괜찮지만, 그 내용이
 * 어디에도 없으면 안 된다(덮어썼거나 지웠다는 뜻이다).
 */
function assertNothingVanished(before: Map<string, string>, after: Map<string, string>): void {
  const leftovers = [...after.values()];
  for (const [name, text] of before) {
    const at = leftovers.indexOf(text);
    assert.ok(at >= 0, `${name} 의 내용이 사라졌다`);
    leftovers.splice(at, 1);
  }
}

const TODAY_FILE = "JUSUNG_현황_260930.xlsx";

/** 오늘 이름으로 저장한다 — 시험마다 되풀이되는 부분. */
function saveToday(root: string, text = "오늘 것") {
  return savePortalExportFile({ root, spec: JUSUNG, fileName: TODAY_FILE, bytes: Buffer.from(text) });
}

describe("🔴 저장한 뒤 날짜가 지난 파일을 OLD 로 옮긴다", () => {
  test("1) 옛 날짜 파일이 OLD 로 옮겨진다 — OLD 폴더가 없으면 만든다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "지지난 것");
    await writeFile(path.join(root, "JUSUNG_현황_260929.xlsx"), "어제 것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.equal(saved.status, "saved");
    assert.deepEqual(saved.archived, {
      movedCount: 2,
      failedFileNames: [],
    });

    assert.deepEqual((await readdir(root)).sort(), [TODAY_FILE, "OLD"].sort());
    assert.deepEqual(
      (await readdir(path.join(root, "OLD"))).sort(),
      ["JUSUNG_현황_260901.xlsx", "JUSUNG_현황_260929.xlsx"].sort()
    );
    // 옮긴 것은 내용 그대로다 — 새로 쓴 것이 아니다.
    assert.equal(await readFile(path.join(root, "OLD", "JUSUNG_현황_260929.xlsx"), "utf8"), "어제 것");
    assert.equal(await readFile(path.join(root, TODAY_FILE), "utf8"), "오늘 것");
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 2) 다른 고객사의 파일은 그대로 있다 — 한 폴더에 세 고객사가 산다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "ICD 정리 자료_260901.xlsx"), "ICD 옛것");
    await writeFile(path.join(root, "INVENIA_현황_260901.xlsx"), "INVENIA 옛것");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "JUSUNG 옛것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });

    assert.deepEqual(
      (await readdir(root)).sort(),
      ["ICD 정리 자료_260901.xlsx", "INVENIA_현황_260901.xlsx", TODAY_FILE, "OLD"].sort()
    );
    assert.deepEqual(await readdir(path.join(root, "OLD")), ["JUSUNG_현황_260901.xlsx"]);
    assert.equal(await readFile(path.join(root, "ICD 정리 자료_260901.xlsx"), "utf8"), "ICD 옛것");
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 3) 이름 규칙 밖의 파일은 그대로 있다 — 사람이 만든 임시본을 건드리지 않는다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG 임시본.xlsx"), "사람이 만든 것");
    await writeFile(path.join(root, "JUSUNG_사본.xlsx"), "날짜가 없다");
    await writeFile(path.join(root, "JUSUNG_현황_260901.pdf"), "엑셀이 아니다");
    await writeFile(path.join(root, "~$JUSUNG_현황_260901.xlsx"), "엑셀이 열어 둔 잠금 파일");
    await writeFile(path.join(root, "메모.txt"), "메모");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "이것만 옮긴다");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });

    assert.deepEqual(await readdir(path.join(root, "OLD")), ["JUSUNG_현황_260901.xlsx"]);
    assert.deepEqual(
      (await readdir(root)).sort(),
      [
        "JUSUNG 임시본.xlsx",
        "JUSUNG_사본.xlsx",
        "JUSUNG_현황_260901.pdf",
        "~$JUSUNG_현황_260901.xlsx",
        "메모.txt",
        TODAY_FILE,
        "OLD",
      ].sort()
    );
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("4) 오늘 날짜 파일은 그대로 있다 — ` (2)` 가 붙어 있어도 오늘 것이면 남긴다", async () => {
    const root = await makeRoot();
    // 옛 규칙으로 만들어진 오늘치 둘째 파일. 오늘의 기록이므로 우리가 치우지 않는다.
    await writeFile(path.join(root, "JUSUNG_현황_260930 (2).xlsx"), "오늘 둘째");
    await writeFile(path.join(root, "JUSUNG_현황_260929.xlsx"), "어제 것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });

    assert.deepEqual(
      (await readdir(root)).sort(),
      ["JUSUNG_현황_260930 (2).xlsx", TODAY_FILE, "OLD"].sort()
    );
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260930 (2).xlsx"), "utf8"), "오늘 둘째");
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 5) 저장이 실패하면 아무것도 옮기지 않는다 — 폴더가 비어 버리면 안 된다", async () => {
    const root = await makeRoot();
    // 같은 이름의 폴더가 자리를 차지해 바꿔치기가 막힌다(= 저장 실패).
    await mkdir(path.join(root, TODAY_FILE));
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "옛것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.equal(saved.status, "failed");

    // 🔴 OLD 폴더조차 만들지 않았고, 옛 파일은 있던 자리에 그대로다.
    assert.deepEqual((await readdir(root)).sort(), ["JUSUNG_현황_260901.xlsx", TODAY_FILE].sort());
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "utf8"), "옛것");
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 5) 루트가 사라져 저장이 실패해도 아무것도 옮기지 않는다", async () => {
    const root = await makeRoot();
    const missing = path.join(root, "없는-폴더");
    const saved = await savePortalExportFile({
      root: missing,
      spec: JUSUNG,
      fileName: TODAY_FILE,
      bytes: Buffer.from("오늘 것"),
    });
    assert.equal(saved.status, "failed");
    assert.deepEqual(await readdir(root), []);
  });

  test("🔴 6) OLD 에 같은 이름이 있으면 덮어쓰지 않고 ` (2)` 로 비켜 간다", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "OLD"));
    await writeFile(path.join(root, "OLD", "JUSUNG_현황_260901.xlsx"), "지난 기록");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "이번에 치울 것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });

    // 🔴 지난 기록이 그대로 살아 있고, 이번 것은 옆자리에 쌓였다.
    assert.deepEqual(
      (await readdir(path.join(root, "OLD"))).sort(),
      ["JUSUNG_현황_260901 (2).xlsx", "JUSUNG_현황_260901.xlsx"].sort()
    );
    assert.equal(await readFile(path.join(root, "OLD", "JUSUNG_현황_260901.xlsx"), "utf8"), "지난 기록");
    assert.equal(
      await readFile(path.join(root, "OLD", "JUSUNG_현황_260901 (2).xlsx"), "utf8"),
      "이번에 치울 것"
    );
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 6) ` (2)` 까지 차 있으면 ` (3)` 으로 간다 — 그래도 덮어쓰지 않는다", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "OLD"));
    await writeFile(path.join(root, "OLD", "JUSUNG_현황_260901.xlsx"), "지지난 기록");
    await writeFile(path.join(root, "OLD", "JUSUNG_현황_260901 (2).xlsx"), "지난 기록");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "이번 것");
    const before = await readAllFiles(root);

    await saveToday(root);
    assert.equal(
      await readFile(path.join(root, "OLD", "JUSUNG_현황_260901 (3).xlsx"), "utf8"),
      "이번 것"
    );
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 7) 옮기기가 실패해도 저장은 살아 있고, 못 옮긴 이름을 알린다", async () => {
    const root = await makeRoot();
    // `OLD` 자리를 **파일**이 차지하고 있다 — 폴더를 만들 수 없다(사람이 손으로 옮겨야 한다).
    await writeFile(path.join(root, "OLD"), "이건 폴더가 아니다");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "못 옮길 것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    // 🔴 저장은 성공이다 — 옮기기가 막혔다고 되돌리지 않는다.
    assert.equal(saved.status, "saved");
    assert.deepEqual(saved.archived, {
      movedCount: 0,
      failedFileNames: ["JUSUNG_현황_260901.xlsx"],
    });

    assert.equal(await readFile(path.join(root, TODAY_FILE), "utf8"), "오늘 것");
    assert.equal(await readFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "utf8"), "못 옮길 것");
    assert.equal(await readFile(path.join(root, "OLD"), "utf8"), "이건 폴더가 아니다");
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("🔴 OLD 안의 파일은 다시 보지 않는다 — 하위 폴더로 내려가지 않는다", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "OLD"));
    await mkdir(path.join(root, "OLD", "2025"));
    await writeFile(path.join(root, "OLD", "2025", "JUSUNG_현황_250101.xlsx"), "재작년 것");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "옛것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });
    assert.equal(
      await readFile(path.join(root, "OLD", "2025", "JUSUNG_현황_250101.xlsx"), "utf8"),
      "재작년 것"
    );
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("대소문자가 다른 old 폴더가 이미 있으면 그것을 쓴다 — 기록이 두 곳으로 갈리지 않게", async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, "old"));
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "옛것");

    await saveToday(root);
    assert.deepEqual((await readdir(root)).sort(), [TODAY_FILE, "old"].sort());
    assert.deepEqual(await readdir(path.join(root, "old")), ["JUSUNG_현황_260901.xlsx"]);
  });

  test("내용이 같아 손대지 않은(unchanged) 저장에서도 옛 파일은 치운다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, TODAY_FILE), "오늘 것");
    await writeFile(path.join(root, "JUSUNG_현황_260901.xlsx"), "옛것");
    const before = await readAllFiles(root);

    const saved = await saveToday(root);
    assert.equal(saved.status, "unchanged");
    assert.deepEqual(saved.archived, {
      movedCount: 1,
      failedFileNames: [],
    });
    assertNothingVanished(before, await readAllFiles(root));
  });

  test("옮길 것이 없으면 OLD 폴더를 만들지 않는다 — 빈 폴더를 남기지 않는다", async () => {
    const root = await makeRoot();
    const saved = await saveToday(root);
    assert.deepEqual(saved.status === "failed" ? null : saved.archived, {
      movedCount: 0,
      failedFileNames: [],
    });
    assert.deepEqual(await readdir(root), [TODAY_FILE]);
  });

  test("치운 뒤 직전 파일 고르기가 오늘 것을 집는다 — OLD 로 간 것은 후보에서 빠진다", async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, "JUSUNG_현황_260929.xlsx"), "어제 것");
    await saveToday(root);

    const found = await findLatestPortalExportFile({ root, spec: JUSUNG });
    assert.equal(found.status === "found" ? found.fileName : null, TODAY_FILE);
    assert.equal(found.status === "found" ? found.bytes.toString("utf8") : null, "오늘 것");
  });
});
