import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { deriveExtensionFromFileName, MAX_FILE_NAME_LENGTH } from "@/lib/domain/local/attachments/filename";
import { convertPickedHeic, heicConversionNotice } from "./heic-upload";
import {
  UPLOAD_FILE_NAME_INVALID_MESSAGE,
  UPLOAD_FILE_NAME_MAX_LENGTH,
  UPLOAD_FILE_NAME_TOO_LONG_MESSAGE,
  heicRenamesWithUploadNames,
  uploadFileNameError,
  uploadFileNamesFor,
} from "./upload-file-name";

/**
 * ============================================================================
 * [파일 올리기] 의 **[파일 이름 (선택)]** — 번호 · 확장자 · 막는 글자 (2026-11-18)
 * ============================================================================
 * 사용자 요청 둘이 한 조각으로 들어왔다.
 *  ① 안내 문구 셋을 없앤다 — heic 한 줄(고르기 칸 아래) · 앱 안 카메라 두 줄.
 *     「설명은 없어도 될 것 같아.」
 *  ② 「[설명 (선택)]을 없애고 [파일 이름(선택)]으로 바꿔줘. 그 의미는 저장되는 파일의
 *     이름을 설정하는 거고 거기에 작성되는 이름에 (1), (2) 로 번호가 붙도록 해줘.」
 *     번호 규칙은 그 뒤에 셋으로 정해졌다 — 한 장이면 번호 없음 · 여럿이면 (1)(2)(3) ·
 *     비우면 지금까지와 똑같이 원래 파일 이름 그대로.
 *
 * ── 🔴 이 파일이 가장 세게 지키는 셋 ────────────────────────────────────────
 *  · **비워 두면 한 글자도 안 달라진다.** 적는 사람이 드물 칸이고, 안 적었을 때 이름이
 *    조금이라도 바뀌면 그것이 곧 사고다(목록에서 제 파일을 못 찾는다).
 *  · **경로 글자가 막힌다.** 이 이름은 표시만 하는 값이 아니라 **연락서 폴더에 실제로
 *    적히는 파일 이름**이 된다(upload-file-name.ts 머리말). 막는 자리는 새로 짓지 않고
 *    「표시 이름 변경」 창이 쓰는 `isSafeFileNameString` 을 그대로 쓴다 — 그 사실도 여기서
 *    값으로 잰다(같은 입력에 같은 판정인가).
 *  · **설명을 안 죽였다.** 없앤 것은 **올릴 때 적는 칸 하나**뿐이다. 이미 적힌 설명의
 *    표시도, 「설명 수정」도, 통로가 `description` 을 받는 것도 그대로여야 한다.
 *
 * ── 🔵 여기서 다시 재지 않는 것 ─────────────────────────────────────────────
 * heic 를 고를 수 있는가(accept) · 보내기 전에 굽는가 · 안내 줄이 사라졌는가는
 * heic-upload.test.ts 와 upload-panel-width.test.ts 가 이미 본다. 이 파일은 **이름이
 * 정해지는 규칙**과 **그 둘이 만나는 자리**(구운 뒤의 확장자 · 바뀐 이름 알림)만 본다.
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

/** 보낼 이름만 꺼낸다 — 실패하면 그 자리에서 까닭과 함께 멈춘다. */
function namesOf(baseName: string, fileNames: readonly string[]): string[] {
  const result = uploadFileNamesFor({ baseName, fileNames });
  assert.ok(result.ok, `이름을 못 지었다: ${result.ok ? "" : result.message}`);
  return result.names;
}

describe("🔴 비워 두면 지금까지와 똑같다 — 고른 이름이 그대로 올라간다", () => {
  test("빈 글자", () => {
    const picked = ["IMG_1234.jpg", "보고서.pdf", "확장자없음"];
    assert.deepEqual(namesOf("", picked), picked);
  });

  test("공백만 적은 것도 **안 적은 것과 같다**", () => {
    const picked = ["IMG_1234.jpg", "IMG_1235.jpg"];
    for (const blank of [" ", "   ", "\t", "\n", "　"]) {
      assert.deepEqual(namesOf(blank, picked), picked, `「${JSON.stringify(blank)}」이 이름으로 먹혔다`);
    }
  });

  test("🔵 공백만 적은 것은 **막히지도 않는다** — 올리기가 멈추면 안 된다", () => {
    for (const blank of ["", " ", "   ", "　"]) {
      assert.equal(uploadFileNameError(blank), null, `「${JSON.stringify(blank)}」에서 올리기가 막혔다`);
    }
  });

  test("🔵 안 적었으면 **같은 배열을 돌려주지 않는다**(복사본이다) — 부르는 쪽이 고쳐도 번지지 않게", () => {
    const picked = ["a.jpg"];
    const names = namesOf("", picked);
    assert.notEqual(names, picked);
    assert.deepEqual(names, picked);
  });
});

describe("🔴 번호 — 한 장이면 안 붙고, 여럿이면 (1)(2)(3)", () => {
  test("한 장이면 번호가 **안 붙는다**", () => {
    assert.deepEqual(namesOf("점검사진", ["IMG_1234.jpg"]), ["점검사진.jpg"]);
  });

  test("여러 장이면 고른 차례대로 (1)(2)(3)", () => {
    assert.deepEqual(namesOf("점검사진", ["a.jpg", "b.jpg", "c.jpg"]), [
      "점검사진 (1).jpg",
      "점검사진 (2).jpg",
      "점검사진 (3).jpg",
    ]);
  });

  test("🔴 두 자리에서도 규칙이 그대로다 — (10) 이지 (1)0 이 아니다", () => {
    const picked = Array.from({ length: 12 }, (_, index) => `IMG_${1000 + index}.jpg`);
    const names = namesOf("점검사진", picked);
    assert.equal(names.length, 12);
    assert.equal(names[9], "점검사진 (10).jpg");
    assert.equal(names[11], "점검사진 (12).jpg");
    // 🔵 열두 개가 **전부 다른 이름**이어야 한다 — 겹치면 연락서 폴더에서 덮어쓰기를
    //    막느라 엉뚱한 번호가 또 붙는다.
    assert.equal(new Set(names).size, 12, `이름이 겹친다: ${names.join(", ")}`);
  });

  test("🔵 번호는 **차례**다 — 받은 순서를 바꾸지 않는다", () => {
    const names = namesOf("사진", ["z.jpg", "a.jpg", "m.jpg"]);
    assert.deepEqual(names, ["사진 (1).jpg", "사진 (2).jpg", "사진 (3).jpg"]);
  });
});

describe("🔴 확장자는 **고른 파일의 것**이 따라붙는다", () => {
  test("사람이 안 적었으면 붙인다", () => {
    assert.deepEqual(namesOf("보고서", ["scan.pdf"]), ["보고서.pdf"]);
  });

  test("🔴 사람이 같은 확장자까지 적었으면 두 번 붙이지 않는다 — 대소문자를 접는다", () => {
    assert.deepEqual(namesOf("점검사진.jpg", ["a.jpg"]), ["점검사진.jpg"]);
    assert.deepEqual(namesOf("점검사진.JPG", ["a.jpg"]), ["점검사진.jpg"]);
    assert.deepEqual(namesOf("점검사진.jpg", ["a.JPG"]), ["점검사진.JPG"]);
    // 번호는 **확장자 앞**에 들어간다 — 이 저장소의 다른 번호 붙이기와 같은 모양이다
    // (domain/share-folder-naming.ts 의 numberedShareFolderFileName).
    assert.deepEqual(namesOf("점검사진.jpg", ["a.jpg", "b.jpg"]), [
      "점검사진 (1).jpg",
      "점검사진 (2).jpg",
    ]);
  });

  test("다른 확장자를 적었으면 그것은 이름의 일부다", () => {
    assert.deepEqual(namesOf("보고서.v2", ["a.jpg"]), ["보고서.v2.jpg"]);
  });

  test("🔴 확장자만 적었으면 그것이 줄기가 된다 — 줄기가 비면 통로가 415 로 되돌려보낸다", () => {
    // `.jpg` 를 떼면 이름이 `.jpg` 뿐이 되는데, 맨 앞의 점은 확장자 구분자가 아니라서
    // (deriveExtensionFromFileName) 서버가 확장자를 못 뽑는다 — 이상해 보여도 이쪽이 맞다.
    assert.deepEqual(namesOf(".jpg", ["a.jpg"]), [".jpg.jpg"]);
    assert.equal(deriveExtensionFromFileName(".jpg.jpg"), "jpg");
    assert.equal(deriveExtensionFromFileName(".jpg"), null, "맨 앞의 점이 확장자로 읽히게 바뀌었다");
  });

  test("고른 파일에 확장자가 없으면 아무것도 안 붙인다", () => {
    assert.deepEqual(namesOf("보고서", ["README"]), ["보고서"]);
    assert.deepEqual(namesOf("보고서", ["README", "LICENSE"]), ["보고서 (1)", "보고서 (2)"]);
  });

  test("🔵 확장자의 **경계**는 공용 함수와 같다 — 숨김 파일 · 끝의 점 · 점 없음", () => {
    for (const picked of ["README", ".gitignore", "끝에점.", "a.b.jpg", "IMG_1234.JPG"]) {
      const [name] = namesOf("이름", [picked]);
      const shared = deriveExtensionFromFileName(picked);
      if (shared === null) {
        assert.equal(name, "이름", `${picked}: 공용 함수는 확장자가 없다는데 붙었다 — ${name}`);
      } else {
        assert.equal(
          name.toLowerCase(),
          `이름.${shared}`,
          `${picked}: 공용 함수가 말하는 확장자(${shared})와 다르다 — ${name}`
        );
      }
    }
  });

  test("🔴 어느 경우에도 **고른 파일의 확장자가 그대로** 남는다 — 통로가 그것으로 판정한다", () => {
    const picked = ["a.jpg", "b.PNG", "c.pdf", "d.xlsx"];
    for (const base of ["", "점검사진", "점검사진.jpg", "보고서.v2"]) {
      const names = namesOf(base, picked);
      for (const [index, name] of names.entries()) {
        assert.equal(
          deriveExtensionFromFileName(name),
          deriveExtensionFromFileName(picked[index]),
          `base=「${base}」 ${picked[index]} → ${name}: 확장자가 바뀌었다`
        );
      }
    }
  });
});

describe("🔴 울타리 — 경로 글자 · 길이", () => {
  test("🔴 경로 글자가 막힌다 — 이 이름은 공유폴더에 **파일로 적힌다**", () => {
    for (const bad of ["../점검사진", "폴더/점검사진", "폴더\\점검사진", "a..b", "..", "점검사진/"]) {
      assert.equal(
        uploadFileNameError(bad),
        UPLOAD_FILE_NAME_INVALID_MESSAGE,
        `「${bad}」가 통과했다`
      );
      const result = uploadFileNamesFor({ baseName: bad, fileNames: ["a.jpg"] });
      assert.equal(result.ok, false, `「${bad}」로 이름을 지어 버렸다`);
    }
  });

  test("제어문자도 막힌다 — 파일 이름에 섞이면 탐색기에서 지우지도 못한다", () => {
    assert.equal(uploadFileNameError("점검\u0000사진"), UPLOAD_FILE_NAME_INVALID_MESSAGE);
    assert.equal(uploadFileNameError("점검\t사진"), UPLOAD_FILE_NAME_INVALID_MESSAGE);
    assert.equal(uploadFileNameError("점검\n사진"), UPLOAD_FILE_NAME_INVALID_MESSAGE);
  });

  test("🔵 가운데 **보통 공백**은 막지 않는다 — 「점검 사진」은 멀쩡한 이름이다", () => {
    assert.equal(uploadFileNameError("점검 사진"), null);
    assert.deepEqual(namesOf("점검 사진", ["a.jpg", "b.jpg"]), [
      "점검 사진 (1).jpg",
      "점검 사진 (2).jpg",
    ]);
  });

  test("🔵 막는 규칙이 「표시 이름 변경」과 **같은 함수**다 — 한 시스템에 두 길을 두지 않는다", () => {
    const source = read("upload-file-name.ts");
    assert.ok(source.includes("isSafeFileNameString("), "막는 판정을 새로 지었다");
    assert.ok(
      source.includes('from "@/lib/domain/local/attachments/filename"'),
      "공용 파일명 모듈을 안 쓴다"
    );
    const dialog = read("EditMetadataDialog.tsx");
    assert.ok(
      dialog.includes("isSafeFileNameString(trimmed, MAX_DISPLAY_NAME_LENGTH)"),
      "「표시 이름 변경」 쪽이 다른 판정으로 바뀌었다 — 두 길이 갈린다"
    );
  });

  test("🔴 번호와 확장자까지 붙인 **최종 이름**으로 길이를 잰다", () => {
    // 상한에 딱 맞는 줄기: 번호 꼬리 ` (1)`(4자)와 `.jpg`(4자)가 붙으면 넘친다.
    const base = "가".repeat(MAX_FILE_NAME_LENGTH - 4);
    const one = uploadFileNamesFor({ baseName: base, fileNames: ["a.jpg"] });
    assert.ok(one.ok, "한 장짜리는 상한 안에 들어온다");
    assert.equal(one.names[0].length, MAX_FILE_NAME_LENGTH);

    const many = uploadFileNamesFor({ baseName: base, fileNames: ["a.jpg", "b.jpg"] });
    assert.equal(many.ok, false, "번호가 붙어 넘쳤는데 그대로 보냈다");
    assert.equal(many.ok ? "" : many.message, UPLOAD_FILE_NAME_TOO_LONG_MESSAGE);
  });

  test("적은 이름 자체가 상한을 넘으면 **굽기 전에** 막힌다", () => {
    const tooLong = "가".repeat(UPLOAD_FILE_NAME_MAX_LENGTH + 1);
    assert.equal(uploadFileNameError(tooLong), UPLOAD_FILE_NAME_TOO_LONG_MESSAGE);
  });

  test("🔵 앞뒤 공백은 떼고 쓴다 — 적은 그대로 보내면 서버가 다시 떼어 둘이 어긋난다", () => {
    assert.deepEqual(namesOf("  점검사진  ", ["a.jpg"]), ["점검사진.jpg"]);
  });
});

describe("🔴 아이폰 사진(heic)과 만나는 자리 — 구운 **뒤**에 이름을 정한다", () => {
  const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });
  const convert = async () => JPEG;

  test("🔴 heic 를 골라도 최종 확장자는 .jpg 다 — 적은 이름 + 구운 확장자", async () => {
    const picked = [new File([new Uint8Array([1])], "IMG_1234.HEIC", { type: "image/heic" })];
    const outcome = await convertPickedHeic(picked, { convert });
    assert.deepEqual(
      outcome.renamed,
      [{ from: "IMG_1234.HEIC", to: "IMG_1234.jpg" }],
      "표본: 굽기가 안 돌았다"
    );

    const names = namesOf("보고서", outcome.files.map((file) => file.name));
    assert.deepEqual(names, ["보고서.jpg"]);
  });

  test("🔴 heic 와 jpg 를 섞어 골라도 번호는 **보내는 차례**로 이어진다", async () => {
    const picked = [
      new File([new Uint8Array([1])], "IMG_1.HEIC", { type: "image/heic" }),
      new File([new Uint8Array([2])], "사진.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([3])], "IMG_2.heic", { type: "" }),
    ];
    const outcome = await convertPickedHeic(picked, { convert });
    const names = namesOf("점검사진", outcome.files.map((file) => file.name));
    assert.deepEqual(names, ["점검사진 (1).jpg", "점검사진 (2).jpg", "점검사진 (3).jpg"]);
  });

  test("🔴 못 바꾼 장은 분모에서 빠진다 — 세 장을 골라 하나가 깨지면 (1)(2) 다", async () => {
    const picked = [
      new File([new Uint8Array([1])], "A.heic", { type: "image/heic" }),
      new File([new Uint8Array([2])], "B.heic", { type: "image/heic" }),
      new File([new Uint8Array([3])], "C.jpg", { type: "image/jpeg" }),
    ];
    let call = 0;
    const flaky = async () => {
      call += 1;
      if (call === 2) throw new Error("못 바꿨다");
      return JPEG;
    };
    const outcome = await convertPickedHeic(picked, { convert: flaky });
    assert.equal(outcome.failures.length, 1, "표본: 한 장이 빠지는 상황을 못 만들었다");
    assert.deepEqual(namesOf("점검사진", outcome.files.map((file) => file.name)), [
      "점검사진 (1).jpg",
      "점검사진 (2).jpg",
    ]);
  });

  test("🔴 바뀐 이름 알림의 「→ 뒤」가 **최종 이름**으로 바뀐다 — 안 그러면 거짓말이 된다", () => {
    const renamed = [
      { from: "IMG_1.HEIC", to: "IMG_1.jpg" },
      { from: "IMG_2.HEIC", to: "IMG_2.jpg" },
    ];
    const outgoing = ["IMG_1.jpg", "사진.jpg", "IMG_2.jpg"];
    const uploadNames = ["점검사진 (1).jpg", "점검사진 (2).jpg", "점검사진 (3).jpg"];

    assert.deepEqual(heicRenamesWithUploadNames(renamed, outgoing, uploadNames), [
      { from: "IMG_1.HEIC", to: "점검사진 (1).jpg" },
      { from: "IMG_2.HEIC", to: "점검사진 (3).jpg" },
    ]);

    const notice = heicConversionNotice(
      heicRenamesWithUploadNames(renamed, outgoing, uploadNames)
    );
    assert.ok(notice !== null);
    assert.ok(notice.includes("IMG_1.HEIC → 점검사진 (1).jpg"), notice);
    assert.ok(!notice.includes("→ IMG_1.jpg"), `목록에 없는 이름을 적었다: ${notice}`);
  });

  test("이름을 안 적었으면 알림이 **한 글자도 안 바뀐다**", () => {
    const renamed = [{ from: "IMG_1.HEIC", to: "IMG_1.jpg" }];
    const outgoing = ["IMG_1.jpg"];
    assert.deepEqual(heicRenamesWithUploadNames(renamed, outgoing, outgoing), renamed);
  });

  test("🔵 같은 이름이 두 장 섞여 있어도 앞의 것이 앞의 것과 짝지어진다", () => {
    const renamed = [
      { from: "a.heic", to: "같은이름.jpg" },
      { from: "b.HEIC", to: "같은이름.jpg" },
    ];
    const outgoing = ["같은이름.jpg", "같은이름.jpg"];
    const uploadNames = ["사진 (1).jpg", "사진 (2).jpg"];
    assert.deepEqual(heicRenamesWithUploadNames(renamed, outgoing, uploadNames), [
      { from: "a.heic", to: "사진 (1).jpg" },
      { from: "b.HEIC", to: "사진 (2).jpg" },
    ]);
  });

  test("🔵 길이가 어긋나면 지어내지 않고 받은 그대로 돌려준다", () => {
    const renamed = [{ from: "a.heic", to: "a.jpg" }];
    assert.deepEqual(heicRenamesWithUploadNames(renamed, ["a.jpg"], []), renamed);
  });
});

describe("🔴 화면이 이 규칙대로 배선돼 있다", () => {
  const screen = read("FilesScreen.tsx");
  const screenCode = withoutComments(screen);

  test("표본: 올리기 함수를 잘라 냈다", () => {
    assert.ok(screenCode.includes("async function handleUpload("), "handleUpload 를 못 찾았다");
  });

  test("🔴 적은 이름은 **굽기 전에** 한 번 걸러진다 — 몇 초를 들인 뒤 되돌리지 않는다", () => {
    const upload = screenCode.slice(screenCode.indexOf("async function handleUpload("));
    const check = upload.indexOf("uploadFileNameError(fileName)");
    const convert = upload.indexOf("convertPickedHeic(files");
    assert.ok(check >= 0, "적은 이름을 미리 보지 않는다");
    assert.ok(convert > check, "사진을 구운 뒤에야 이름을 본다");
  });

  test("🔴 이름 짓기는 굽기 **뒤**다 — 확장자가 거기서 .heic 에서 .jpg 로 갈린다", () => {
    const upload = screenCode.slice(screenCode.indexOf("async function handleUpload("));
    const convert = upload.indexOf("convertPickedHeic(files");
    const naming = upload.indexOf("uploadFileNamesFor({ baseName: fileName");
    const loop = upload.indexOf("for (const [index, file] of outgoing.entries())");
    assert.ok(naming > convert, "굽기 전에 이름을 짓는다 — .heic 이름에 jpeg 를 실어 보낸다");
    assert.ok(loop > naming, "보내기 시작한 뒤에 이름을 짓는다");
  });

  test("🔴 보낼 때 그 이름을 쓴다 — 파일 객체의 이름이 아니다", () => {
    assert.ok(screenCode.includes("uploadOne(file, uploadNames[index])"), "지은 이름을 안 넘긴다");
    assert.ok(
      screenCode.includes("fileName: uploadName"),
      "통로에 보내는 이름이 지은 이름이 아니다"
    );
  });

  test("🔴 바뀐 이름 알림도 지은 이름으로 다시 쓴다", () => {
    assert.ok(
      screenCode.includes("heicRenamesWithUploadNames(heicRenamed, outgoingNames, uploadNames)"),
      "바뀐 이름 줄이 옛 이름을 그대로 적는다"
    );
  });

  test("🔴 올린 뒤에는 이름 칸을 비운다 — 연달아 올릴 때 같은 이름이 또 붙는다", () => {
    assert.ok(screenCode.includes('setFileName("")'), "이름 칸이 안 비워진다");
  });

  test("🔵 칸의 글자 수 상한이 공용 값이다 — 화면에 숫자를 적지 않는다", () => {
    assert.ok(
      screenCode.includes("maxLength={UPLOAD_FILE_NAME_MAX_LENGTH}"),
      "상한을 손으로 적었다"
    );
  });
});

describe("🔴 화면에 「파일 이름 (선택)」이 서고 「설명 (선택)」은 없다", () => {
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
    assert.ok(form.includes("파일 이름 (선택)"), "이름표가 없다");
    assert.ok(form.includes("value={fileName}"), "칸이 state 에 안 묶였다");
    assert.ok(form.includes("(1) (2) 번호"), "번호 규칙을 사람이 볼 자리에 안 적었다");
    assert.ok(form.includes("한 장만 올리면 번호 없이"), "한 장일 때의 규칙을 안 적었다");
  });

  test("🔴 올릴 때 적는 설명 칸은 사라졌다", () => {
    assert.ok(!form.includes("설명 (선택)"), "설명 칸이 그대로 있다");
    assert.ok(!form.includes("value={description}"), "설명 state 가 칸에 묶인 채 남아 있다");
    assert.ok(
      !form.includes("반입 당시 전면 패널 상태"),
      "설명 칸의 예시 글이 남아 있다 — 칸이 어딘가에 또 있다"
    );
    assert.ok(
      !screenCode.includes("분류와 설명이 모두에 똑같이"),
      "없어진 칸을 가리키는 안내가 남아 있다"
    );
  });

  test("🔴 올리는 통로에 설명을 **더 이상 싣지 않는다** — 적는 칸이 없으니 보낼 것도 없다", () => {
    assert.ok(
      !screenCode.includes('query.set("description"'),
      "화면이 없는 칸의 값을 보내고 있다"
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

describe("🔴 ① 없앤 안내 문구 셋 — 글자만 지웠다", () => {
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
