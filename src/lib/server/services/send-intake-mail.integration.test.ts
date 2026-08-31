import "../../../../scripts/load-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db, pgClient } from "../../db/connection";
import {
  intakeMailRecipients,
  intakeMailSettings,
  users,
} from "../../db/schema";
import { listActiveRecipientEmails } from "../../db/queries/intake-mail-settings";
import { sendIntakeNotificationMail } from "./send-intake-mail";

/**
 * ============================================================================
 * 접수 알림 메일 — **보내지 않기로 하는 판단**을 본다
 * ============================================================================
 * 실제 발송은 SMTP 가 있어야 하므로 여기서 시험하지 않는다. 대신 이 기능에서
 * 가장 위험한 부분, 곧 **언제 보내고 언제 안 보내는가**를 본다. 잘못 나간
 * 메일은 되돌릴 수 없다.
 *
 *  1. 꺼져 있으면 안 보낸다(기본값).
 *  2. 🔴 켰는데 고른 사람이 없으면 안 보낸다 — "안 골랐으니 전원"이 아니다.
 *  3. 🔴 골라 둔 뒤에 승인이 취소된 계정은 빠진다. 수신자 표에 행이 남아
 *     있어도 우리 사람이 아닌 주소로는 고객사·S/N·증상이 나가면 안 된다.
 *  4. 🔴 삭제된 계정도 빠진다.
 *  5. 접수를 못 읽으면 조용히 넘어가지 않고 이유를 남긴다.
 *
 * 격리 규약: 이 스위트는 **설정 표(한 행)와 수신자 표를 통째로 비웠다 채운다.**
 * 시험 DB 전용이며(scripts/test-db-bootstrap.ts), 끝나면 지운다.
 * ============================================================================
 */

let adminId: string;
let adminEmail: string;

async function setEnabled(isEnabled: boolean) {
  await db.delete(intakeMailSettings);
  await db.insert(intakeMailSettings).values({
    singleton: true,
    isEnabled,
    subjectTemplate: "[시험] {{인수번호}}",
    introText: "",
    outroText: "",
    signatureHtml: "",
    updatedBy: adminId,
  });
}

before(async () => {
  const [admin] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.role, "SUPER_ADMIN"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(admin, "expected an approved SUPER_ADMIN in the test DB");
  adminId = admin.id;
  adminEmail = admin.email;
});

beforeEach(async () => {
  await db.delete(intakeMailRecipients);
  await db.delete(intakeMailSettings);
});

after(async () => {
  await db.delete(intakeMailRecipients);
  await db.delete(intakeMailSettings);
  await pgClient.end({ timeout: 5 });
});

describe("접수 알림 메일 — 보낼지 말지", () => {
  test("설정이 아예 없으면 꺼진 것으로 본다", async () => {
    const result = await sendIntakeNotificationMail({ repairCaseId: randomUUID() });
    assert.deepEqual(result, { sent: false, reason: "DISABLED" });
  });

  test("꺼 두면 보내지 않는다", async () => {
    await setEnabled(false);
    await db.insert(intakeMailRecipients).values({ userId: adminId, addedBy: adminId });

    const result = await sendIntakeNotificationMail({ repairCaseId: randomUUID() });
    assert.deepEqual(result, { sent: false, reason: "DISABLED" });
  });

  test("🔴 켰는데 고른 사람이 없으면 보내지 않는다", async () => {
    await setEnabled(true);

    const result = await sendIntakeNotificationMail({ repairCaseId: randomUUID() });
    // 여기서 SEND_FAILED 가 나오면 아무에게도 안 보낸다는 약속이 깨진 것이다.
    assert.deepEqual(result, { sent: false, reason: "NO_RECIPIENTS" });
  });

  test("수신자와 접수가 다 있어야 발송까지 간다 — 없는 접수는 이유를 남긴다", async () => {
    await setEnabled(true);
    await db.insert(intakeMailRecipients).values({ userId: adminId, addedBy: adminId });

    const result = await sendIntakeNotificationMail({ repairCaseId: randomUUID() });
    assert.equal(result.sent, false);
    if (result.sent) throw new Error("unreachable");
    // 여기까지 왔다는 것은 켜짐·수신자 두 문을 지났다는 뜻이다.
    assert.equal(result.reason, "CASE_NOT_FOUND");
  });
});

describe("실제로 받을 주소 고르기", () => {
  test("고른 사람의 주소가 나온다", async () => {
    await db.insert(intakeMailRecipients).values({ userId: adminId, addedBy: adminId });
    const emails = await listActiveRecipientEmails();
    assert.ok(emails.includes(adminEmail), `${adminEmail} 이 목록에 없다: ${emails.join(", ")}`);
  });

  test("🔴 골라 둔 뒤 승인이 취소된 계정은 빠진다", async () => {
    await db.insert(intakeMailRecipients).values({ userId: adminId, addedBy: adminId });
    await db.update(users).set({ approvalStatus: "PENDING" }).where(eq(users.id, adminId));
    try {
      assert.deepEqual(await listActiveRecipientEmails(), []);
    } finally {
      await db.update(users).set({ approvalStatus: "APPROVED" }).where(eq(users.id, adminId));
    }
  });

  test("🔴 삭제된 계정도 빠진다", async () => {
    await db.insert(intakeMailRecipients).values({ userId: adminId, addedBy: adminId });
    await db.update(users).set({ isDeleted: true }).where(eq(users.id, adminId));
    try {
      assert.deepEqual(await listActiveRecipientEmails(), []);
    } finally {
      await db.update(users).set({ isDeleted: false }).where(eq(users.id, adminId));
    }
  });

  test("아무도 안 골랐으면 빈 목록", async () => {
    assert.deepEqual(await listActiveRecipientEmails(), []);
  });
});
