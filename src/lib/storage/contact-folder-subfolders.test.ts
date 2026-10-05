import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  ATTACHMENT_CATEGORY_CODES,
  attachmentCategoryLabels,
  type AttachmentCategory,
} from "@/lib/domain/attachment-category";
import {
  CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH,
  CONTACT_FOLDER_DATA_FOLDER_NAME,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
  CONTACT_FOLDER_MAX_NAME_LENGTH,
  contactFolderName,
  type ContactFolderNamingInput,
} from "@/lib/domain/contact-folder-naming";
import { copyIntoContactFolder, createContactFolder } from "./contact-folder-archive";

/*
 * ============================================================================
 * 연락서 폴더 **안의 하위 폴더** — mkdtemp 임시 폴더에서만 (연락서 조각 11)
 * ============================================================================
 * 🔴 모든 시험은 OS 임시 폴더(mkdtemp)에서만 돈다 — 실제 공유폴더
 * (`\\192.168.0.222\…`)에 닿지 않는다. 끝나면 만든 임시 폴더를 통째로 지운다.
 * 고객사 · 모델 · S/N 은 가짜다(저장소가 공개다).
 *
 * 못 박는 것 — (가) `DATA`:
 *  · 🔴 **새로 만들 때만** 생긴다. **이미 있던 폴더에는 만들지 않는다** — 운영 공유폴더의
 *    660 여 개에 우리가 폴더를 한꺼번에 늘리면 안 된다
 *  · 🔴 이름은 **대괄호 없는 `DATA`** 다(사용자 글의 `[DATA]` 는 `[파일관리]` 처럼 화면
 *    요소를 가리키는 표기였고, 승인받은 그림에는 `DATA` 로 그려져 있었다)
 *  · 이미 `DATA` 가 있으면 **그대로 둔다** — 안에 든 것을 건드리지 않는다
 *
 * 못 박는 것 — (나) 분류 폴더:
 *  · 🔴 **없으면 만들고 있으면 쓴다** · 🔴 **쓰는 분류만** 그때그때 만든다(미리 만들지 않는다)
 *  · 🔴 폴더 이름은 **한글 이름표**다(`INTAKE_PHOTO` 가 아니라 `인수 사진`)
 *  · 🔴 같은 이름의 **파일**이 자리를 막고 있으면 실패로 끝내지 않고 **폴더 바로 아래**에
 *    꽂고 그 사실을 알린다 — 🔴 막은 파일을 지우지도 옮기지도 않는다
 *  · 🔴 분류 폴더가 한 겹 들어가고도 **경로 길이 상한**이 맞는다
 *
 * 꽂기 자체(덮어쓰지 않기 · NFC/NFD · 번호 상한)는 contact-folder-copy.test.ts 가,
 * 만들기 자체(인수번호로 먼저 찾기 · 루트를 안 만들기)는 contact-folder-create.test.ts 가,
 * 지우기 금지와 「DATA 가 곁다리다」는 contact-folder-archive-source.test.ts 가 본다.
 * ============================================================================
 */

const createdRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "contact-folder-subfolders-test-"));
  createdRoots.push(root);
  return root;
}

after(async () => {
  for (const root of createdRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

const NAMING: ContactFolderNamingInput = {
  intakeNumber: "D260908",
  customerName: "INVENIA",
  modelName: "T2RCONT-AD2",
  lotNumber: "WN3947",
  serialNumber: "1802034",
  reportedSymptom: "점검요청",
};

const INTAKE = NAMING.intakeNumber;
/** 🔴 기대하는 이름은 **domain 이 짓는 것 그대로**다 — 시험이 다시 짓지 않는다. */
const NAME = contactFolderName(NAMING);

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function entries(...segments: string[]): Promise<string[]> {
  return (await readdir(path.join(...segments))).sort();
}

/** 하위 폴더까지 걸어서 모은 한 벌 — 폴더는 뒤에 `/` 를 붙인다. */
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

function copy(root: string, category: AttachmentCategory, originalFileName: string, content: string) {
  return copyIntoContactFolder({ root, intakeNumber: INTAKE, category, originalFileName, bytes: bytes(content) });
}

// ── (가) DATA ───────────────────────────────────────────────────────────────

test("🔴 폴더를 새로 만들면 `DATA` 빈 폴더가 함께 생긴다 — 이름에 대괄호가 없다", async () => {
  const root = await makeRoot();

  const result = await createContactFolder({ root, naming: NAMING });

  assert.deepEqual(result, { status: "created", folderName: NAME });
  assert.deepEqual(await entries(root, NAME), ["DATA"]);
  // 🔴 값으로 못 박는다 — `[DATA]` 가 아니다.
  assert.equal(CONTACT_FOLDER_DATA_FOLDER_NAME, "DATA");
  assert.equal(/[[\]]/.test(CONTACT_FOLDER_DATA_FOLDER_NAME), false, "폴더 이름에 대괄호가 들어갔다");
  // 빈 폴더다 — 안에 아무것도 넣지 않는다.
  assert.deepEqual(await entries(root, NAME, "DATA"), []);
  assert.equal((await stat(path.join(root, NAME, "DATA"))).isDirectory(), true, "파일을 만들었다");
});

test("🔴 이미 있던 폴더에는 `DATA` 를 만들지 않는다 — 디스크가 한 글자도 안 바뀐다", async () => {
  const root = await makeRoot();
  // 사람이 적어 둔 이름(공백 두 칸 · 소문자)이라 앱이 지을 이름과 다르다.
  const human = "d260908  INVENIA 옛날에 만든 폴더";
  await mkdir(path.join(root, human));
  await writeFile(path.join(root, human, "연락서.xlsx"), "사람이 넣은 것");
  const before = await snapshot(root);

  const result = await createContactFolder({ root, naming: NAMING });

  assert.deepEqual(result, { status: "found", folderName: human });
  // 🔴 운영의 660 여 개에 DATA 가 한꺼번에 생기면 안 된다 — 여기서 그것을 막는다.
  assert.deepEqual(await snapshot(root), before, "🔴 이미 있던 폴더에 DATA 를 만들었다");
});

test("🔴 맞는 폴더가 여럿이면 아무것도 만들지 않는다 — DATA 도 없다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, "D260908 INVENIA 나중에 또 만든 폴더"));
  const before = await snapshot(root);

  const result = await createContactFolder({ root, naming: NAMING });

  assert.equal(result.status, "multiple", JSON.stringify(result));
  assert.deepEqual(await snapshot(root), before, "여럿인데 무엇인가 만들었다");
});

test("이미 `DATA` 가 있으면 그대로 둔다 — 사람이 넣어 둔 것이 그 안에 남는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, NAME, "DATA"));
  await writeFile(path.join(root, NAME, "DATA", "측정값.csv"), "사람이 넣은 것");

  const result = await createContactFolder({ root, naming: NAMING });

  assert.deepEqual(result, { status: "found", folderName: NAME });
  assert.deepEqual(await entries(root, NAME, "DATA"), ["측정값.csv"]);
  assert.equal(
    (await readFile(path.join(root, NAME, "DATA", "측정값.csv"))).toString("utf8"),
    "사람이 넣은 것",
    "🔴 DATA 안의 파일을 건드렸다"
  );
});

test("🔴 조각 5(사람이 눌러서)와 조각 7(접수 때)이 **같은 길**을 탄다 — DATA 가 둘로 갈라지지 않는다", () => {
  // 두 부르는 쪽 어디에도 `DATA` 라는 글자가 없다 — 만드는 규율은 storage 한 자리뿐이고,
  // 두 곳에 각각 적으면 한쪽만 고쳐져 갈라진다.
  const callers = {
    "조각 5 통로": new URL("../../app/api/repair-cases/[id]/contact-folder/route.ts", import.meta.url),
    "조각 7 후처리": new URL("../server/services/create-contact-folder.ts", import.meta.url),
  };
  for (const [what, url] of Object.entries(callers)) {
    // 주석을 뺀 코드만 본다 — 머리말이 까닭을 설명하느라 적은 낱말(mkdir …)에 걸리지 않게.
    const source = readFileSync(url, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.ok(source.includes("await createContactFolder({"), `${what}: storage 를 거치지 않는다`);
    // 낱말 경계로 본다 — `DATABASE_MODE_REQUIRED` 같은 남의 낱말에 걸리지 않게.
    assert.equal(
      new RegExp(`\\b${CONTACT_FOLDER_DATA_FOLDER_NAME}\\b`).test(source),
      false,
      `${what}: DATA 를 제 손으로 만든다`
    );
    assert.equal(/\bmkdir\b/.test(source), false, `${what}: 폴더를 제 손으로 만든다`);
  }
});

test("🔴 올리기는 `DATA` 를 만들지 않는다 — 만드는 것은 폴더를 처음 만들 때뿐이다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));

  const result = await copy(root, "INTAKE_PHOTO", "IMG_2847.jpg", "사진");

  assert.equal(result.status, "copied", JSON.stringify(result));
  assert.deepEqual(await entries(root, NAME), ["인수 사진"], "올리기가 DATA 를 만들었다");
});

// ── (나) 분류 폴더 ──────────────────────────────────────────────────────────

test("🔴 분류 폴더가 없으면 만들고 그 안에 꽂는다 — 폴더 맨 위에는 폴더만 선다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));

  const result = await copy(root, "INTAKE_PHOTO", "IMG_2847.jpg", "사진");

  assert.deepEqual(result, {
    status: "copied",
    folderName: NAME,
    fileName: "IMG_2847.jpg",
    categoryFolderName: "인수 사진",
    categoryFolderBlockedByFile: false,
  });
  assert.deepEqual(await snapshot(root), [`${NAME}/`, `${NAME}/인수 사진/`, `${NAME}/인수 사진/IMG_2847.jpg`]);
});

test("🔴 분류 폴더가 있으면 그것을 쓴다 — 안에 있던 파일을 건드리지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await mkdir(path.join(root, NAME, "인수 사진"));
  await writeFile(path.join(root, NAME, "인수 사진", "먼저.jpg"), "사람이 넣은 것");

  const result = await copy(root, "INTAKE_PHOTO", "IMG_2847.jpg", "사진");

  assert.equal(result.status, "copied", JSON.stringify(result));
  assert.deepEqual(await entries(root, NAME), ["인수 사진"], "폴더를 하나 더 만들었다");
  assert.deepEqual(await entries(root, NAME, "인수 사진"), ["IMG_2847.jpg", "먼저.jpg"]);
  assert.equal(
    (await readFile(path.join(root, NAME, "인수 사진", "먼저.jpg"))).toString("utf8"),
    "사람이 넣은 것",
    "🔴 먼저 있던 파일을 덮어썼다"
  );
});

test("🔴 쓰는 분류만 그때그때 생긴다 — 분류 전부를 미리 만들지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));

  await copy(root, "INTAKE_PHOTO", "IMG_2847.jpg", "사진");
  await copy(root, "QUOTE", "견적서_INVENIA.xlsx", "엑셀");

  // 올린 둘만 섰다 — 나머지 스물은 없다.
  assert.deepEqual(await entries(root, NAME), ["견적서", "인수 사진"]);
  assert.ok(ATTACHMENT_CATEGORY_CODES.length > 2, "시험 전제가 깨졌다 — 분류가 둘뿐이다");
});

test("🔴 폴더 이름은 **한글 이름표**다 — 코드(INTAKE_PHOTO)가 아니다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));

  // 수리 건에 붙을 수 있는 분류 가운데 모양이 다른 셋.
  const cases: AttachmentCategory[] = ["INTAKE_PHOTO", "PASS_SLIP", "OSCILLOSCOPE_DATA"];
  for (const category of cases) {
    const result = await copy(root, category, `${category}.jpg`, category);
    assert.equal(result.status, "copied", JSON.stringify(result));
    if (result.status !== "copied") throw new Error("unreachable");
    // 🔴 값으로 — 이름표는 attachment-category.ts 한 자리에만 있다.
    assert.equal(result.categoryFolderName, attachmentCategoryLabels[category]);
  }

  assert.deepEqual(await entries(root, NAME), ["오실로스코프 데이터", "인수 사진", "통문증"]);
  // 🔴 코드가 폴더 이름이 된 자리가 하나도 없다.
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    assert.equal((await entries(root, NAME)).includes(code), false, `코드가 폴더 이름이 되었다: ${code}`);
  }
});

test("🔴 같은 이름의 **파일**이 막고 있으면 폴더 바로 아래에 꽂고 알린다 — 그 파일을 지우지 않는다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  // 사람의 서류함에는 `견적서` 라는 **파일**이 있을 수 있다.
  await writeFile(path.join(root, NAME, "견적서"), "사람이 넣은 것");

  const result = await copy(root, "QUOTE", "견적서_INVENIA.xlsx", "엑셀");

  // 🔴 실패로 끝내지 않는다 — 파일은 폴더 바로 아래에 들어갔다.
  assert.deepEqual(result, {
    status: "copied",
    folderName: NAME,
    fileName: "견적서_INVENIA.xlsx",
    categoryFolderName: null,
    categoryFolderBlockedByFile: true,
  });
  assert.deepEqual(await entries(root, NAME), ["견적서", "견적서_INVENIA.xlsx"]);
  // 🔴 막고 있던 파일은 한 글자도 안 바뀌었다(지우지도 옮기지도 않는다).
  assert.equal((await readFile(path.join(root, NAME, "견적서"))).toString("utf8"), "사람이 넣은 것");
  assert.equal((await stat(path.join(root, NAME, "견적서"))).isFile(), true, "🔴 파일이 폴더가 되었다");
});

test("🔴 막힌 뒤에도 바로 아래에서 덮어쓰지 않는다 — ` (2)` 로 비켜 간다", async () => {
  const root = await makeRoot();
  await mkdir(path.join(root, NAME));
  await writeFile(path.join(root, NAME, "견적서"), "자리를 막은 파일");
  await writeFile(path.join(root, NAME, "견적서_INVENIA.xlsx"), "먼저 있던 것");

  const result = await copy(root, "QUOTE", "견적서_INVENIA.xlsx", "앱이 올린 것");

  assert.equal(result.status, "copied", JSON.stringify(result));
  if (result.status !== "copied") throw new Error("unreachable");
  assert.equal(result.fileName, "견적서_INVENIA (2).xlsx");
  assert.equal(
    (await readFile(path.join(root, NAME, "견적서_INVENIA.xlsx"))).toString("utf8"),
    "먼저 있던 것",
    "🔴 남의 파일을 덮어썼다"
  );
});

// ── 길이 상한 ──────────────────────────────────────────────────────────────

test("🔴 분류 폴더가 한 겹 들어가고도 가장 긴 경로가 엑셀의 218 자 안이다", () => {
  const longest = Math.max(...Object.values(attachmentCategoryLabels).map((label) => label.length));
  // 🔴 이름표가 길어지면 파일 이름 상한을 다시 뽑아야 한다 — 그 사실을 여기서 잡는다.
  assert.equal(longest, CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH, "가장 긴 분류 이름표가 상한과 다르다");

  // 운영 루트(49) + `\` + 폴더 이름(72) + `\` + 분류 폴더(10) + `\` + 파일 이름(84).
  // 🔴 셋을 **동시에** 가정한 최악이다(조각 6 이 N = 72 를 가정한 것과 같은 보수성).
  const worst =
    49 + 1 + CONTACT_FOLDER_MAX_NAME_LENGTH + 1 + CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH + 1 + CONTACT_FOLDER_FILE_MAX_NAME_LENGTH;

  assert.equal(worst, 218, "계산이 달라졌다 — 상한을 다시 뽑고 주석의 근거를 고칠 것");
  assert.ok(worst <= 218, `엑셀이 열지 못하는 길이다: ${worst} 자`);
  assert.ok(worst <= 260, `탐색기 한도를 넘는다: ${worst} 자`);
  // 조각 6 의 95 자를 그대로 두었다면 229 자가 되어 엑셀이 열지 못했다.
  assert.equal(CONTACT_FOLDER_FILE_MAX_NAME_LENGTH, 84, "파일 이름 상한이 분류 폴더를 셈에 넣지 않았다");
});

test("🔴 모든 분류 이름표가 폴더 이름으로 쓸 수 있는 모양이다", () => {
  for (const code of ATTACHMENT_CATEGORY_CODES) {
    const label = attachmentCategoryLabels[code];
    assert.ok(label.length > 0, `${code}: 이름표가 비었다`);
    assert.ok(
      label.length <= CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH,
      `${code}: 이름표가 ${label.length} 자다 — 상한을 다시 뽑을 것`
    );
    // 금지 글자 · 끝의 점이 있으면 다듬기가 모양을 바꾼다(지금은 하나도 없다).
    assert.equal(/[\\/:*?"<>|]/.test(label), false, `${code}: 이름표에 금지 글자가 있다`);
    assert.equal(/[.\s]$/.test(label), false, `${code}: 이름표가 점 · 공백으로 끝난다`);
  }
});
