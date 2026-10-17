import "../../../../scripts/load-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

import { db, pgClient } from "../connection";
import { customers, products, repairCaseCustomerStatus, repairCaseIntakeSequences, repairCases, users } from "../schema";
import { createRepairCase } from "../mutations/repair-cases";
import { setCustomerStatuses } from "../mutations/customer-portal";
import { getPortalFormCustomerForRepairCase } from "./customer-portal";
import {
  findPortalFormForCustomerName,
  resolvePortalFormForCustomer,
  sanitizeManualValues,
  type CustomerPortalForm,
} from "@/lib/domain/customer-portal-forms";
import type { ValidatedCreateRepairCaseInput } from "@/lib/validation/repair-case-input";

/**
 * ============================================================================
 * 손으로 적은 칸이 **실제로 들어가는가** — 저장 길이 양식을 고르는 근거
 * ============================================================================
 * 2026-10-17 에 고객사 세 곳의 이름이 정식 상호로 바뀌자, 양식을 **이름 글자로**
 * 가리던 코드가 하나도 못 맞춰 표 셋이 통째로 사라졌다. 그래서 판정의 근거를
 * `customers.portal_form_id` 칸으로 옮겼다 — C-1 이 칸을 만들고, C-2 가 **표를
 * 그리는 길**을 칸 쪽으로 옮겼다.
 *
 * 🔴 그때 **저장 길만 이름으로 남았다.** 그 어긋남이 만드는 모양이 고약하다:
 * 칸은 채워졌는데 이름이 등록부에 없는 고객사는 화면에 표가 **뜨는데**(C-2 덕분)
 * 그 줄에 적은 값은 양식을 못 찾아 `undefined` 가 되어 **아무 오류 없이 안
 * 들어간다.** 사람에게는 「내가 적은 게 왜 안 들어가지」로만 보인다. 이 파일이
 * 재는 것이 정확히 그 구멍이다.
 *
 * ── 왜 서버 액션을 직접 부르지 않는가 ───────────────────────────────────
 * saveCustomerStatusesAction 은 세션·권한 관문을 먼저 지나는데(쿠키를 읽는다)
 * 그 관문은 요청 바깥에서 열리지 않는다. 그래서 이 저장소의 선례
 * (server/services/quote-issue.integration.test.ts)를 따라 **그 액션이 부르는
 * 함수들을 같은 차례로** 부른다(아래 resolveLikeAction). 액션이 정말 그 차례로
 * 부르는가는 원본 글자를 읽는 시험이 지킨다
 * (components/customer-portal/customer-portal-form-view.test.ts 의 「5.」).
 *
 * ── 여기서 못 박는 것 넷 ────────────────────────────────────────────────
 *  1. 🔴 **이름이 등록부에 하나도 없고 칸만 채워진** 고객사의 접수에 적은 값이
 *     **진짜로 DB 에 들어간다.** 울타리를 함께 둔다 — 그 이름이 정말 이름으로는
 *     안 걸린다는 것을 먼저 재지 않으면, 이름으로 걸려 저장된 것을 보고도 통과한다.
 *  2. 칸이 비고 이름만 맞는 고객사도 **지금까지처럼** 저장된다(안전망이 산다).
 *  3. 🔴 칸에 등록부에 없는 값이 있으면 **양식 없음**이고, 그때 저장 값은
 *     `undefined` 다 — `{}` 가 아니다. `{}` 는 "다 지워라"가 되어 적어 둔 값을
 *     **전부 날린다.** 날아가지 않는다는 것을 DB 에서 되읽어 확인한다.
 *  4. 조회가 이름과 칸을 **DB 에서 읽은 그대로** 낸다 — 지워진 고객사도 그대로
 *     돌려주고(접수는 남아 있다), 없는 접수는 null 이다.
 *
 * ── 격리 규약 ────────────────────────────────────────────────────────────
 * 이 스위트만 쓰는 접수 월 "9208", 고객사 접두사 "AS-TEST-PORTAL-FORM-",
 * 제품 모델 접두사 "PORTAL-FORM-TEST-". 인수번호의 연월은 receivedAt 에서
 * 나오므로 TEST_YEAR_MONTH 와 TEST_RECEIVED_AT 은 같은 달을 가리켜야 한다.
 *
 * 🔴 **고객사 한 줄만 접두사를 못 단다** — 안전망(2번)이 재는 것이 「이름이
 * 등록부에 있는가」라서, 이름을 접두사로 비틀면 그 시험이 뜻을 잃는다. 그래서
 * 그 줄만 등록부의 옛 이름(`JUSUNG`)을 그대로 쓰고, 뒷정리는 이름이 아니라
 * **이 실행이 만든 id 로만** 지운다(createdCustomerIds). 이름으로 지우면 언젠가
 * 남의 줄을 지운다.
 *
 * 🔴 디스크에는 아무것도 쓰지 않는다 — 접수 만들기가 파일을 건드리지 않는다.
 * ============================================================================
 */

const TEST_CUSTOMER_NAME_PREFIX = "AS-TEST-PORTAL-FORM-";
const TEST_MODEL_PREFIX = "PORTAL-FORM-TEST-";
const TEST_YEAR_MONTH = "9208";
const TEST_RECEIVED_AT = "2092-08-05";

/**
 * 안전망(2번)이 쓰는 이름. 🔴 **등록부(JUSUNG_FORM.customerNames)에 있는 옛
 * 이름이다** — 2026-10-17 에 운영에서는 `주성엔지니어링(주)` 로 바뀌었지만 옛
 * 이름은 개발 DB 와 과거 데이터에 남아 있어 목록에서 지우지 않았다. 새로
 * 들여온 이름이 아니라 **이미 코드에 있는 이름**이다.
 */
const REGISTERED_CUSTOMER_NAME = "JUSUNG";

let engineerId: string;
let actorUserId: string;

/** 🔴 이름이 등록부에 없고 **칸만** 채워진 고객사 — 이 파일의 핵심이다. */
let columnOnlyCustomerId: string;
let columnOnlyCustomerName: string;
/** 칸이 비고 **이름만** 맞는 고객사 — 안전망. */
let nameOnlyCustomerId: string;
/** 칸에 등록부에 없는 값이 든 고객사 — 양식 없음. */
let unknownFormCustomerId: string;
/** 지워진 고객사 — 접수는 남아 있다. */
let deletedCustomerId: string;

/** 🔴 뒷정리는 이 목록의 id 로만 한다(이름으로 지우지 않는다). */
const createdCustomerIds: string[] = [];

function baseCreateRepairCaseInput(customerId: string): ValidatedCreateRepairCaseInput {
  const suffix = randomUUID().slice(0, 8);
  return {
    workflowType: "PAID_MATCHER",
    billingType: "PAID",
    customerId,
    endUserId: null,
    assignedEngineerId: engineerId,
    receivedAt: TEST_RECEIVED_AT,
    customerRequestedDueDate: null,
    internalTargetShipmentDate: null,
    modelName: `${TEST_MODEL_PREFIX}${suffix}`,
    lotNumber: `LOT-${suffix}`,
    serialNumber: `SN-${suffix}`,
    partNumber: null,
    accessoryList: null,
    externalConditionSummary: null,
    reasonForRemoval: null,
    reportedSymptom: "Bias Fwd Drop 발생",
    intakeInspectionResult: null,
    currentDiagnosisSummary: null,
    nextPlannedAction: null,
    notes: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
  };
}

async function createTestRepairCase(customerId: string): Promise<string> {
  const created = await createRepairCase(baseCreateRepairCaseInput(customerId));
  assert.equal(created.ok, true, `setup repair case failed: ${JSON.stringify(created)}`);
  if (!created.ok) throw new Error("unreachable");
  return created.id;
}

async function createTestCustomer(name: string, portalFormId: string | null): Promise<string> {
  const [row] = await db
    .insert(customers)
    .values({ name, portalFormId })
    .returning({ id: customers.id });
  createdCustomerIds.push(row.id);
  return row.id;
}

/** 지금 저장돼 있는 줄. 없으면 null. */
async function readStatusRow(repairCaseId: string) {
  const [row] = await db
    .select({
      formValues: repairCaseCustomerStatus.formValues,
      version: repairCaseCustomerStatus.version,
    })
    .from(repairCaseCustomerStatus)
    .where(eq(repairCaseCustomerStatus.repairCaseId, repairCaseId));
  return row ?? null;
}

/**
 * 🔴 **서버 액션이 하는 그대로** — 접수 id 하나만 들고 시작해서, 고객사 줄을
 * 서버가 직접 읽고(getPortalFormCustomerForRepairCase), 판정은 domain 한 곳에
 * 맡기고(resolvePortalFormForCustomer), 양식을 못 고르면 저장 값은 **`undefined`
 * 로 둔다**(`{}` 가 아니다 — 그것은 "다 지워라"다).
 *
 * 🔴 이 함수는 **화면이 보낸 이름도 양식 칸도 받지 않는다.** 액션이 받는 것도
 * 접수 id 와 적은 값뿐이다 — 그것이 인가 경계다(queries/customer-portal.ts 의
 * getPortalFormCustomerForRepairCase 머리말).
 */
async function resolveLikeAction(
  repairCaseId: string,
  formValues: Record<string, string>
): Promise<{ form: CustomerPortalForm | null; prepared: Record<string, string> | undefined }> {
  const customer = await getPortalFormCustomerForRepairCase(repairCaseId);
  const form = customer === null ? null : resolvePortalFormForCustomer(customer);
  if (form === null) return { form, prepared: undefined };

  const sanitized = sanitizeManualValues(form, formValues);
  assert.equal(sanitized.ok, true, JSON.stringify(sanitized));
  if (!sanitized.ok) throw new Error("unreachable");
  return { form, prepared: sanitized.values };
}

before(async () => {
  const [engineer] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, "AS_ENGINEER"),
        eq(users.approvalStatus, "APPROVED"),
        eq(users.isDeleted, false)
      )
    )
    .limit(1);
  assert.ok(engineer, "expected at least one approved AS_ENGINEER in the test DB");
  engineerId = engineer.id;
  // updated_by 는 users 를 RESTRICT 로 가리킨다 — 실재하는 계정이어야 한다.
  // 역할은 상관없다(인가는 서버 액션의 몫이다).
  actorUserId = engineer.id;

  columnOnlyCustomerName = `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`;
  columnOnlyCustomerId = await createTestCustomer(columnOnlyCustomerName, "JUSUNG");
  nameOnlyCustomerId = await createTestCustomer(REGISTERED_CUSTOMER_NAME, null);
  unknownFormCustomerId = await createTestCustomer(
    `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`,
    // 양식을 하나 걷어낸 뒤에 남는 모양이다 — 등록부에 없는 값.
    "NOPE"
  );
  deletedCustomerId = await createTestCustomer(
    `${TEST_CUSTOMER_NAME_PREFIX}${randomUUID().slice(0, 8)}`,
    "ICD"
  );
});

after(async () => {
  // 접수를 지우면 상태 줄이 cascade 로 함께 간다.
  await db.delete(repairCases).where(like(repairCases.intakeNumber, `D${TEST_YEAR_MONTH}%`));
  await db.delete(products).where(like(products.modelName, `${TEST_MODEL_PREFIX}%`));
  await db
    .delete(repairCaseIntakeSequences)
    .where(eq(repairCaseIntakeSequences.yearMonth, TEST_YEAR_MONTH));
  // 🔴 이름이 아니라 **이 실행이 만든 id** 로만 지운다(격리 규약 참조).
  if (createdCustomerIds.length > 0) {
    await db.delete(customers).where(inArray(customers.id, createdCustomerIds));
  }
  await pgClient.end({ timeout: 5 });
});

describe("🔴 저장 길도 「칸이 먼저, 비면 이름」으로 양식을 고른다", () => {
  test("🔴 ① 이름이 등록부에 없고 칸만 채워진 고객사 — 적은 값이 진짜로 들어간다", async () => {
    const repairCaseId = await createTestRepairCase(columnOnlyCustomerId);

    const customer = await getPortalFormCustomerForRepairCase(repairCaseId);
    assert.ok(customer, "접수에서 고객사 줄을 못 찾았다");
    assert.equal(customer.id, columnOnlyCustomerId);
    assert.equal(customer.name, columnOnlyCustomerName);
    assert.equal(customer.portalFormId, "JUSUNG");

    // 🔴 울타리다. 이 이름이 이름으로도 걸린다면 아래 통과는 아무것도 뜻하지
    //    않는다 — 2026-10-17 전의 코드로 되돌려도 그대로 통과할 것이다.
    assert.equal(
      findPortalFormForCustomerName(customer.name),
      null,
      "이 시험의 가짜 이름이 이름으로도 걸린다 — 칸을 보는지 잴 수 없다"
    );

    const { form, prepared } = await resolveLikeAction(repairCaseId, {
      prvNumber: "PRV-0001",
      passNumber: "TEST-PASS-0001",
      // 🔴 JUSUNG 양식에 없는 칸이다. 양식을 **제대로** 골랐다면 버려진다 —
      //    버려지지 않으면 "아무 양식이나 통과시킨" 것이다.
      chinaReExportDeadline: "2092-09-09",
    });
    assert.equal(form?.id, "JUSUNG");

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId,
          statusOptionId: null,
          note: null,
          formValues: prepared,
          expectedVersion: null,
        },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const saved = await readStatusRow(repairCaseId);
    assert.deepEqual(
      saved?.formValues,
      { prvNumber: "PRV-0001", passNumber: "TEST-PASS-0001" },
      "칸만 채워진 고객사의 손 입력 값이 안 들어갔다 — 2026-10-17 의 그 구멍이다"
    );
  });

  test("② 칸이 비고 이름만 맞는 고객사도 지금까지처럼 저장된다 — 안전망이 산다", async () => {
    const repairCaseId = await createTestRepairCase(nameOnlyCustomerId);

    const customer = await getPortalFormCustomerForRepairCase(repairCaseId);
    assert.ok(customer);
    assert.equal(customer.name, REGISTERED_CUSTOMER_NAME);
    assert.equal(customer.portalFormId, null, "안전망을 재려면 칸이 비어 있어야 한다");

    const { form, prepared } = await resolveLikeAction(repairCaseId, { qCode: "QTEST00001" });
    assert.equal(form?.id, "JUSUNG");

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId,
          statusOptionId: null,
          note: null,
          formValues: prepared,
          expectedVersion: null,
        },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const saved = await readStatusRow(repairCaseId);
    assert.deepEqual(saved?.formValues, { qCode: "QTEST00001" });
  });

  test("🔴 ③ 칸에 등록부에 없는 값이 있으면 양식 없음 — `undefined` 로 가고 적어 둔 값이 안 날아간다", async () => {
    const repairCaseId = await createTestRepairCase(unknownFormCustomerId);

    // 칸이 아직 멀쩡하던 때에 적어 둔 값이 있다고 치고 미리 넣어 둔다.
    const seeded = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId,
          statusOptionId: null,
          note: null,
          formValues: { prvNumber: "PRV-OLD", passNumber: "TEST-PASS-OLD" },
          expectedVersion: null,
        },
      ],
    });
    assert.equal(seeded.ok, true, JSON.stringify(seeded));

    const { form, prepared } = await resolveLikeAction(repairCaseId, { prvNumber: "PRV-NEW" });
    assert.equal(form, null, "등록부에 없는 값이 양식으로 풀렸다");
    // 🔴 `{}` 가 아니라 `undefined` 다. `{}` 면 아래 저장 한 번이 적어 둔 값을
    //    통째로 날린다 — 오류는 어디에도 안 난다.
    assert.equal(prepared, undefined);

    const result = await setCustomerStatuses({
      actorUserId,
      rows: [
        {
          repairCaseId,
          statusOptionId: null,
          note: "양식이 빠진 사이의 저장",
          formValues: prepared,
          expectedVersion: 1,
        },
      ],
    });
    assert.equal(result.ok, true, JSON.stringify(result));

    const saved = await readStatusRow(repairCaseId);
    assert.deepEqual(
      saved?.formValues,
      { prvNumber: "PRV-OLD", passNumber: "TEST-PASS-OLD" },
      "양식이 안 풀리는 사이의 저장 한 번이 적어 둔 값을 날렸다"
    );
    // 저장 자체는 됐다(비고는 들어갔다) — 막힌 것이 아니라 양식 칸만 안 건드린다.
    assert.equal(saved?.version, 2);
  });

  test("④ 조회는 이름도 칸도 DB 에서 읽은 그대로 낸다 — 지워진 고객사도, 없는 접수는 null", async () => {
    const repairCaseId = await createTestRepairCase(deletedCustomerId);
    await db
      .update(customers)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(customers.id, deletedCustomerId));

    const customer = await getPortalFormCustomerForRepairCase(repairCaseId);
    assert.ok(
      customer,
      "고객사가 지워졌다고 조회가 비었다 — 남아 있는 접수를 고칠 수 없게 된다"
    );
    assert.equal(customer.id, deletedCustomerId);
    assert.equal(customer.portalFormId, "ICD");
    assert.equal(resolvePortalFormForCustomer(customer)?.id, "ICD");

    assert.equal(await getPortalFormCustomerForRepairCase(randomUUID()), null);
  });
});
