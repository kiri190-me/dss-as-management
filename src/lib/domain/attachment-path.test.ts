import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  ATTACHMENT_MODEL_STORED_PATH_PREFIX,
  ATTACHMENT_STORED_PATH_PREFIX,
  AttachmentPathError,
  assertPortableStoredPath,
  buildAttachmentStoredPath,
  buildAttachmentStoredPathFromFileName,
  buildProductModelAttachmentPreviewPath,
  buildProductModelAttachmentStoredPath,
  buildProductModelAttachmentStoredPathFromFileName,
  isPortableStoredPath,
  resolveAttachmentAbsolutePath,
} from "./attachment-path";

/**
 * ============================================================================
 * 이 파일이 지키려는 것 — NAS로 옮긴 다음 날 알게 되는 종류의 고장
 * ============================================================================
 * 이 시스템은 나중에 사내 NAS(Docker, 컨테이너 안은 Linux)로 옮긴다. 개발은
 * Windows에서 한다. 아래 세 가지는 **Windows에서는 아무 문제 없이 돌아가다가
 * 옮긴 뒤에야 터지는** 종류라, 옮기기 전에 테스트로 못박아 둔다.
 *
 *   1. DB에 적는 구분자는 `/` 하나뿐이다. `repair-cases\abc\1.jpg`는 Linux에서
 *      폴더 하나의 이름이 되어 파일을 못 찾는다.
 *   2. 경로는 전부 소문자다. Windows는 대소문자를 같게 보지만 Linux는 다른
 *      파일로 본다 — 옮긴 뒤 일부만 안 열린다.
 *   3. 절대경로·드라이브 문자는 DB에 들어가지 않는다. `C:\DSS-AS-DATA`는
 *      컨테이너 안에 존재하지 않는다.
 *
 * 여기에 하나 더 — `..`가 어떤 경로로 들어와도 저장 루트를 벗어나지 못한다.
 *
 * 전부 **실제 파일 없이** 검증된다. 이 테스트는 디스크를 만지지 않는다.
 * ============================================================================
 */

const CASE_ID = "3f6c1b2a-7d4e-4a1b-9c8d-0e1f2a3b4c5d";
const ATTACHMENT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e";

// ─────────────────────────────────────────────── 규칙 1: 구분자는 '/' 뿐이다

test("stored_path의 구분자는 '/' 뿐이고 역슬래시가 섞이지 않는다", () => {
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "jpg",
  });
  assert.equal(stored, `repair-cases/${CASE_ID}/${ATTACHMENT_ID}.jpg`);
  assert.equal(stored.includes("\\"), false, "Linux는 역슬래시를 파일명의 일부로 읽는다");
  assert.equal(stored.split("/").length, 3);
});

test("Windows에서 만들어도 OS 구분자(path.sep)가 결과에 새어 들어오지 않는다", () => {
  // path.join을 쓰면 이 단언이 Windows에서만 깨진다 — 그게 정확히 막으려는 것이다.
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "pdf",
  });
  if (path.sep !== "/") {
    assert.equal(stored.includes(path.sep), false, `OS 구분자(${path.sep})가 DB 값에 들어갔다`);
  }
});

// ──────────────────────────────────────────────────── 규칙 2: 전부 소문자다

test("대문자 UUID를 넘겨도 stored_path는 소문자로 눕는다", () => {
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID.toUpperCase(),
    attachmentId: ATTACHMENT_ID.toUpperCase(),
    extension: "PNG",
  });
  assert.equal(stored, stored.toLowerCase());
  assert.equal(stored, `repair-cases/${CASE_ID}/${ATTACHMENT_ID}.png`);
});

test("대문자 확장자를 가진 원본 파일명도 소문자 확장자로 저장된다", () => {
  const stored = buildAttachmentStoredPathFromFileName({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    originalFileName: "인수 사진 A.JPG",
  });
  assert.ok(stored.endsWith(".jpg"), stored);
  assert.equal(stored, stored.toLowerCase());
});

test("한글·공백·특수문자가 든 원본 파일명이 디스크 경로에 들어가지 않는다", () => {
  // 디스크 이름은 첨부 ID다. 원본 이름은 original_file_name 컬럼에만 남는다.
  const stored = buildAttachmentStoredPathFromFileName({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    originalFileName: "교산 보고서 (최종) #2.pdf",
  });
  assert.equal(stored, `repair-cases/${CASE_ID}/${ATTACHMENT_ID}.pdf`);
  assert.equal(stored.includes("교산"), false);
  assert.equal(stored.includes(" "), false);
  assert.equal(stored.includes("#"), false);
});

// ────────────────────────────────────────── 규칙 3: 절대경로가 섞이지 않는다

test("stored_path는 상대 경로이고 드라이브 문자가 붙지 않는다", () => {
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "zip",
  });
  assert.equal(stored.startsWith("/"), false);
  assert.equal(/^[a-zA-Z]:/.test(stored), false, "C: 같은 드라이브 문자는 컨테이너 안에 없다");
  assert.equal(path.isAbsolute(stored), false);
  assert.ok(stored.startsWith(`${ATTACHMENT_STORED_PATH_PREFIX}/`));
});

// ─────────────────────────────────────── 만들 수 없는 값은 만들어지지 않는다

test("허용목록에 없는 확장자로는 경로를 만들 수 없다", () => {
  assert.throws(
    () =>
      buildAttachmentStoredPath({
        repairCaseId: CASE_ID,
        attachmentId: ATTACHMENT_ID,
        extension: "exe",
      }),
    AttachmentPathError
  );
});

test("UUID가 아닌 ID로는 경로를 만들 수 없다", () => {
  assert.throws(
    () =>
      buildAttachmentStoredPath({
        repairCaseId: "../../etc",
        attachmentId: ATTACHMENT_ID,
        extension: "jpg",
      }),
    AttachmentPathError
  );
  assert.throws(
    () =>
      buildAttachmentStoredPath({
        repairCaseId: CASE_ID,
        attachmentId: "local-demo-1",
        extension: "jpg",
      }),
    AttachmentPathError
  );
});

test("확장자를 알 수 없는 원본 파일명은 거부된다", () => {
  for (const name of ["README", "trailing.", ".hidden", "weird.타입"]) {
    assert.throws(
      () =>
        buildAttachmentStoredPathFromFileName({
          repairCaseId: CASE_ID,
          attachmentId: ATTACHMENT_ID,
          originalFileName: name,
        }),
      AttachmentPathError,
      name
    );
  }
});

// ──────────────────────────────── DB에서 읽은 값도 그대로 믿지 않는다

test("스스로 만든 경로는 언제나 검사를 통과한다", () => {
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "csv",
  });
  assert.doesNotThrow(() => assertPortableStoredPath(stored));
  assert.equal(isPortableStoredPath(stored), true);
});

test("옮길 수 없는 경로는 전부 거부된다", () => {
  const rejected = [
    "", // 빈 값
    "repair-cases\\case\\file.jpg", // 규칙 1 — 역슬래시
    "REPAIR-CASES/CASE/FILE.JPG", // 규칙 2 — 대문자
    `repair-cases/${CASE_ID}/${ATTACHMENT_ID}.JPG`, // 규칙 2 — 확장자만 대문자
    "/repair-cases/case/file.jpg", // 규칙 3 — 절대경로
    "c:/dss-as-data/uploads/x.jpg", // 규칙 3 — 드라이브 문자
    "repair-cases/../../windows/system32/config", // 상위 이동
    "repair-cases//double.jpg", // 빈 마디
    "repair-cases/./x.jpg", // 현재 디렉터리 마디
    "other-root/case/file.jpg", // 접두사 밖
  ];
  for (const value of rejected) {
    assert.equal(isPortableStoredPath(value), false, `거부돼야 한다: ${JSON.stringify(value)}`);
    assert.throws(() => assertPortableStoredPath(value), AttachmentPathError, value);
  }
});

// ─────────────────────────────────────────── 절대 경로 해석은 루트를 벗어나지 않는다

test("정상 경로는 저장 루트 아래의 절대 경로로 해석된다", () => {
  const root = path.resolve(path.sep === "/" ? "/srv/dss-as-data/uploads" : "C:\\DSS-AS-DATA\\uploads");
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "png",
  });

  const absolute = resolveAttachmentAbsolutePath(root, stored);
  assert.ok(path.isAbsolute(absolute));
  const relative = path.relative(root, absolute);
  assert.equal(relative.startsWith(".."), false, "루트 밖으로 나가면 안 된다");
  assert.ok(absolute.endsWith(`${ATTACHMENT_ID}.png`));
  // 디스크에 닿는 값이므로 여기서는 OS 구분자를 쓰는 것이 맞다.
  assert.ok(absolute.includes(`${path.sep}${ATTACHMENT_STORED_PATH_PREFIX}${path.sep}`));
});

test("'..'가 들어간 경로는 절대 경로 해석 단계에서도 루트를 벗어나지 못한다", () => {
  const root = path.resolve(path.sep === "/" ? "/srv/dss-as-data/uploads" : "C:\\DSS-AS-DATA\\uploads");
  for (const evil of [
    "repair-cases/../../secrets.txt",
    "repair-cases/case/../../../secrets.txt",
    "../uploads-shadow/x.jpg",
    "..",
  ]) {
    assert.throws(() => resolveAttachmentAbsolutePath(root, evil), AttachmentPathError, evil);
  }
});

test("저장 루트가 비어 있으면 조용히 기본값으로 넘어가지 않고 던진다", () => {
  const stored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "txt",
  });
  assert.throws(() => resolveAttachmentAbsolutePath("", stored), AttachmentPathError);
  assert.throws(() => resolveAttachmentAbsolutePath("   ", stored), AttachmentPathError);
});

/**
 * ============================================================================
 * 제품 모델 첨부 — 두 번째 접두어가 생겨도 규칙은 하나다
 * ============================================================================
 * 모델(장비 종류)에 외형 사진·회로도를 붙이면서 stored_path의 첫 마디가 둘이
 * 됐다. 아래 시험이 못박는 것은 두 가지다.
 *
 *   1. 모델 쪽 경로도 위의 규칙 1·2·3을 **똑같이** 지킨다 — 접두어만 다르고
 *      느슨해진 검사는 하나도 없다.
 *   2. 검사를 "넓혔다"는 것이 "아무거나 받는다"가 되지 않았다 — 알려진 접두어
 *      둘 말고 제3의 첫 마디는 여전히 거부된다.
 * ============================================================================
 */

const MODEL_ID = "b7e4d3c2-1a09-4f8e-8b7a-6c5d4e3f2a1b";

// ─────────────────────────────── 모델 경로의 모양과 규칙 1·2

test("모델 첨부의 stored_path는 product-models/{모델id}/{첨부id}.{확장자}다", () => {
  const stored = buildProductModelAttachmentStoredPath({
    productModelId: MODEL_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "jpg",
  });
  assert.equal(stored, `product-models/${MODEL_ID}/${ATTACHMENT_ID}.jpg`);
  assert.equal(stored.split("/").length, 3);
  assert.equal(stored.includes("\\"), false, "Linux는 역슬래시를 파일명의 일부로 읽는다");
  assert.ok(stored.startsWith(`${ATTACHMENT_MODEL_STORED_PATH_PREFIX}/`));
  if (path.sep !== "/") {
    assert.equal(stored.includes(path.sep), false, `OS 구분자(${path.sep})가 DB 값에 들어갔다`);
  }
});

test("모델 경로도 대문자 UUID·대문자 확장자를 소문자로 눕힌다", () => {
  const stored = buildProductModelAttachmentStoredPath({
    productModelId: MODEL_ID.toUpperCase(),
    attachmentId: ATTACHMENT_ID.toUpperCase(),
    extension: "PNG",
  });
  assert.equal(stored, stored.toLowerCase());
  assert.equal(stored, `product-models/${MODEL_ID}/${ATTACHMENT_ID}.png`);
});

test("모델 경로도 원본 파일명에서 확장자만 뽑아 소문자로 붙인다", () => {
  const stored = buildProductModelAttachmentStoredPathFromFileName({
    productModelId: MODEL_ID,
    attachmentId: ATTACHMENT_ID,
    originalFileName: "TG-350 외형 사진.JPG",
  });
  assert.equal(stored, `product-models/${MODEL_ID}/${ATTACHMENT_ID}.jpg`);
  assert.equal(stored, stored.toLowerCase());
  assert.equal(stored.includes("외형"), false, "원본 이름은 디스크 경로에 들어가지 않는다");
  assert.equal(stored.includes(" "), false);
});

test("모델 첨부의 미리보기 경로는 .preview.jpg로 끝난다", () => {
  const preview = buildProductModelAttachmentPreviewPath({
    productModelId: MODEL_ID,
    attachmentId: ATTACHMENT_ID,
  });
  assert.equal(preview, `product-models/${MODEL_ID}/${ATTACHMENT_ID}.preview.jpg`);
  assert.ok(preview.endsWith(".preview.jpg"));
  assert.equal(preview, preview.toLowerCase());
  assert.equal(isPortableStoredPath(preview), true);
});

// ─────────────────────── 만들 수 없는 값은 모델 쪽에서도 만들어지지 않는다

test("UUID가 아닌 모델 ID·첨부 ID로는 모델 경로를 만들 수 없다", () => {
  for (const badModelId of ["../../etc", "local-model-1", "", "TG-350"]) {
    assert.throws(
      () =>
        buildProductModelAttachmentStoredPath({
          productModelId: badModelId,
          attachmentId: ATTACHMENT_ID,
          extension: "jpg",
        }),
      AttachmentPathError,
      badModelId
    );
  }
  assert.throws(
    () =>
      buildProductModelAttachmentStoredPath({
        productModelId: MODEL_ID,
        attachmentId: "local-demo-1",
        extension: "jpg",
      }),
    AttachmentPathError
  );
  assert.throws(
    () =>
      buildProductModelAttachmentPreviewPath({
        productModelId: "not-a-uuid",
        attachmentId: ATTACHMENT_ID,
      }),
    AttachmentPathError
  );
});

test("허용목록에 없는 확장자로는 모델 경로도 만들 수 없다", () => {
  assert.throws(
    () =>
      buildProductModelAttachmentStoredPath({
        productModelId: MODEL_ID,
        attachmentId: ATTACHMENT_ID,
        extension: "exe",
      }),
    AttachmentPathError
  );
  for (const name of ["README", "trailing.", ".hidden", "weird.타입"]) {
    assert.throws(
      () =>
        buildProductModelAttachmentStoredPathFromFileName({
          productModelId: MODEL_ID,
          attachmentId: ATTACHMENT_ID,
          originalFileName: name,
        }),
      AttachmentPathError,
      name
    );
  }
});

// ──────────────── 검사는 두 접두어를 받고, 그 둘 말고는 여전히 거부한다

test("assertPortableStoredPath는 두 접두어를 모두 받는다", () => {
  const caseStored = buildAttachmentStoredPath({
    repairCaseId: CASE_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "pdf",
  });
  const modelStored = buildProductModelAttachmentStoredPath({
    productModelId: MODEL_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "pdf",
  });
  for (const stored of [caseStored, modelStored]) {
    assert.doesNotThrow(() => assertPortableStoredPath(stored), stored);
    assert.equal(isPortableStoredPath(stored), true, stored);
  }
  assert.notEqual(caseStored.split("/")[0], modelStored.split("/")[0]);
});

test("접두어를 넓힌 것이 '아무거나 받는다'가 되지 않았다 — 제3의 접두어는 거부된다", () => {
  const rejectedPrefixes = [
    `customers/${MODEL_ID}/${ATTACHMENT_ID}.jpg`,
    `products/${MODEL_ID}/${ATTACHMENT_ID}.jpg`,
    `product-model/${MODEL_ID}/${ATTACHMENT_ID}.jpg`, // 단수형 오타
    `product-models-old/${MODEL_ID}/${ATTACHMENT_ID}.jpg`,
    `repair-case/${CASE_ID}/${ATTACHMENT_ID}.jpg`, // 단수형 오타
    `${ATTACHMENT_ID}.jpg`, // 접두어 없음
  ];
  for (const value of rejectedPrefixes) {
    assert.equal(isPortableStoredPath(value), false, `거부돼야 한다: ${value}`);
    assert.throws(() => assertPortableStoredPath(value), AttachmentPathError, value);
  }
});

test("모델 접두어에서도 역슬래시·절대경로·'..'·대문자는 여전히 거부된다", () => {
  const rejected = [
    "product-models\\model\\file.jpg", // 규칙 1 — 역슬래시
    `product-models\\${MODEL_ID}\\${ATTACHMENT_ID}.jpg`,
    "PRODUCT-MODELS/MODEL/FILE.JPG", // 규칙 2 — 대문자
    `product-models/${MODEL_ID}/${ATTACHMENT_ID}.JPG`, // 규칙 2 — 확장자만 대문자
    "/product-models/model/file.jpg", // 규칙 3 — 절대경로
    "c:/product-models/model/file.jpg", // 규칙 3 — 드라이브 문자
    "product-models/../../windows/system32/config", // 상위 이동
    `product-models/${MODEL_ID}/../../secrets.txt`,
    "product-models//double.jpg", // 빈 마디
    "product-models/./x.jpg", // 현재 디렉터리 마디
  ];
  for (const value of rejected) {
    assert.equal(isPortableStoredPath(value), false, `거부돼야 한다: ${JSON.stringify(value)}`);
    assert.throws(() => assertPortableStoredPath(value), AttachmentPathError, value);
  }
});

test("모델 경로도 저장 루트 아래로만 해석되고 '..'로 루트를 벗어나지 못한다", () => {
  const root = path.resolve(path.sep === "/" ? "/srv/dss-as-data/uploads" : "C:\\DSS-AS-DATA\\uploads");
  const stored = buildProductModelAttachmentStoredPath({
    productModelId: MODEL_ID,
    attachmentId: ATTACHMENT_ID,
    extension: "png",
  });

  const absolute = resolveAttachmentAbsolutePath(root, stored);
  assert.ok(path.isAbsolute(absolute));
  assert.equal(path.relative(root, absolute).startsWith(".."), false, "루트 밖으로 나가면 안 된다");
  assert.ok(absolute.includes(`${path.sep}${ATTACHMENT_MODEL_STORED_PATH_PREFIX}${path.sep}`));

  for (const evil of [
    "product-models/../../secrets.txt",
    "product-models/model/../../../secrets.txt",
  ]) {
    assert.throws(() => resolveAttachmentAbsolutePath(root, evil), AttachmentPathError, evil);
  }
});
