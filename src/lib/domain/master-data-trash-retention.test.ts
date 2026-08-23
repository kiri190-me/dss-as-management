import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMasterDataTrashRetentionStatus,
  MASTER_DATA_TRASH_RETENTION_DAYS,
} from "./master-data-trash-retention";

test("삭제한 순간에는 15일이 통째로 남아 있고 만료가 아니다", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const status = getMasterDataTrashRetentionStatus(deletedAt, new Date(deletedAt));
  assert.equal(status.daysRemaining, MASTER_DATA_TRASH_RETENTION_DAYS);
  assert.equal(status.isExpired, false);
  assert.equal(status.expiresAt, "2026-08-16T00:00:00.000Z");
});

test("14일이 지나면 1일 남는다", () => {
  const status = getMasterDataTrashRetentionStatus(
    "2026-08-01T00:00:00.000Z",
    new Date("2026-08-15T00:00:00.000Z")
  );
  assert.equal(status.daysRemaining, 1);
  assert.equal(status.isExpired, false);
});

test("만료 순간 정각에 만료된다 — 0일 남음", () => {
  const status = getMasterDataTrashRetentionStatus(
    "2026-08-01T00:00:00.000Z",
    new Date("2026-08-16T00:00:00.000Z")
  );
  assert.equal(status.daysRemaining, 0);
  assert.equal(status.isExpired, true);
});

test("만료 몇 시간 전은 0일이 아니라 1일로 올린다", () => {
  // 올림이 아니면 "만료까지 0일"이라는, 아직 만료되지 않았는데 만료처럼
  // 읽히는 문구가 화면에 뜬다.
  const status = getMasterDataTrashRetentionStatus(
    "2026-08-01T00:00:00.000Z",
    new Date("2026-08-15T18:00:00.000Z")
  );
  assert.equal(status.daysRemaining, 1);
  assert.equal(status.isExpired, false);
});

test("만료가 지나면 남은 일수는 음수로 간다 — 0으로 잘라 두지 않는다", () => {
  // 자동 정리가 며칠째 돌지 않았는지가 이 값에 그대로 드러나야 한다.
  const status = getMasterDataTrashRetentionStatus(
    "2026-08-01T00:00:00.000Z",
    new Date("2026-08-21T00:00:00.000Z")
  );
  assert.equal(status.daysRemaining, -5);
  assert.equal(status.isExpired, true);
});

test("접수 건 휴지통과 같은 15일이지만 계산은 이 모듈이 따로 갖는다", () => {
  // 두 값이 지금 같다는 사실을 고정해 두는 것이 아니라, 이 모듈이 자기
  // 상수를 갖고 있다는 것을 확인한다 — 접수 건 쪽이 바뀌어도 여기는 그대로다.
  assert.equal(MASTER_DATA_TRASH_RETENTION_DAYS, 15);
});
