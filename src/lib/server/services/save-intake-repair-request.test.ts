import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { attachmentCategoryLabels } from "@/lib/domain/attachment-category";
import { contactFolderCategoryFolderName } from "@/lib/domain/contact-folder-naming";
import { INTAKE_REPAIR_REQUEST_CATEGORY } from "@/lib/domain/intake-repair-request";
import { saveIntakeRepairRequest } from "./save-intake-repair-request";

/*
 * ============================================================================
 * 접수와 함께 올라온 수리 의뢰서 — **연락서 폴더 안 「수리 의뢰서」 폴더**에 (2026-10-19)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 사내 공유폴더에 닿지
 * 않는다. 루트를 `root` 인자로 직접 넘기므로 `CONTACT_FOLDER_ARCHIVE_DIR` 을 보지
 * 않는다. 끝나면 만든 임시 폴더를 통째로 지운다. 고객사 · 모델 · S/N 은 가짜다.
 *
 * 못 박는 것:
 *  · 🔴 **「수리 의뢰서」 폴더 안**이다 — `공통` 도 `DATA` 도 연락서 폴더 바로
 *    아래도 아니다. 🔴 **폴더 이름을 글자로 적지 않고** 분류 이름표에서 뽑아 맞댄다.
 *  · 🔴 **연락서 폴더를 만들지 않는다** — 없으면 `no-folder`, 여럿이면 고르지 않는다.
 *  · 🔴 **덮어쓰지 않는다** — 같은 이름이 있으면 ` (2)` 로 비켜 가고 남의 파일은 그대로.
 *  · 🔴 **메일이 실패해도 파일은 그대로 남는다** — 이 길에 지우는 코드가 없다.
 *  · 설정이 비면 아무 일도 하지 않는다 · 결과에 경로 · 파일 이름이 없다.
 *
 * 꽂기의 공통 규율(NFC/NFD · 이름 길이 상한 · 번호 상한)은
 * lib/storage/contact-folder-copy.test.ts 가 본다 — 같은 `put` 을 지난다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "intake-repair-request-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const INTAKE = "D261019";
const FOLDER = "D261019 INVENIA T2RCONT-AD2 WN3947 1802034 점검요청";

/** 🔴 폴더 이름을 베끼지 않는다 — 분류 이름표에서 나온 값을 그대로 쓴다. */
const REQUEST_FOLDER = contactFolderCategoryFolderName(INTAKE_REPAIR_REQUEST_CATEGORY) ?? "";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function makeRootWithFolder(folderName: string = FOLDER): Promise<string> {
  const root = await makeRoot();
  await mkdir(path.join(root, folderName));
  return root;
}

function save(root: string, fileName: string, content: string) {
  return saveIntakeRepairRequest({ root, intakeNumber: INTAKE, fileName, bytes: bytes(content) });
}

describe("수리 의뢰서 — 어디에 꽂히는가", () => {
  test("🔴 연락서 폴더 **안의 「수리 의뢰서」 폴더**에 들어간다 — 이름은 분류 이름표에서 나온다", async () => {
    const root = await makeRootWithFolder();

    const saved = await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    assert.deepEqual(saved, { status: "copied" });
    // 🔴 「수리 의뢰서」라고 적어 굳히지 않는다 — 이름표가 바뀌면 이 시험도 따라온다.
    assert.equal(REQUEST_FOLDER, attachmentCategoryLabels[INTAKE_REPAIR_REQUEST_CATEGORY]);
    assert.deepEqual(await readdir(path.join(root, FOLDER)), [REQUEST_FOLDER], "하위 폴더가 그것 하나가 아니다");
    assert.deepEqual(
      await readdir(path.join(root, FOLDER, REQUEST_FOLDER)),
      ["수리의뢰서.pdf"],
      "🔴 「수리 의뢰서」 폴더 안에 없다"
    );
    assert.equal(
      await readFile(path.join(root, FOLDER, REQUEST_FOLDER, "수리의뢰서.pdf"), "utf8"),
      "%PDF-1.7 의뢰서",
      "바이트가 그대로 들어가지 않았다"
    );
  });

  test("🔴 `공통` 에도 `DATA` 에도 연락서 폴더 바로 아래에도 두지 않는다", async () => {
    const root = await makeRootWithFolder();

    await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    const inFolder = await readdir(path.join(root, FOLDER), { withFileTypes: true });
    assert.deepEqual(
      inFolder.filter((entry) => entry.isFile()).map((entry) => entry.name),
      [],
      "🔴 연락서 폴더 바로 아래에 파일이 생겼다"
    );
    assert.equal(inFolder.some((entry) => entry.name === "공통"), false, "`공통` 에 꽂았다");
    assert.equal(inFolder.some((entry) => entry.name === "DATA"), false, "`DATA` 에 꽂았다");
  });

  test("이미 있는 「수리 의뢰서」 폴더를 쓰고, 그 안의 남의 파일을 건드리지 않는다", async () => {
    const root = await makeRootWithFolder();
    await mkdir(path.join(root, FOLDER, REQUEST_FOLDER));
    await writeFile(path.join(root, FOLDER, REQUEST_FOLDER, "사람이 넣은 것.pdf"), "손으로 넣음");

    await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    assert.deepEqual(
      (await readdir(path.join(root, FOLDER, REQUEST_FOLDER))).sort(),
      ["사람이 넣은 것.pdf", "수리의뢰서.pdf"].sort()
    );
    assert.equal(
      await readFile(path.join(root, FOLDER, REQUEST_FOLDER, "사람이 넣은 것.pdf"), "utf8"),
      "손으로 넣음",
      "🔴 사람이 넣은 파일이 바뀌었다"
    );
  });
});

describe("수리 의뢰서 — 덮어쓰지 않는다 · 지우지 않는다", () => {
  test("🔴 같은 이름의 **다른** 파일이 있으면 ` (2)` 로 비켜 간다 — 남의 파일을 덮지 않는다", async () => {
    const root = await makeRootWithFolder();
    await mkdir(path.join(root, FOLDER, REQUEST_FOLDER));
    await writeFile(path.join(root, FOLDER, REQUEST_FOLDER, "수리의뢰서.pdf"), "남의 것");

    const saved = await save(root, "수리의뢰서.pdf", "%PDF-1.7 내 것");

    assert.deepEqual(saved, { status: "copied" });
    assert.equal(
      await readFile(path.join(root, FOLDER, REQUEST_FOLDER, "수리의뢰서.pdf"), "utf8"),
      "남의 것",
      "🔴 남의 파일을 덮어썼다"
    );
    assert.deepEqual((await readdir(path.join(root, FOLDER, REQUEST_FOLDER))).sort(), [
      "수리의뢰서 (2).pdf",
      "수리의뢰서.pdf",
    ]);
  });

  test("같은 내용이면 새로 쓰지 않는다 — 두 번 눌러도 ` (2)` 가 쌓이지 않는다", async () => {
    const root = await makeRootWithFolder();

    await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");
    const again = await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    assert.deepEqual(again, { status: "unchanged" });
    assert.deepEqual(await readdir(path.join(root, FOLDER, REQUEST_FOLDER)), ["수리의뢰서.pdf"]);
  });

  test("🔴 **메일이 실패해도 꽂은 파일은 그대로 남는다** — 이 길에 지우는 코드가 없다", async () => {
    const root = await makeRootWithFolder();

    // 꽂기는 메일보다 **앞**이다(services/create-repair-case.ts). 메일이 그 뒤에
    // 어떻게 실패하든 이 모듈은 다시 불리지 않고, 불려도 지우는 길이 없다.
    await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    // 메일 실패를 흉내 내는 자리가 없다 — 지우는 함수 자체를 내보내지 않기 때문이다.
    const exported = Object.keys(await import("./save-intake-repair-request"));
    assert.deepEqual(exported, ["saveIntakeRepairRequest"], "지우는 통로가 하나 생겼다");
    assert.equal(
      await readFile(path.join(root, FOLDER, REQUEST_FOLDER, "수리의뢰서.pdf"), "utf8"),
      "%PDF-1.7 의뢰서"
    );
  });
});

describe("수리 의뢰서 — 꽂지 않는 경우", () => {
  test("🔴 연락서 폴더가 없으면 **만들지 않는다** — `no-folder` 로 끝난다", async () => {
    const root = await makeRoot();

    const saved = await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    assert.deepEqual(saved, { status: "no-folder" });
    assert.deepEqual(await readdir(root), [], "🔴 폴더를 만들었다");
  });

  test("🔴 인수번호가 같은 폴더가 여럿이면 고르지 않는다 — `multiple`", async () => {
    const root = await makeRootWithFolder();
    await mkdir(path.join(root, `${INTAKE} 다른고객 ABC-1 LN1 SN1 점검요청`));

    const saved = await save(root, "수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    assert.deepEqual(saved, { status: "multiple" });
    assert.deepEqual(await readdir(path.join(root, FOLDER)), [], "어느 한쪽에 꽂았다");
  });

  test("설정이 비면 아무 일도 하지 않는다 — 이 기능만 꺼져 있다", async () => {
    const saved = await saveIntakeRepairRequest({
      root: "",
      intakeNumber: INTAKE,
      fileName: "수리의뢰서.pdf",
      bytes: bytes("%PDF-1.7"),
    });
    assert.deepEqual(saved, { status: "disabled" });
  });

  test("인수번호가 비면 디스크를 보지 않고 사유를 돌려준다 — 🔴 사유에 경로가 없다", async () => {
    const root = await makeRootWithFolder();

    const saved = await saveIntakeRepairRequest({
      root,
      intakeNumber: "  ",
      fileName: "수리의뢰서.pdf",
      bytes: bytes("%PDF-1.7"),
    });

    assert.equal(saved.status, "failed");
    if (saved.status !== "failed") return;
    for (const forbidden of [root, "\\", "/", "CONTACT_FOLDER_ARCHIVE_DIR"]) {
      assert.equal(saved.reason.includes(forbidden), false, `사유에 ${forbidden} 가 들어간다`);
    }
  });

  test("🔴 결과에 **파일 이름도 폴더 이름도** 담기지 않는다 — 부르는 쪽이 로그에 적는다", async () => {
    const root = await makeRootWithFolder();

    const saved = await save(root, "INVENIA 수리의뢰서.pdf", "%PDF-1.7 의뢰서");

    // 연락서 폴더 이름에는 고객사와 S/N 이 들어 있다 — 상태 코드만 나간다.
    assert.deepEqual(Object.keys(saved), ["status"], "결과에 칸이 하나가 아니다");
  });
});
