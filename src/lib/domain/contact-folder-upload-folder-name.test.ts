import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH,
  CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER,
  CONTACT_FOLDER_MAX_NAME_LENGTH,
  CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH,
  contactFolderCopyFileName,
  contactFolderUploadFolderName,
} from "./contact-folder-naming";
import {
  CONTACT_FOLDER_UPLOAD_FOLDER_EMPTY_REASON,
  CONTACT_FOLDER_UPLOAD_FOLDER_HIDDEN_REASON,
  CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON,
  CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON,
  checkContactFolderUploadFolderName,
} from "./contact-folder-upload-folder-name";
import { isSafeFileNameString } from "./local/attachments/filename";
import { isIgnoredShareFolderEntryName } from "./share-folder-naming";

/*
 * ============================================================================
 * [파일 올리기]의 **「폴더 이름 (선택)」** — 거절과 다듬기 (2026-11-26)
 * ============================================================================
 * 사용자 요청: 「파일 이름이 아니라 폴더 이름을 적는 자리로 바꿔서, 적힌 폴더 이름으로
 * 분류 폴더 아래에 폴더를 만들고 파일은 그 안에 저장되도록 해줘. (안 적혀 있다면 그대로
 * 분류 안에 저장되면 돼.)」
 *
 * 🔴 적은 글자가 **사람의 공유폴더에 실제로 서는 폴더 이름**이 된다. 그래서 여기서 재는
 * 것은 모양새가 아니라 **디스크에 닿기 전의 두 겹**이다:
 *   ① 거절형 — 경로 글자 · 제어문자 · 목록이 감추는 이름 · 길이 · 다듬으면 빈 글자
 *   ② 치환형 — 거절을 지난 글자도 다듬기를 지난다(`:` · `*` 는 공백이 되고 끝의 점은 걷힌다)
 * 🔴 **판정을 베껴 적지 않았는지**도 값으로 본다 — 두 함수(isSafeFileNameString ·
 * isIgnoredShareFolderEntryName)를 같은 입력으로 맞대어 잰다. 베껴 적으면 규칙이 느는 날
 * 한쪽만 고쳐진다.
 *
 * 🔴 **경로 예산**도 여기서 못 박는다. 한 겹이 더 들어가면 파일 이름 상한이 84 → 63 자로
 * 내려가야 엑셀의 218 자 안에 들어온다 — 그 셈이 틀어지면 공유폴더의 파일이 **열리지
 * 않는다**(오류 없이, 그 파일을 여는 사람에게서만 드러난다).
 *
 * 폴더가 **실제로 서는가**는 storage/contact-folder-upload-folder.test.ts 가 임시 폴더에
 * 꽂아 보고, 화면 배선은 components/repair-cases/files/upload-folder-name.test.ts 가 본다.
 * 이 파일은 순수 함수만 본다 — 파일시스템도 DOM 도 없다.
 * ============================================================================
 */

describe("🔴 안 적으면 거절이 아니다 — 분류 폴더에 바로(지금까지와 같다)", () => {
  test("빈 글자 · 공백만 · null · undefined 가 전부 통과하고, 폴더 이름은 없다", () => {
    for (const blank of ["", " ", "   ", "\t", "　", null, undefined]) {
      assert.equal(
        checkContactFolderUploadFolderName(blank),
        null,
        `「${JSON.stringify(blank)}」에서 올리기가 막혔다`
      );
      assert.equal(
        contactFolderUploadFolderName(blank),
        null,
        `「${JSON.stringify(blank)}」로 폴더를 만들려 든다`
      );
    }
  });
});

describe("🔴 울타리 — 적은 글자가 디스크에 닿기 전에 걸린다", () => {
  test("🔴 경로 글자가 막힌다 — 여기서 만드는 것은 **폴더 한 겹**이지 경로가 아니다", () => {
    for (const bad of ["../측정", "1차/측정", "1차\\측정", "a..b", "..", "...", "측정/"]) {
      assert.equal(
        checkContactFolderUploadFolderName(bad),
        CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON,
        `「${bad}」가 통과했다`
      );
    }
    // 🔵 점 하나(`.`)는 **감추는 이름 쪽**에서 걸린다(점으로 시작한다) — 어느 겹에서
    //    걸리든 막히는 것이 중요하고, 글귀는 그 겹의 것이 나간다.
    assert.notEqual(checkContactFolderUploadFolderName("."), null, "「.」가 통과했다");
  });

  test("제어문자도 막힌다 — 폴더 이름에 섞이면 탐색기에서 지우지도 못한다", () => {
    for (const bad of ["1차\u0000측정", "1차\t측정", "1차\n측정"]) {
      assert.equal(checkContactFolderUploadFolderName(bad), CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON, bad);
    }
  });

  test("🔴 **목록이 감추는 이름**이 막힌다 — 만들었는데 화면에도 탐색기에도 안 보인다", () => {
    for (const bad of [".측정", ".DS_Store", "~$측정", "Thumbs.db", "thumbs.db", "desktop.ini"]) {
      assert.equal(
        checkContactFolderUploadFolderName(bad),
        CONTACT_FOLDER_UPLOAD_FOLDER_HIDDEN_REASON,
        `「${bad}」가 통과했다 — 만들어도 목록에 안 뜨는 폴더다`
      );
    }
  });

  test("🔴 다듬으면 아무것도 안 남는 이름이 막힌다 — 조용히 무시되면 안 된다", () => {
    for (const bad of [":::", "***", "???", " * ", '"<>|']) {
      assert.equal(
        checkContactFolderUploadFolderName(bad),
        CONTACT_FOLDER_UPLOAD_FOLDER_EMPTY_REASON,
        `「${bad}」가 통과했다 — 폴더가 안 생기는데 생긴 척한다`
      );
    }
  });

  test("길이 — 상한까지는 통과하고 한 자만 넘어도 막힌다", () => {
    const limit = "가".repeat(CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH);
    assert.equal(checkContactFolderUploadFolderName(limit), null, "상한에 딱 맞는 이름이 막혔다");
    assert.equal(
      checkContactFolderUploadFolderName(`${limit}가`),
      CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON
    );
    // 🔵 까닭 한 줄에 **그 숫자가 적혀 있어야** 사람이 몇 자까지인지 안다.
    assert.ok(
      CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON.includes(
        String(CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH)
      ),
      CONTACT_FOLDER_UPLOAD_FOLDER_TOO_LONG_REASON
    );
  });

  test("🔵 가운데 **보통 공백**은 막지 않는다 — 「1차 측정」은 멀쩡한 폴더 이름이다", () => {
    assert.equal(checkContactFolderUploadFolderName("1차 측정"), null);
    assert.equal(contactFolderUploadFolderName("1차 측정"), "1차 측정");
  });

  test("🔵 앞뒤 공백은 걷고 본다 — 적다가 남긴 공백 때문에 막히지 않는다", () => {
    assert.equal(checkContactFolderUploadFolderName("  1차 측정  "), null);
    assert.equal(contactFolderUploadFolderName("  1차 측정  "), "1차 측정");
  });

  test("🔴 막는 규칙을 **베껴 적지 않았다** — 공용 두 함수와 판정이 맞물린다", () => {
    // 표본이 비어서 공짜로 통과하지 않게, 두 함수가 **실제로 갈라 놓는** 표본을 먼저 센다.
    const samples = ["1차 측정", "../측정", ".측정", "~$측정", "Thumbs.db", "2026:11 점검"];
    assert.equal(
      samples.filter((value) => !isSafeFileNameString(value, CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH))
        .length,
      1,
      "표본이 바뀌었다"
    );
    // 🔵 넷이다 — `../측정` 은 **둘 다**에 걸린다(점으로 시작한다). 거절은 경로 쪽이
    //    먼저 하므로 아래 되풀이가 그 차례대로 본다.
    assert.equal(samples.filter((value) => isIgnoredShareFolderEntryName(value)).length, 4, "표본이 바뀌었다");

    for (const value of samples) {
      const reason = checkContactFolderUploadFolderName(value);
      if (!isSafeFileNameString(value, CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH)) {
        assert.equal(reason, CONTACT_FOLDER_UPLOAD_FOLDER_PATH_REASON, `${value}: 판정이 갈라졌다`);
      } else if (isIgnoredShareFolderEntryName(value)) {
        assert.equal(reason, CONTACT_FOLDER_UPLOAD_FOLDER_HIDDEN_REASON, `${value}: 판정이 갈라졌다`);
      }
    }
  });
});

describe("🔴 거절을 지난 글자도 **다듬기를 지난다** — 두 자가 겹쳐 선다", () => {
  test("경로를 깨지 않는 금지 글자는 공백이 된다 — 막지 않고 다듬는다", () => {
    assert.equal(checkContactFolderUploadFolderName("2026:11 점검"), null, "거절형이 너무 넓다");
    assert.equal(contactFolderUploadFolderName("2026:11 점검"), "2026 11 점검");
    assert.equal(contactFolderUploadFolderName("1차*측정?"), "1차 측정");
  });

  test("끝의 점은 걷힌다 — 윈도우가 받지 않는 이름이다", () => {
    assert.equal(contactFolderUploadFolderName("1차 측정."), "1차 측정");
    assert.equal(contactFolderUploadFolderName("1차 측정 . "), "1차 측정");
  });

  test("🔴 마지막 자리는 **자른다 · 던지지 않는다** — 거절 두 겹이 다 빠져도 예산이 지켜진다", () => {
    const tooLong = "가".repeat(CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH + 10);
    const made = contactFolderUploadFolderName(tooLong);
    assert.equal(made?.length, CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH, "상한을 넘는 폴더가 선다");
  });

  test("🔴 **감추는 이름은 폴더로도 안 짓는다** — 거절 한 겹이 빠져도 숨은 폴더가 안 선다", () => {
    for (const hidden of [".측정", "~$측정", "Thumbs.db", "desktop.ini"]) {
      assert.equal(
        contactFolderUploadFolderName(hidden),
        null,
        `「${hidden}」로 폴더를 짓는다 — 만들어도 목록에 안 뜬다`
      );
    }
  });

  test("한글은 모아쓴(NFC) 모양으로 나온다 — 디스크에 두 모양이 섞이지 않게", () => {
    const decomposed = "측정".normalize("NFD");
    assert.notEqual(decomposed, "측정", "표본: NFD 로 안 풀렸다");
    assert.equal(contactFolderUploadFolderName(decomposed), "측정");
  });
});

describe("🔴 경로 예산 — 한 겹이 늘면 파일 이름 상한이 내려간다", () => {
  test("🔴 폴더를 적었을 때의 가장 긴 경로가 엑셀의 218 자 안이다", () => {
    // 루트(49) + `\` + 폴더 이름(72) + `\` + 분류 폴더(10) + `\` + **적은 폴더(20)** +
    // `\` + 파일 이름(63). 🔴 넷을 **동시에** 가정한 최악이다(조각 11 과 같은 보수성).
    const worst =
      49 +
      1 +
      CONTACT_FOLDER_MAX_NAME_LENGTH +
      1 +
      CONTACT_FOLDER_CATEGORY_MAX_NAME_LENGTH +
      1 +
      CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH +
      1 +
      CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER;

    assert.equal(worst, 218, "계산이 달라졌다 — 상한을 다시 뽑고 주석의 근거를 고칠 것");
    assert.ok(worst <= 218, `엑셀이 열지 못하는 길이다: ${worst} 자`);
    assert.ok(worst <= 260, `탐색기 한도를 넘는다: ${worst} 자`);
    // 🔴 한 겹이 늘어난 만큼 **정확히** 내려갔다 — 폴더 이름 + 구분자 하나.
    assert.equal(
      CONTACT_FOLDER_FILE_MAX_NAME_LENGTH - CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER,
      CONTACT_FOLDER_UPLOAD_FOLDER_MAX_NAME_LENGTH + 1
    );
    assert.equal(CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER, 63);
  });

  test("🔴 폴더를 **안 적으면** 파일 이름 상한이 한 글자도 안 달라진다", () => {
    // 2026-11-26 전의 모든 부르는 쪽이 이 길이다 — 인자를 안 준다.
    const long = `${"가".repeat(200)}.jpg`;
    const before = contactFolderCopyFileName(long);
    assert.ok(before !== null);
    assert.equal(before.length, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH - " (999)".length);
  });

  test("🔴 폴더를 적으면 줄기가 그만큼 더 잘린다 — 확장자는 그대로다", () => {
    const long = `${"가".repeat(200)}.jpg`;
    const inFolder = contactFolderCopyFileName(long, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER);
    assert.ok(inFolder !== null);
    assert.equal(inFolder.length, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER - " (999)".length);
    assert.ok(inFolder.endsWith(".jpg"), `확장자가 잘렸다: ${inFolder}`);
  });

  test("🔵 짧은 이름은 **둘 다에서 한 글자도 안 달라진다** — 늘 자르는 것이 아니다", () => {
    for (const name of ["IMG_2847.jpg", "점검표.xlsx", "파형.csv"]) {
      assert.equal(contactFolderCopyFileName(name), name);
      assert.equal(
        contactFolderCopyFileName(name, CONTACT_FOLDER_FILE_MAX_NAME_LENGTH_IN_UPLOAD_FOLDER),
        name
      );
    }
  });
});
