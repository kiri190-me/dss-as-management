import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH } from "@/lib/domain/contact-folder-naming";

/**
 * ============================================================================
 * [파일 올리기] 의 **[폴더 이름 (선택)]** — 화면이 그 규칙대로 배선돼 있는가 (2026-11-26)
 * ============================================================================
 * 🔴 **이 파일은 2026-11-18 의 `upload-file-name.test.ts` 가 이름을 바꾼 것**이다. 같은
 * 칸을 재고 있고, 그 칸의 뜻이 바뀌었다:
 *
 *   · ~2026-11-18  「설명 (선택)」
 *   · 2026-11-18   「파일 이름 (선택)」 — 「그 의미는 저장되는 파일의 이름을 설정하는
 *                  거고 거기에 작성되는 이름에 (1), (2) 로 번호가 붙도록 해줘.」
 *   · 2026-11-26   「폴더 이름 (선택)」 — 「파일 이름이 아니라 폴더 이름을 적는 자리로
 *                  바꿔서, 적힌 폴더 이름으로 분류 폴더 아래에 폴더를 만들고 파일은 그
 *                  안에 저장되도록 해줘. (안 적혀 있다면 그대로 분류 안에 저장되면 돼.)」
 *
 * ── 🔴 **없어진 기능과 함께 없어진 시험** ───────────────────────────────────
 * 2026-11-18 판에는 **이름 짓기 규칙**을 재는 절이 넷 있었다(번호 (1)(2)(3) · 확장자
 * 따라붙기 · 최종 이름의 길이 · 바뀐 이름 알림의 「→ 뒤」 갈아 끼우기). 🔴 **그 기능이
 * 없어져서 함께 없앴다** — 단언을 약하게 만든 것이 아니라, 재던 대상(`uploadFileNamesFor`
 * · `heicRenamesWithUploadNames` 가 든 upload-file-name.ts)이 **통째로 사라졌다.** 그
 * 사실 자체를 아래 「파일 이름을 정하는 길이 없다」 절이 값으로 못 박는다.
 *
 * 울타리(경로 글자 · 목록이 감추는 이름 · 길이 · 다듬으면 빈 글자)는 **도메인 쪽으로
 * 옮겨 갔다** — lib/domain/contact-folder-upload-folder-name.test.ts 가 같은 강도로 본다
 * (막는 함수가 화면과 통로가 함께 쓰는 한 자리이기 때문이다). 폴더가 **실제로 서는가**는
 * lib/storage/contact-folder-upload-folder.test.ts 가 임시 폴더에 꽂아 본다.
 *
 * ── 🔴 이 파일이 가장 세게 지키는 셋 ────────────────────────────────────────
 *  · **비워 두면 한 글자도 안 달라진다.** 안 적는 사람이 대부분이고, 그때 파일이 분류
 *    폴더 말고 다른 데로 가면 그것이 곧 사고다.
 *  · **파일 이름은 고른 그대로 올라간다.** 2026-11-18~11-26 사이에만 사람이 적은 이름이
 *    나갔고, 지금은 다시 `file.name` 이다.
 *  · **설명을 안 죽였다.** 2026-11-18 에 없앤 것은 **올릴 때 적는 칸 하나**뿐이었고,
 *    이번 조각도 그것을 되살리거나 더 없애지 않았다.
 * ============================================================================
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function read(...pieces: string[]): string {
  return readFileSync(path.join(here, ...pieces), "utf8").replace(/\r\n/g, "\n");
}

/** 주석을 뺀 코드 — 까닭을 적어 둔 머리말의 낱말에 셈이 걸리지 않게. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("🔴 화면에 「폴더 이름 (선택)」이 서고 「파일 이름 (선택)」은 없다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);
  /** 올리는 칸이 든 form — 아래 목록·뷰어 쪽 글자에 걸리지 않게 여기만 본다. */
  const form = screenCode.slice(
    screenCode.indexOf("onSubmit={handleUpload}"),
    screenCode.indexOf("</form>")
  );

  test("표본: 올리기 form 을 잘라 냈다", () => {
    assert.ok(form.length > 1000, `잘라 낸 것이 너무 짧다 — ${form.length}자`);
    assert.ok(form.includes(">분류<"), "분류 칸이 이 안에 없다");
  });

  test("새 칸의 이름표와 안내가 서 있다", () => {
    assert.ok(form.includes("폴더 이름 (선택)"), "이름표가 없다");
    assert.ok(form.includes("value={uploadFolder}"), "칸이 state 에 안 묶였다");
    // 🔴 **비우면 어떻게 되는지**가 사람이 보는 자리에 적혀 있어야 한다 — 두 곳이다
    //    (칸 안의 흐린 글씨 · 칸 아래 안내 줄).
    assert.ok(form.includes("비워 두면 분류 폴더에 바로"), "칸 안의 안내가 없다");
    assert.ok(form.includes("분류 폴더에 바로</strong> 들어갑니다"), "비웠을 때의 안내 줄이 없다");
    assert.ok(form.includes("분류 폴더 안에 그 이름의 폴더"), "적었을 때 무엇이 생기는지 안 적었다");
  });

  test("🔵 칸의 글자 수 상한이 공용 값이다 — 화면에 숫자를 적지 않는다", () => {
    assert.ok(
      form.includes("maxLength={CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH}"),
      "상한을 손으로 적었다"
    );
    // 🔴 그 값은 **경로 예산에서 뽑은 것**이다(domain 쪽 주석) — 숫자를 여기서 다시 짓지
    //    않되, 상한이 사라지지 않았는지는 값으로 본다.
    assert.ok(CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH > 0);
  });

  test("🔴 2026-11-18 의 [파일 이름 (선택)] 칸은 사라졌다 — (1)(2) 안내도 함께", () => {
    assert.ok(!form.includes("파일 이름 (선택)"), "파일 이름 칸이 그대로 있다");
    assert.ok(!form.includes("value={fileName}"), "파일 이름 state 가 칸에 묶인 채 남아 있다");
    assert.ok(!form.includes("(1) (2) 번호"), "없어진 번호 규칙을 아직 안내하고 있다");
    assert.ok(
      !screenCode.includes("한 장만 올리면 번호 없이"),
      "없어진 번호 규칙을 아직 안내하고 있다"
    );
  });

  test("🔴 올릴 때 적는 설명 칸은 (2026-11-18 에 없어진 채) 그대로 없다", () => {
    assert.ok(!form.includes("설명 (선택)"), "설명 칸이 돌아왔다");
    assert.ok(!form.includes("value={description}"), "설명 state 가 칸에 묶인 채 남아 있다");
    assert.ok(
      !form.includes("반입 당시 전면 패널 상태"),
      "설명 칸의 예시 글이 남아 있다 — 칸이 어딘가에 또 있다"
    );
  });
});

describe("🔴 파일 이름을 정하는 길이 **없어졌다** — 고른 이름 그대로 올라간다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);

  test("🔴 그 한 벌(upload-file-name.ts)이 저장소에 없다 — 되살아나면 여기서 걸린다", () => {
    assert.equal(
      existsSync(path.join(here, "upload-file-name.ts")),
      false,
      "없어진 모듈이 되살아났다 — 파일 이름을 정하는 기능은 2026-11-26 에 사용자가 거둔 것이다"
    );
    for (const gone of ["uploadFileNamesFor", "uploadFileNameError", "heicRenamesWithUploadNames"]) {
      assert.equal(screenCode.includes(gone), false, `화면이 없어진 것을 부른다: ${gone}`);
    }
  });

  test("🔴 통로로 가는 이름이 **고른 파일의 이름**이다", () => {
    assert.ok(
      screenCode.includes("new URLSearchParams({ category, fileName: file.name })"),
      "보내는 이름이 고른 파일의 것이 아니다"
    );
    // 🔴 보내기 고리는 파일만 넘긴다 — 이름을 따로 지어 넘기던 자리가 사라졌다.
    assert.ok(screenCode.includes("await uploadOne(file)"), "올리기 고리의 인자가 바뀌었다");
  });

  test("🔴 올린 뒤 한 장일 때의 알림도 **보낸 파일의 이름**이다 — 목록에 뜨는 그 이름", () => {
    assert.ok(
      screenCode.includes('`"${outgoing[0].name}"을(를) 올렸습니다.`'),
      "한 장일 때의 알림이 보낸 이름을 안 적는다"
    );
  });

  test("🔴 heic 바뀐 이름 알림은 **그대로 산다** — 갈아 끼우던 한 겹만 빠졌다", () => {
    assert.ok(
      screenCode.includes("heicNotice = heicConversionNotice(heicRenamed);"),
      "바뀐 이름을 사람에게 안 알린다"
    );
    assert.ok(screenCode.includes("heicRenamed = outcome.renamed"), "바뀐 이름을 안 모은다");
  });
});

describe("🔴 화면이 폴더 이름 규칙대로 배선돼 있다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);

  test("표본: 올리기 함수를 잘라 냈다", () => {
    assert.ok(screenCode.includes("async function handleUpload("), "handleUpload 를 못 찾았다");
  });

  test("🔴 적은 폴더 이름은 **굽기 전에** 한 번 걸러진다 — 몇 초를 들인 뒤 되돌리지 않는다", () => {
    const upload = screenCode.slice(screenCode.indexOf("async function handleUpload("));
    const check = upload.indexOf("checkContactFolderUploadFolderName(uploadFolder)");
    const convert = upload.indexOf("convertPickedHeic(files");
    assert.ok(check >= 0, "적은 폴더 이름을 미리 보지 않는다");
    assert.ok(convert > check, "사진을 구운 뒤에야 폴더 이름을 본다");
  });

  test("🔴 막는 판정도 글귀도 **통로와 같은 함수**에서 온다 — 한 시스템에 두 길을 두지 않는다", () => {
    assert.ok(
      screenCode.includes('from "@/lib/domain/contact-folder-upload-folder-name"'),
      "화면이 제 손으로 판정을 짓는다"
    );
    const route = readFileSync(
      path.join(here, "..", "..", "..", "app", "api", "repair-cases", "[id]", "attachments", "route.ts"),
      "utf8"
    );
    assert.ok(
      route.includes("checkContactFolderUploadFolderName(uploadFolderName)"),
      "통로가 같은 함수를 안 쓴다 — 화면이 말하는 것과 서버가 말하는 것이 갈라진다"
    );
  });

  test("🔴 **적었을 때만** 통로에 싣는다 — 안 적은 사람의 주소가 안 달라진다", () => {
    assert.ok(
      screenCode.includes('if (folder.length > 0) query.set("folder", folder);'),
      "폴더 칸을 늘 싣거나 아예 안 싣는다"
    );
    assert.ok(screenCode.includes("const folder = uploadFolder.trim();"), "앞뒤 공백을 안 걷는다");
  });

  test("🔴 올린 뒤에도 폴더 칸을 **비우지 않는다** — 분류와 같은 성격이다", () => {
    assert.equal(
      screenCode.includes('setUploadFolder("")'),
      false,
      "🔴 올린 뒤 폴더 칸을 비운다 — 한 폴더에 나눠 올리는 쓰임이 막힌다"
    );
    // 🔵 되돌아감 방지: 2026-11-18 의 [파일 이름] 칸은 비우는 것이 맞았다. 그 줄이
    //    이름만 바뀐 채 남아 있지 않은지 함께 본다.
    assert.equal(screenCode.includes('setFileName("")'), false, "없어진 칸을 비우는 줄이 남아 있다");
    // 🔴 그래도 **고른 파일**은 비운다 — 안 비우면 같은 파일이 두 번 올라간다.
    assert.ok(
      screenCode.includes("if (!fromCamera && fileInputRef.current) fileInputRef.current.value = \"\";"),
      "고른 파일을 안 비운다"
    );
  });
});

describe("🔴 설명 기능은 **안 죽였다** — 없앤 것은 올릴 때 적는 칸 하나뿐이다", () => {
  const repoRoot = path.join(here, "..", "..", "..", "..");
  const readRepo = (relative: string) =>
    readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n/g, "\n");

  test("통로는 지금도 `description` 을 받아 기록에 적는다", () => {
    const route = readRepo("src/app/api/repair-cases/[id]/attachments/route.ts");
    assert.ok(route.includes('searchParams.get("description")'), "통로가 설명을 안 받는다");
    assert.ok(route.includes("MAX_DESCRIPTION_LENGTH"), "설명 길이 상한이 사라졌다");
    assert.ok(/createAttachmentRecord\(\{[\s\S]*?\n\s*description,/.test(route), "기록에 안 적는다");
  });

  test("목록이 설명을 그대로 보여 주고, 설명으로 **찾기**도 그대로다", () => {
    const list = readRepo("src/components/repair-cases/files/StoredAttachmentList.tsx");
    assert.ok(list.includes("{item.description}"), "목록에서 설명이 사라졌다");
    assert.ok(list.includes("파일명·설명 검색"), "설명으로 찾는 길이 사라졌다");
  });

  test("뷰어가 설명을 그대로 보여 준다", () => {
    const viewer = readRepo("src/components/repair-cases/files/AttachmentViewer.tsx");
    assert.ok(viewer.includes("current.description"), "뷰어에서 설명이 사라졌다");
  });

  /**
   * 🔵 **「설명 수정」 창은 데모 화면(DemoFilesScreen)에만 서 있다** — 실제 저장 화면에는
   *    2026-11-18 **이전에도** 설명을 고치는 단추가 없었다(목록은 보여 주기만 한다).
   *    이 조각이 그것을 없앤 것이 아니라는 뜻이고, 그래서 재는 것도 「그대로 있는가」다.
   */
  test("「설명 수정」 창이 그대로 있다(데모 화면)", () => {
    const dialog = read("EditMetadataDialog.tsx");
    assert.ok(dialog.includes('description: { title: "설명 수정"'), "설명 수정 창이 사라졌다");
    const screen = read("FilesScreen.tsx");
    assert.ok(screen.includes('mode="description"'), "화면이 설명 수정 창을 안 세운다");
    assert.ok(screen.includes("updateDescription("), "설명 저장 길이 사라졌다");
  });
});

describe("🔴 2026-11-18 ① 없앤 안내 문구 셋 — 글자만 지웠다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);
  const camera = read("InAppCamera.tsx");
  const cameraCode = withoutComments(camera);

  test("🔴 앱 안 카메라의 「셔터를 누르는 만큼」 줄이 화면에서 사라졌다", () => {
    assert.ok(
      !cameraCode.includes("켜 두고 셔터를 누르는 만큼 계속 찍힙니다"),
      "안내 줄이 그대로 있다"
    );
    // 🔵 주석에는 **같은 말이 남아 있어야 한다** — 그 설계가 왜 그런지를 적은 머리말이고,
    //    이번에 바뀐 것은 화면이지 동작이 아니다. 주석까지 지우면 까닭이 사라진다.
    assert.ok(camera.includes("셔터를 누르는 만큼"), "머리말의 까닭까지 지웠다");
  });

  test("🔴 「각인·파형처럼」 줄이 사라졌다", () => {
    assert.ok(
      !screenCode.includes("각인·파형처럼 화질이 중요한 사진은"),
      "평소에 뜨던 화질 안내가 그대로 있다"
    );
    assert.ok(
      !screenCode.includes("앱 안 카메라는 미리보기 화질이라"),
      "평소에 뜨던 화질 안내가 그대로 있다"
    );
  });

  test("🔴 카메라를 **못 쓸 때**의 노란 줄은 남는다 — 그때는 그것이 유일한 길 안내다", () => {
    assert.ok(screenCode.includes("{cameraUnavailableReason && ("), "노란 줄까지 지웠다");
    assert.ok(
      screenCode.includes("폰 기본 카메라로 찍은 뒤 위의"),
      "카메라를 못 쓸 때의 대체 경로 안내가 사라졌다"
    );
  });

  test("🔴 카메라 기능 자체는 그대로다 — 켜는 단추 · 찍기 · 찍은 사진 고르기", () => {
    assert.ok(cameraCode.includes('"카메라 켜기"'), "카메라 켜는 단추가 사라졌다");
    assert.ok(cameraCode.includes("onCapture(file)"), "찍은 사진을 넘기는 길이 사라졌다");
    assert.ok(screenCode.includes("<InAppCamera"), "화면이 카메라를 안 세운다");
    assert.ok(screenCode.includes("onCapture={stagePhoto}"), "찍은 사진을 모으는 길이 사라졌다");
    assert.ok(screenCode.includes("찍은 사진 "), "찍어 둔 사진 수를 안 보여 준다");
  });
});
