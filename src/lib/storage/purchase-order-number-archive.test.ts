import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  PURCHASE_ORDER_ARCHIVE_SLOW_REASON,
  findPurchaseOrderArchiveFolder,
  resolvePurchaseOrderArchiveRoot,
} from "./purchase-order-archive";
import {
  findPurchaseOrderArchiveFolderByNumber,
  type PurchaseOrderNumberArchiveResult,
} from "./purchase-order-number-archive";

/*
 * ============================================================================
 * **이 번호의 발주 건 폴더 하나**를 찾아 읽는다 (2026-11-06)
 * ============================================================================
 * 🔴 **모든 시험이 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지 않는다.**
 * 그것을 보장하는 길이 둘이다(이웃 purchase-order-archive.test.ts 와 **같은 방법**):
 *   1. 디스크를 보는 시험은 전부 `root` 에 **임시 폴더를 직접 넘긴다.** 그 값이 있으면
 *      설정(PURCHASE_ORDER_ARCHIVE_DIR)을 **아예 읽지 않는다.**
 *   2. 설정을 읽는 길을 보는 시험(아래 `disabled`)은 그 환경변수를 **지우고** 부르고,
 *      부르기 전에 `resolvePurchaseOrderArchiveRoot() === null` 임을 먼저 확인한 뒤 되돌린다.
 * 끝나면 만든 임시 폴더를 통째로 지운다.
 *
 * 여기서 못 박는 것은 여섯이다:
 *  · 🔴 **번호로 찾는다** — 연도 폴더를 전부 훑고, 고객사 폴더는 지나가는 켜일 뿐이다
 *  · 🔴 **둘째 마디로 맞댄다** — 첫 마디의 날짜나 내용에 번호가 적힌 폴더는 안 걸린다
 *  · 🔴 **양식이 다른 번호 둘 다** 걸린다(9자리 · 10자리 SAP 꼴)
 *  · 🔴 번호가 없으면 **디스크를 아예 안 본다** · 같은 번호가 둘이면 `multiple`
 *  · 🔴 **수리 건 길이 바뀌지 않았다** — 같은 트리에서 그 길은 여전히 L/N · S/N 으로만 찾고,
 *    두 길이 **같은 연도 폴더를 같게 가린다**(두 벌이 된 판정이 갈라지지 않았다는 증거)
 *  · 🔴 아무것도 만들지 않고 지우지 않았다(snapshot)
 *
 * 🔴 고객사명 · 모델 · 번호 · L/N · S/N 은 전부 **가짜다**(저장소가 공개다) — 폴더 이름의
 * **모양만** 사용자가 보여 준 실제 모양과 같다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "purchase-order-number-archive-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

/** 🔴 가짜 번호 둘 — 양식이 고객사마다 다르다(9자리 · 10자리 SAP 꼴). */
const NUMBER = "PO261103031";
const SAP_NUMBER = "PO4500361248";
/** 🔴 가짜 장비 한 대 — 수리 건 길이 쓰는 열쇠다. */
const LOT = "AB1234";
const SERIAL = "1234567";

/** 기타건 발주 건 폴더 — `<번호>. 내자 <YYYYMMDD>_<PO번호>_<내용> - <금액>`. */
function otherFolder(seq: number, date: string, number: string = NUMBER, content = "(고객) 30kW 부속케이블 3SET"): string {
  return `${seq}. 내자 ${date}_${number}_${content} - 1,000,000원`;
}

/** 수리 건 발주 건 폴더 — 뒤 세 마디가 모델 · L/N · S/N 이다. 앞 세 마디는 위와 같다. */
function repairFolder(seq: number, date: string, number: string = SAP_NUMBER): string {
  return `${seq}. 내자 ${date}_${number}_MODEL-X1_${LOT}_${SERIAL} - 1,000,000원`;
}

async function makeFolder(root: string, ...segments: string[]): Promise<string> {
  const folder = path.join(root, ...segments);
  await mkdir(folder, { recursive: true });
  return folder;
}

function find(
  root: string | null | undefined,
  overrides: Partial<Parameters<typeof findPurchaseOrderArchiveFolderByNumber>[0]> = {}
): Promise<PurchaseOrderNumberArchiveResult> {
  return findPurchaseOrderArchiveFolderByNumber({ root, purchaseOrderNumber: NUMBER, ...overrides });
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

describe("번호로 발주 건 폴더 찾기", () => {
  test("🔴 연도 폴더를 **전부** 훑는다 — 고객사 폴더는 지나가는 켜일 뿐이다", async () => {
    const root = await makeRoot();
    // 다른 번호의 발주 건이 다른 연도 · 다른 고객사에 흩어져 있다.
    await makeFolder(root, "2024", "1. 가나전자", otherFolder(50, "20240110", SAP_NUMBER));
    // 🔴 찾는 번호의 폴더는 **폴더 이름의 해와 다른 연도 폴더**에 들어 있다(실측에 있는 일).
    const wanted = await makeFolder(root, "2026", "2. 다라전자", otherFolder(117, "20261103"));
    await writeFile(path.join(wanted, "발주서.pdf"), "x");
    await writeFile(path.join(wanted, "Thumbs.db"), "x");

    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.relativePath, `2026/2. 다라전자/${otherFolder(117, "20261103")}`);
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

  test("🔴 **둘째 마디로 맞댄다** — 날짜 · 내용에 번호 비슷한 글자가 있어도 안 걸린다", async () => {
    const root = await makeRoot();
    // ① 내용 마디에 찾는 번호가 적혀 있다(사람이 「… 건」이라고 적어 둔 폴더).
    await makeFolder(root, "2026", "1. 가나전자", otherFolder(1, "20260102", SAP_NUMBER, `${NUMBER} 건 재발행분`));
    // ② 첫 마디(순번 · 날짜 자리)에 찾는 번호가 들어 있다.
    await makeFolder(root, "2026", "1. 가나전자", `${NUMBER}. 내자 20260103_PO4500360904_내용 - 1,000원`);
    // 🔵 못 — 이 둘은 이름 **안에** 찾는 번호를 실제로 갖고 있다(표본이 허수가 아니다).
    const names = await readdir(path.join(root, "2026", "1. 가나전자"));
    assert.equal(names.length, 2);
    for (const name of names) assert.ok(name.includes(NUMBER), name);

    assert.deepEqual(await find(root), { status: "not-found" });

    // 진짜 그 번호의 폴더를 하나 더 두면 **그것만** 걸린다.
    await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103"));
    const found = await find(root);
    assert.equal(found.status, "found");
    if (found.status !== "found") return;
    assert.equal(found.relativePath, `2026/1. 가나전자/${otherFolder(117, "20261103")}`);
  });

  test("🔴 **양식이 다른 번호 둘 다** 걸린다 — 모양을 못 박지 않았다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103", NUMBER));
    await makeFolder(root, "2026", "2. 다라전자", otherFolder(101, "20251223", SAP_NUMBER));

    for (const [number, expected] of [
      [NUMBER, `2026/1. 가나전자/${otherFolder(117, "20261103", NUMBER)}`],
      [SAP_NUMBER, `2026/2. 다라전자/${otherFolder(101, "20251223", SAP_NUMBER)}`],
    ] as const) {
      const found = await find(root, { purchaseOrderNumber: number });
      assert.equal(found.status, "found", number);
      if (found.status !== "found") return;
      assert.equal(found.relativePath, expected, number);
    }
  });

  test("🔴 같은 번호의 폴더가 둘이면 `multiple` — 목록도 경로도 내지 않는다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103"));
    // 번호만 같고 날짜 · 고객사 · 내용이 다르다 — 어느 것이 이 줄의 발주서인지 알 길이 없다.
    await makeFolder(root, "2025", "2. 다라전자", otherFolder(9, "20251103", NUMBER, "다른 내용"));

    const picked = await find(root);
    assert.deepEqual(picked, { status: "multiple" });
    // 🔴 값 자체에 경로도 줄도 없다 — 칸이 `status` 하나다.
    assert.deepEqual(Object.keys(picked), ["status"]);
  });

  test("🔴 대소문자 · 앞뒤 공백이 달라도 같은 번호로 본다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103", "po261103031"));
    assert.equal((await find(root, { purchaseOrderNumber: `  ${NUMBER}  ` })).status, "found");
  });

  test("🔴 쓸 수 있는 번호가 아니면 **디스크를 아예 안 본다**", async () => {
    // 🔴 없는 폴더를 루트로 준다 — 디스크를 봤다면 `failed` 가 나왔을 것이다.
    const missing = path.join(await makeRoot(), "없는-폴더");
    for (const purchaseOrderNumber of ["", "   ", null, undefined, "-"]) {
      assert.deepEqual(
        await find(missing, { purchaseOrderNumber }),
        { status: "not-found" },
        JSON.stringify(purchaseOrderNumber)
      );
    }
    // 번호가 쓸 수 있으면 그제야 디스크를 보고 실패한다 — 위가 「안 봤다」는 증거다.
    assert.equal((await find(missing)).status, "failed");
  });

  test("🔴 설정이 비면 `disabled` — 디스크를 보지 않는다", async () => {
    const before = process.env.PURCHASE_ORDER_ARCHIVE_DIR;
    delete process.env.PURCHASE_ORDER_ARCHIVE_DIR;
    try {
      assert.equal(resolvePurchaseOrderArchiveRoot(), null);
      assert.deepEqual(await findPurchaseOrderArchiveFolderByNumber({ purchaseOrderNumber: NUMBER }), {
        status: "disabled",
      });
      // 빈 글자를 넘겨도 같다.
      assert.deepEqual(await find("   "), { status: "disabled" });
    } finally {
      if (before === undefined) delete process.env.PURCHASE_ORDER_ARCHIVE_DIR;
      else process.env.PURCHASE_ORDER_ARCHIVE_DIR = before;
    }
  });

  test("🔴 바로 가기 **파일**은 폴더가 아니다 — 훑지 않는다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026");
    await writeFile(path.join(root, "2026", `${otherFolder(117, "20261103")}.lnk`), "x");
    assert.deepEqual(await find(root), { status: "not-found" });
  });

  test("🔴 줄 수 상한 — 잘리면 잘렸다고 알린다", async () => {
    const root = await makeRoot();
    const folder = await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103"));
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
    /**
     * 🔴 **훑을 거리를 만들어 둔다.** 상한(0ms)은 타이머라 **이벤트 루프가 한 바퀴 돌아야**
     * 걸리는데, 폴더 하나짜리 트리에서는 훑기가 그 전에 끝나 `found` 가 나온다(이 시험을
     * 쓰면서 실제로 그랬다 — 이웃 시험이 작은 트리로 통과하는 것은 운에 가깝다).
     * 연도 열 · 고객사 열이면 readdir 이 백 번을 넘어 **반드시** 상한이 먼저 걸린다.
     */
    for (let year = 2016; year < 2026; year += 1) {
      for (let customer = 1; customer <= 10; customer += 1) {
        await makeFolder(root, String(year), `${customer}. 가나전자`, otherFolder(customer, `${year}0103`));
      }
    }

    const found = await find(root, { timeoutMs: 0 });
    assert.deepEqual(found, { status: "failed", reason: PURCHASE_ORDER_ARCHIVE_SLOW_REASON });
    assert.equal(PURCHASE_ORDER_ARCHIVE_SLOW_REASON.includes(path.sep), false);
  });

  test("🔴 **아무것도 만들지 않았다 · 지우지 않았다**", async () => {
    const root = await makeRoot();
    const folder = await makeFolder(root, "2026", "1. 가나전자", otherFolder(117, "20261103"));
    await writeFile(path.join(folder, "발주서.pdf"), "x");

    const before = await snapshot(root);
    await find(root);
    await find(root, { purchaseOrderNumber: "PO0000000000" });
    assert.deepEqual(await snapshot(root), before);
  });
});

describe("🔴 수리 건 길은 그대로다 — 두 길이 서로의 자리를 침범하지 않는다", () => {
  test("같은 트리에서 수리 건 길은 **L/N · S/N 으로만** 찾는다", async () => {
    const root = await makeRoot();
    await makeFolder(root, "2026", "1. 가나전자", repairFolder(101, "20251223"));

    // 수리 건 길 — 장비로 찾는다(바뀌지 않았다).
    const byProduct = await findPurchaseOrderArchiveFolder({ root, lotNumber: LOT, serialNumber: SERIAL });
    assert.equal(byProduct.status, "found");
    // 🔴 그 길에 **번호를 넣어도** 걸리지 않는다 — 번호로 찾는 일은 그 모듈의 것이 아니다.
    assert.deepEqual(
      await findPurchaseOrderArchiveFolder({ root, lotNumber: SAP_NUMBER, serialNumber: SAP_NUMBER }),
      { status: "not-found" }
    );
    // 🔴 반대도 같다 — 번호 자리에 L/N 을 넣으면 안 걸린다(둘째 마디가 아니다).
    assert.deepEqual(await find(root, { purchaseOrderNumber: LOT }), { status: "not-found" });
    // 그 폴더의 **둘째 마디**로는 이쪽 길이 찾는다.
    assert.equal((await find(root, { purchaseOrderNumber: SAP_NUMBER })).status, "found");
  });

  test("🔴 두 길이 **같은 연도 폴더를 같게 가린다** — 두 벌이 된 판정이 갈라지지 않았다", async () => {
    /**
     * 맨 위 켜의 이름 판정(isYearFolder)은 두 모듈에 각각 있다 — 수리 건 쪽 것은 그 파일
     * 안에만 있어 꺼내려면 그 파일을 고쳐야 하고, 이 조각은 그 길을 건드리지 않았다. 그래서
     * **같게 가리는지**를 한 트리에서 둘을 나란히 돌려 본다.
     */
    /**
     * 🔵 표본에 **연도 범위의 양끝**이 들어 있어야 한다. 한때 2026 이 든 이름만 넣었더니,
     * 한쪽의 범위를 `2026~2026` 으로 좁혀도 이 시험이 **그대로 통과했다**(깨뜨려 보다 잡았다).
     */
    const tops = [
      "2026",
      "2026년",
      "1. 2026",
      "_작업중 2026",
      "2024",
      "2019년 발주서",
      "2000",
      "2099",
      "_작업중",
      "메모",
      "1999",
      "2100",
      "0001",
    ];
    const agreed: Array<[string, string]> = [];
    for (const top of tops) {
      const root = await makeRoot();
      // 🔴 **두 문법을 모두 갖춘** 이름 하나 — 번호(둘째 마디)도, L/N · S/N(마지막 둘)도 있다.
      await makeFolder(root, top, "1. 가나전자", repairFolder(101, "20251223"));
      const byNumber = await find(root, { purchaseOrderNumber: SAP_NUMBER });
      const byProduct = await findPurchaseOrderArchiveFolder({ root, lotNumber: LOT, serialNumber: SERIAL });
      assert.equal(byNumber.status, byProduct.status, `연도 폴더 판정이 갈라졌다: ${top}`);
      agreed.push([top, byNumber.status]);
    }
    // 🔵 못 — 표본에 **훑는 이름과 안 훑는 이름이 둘 다** 들어 있다. 한쪽뿐이면 「늘 같다」가
    //    공짜로 통과한다(판정을 통째로 뒤집어도 빨개지지 않는다).
    assert.ok(agreed.some(([, status]) => status === "found"), JSON.stringify(agreed));
    assert.ok(agreed.some(([, status]) => status === "not-found"), JSON.stringify(agreed));
  });
});
