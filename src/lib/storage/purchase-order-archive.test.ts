import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  PURCHASE_ORDER_ARCHIVE_SLOW_REASON,
  findPurchaseOrderArchiveFolder,
  resolvePurchaseOrderArchiveRoot,
  type PurchaseOrderArchiveResult,
} from "./purchase-order-archive";

/*
 * ============================================================================
 * **이 장비의 발주서 폴더 하나**를 찾아 읽는다 (2026-10-12)
 * ============================================================================
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 quote-archive-product-folders.test.ts 와 **같은 방법**):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      findPurchaseOrderArchiveFolder 는 설정(PURCHASE_ORDER_ARCHIVE_DIR)을 **아예 읽지
 *      않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolvePurchaseOrderArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 🔴 **고객사명 · 모델 · L/N · S/N 은 전부 가짜다**(저장소가 공개다) — 폴더 이름의 **모양만**
 * 사용자가 보여 준 실제 모양과 같다.
 *
 * 🔴 이 모듈은 **읽기만** 한다. 그래서 시험 하나가 「무엇도 만들거나 지우지 않았다」를
 * 통째로 본다(snapshot). 원본에 쓰기 · 지우기 낱말이 한 글자도 없다는 것은 이웃
 * purchase-order-archive-source.test.ts 가 글자로 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "purchase-order-archive-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 🔴 가짜 장비 한 대 — L/N 은 영문 2 + 숫자 4, S/N 은 숫자 7(실제 모양). */
const LOT = "AB1234";
const SERIAL = "1234567";

/** 발주 건 폴더 이름 — `<번호>. 내자 <YYYYMMDD>_<PO번호>_<모델>_<L/N>_<S/N> - <금액>원`. */
function poFolder(
  seq: number,
  date: string,
  lot: string = LOT,
  serial: string = SERIAL
): string {
  return `${seq}. 내자 ${date}_PO45003${seq}_MODEL-X1_${lot}_${serial} - 1,000,000원`;
}

/** 🔴 실제 외자 폴더 이름 — 날짜도 L/N 도 S/N 도 없다. */
const FOREIGN_FOLDER = "1. 외자 Purchase Order_GANA_CSOT_4500391219_JPY16,295,000";

async function makeFolder(root: string, ...segments: string[]): Promise<string> {
  const folder = path.join(root, ...segments);
  await mkdir(folder, { recursive: true });
  return folder;
}

function find(
  root: string | null | undefined,
  overrides: Partial<Parameters<typeof findPurchaseOrderArchiveFolder>[0]> = {}
): Promise<PurchaseOrderArchiveResult> {
  return findPurchaseOrderArchiveFolder({ root, lotNumber: LOT, serialNumber: SERIAL, ...overrides });
}

/** 지금 트리의 모든 칸 — 만들거나 지운 것이 있으면 달라진다(이웃 시험과 같은 방법). */
async function snapshot(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      found.push(entry.isDirectory() ? `${relative}/` : relative);
      if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
    }
  }
  await walk(root, "");
  return found.sort();
}

describe("발주서 폴더 찾기", () => {
  test("🔴 연도 폴더를 **전부** 훑어 가장 최근 폴더 하나를 읽는다", async () => {
    const root = await makeRoot();
    // 🔴 2024 연도 폴더에 든 **옛** 발주서.
    await makeFolder(root, "2024", "1. 가나전자", poFolder(50, "20240110"));
    // 🔴 **더 최근** 발주서가 **다른 연도 폴더 · 다른 고객사 폴더**에 들어 있다 — 폴더 이름의
    //    날짜(2025-12-23)와 연도 폴더 이름(2026)이 서로 다르다. 연도를 추측하면 못 찾는다.
    const newest = await makeFolder(root, "2026", "2. 다라전자", poFolder(101, "20251223"));
    await writeFile(path.join(newest, "발주서.pdf"), "x");
    await writeFile(path.join(newest, "Thumbs.db"), "x");

    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.relativePath, `2026/2. 다라전자/${poFolder(101, "20251223")}`);
    assert.equal(found.issuedDate, "2025-12-23");
    // 🔴 찌꺼기(Thumbs.db)는 **세기 전에** 빠진다.
    assert.deepEqual(
      found.entries.map((entry) => entry.name),
      ["발주서.pdf"]
    );
    assert.equal(found.totalCount, 1);
    assert.equal(found.truncated, false);
    // 🔴 돌려주는 값에 절대 경로가 없다.
    assert.equal(JSON.stringify(found).includes(root), false);
  });

  test("🔴 **외자 폴더는 후보에 안 들어간다** — 날짜도 L/N 도 S/N 도 없다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", FOREIGN_FOLDER);
    assert.deepEqual(await find(root), { status: "not-found" });
  });

  test("🔴 외자가 섞여 있어도 내자 폴더만 고른다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", FOREIGN_FOLDER);
    await makeFolder(root, "2026", "1. 가나전자", poFolder(2, "20260301"));

    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.relativePath, `2026/1. 가나전자/${poFolder(2, "20260301")}`);
  });

  test("🔴 같은 장비 폴더가 여럿이면 **날짜가 가장 최근인 것 하나**", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2025", "1. 가나전자", poFolder(1, "20250103"));
    await makeFolder(root, "2026", "1. 가나전자", poFolder(2, "20260215"));
    await makeFolder(root, "2026", "3. 마바전자", poFolder(3, "20251130"));

    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.issuedDate, "2026-02-15");
    assert.equal(found.relativePath, `2026/1. 가나전자/${poFolder(2, "20260215")}`);
  });

  test("🔴 날짜가 **같으면** `multiple` — 목록도 경로도 내지 않는다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215"));
    // 번호도 고객사도 다르지만 **날짜가 같다** — 어느 것이 이 건의 발주서인지 알 길이 없다.
    await makeFolder(root, "2026", "2. 다라전자", poFolder(9, "20260215"));
    // 더 오래된 것이 함께 있어도 결과는 같다(가린 뒤에 둘이 남는다).
    await makeFolder(root, "2025", "1. 가나전자", poFolder(1, "20250103"));

    const picked = await find(root);
    assert.deepEqual(picked, { status: "multiple" });
    // 🔴 값 자체에 경로도 줄도 없다 — 칸이 `status` 하나다.
    assert.deepEqual(Object.keys(picked), ["status"]);
  });

  test("🔴 다른 장비는 안 걸린다 — L/N 만 같고 S/N 이 다르다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215", LOT, "7654321"));
    await makeFolder(root, "2026", "1. 가나전자", poFolder(2, "20260216", "ZZ9999", SERIAL));
    assert.deepEqual(await find(root), { status: "not-found" });
  });

  test("🔴 대소문자 · 앞뒤 공백이 달라도 같은 장비로 본다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215", "ab1234", SERIAL));

    const found = await find(root, { lotNumber: " AB1234 ", serialNumber: SERIAL });
    assert.equal(found.status, "found");
  });

  test("🔴 연도 폴더가 아닌 맨 위 폴더는 훑지 않는다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "_작업중", "1. 가나전자", poFolder(1, "20260215"));
    assert.deepEqual(await find(root), { status: "not-found" });
  });

  test("🔴 L/N 이나 S/N 이 비면 **디스크를 아예 안 본다**", async () => {
    // 🔴 없는 폴더를 루트로 준다 — 디스크를 봤다면 `failed` 가 나왔을 것이다.
    const missing = path.join(await makeRoot(), "없는-폴더");
    for (const overrides of [
      { lotNumber: "" },
      { serialNumber: "" },
      { lotNumber: null },
      { serialNumber: undefined },
      { lotNumber: "-" },
    ]) {
      assert.deepEqual(await find(missing, overrides), { status: "not-found" }, JSON.stringify(overrides));
    }
    // 열쇠가 둘 다 있으면 그제야 디스크를 보고 실패한다 — 위가 「안 봤다」는 증거다.
    assert.equal((await find(missing)).status, "failed");
  });

  test("🔴 설정이 비면 `disabled` — 디스크를 보지 않는다", async () => {
    const before = process.env.PURCHASE_ORDER_ARCHIVE_DIR;
    delete process.env.PURCHASE_ORDER_ARCHIVE_DIR;
    try {
      assert.equal(resolvePurchaseOrderArchiveRoot(), null);
      assert.deepEqual(await findPurchaseOrderArchiveFolder({ lotNumber: LOT, serialNumber: SERIAL }), {
        status: "disabled",
      });
      // 빈 글자를 넘겨도 같다.
      assert.deepEqual(await find("   "), { status: "disabled" });
    } finally {
      if (before === undefined) delete process.env.PURCHASE_ORDER_ARCHIVE_DIR;
      else process.env.PURCHASE_ORDER_ARCHIVE_DIR = before;
    }
  });

  test("🔴 줄 수 상한 — 잘리면 잘렸다고 알린다", async () => {
    const root = await makeRoot();
    const folder = await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215"));
    await writeFile(path.join(folder, "a.pdf"), "x");
    await writeFile(path.join(folder, "b.pdf"), "x");

    const found = await find(root, { limit: 1 });
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.entries.length, 1);
    assert.equal(found.totalCount, 2);
    assert.equal(found.truncated, true);
  });

  test("🔴 기다리기 상한에 걸리면 `failed` — 사유에 경로가 없다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215"));

    const found = await find(root, { timeoutMs: 0 });
    assert.deepEqual(found, { status: "failed", reason: PURCHASE_ORDER_ARCHIVE_SLOW_REASON });
    assert.equal(PURCHASE_ORDER_ARCHIVE_SLOW_REASON.includes(path.sep), false);
  });

  test("🔴 **아무것도 만들지 않았다 · 지우지 않았다**", async () => {
    const root = await makeRoot();
    const folder = await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215"));
    await writeFile(path.join(folder, "발주서.pdf"), "x");
    await makeFolder(root, "2025", "2. 다라전자", FOREIGN_FOLDER);

    const before = await snapshot(root);
    await find(root);
    await find(root, { lotNumber: "ZZ9999" });
    assert.deepEqual(await snapshot(root), before);
  });
});

describe("바로 가기를 따라가지 않는다", () => {
  test("🔴 `.lnk` 바로 가기 **파일**은 폴더가 아니다 — 훑지 않는다", async () => {
    const root = await makeRoot();
    // 고객사 켜에 바로 가기 파일만 있고 진짜 폴더는 없다.
    await makeFolder(root, "2026");
    await writeFile(path.join(root, "2026", "임시 발주서 및 신용장 - 바로 가기.lnk"), "x");
    assert.deepEqual(await find(root), { status: "not-found" });
  });

  test("🔴 바로 가기(reparse point)를 따라가지 않는다 — 루트 **밖**으로 새지 않는다", async (t) => {
    const root = await makeRoot();
    // 루트 **밖**에 더 최근 발주서를 둔다 — 바로 가기를 고객사 폴더로 치고 그 안을 읽었다면
    // 이 2099 년 발주서가 걸렸을 것이다.
    const outside = await makeRoot();
    await makeFolder(outside, poFolder(9, "20991231"));
    // 루트 **안**에는 더 오래된 진짜 폴더 하나.
    await makeFolder(root, "2026", "1. 가나전자", poFolder(1, "20260215"));

    const link = path.join(root, "2026", "임시 발주서 및 신용장 - 바로 가기");
    try {
      await symlink(outside, link, "junction");
    } catch {
      t.skip("이 PC 에서는 바로 가기를 만들 수 없다 — 위 `.lnk` 시험이 같은 규율을 본다");
      return;
    }

    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    // 🔴 루트 밖의 2099 년 발주서가 아니라 **루트 안의** 2026 년 발주서다.
    assert.equal(found.issuedDate, "2026-02-15");
    assert.equal(found.relativePath, `2026/1. 가나전자/${poFolder(1, "20260215")}`);
  });
});
