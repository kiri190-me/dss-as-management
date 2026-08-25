import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMissingFromBackup,
  isDestinationInsideSource,
  normalizeRelativePathKey,
  planCopies,
  shouldExcludeFromBackup,
} from "./attachment-backup-plan";

// ── 제외 규칙 ────────────────────────────────────────────────────────────

test("shouldExcludeFromBackup: .tmp-uploads 아래는 제외한다", () => {
  assert.equal(shouldExcludeFromBackup(".tmp-uploads/abc.part"), true);
  assert.equal(shouldExcludeFromBackup(".tmp-uploads/deep/abc.part"), true);
});

test("shouldExcludeFromBackup: 역슬래시로 적힌 .tmp-uploads도 제외한다", () => {
  assert.equal(shouldExcludeFromBackup(".tmp-uploads\\abc.part"), true);
});

test("shouldExcludeFromBackup: 이름만 닮은 폴더는 제외하지 않는다", () => {
  assert.equal(shouldExcludeFromBackup(".tmp-uploads-old/abc.jpg"), false);
  assert.equal(shouldExcludeFromBackup("tmp-uploads/abc.jpg"), false);
  assert.equal(shouldExcludeFromBackup("repair-cases/.tmp-uploads-backup/abc.jpg"), false);
});

test("shouldExcludeFromBackup: 보통의 첨부 경로는 남긴다", () => {
  assert.equal(shouldExcludeFromBackup("repair-cases/case-1/att-1.jpg"), false);
});

// ── 경로 눕히기 (Windows와 Linux가 갈리는 자리) ──────────────────────────

test("normalizeRelativePathKey: 구분자와 대소문자를 눕혀 같은 열쇠로 만든다", () => {
  assert.equal(
    normalizeRelativePathKey("Repair-Cases\\Case-1\\ATT-1.JPG"),
    "repair-cases/case-1/att-1.jpg"
  );
  assert.equal(
    normalizeRelativePathKey("./repair-cases//case-1/att-1.jpg"),
    "repair-cases/case-1/att-1.jpg"
  );
});

// ── 복사 계획 ────────────────────────────────────────────────────────────

test("planCopies: 백업에 없는 것만 고른다", () => {
  const planned = planCopies(
    ["repair-cases/c1/a.jpg", "repair-cases/c1/b.jpg"],
    ["repair-cases/c1/a.jpg"]
  );
  assert.deepEqual(planned, ["repair-cases/c1/b.jpg"]);
});

test("planCopies: 대소문자와 구분자가 달라도 이미 있는 파일로 알아본다", () => {
  const planned = planCopies(
    ["repair-cases\\C1\\A.JPG", "repair-cases/c1/b.jpg"],
    ["repair-cases/c1/a.jpg"]
  );
  assert.deepEqual(planned, ["repair-cases/c1/b.jpg"]);
});

test("planCopies: 원본 경로를 받은 그대로 돌려준다 (열 때 쓰는 값이므로)", () => {
  const planned = planCopies(["repair-cases\\C1\\A.JPG"], []);
  assert.deepEqual(planned, ["repair-cases\\C1\\A.JPG"]);
});

test("planCopies: .tmp-uploads는 계획에 오르지 않는다", () => {
  const planned = planCopies([".tmp-uploads/half.part", "repair-cases/c1/a.jpg"], []);
  assert.deepEqual(planned, ["repair-cases/c1/a.jpg"]);
});

test("planCopies: 같은 파일이 두 번 들어와도 한 번만 복사한다", () => {
  const planned = planCopies(["repair-cases/c1/a.jpg", "repair-cases/C1/A.jpg"], []);
  assert.deepEqual(planned, ["repair-cases/c1/a.jpg"]);
});

test("planCopies: 백업이 비어 있으면 전부 복사한다", () => {
  const planned = planCopies(["repair-cases/c1/a.jpg", "repair-cases/c1/b.jpg"], []);
  assert.deepEqual(planned, ["repair-cases/c1/a.jpg", "repair-cases/c1/b.jpg"]);
});

// ── 빠진 것 찾기 (핵심 안전장치) ─────────────────────────────────────────

test("findMissingFromBackup: DB에 있는데 백업에 없는 경로를 찾아낸다", () => {
  const missing = findMissingFromBackup(
    ["repair-cases/c1/a.jpg", "repair-cases/c1/a.preview.jpg", "repair-cases/c2/z.png"],
    ["repair-cases/c1/a.jpg", "repair-cases/c1/a.preview.jpg"]
  );
  assert.deepEqual(missing, ["repair-cases/c2/z.png"]);
});

test("findMissingFromBackup: 전부 있으면 빈 목록", () => {
  const missing = findMissingFromBackup(
    ["repair-cases/c1/a.jpg"],
    ["repair-cases/c1/a.jpg", "repair-cases/c9/orphan.jpg"]
  );
  assert.deepEqual(missing, []);
});

test("findMissingFromBackup: 대소문자·구분자 차이를 빠진 것으로 오해하지 않는다", () => {
  const missing = findMissingFromBackup(
    ["repair-cases/c1/a.jpg"],
    ["Repair-Cases\\C1\\A.JPG"]
  );
  assert.deepEqual(missing, []);
});

test("findMissingFromBackup: DB의 .tmp-uploads 경로는 걸러 내지 않고 드러낸다", () => {
  const missing = findMissingFromBackup([".tmp-uploads/weird.jpg"], []);
  assert.deepEqual(missing, [".tmp-uploads/weird.jpg"]);
});

// ── 목적지가 원본 안인가 (무한 복사 방지) ────────────────────────────────

test("isDestinationInsideSource: 같은 폴더면 true", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", "C:\\DSS-AS-DATA\\uploads"),
    true
  );
});

test("isDestinationInsideSource: 하위 폴더면 true", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", "C:\\DSS-AS-DATA\\uploads\\backup"),
    true
  );
  assert.equal(isDestinationInsideSource("/srv/uploads", "/srv/uploads/self/copy"), true);
});

test("isDestinationInsideSource: 실제 설정값 조합은 false", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", "C:\\DSS-AS-DATA\\backups\\uploads"),
    false
  );
});

test("isDestinationInsideSource: 이름만 닮은 이웃 폴더는 false", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", "C:\\DSS-AS-DATA\\uploads-old"),
    false
  );
});

test("isDestinationInsideSource: 구분자와 대소문자가 달라도 같은 자리로 알아본다", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", "c:/dss-as-data/UPLOADS/inner"),
    true
  );
});

test("isDestinationInsideSource: 끝의 구분자와 '.' 마디에 속지 않는다", () => {
  assert.equal(
    isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads\\", "C:\\DSS-AS-DATA\\uploads\\.\\sub"),
    true
  );
});

test("isDestinationInsideSource: '..'를 풀어 우회를 잡아낸다", () => {
  assert.equal(
    isDestinationInsideSource(
      "C:\\DSS-AS-DATA\\uploads",
      "C:\\DSS-AS-DATA\\backups\\..\\uploads\\here"
    ),
    true
  );
  assert.equal(
    isDestinationInsideSource(
      "C:\\DSS-AS-DATA\\uploads\\..\\uploads",
      "C:\\DSS-AS-DATA\\backups\\uploads"
    ),
    false
  );
});

test("isDestinationInsideSource: 빈 값은 '안이다'로 답하지 않는다", () => {
  assert.equal(isDestinationInsideSource("", "C:\\anything"), false);
  assert.equal(isDestinationInsideSource("C:\\DSS-AS-DATA\\uploads", ""), false);
});
