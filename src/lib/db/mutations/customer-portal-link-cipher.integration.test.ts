import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { customerRepairLinks, customers, users } from "../schema";
import { issueCustomerLink } from "./customer-portal";
import { getActiveLinkCipher } from "../queries/customer-portal";
import {
  decryptCustomerLinkToken,
  encryptCustomerLinkToken,
} from "@/lib/server/customer-link-token-cipher";

/**
 * ============================================================================
 * 고객사 전용 주소를 다시 꺼내 볼 수 있는가 — 발급부터 복호화까지
 * ============================================================================
 * 단위 시험(customer-link-token-cipher.test.ts)이 암호화 자체를 보고, 여기서는
 * **DB 를 거쳐 왕복했을 때도 같은 주소가 나오는가**를 본다. 확인하는 것은 넷.
 *
 *  1. 발급하면 암호문이 저장되고, 거기서 발급된 주소가 그대로 나온다.
 *  2. **🔴 재발급하면 옛 주소는 더 이상 꺼내지지 않는다.** 회수한 주소를 다시
 *     보여 주면 실수로 죽은 주소를 고객에게 전달하게 된다.
 *  3. **🔴 다른 고객사 id 로는 못 푼다.** 암호문을 옮겨 붙이는 것만으로 A 사
 *     화면에 B 사 주소가 뜨는 일을 막는다.
 *  4. 암호문 없이 발급된 행(옛 방식·키 없는 환경)도 조회는 되고, 복호화만
 *     null 이다 — 화면이 "재발급하세요"로 안내할 수 있어야 한다.
 *
 * 격리 규약: 고객사 접두사 "AS-TEST-LINK-CIPHER-". 접수 건은 만들지 않는다.
 * ============================================================================
 */

const TEST_CUSTOMER_PREFIX = "AS-TEST-LINK-CIPHER-";
const KEY_ENV = "CUSTOMER_LINK_TOKEN_KEY";
const TEST_KEY = randomBytes(32).toString("base64");

let actorUserId: string;
let customerId: string;
let otherCustomerId: string;
let savedKey: string | undefined;

/** 액션이 하는 일과 같은 순서 — 토큰을 만들고, 해시와 암호문을 함께 넣는다. */
async function issue(targetCustomerId: string, withCipher = true) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const { linkId, revokedPreviousId } = await issueCustomerLink({
    customerId: targetCustomerId,
    tokenHash,
    tokenCipher: withCipher
      ? encryptCustomerLinkToken(token, targetCustomerId)
      : null,
    label: null,
    actorUserId,
  });
  return { token, linkId, revokedPreviousId };
}

before(async () => {
  savedKey = process.env[KEY_ENV];
  process.env[KEY_ENV] = TEST_KEY;

  const [admin] = await db
    .select({ id: users.id })
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
  actorUserId = admin.id;

  const created = await db
    .insert(customers)
    .values([
      { name: `${TEST_CUSTOMER_PREFIX}${randomBytes(4).toString("hex")}` },
      { name: `${TEST_CUSTOMER_PREFIX}${randomBytes(4).toString("hex")}` },
    ])
    .returning({ id: customers.id });
  customerId = created[0].id;
  otherCustomerId = created[1].id;
});

after(async () => {
  if (savedKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = savedKey;

  // 링크가 고객사를 참조(onDelete restrict)하므로 링크부터 지운다.
  await db
    .delete(customerRepairLinks)
    .where(inArray(customerRepairLinks.customerId, [customerId, otherCustomerId]));
  await db.delete(customers).where(like(customers.name, `${TEST_CUSTOMER_PREFIX}%`));
  await pgClient.end({ timeout: 5 });
});

describe("고객사 전용 주소 보관 — DB 왕복", () => {
  test("발급한 주소가 그대로 다시 나온다", async () => {
    const { token, linkId } = await issue(customerId);

    const stored = await getActiveLinkCipher(linkId);
    assert.ok(stored, "발급한 링크를 찾지 못했다");
    assert.equal(stored.customerId, customerId);
    assert.ok(stored.tokenCipher, "암호문이 저장되지 않았다");
    // 평문이 그대로 들어갔으면 이 시험이 통과해도 의미가 없다.
    assert.ok(
      !stored.tokenCipher.includes(token),
      "🔴 암호문 안에 평문 주소가 그대로 들어 있다"
    );

    assert.equal(decryptCustomerLinkToken(stored.tokenCipher, stored.customerId), token);
  });

  test("🔴 재발급하면 옛 주소는 더 이상 꺼내지지 않는다", async () => {
    const first = await issue(customerId);
    const second = await issue(customerId);

    assert.equal(second.revokedPreviousId, first.linkId, "옛 링크가 회수되지 않았다");
    assert.equal(await getActiveLinkCipher(first.linkId), null);

    // 새 주소는 정상적으로 나온다.
    const stored = await getActiveLinkCipher(second.linkId);
    assert.ok(stored);
    assert.equal(decryptCustomerLinkToken(stored.tokenCipher, customerId), second.token);
  });

  test("🔴 다른 고객사 id 로는 못 푼다", async () => {
    const { linkId } = await issue(customerId);
    const stored = await getActiveLinkCipher(linkId);
    assert.ok(stored);
    assert.equal(decryptCustomerLinkToken(stored.tokenCipher, otherCustomerId), null);
  });

  test("암호문 없이 발급된 행도 조회는 되고 복호화만 null 이다", async () => {
    const { linkId } = await issue(otherCustomerId, false);

    const stored = await getActiveLinkCipher(linkId);
    assert.ok(stored, "암호문이 없다고 링크 자체가 사라지면 안 된다");
    assert.equal(stored.tokenCipher, null);
    assert.equal(decryptCustomerLinkToken(stored.tokenCipher, otherCustomerId), null);
  });
});
