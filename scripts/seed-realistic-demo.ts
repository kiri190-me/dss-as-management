import { createHash } from "node:crypto";
import { and, eq, inArray, sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../src/lib/db/connection";
import {
  customers, endUsers, endUserContacts, productModels, products, users,
  workflowTemplates, workflowVersions, workflowSteps, repairCases,
  repairCaseWorkRecords, parts, partStockBalances, stockTransactions,
  inventoryPartRequests, inventoryPartRequestItems,
} from "../src/lib/db/schema";

const FIXED_NOW = new Date("2026-08-18T03:00:00.000Z");
const id = (key: string) => {
  const h = createHash("sha256").update(`dss-as-seed-dev:realistic-demo:${key}`).digest("hex").slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export async function seedRealisticDemoDataset() {
  const identity = await db.execute(sql`select current_database() as name`);
  if (identity[0]?.name !== "dss_as_dev") throw new Error("DEV safety gate failed: database is not dss_as_dev");

  const staff = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.isDeleted, false));
  const engineers = staff.filter((u) => u.role === "AS_ENGINEER");
  const actors = engineers.length ? engineers : staff;
  if (!actors.length) throw new Error("DEV demo seed requires at least one active user");

  const workflowRows = await db
    .select({ code: workflowTemplates.code, versionId: workflowVersions.id, stepId: workflowSteps.id, order: workflowSteps.stepOrder })
    .from(workflowTemplates)
    .innerJoin(workflowVersions, and(eq(workflowVersions.workflowTemplateId, workflowTemplates.id), eq(workflowVersions.isCurrent, true)))
    .innerJoin(workflowSteps, and(eq(workflowSteps.workflowVersionId, workflowVersions.id), eq(workflowSteps.isActive, true)));
  const byCode = new Map<string, typeof workflowRows>();
  for (const row of workflowRows) byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);
  for (const rows of byCode.values()) rows.sort((a, b) => a.order - b.order);
  const required = ["PAID_GENERATOR", "WARRANTY_GENERATOR", "PENDING_GENERATOR", "PAID_MATCHER", "WARRANTY_MATCHER", "PENDING_MATCHER", "PAID_TOTAL_CONTROLLER", "WARRANTY_TOTAL_CONTROLLER", "PENDING_TOTAL_CONTROLLER"];
  if (required.some((code) => !(byCode.get(code)?.length))) throw new Error("Required current workflow foundation is incomplete; no writes performed");

  const customerRows = Array.from({ length: 20 }, (_, i) => ({
    id: id(`customer:${i + 1}`), name: `DEMO 고객사 ${pad(i + 1)}`,
    contactName: `DEMO 담당자 ${pad(i + 1)}`, contactEmail: `demo-customer-${pad(i + 1)}@example.invalid`,
    contactPhone: `000-0000-${pad(i + 1, 4)}`, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  }));
  const endUserRows = Array.from({ length: 40 }, (_, i) => ({
    id: id(`end-user:${i + 1}`), customerId: customerRows[i % 20].id,
    name: `DEMO FAB ${pad(i + 1)}`, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  }));
  const contactRows = Array.from({ length: 80 }, (_, i) => ({
    id: id(`contact:${i + 1}`), endUserId: endUserRows[i % 40].id,
    contactName: `DEMO FAB 담당자 ${pad(i + 1)}`, contactEmail: `demo-fab-${pad(i + 1)}@example.invalid`,
    createdAt: FIXED_NOW, updatedAt: FIXED_NOW, isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  }));
  const kinds = ["GENERATOR", "MATCHER", "TOTAL_CONTROLLER"] as const;
  const modelRows = Array.from({ length: 25 }, (_, i) => ({
    id: id(`model:${i + 1}`), modelName: `DEMO-${kinds[i % 3]}-${pad(i + 1, 3)}`,
    kind: kinds[i % 3], manufacturer: "DEMO 제조사", description: "개발 전용 현실형 더미 모델",
    createdAt: FIXED_NOW, updatedAt: FIXED_NOW, isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  }));
  const productRows = modelRows.flatMap((m, mi) => Array.from({ length: 2 + (mi % 7) }, (_, j) => ({
    id: id(`product:${mi + 1}:${j + 1}`), modelName: m.modelName, productModelId: m.id,
    serialNumber: `DEMO-SN-${pad(mi + 1, 3)}-${pad(j + 1, 3)}`, lotNumber: `DEMO-LN-${pad((mi % 9) + 1, 3)}`,
    partNumber: `DEMO-PN-${pad(mi + 1, 3)}`, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
    isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  })));

  const months = Array.from({ length: 18 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 2 + i, 1));
    return { yy: String(d.getUTCFullYear()).slice(2), mm: pad(d.getUTCMonth() + 1), date: d };
  });
  const caseRows = Array.from({ length: 250 }, (_, i) => {
    const m = modelRows[i % modelRows.length];
    const product = productRows.filter((p) => p.productModelId === m.id)[i % (2 + ((i % modelRows.length) % 7))];
    const month = months[i % months.length];
    const sequence = 80 + Math.floor(i / months.length);
    const billing = (["PAID", "WARRANTY", "PENDING_DECISION"] as const)[i % 3];
    const prefix = billing === "PAID" ? "PAID" : billing === "WARRANTY" ? "WARRANTY" : "PENDING";
    const code = `${prefix}_${m.kind}`;
    const steps = byCode.get(code)!;
    const step = steps[Math.floor(i / 17) % steps.length];
    const received = new Date(Date.UTC(month.date.getUTCFullYear(), month.date.getUTCMonth(), 2 + (i % 24)));
    const deleted = i < 15;
    return {
      id: id(`repair-case:${i + 1}`), intakeNumber: `D${month.yy}${month.mm}${pad(sequence)}`,
      customerId: customerRows[i % 20].id, endUserId: endUserRows[i % 40].id, productId: product.id,
      workflowVersionId: step.versionId, currentWorkflowStepId: step.stepId, exceptionStatusId: null,
      assignedEngineerId: actors[i % actors.length].id, billingType: billing,
      priority: (["LOW", "NORMAL", "HIGH", "URGENT"] as const)[i % 4], receivedAt: received.toISOString().slice(0, 10),
      customerRequestedDueDate: new Date(received.getTime() + 14 * 86400000).toISOString().slice(0, 10),
      internalTargetInspectionCompletionDate: new Date(received.getTime() + 3 * 86400000).toISOString().slice(0, 10),
      internalTargetShipmentDate: new Date(received.getTime() + 10 * 86400000).toISOString().slice(0, 10),
      actualShipmentDate: i % 5 === 0 ? new Date(received.getTime() + 9 * 86400000).toISOString().slice(0, 10) : null,
      legacyReportNumber: null, delayReason: i % 11 === 0 ? "DEMO 부품 입고 대기" : null, isLocked: false,
      reportedSymptom: ["출력 불안정", "매칭 불량", "전원 인가 불가", "간헐 알람"][i % 4],
      intakeInspectionResult: "DEMO 외관 및 기본 동작 점검", currentDiagnosisSummary: "DEMO 원인 분석 및 수리 진행",
      nextPlannedAction: "DEMO 기능 시험 후 출하 판정", notes: "DEMO 데이터", accessoryList: i % 3 ? null : "DEMO 케이블",
      externalConditionSummary: "DEMO 외관 상태 양호", reasonForRemoval: null,
      contactNameSnapshot: `DEMO 담당자 ${pad((i % 20) + 1)}`, contactPhoneSnapshot: "000-0000-0000",
      contactEmailSnapshot: `demo-intake-${pad(i + 1, 3)}@example.invalid`, version: 1,
      createdAt: received, updatedAt: received, isDeleted: deleted,
      deletedAt: deleted ? new Date(FIXED_NOW.getTime() - (i + 1) * 18 * 3600000) : null,
      deletedBy: deleted ? actors[0].id : null, deleteReason: deleted ? "DEMO 휴지통 검증" : null,
    };
  });

  const intakeNumbers = caseRows.map((r) => r.intakeNumber);
  const collisions = await db.select({ id: repairCases.id, intakeNumber: repairCases.intakeNumber }).from(repairCases).where(inArray(repairCases.intakeNumber, intakeNumbers));
  if (collisions.some((r) => r.id !== id(`repair-case:${intakeNumbers.indexOf(r.intakeNumber) + 1}`))) {
    throw new Error("DEMO intake-number range collides with existing legitimate data; no writes performed");
  }

  const partRows = Array.from({ length: 60 }, (_, i) => ({
    id: id(`part:${i + 1}`), partName: `DEMO 재고부품 ${pad(i + 1, 3)}`, partSpec: `DEMO-SPEC-${pad(i + 1, 3)}`,
    kyosanPartNo: `DEMO-KYO-${pad(i + 1, 3)}`, drawingNo: `DEMO-DWG-${pad(i + 1, 3)}`,
    category: ["RFG", "MB", "호환"][i % 3], itemType: ["PCB", "MODULE", "CABLE", "FAN"][i % 4], notes: "DEMO 전용",
    version: 1, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, isDeleted: false, deletedAt: null, deletedBy: null, deleteReason: null,
  }));
  const balanceRows = partRows.map((p, i) => ({
    id: id(`balance:${i + 1}`), partId: p.id, owner: (["DSS", "KYOSAN", "SERVICE_SPARE", "TEST"] as const)[i % 4],
    location: `DEMO-${String.fromCharCode(65 + (i % 4))}-${pad((i % 10) + 1)}`, currentQuantity: 20 - (i < 30 ? 2 : 0) + (i < 15 ? 1 : 0),
    version: 1, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  }));
  const receiptRows = balanceRows.map((b, i) => ({ id: id(`tx:receipt:${i + 1}`), partStockBalanceId: b.id, transactionType: "RECEIPT" as const, quantityDelta: 20, resultingQuantity: 20, repairCaseId: null, destinationNote: null, procedureExecutionNodeId: null, reversalOfId: null, requestItemId: null, requestIssueId: null, actorUserId: actors[0].id, reason: "DEMO initial receipt", createdAt: FIXED_NOW }));
  const useRows = balanceRows.slice(0, 30).map((b, i) => ({ id: id(`tx:use:${i + 1}`), partStockBalanceId: b.id, transactionType: "USE" as const, quantityDelta: -2, resultingQuantity: 18, repairCaseId: caseRows[15 + i].id, destinationNote: null, procedureExecutionNodeId: null, reversalOfId: null, requestItemId: null, requestIssueId: null, actorUserId: actors[i % actors.length].id, reason: "DEMO repair use", createdAt: FIXED_NOW }));
  const returnRows = balanceRows.slice(0, 15).map((b, i) => ({ id: id(`tx:return:${i + 1}`), partStockBalanceId: b.id, transactionType: "RETURN" as const, quantityDelta: 1, resultingQuantity: 19, repairCaseId: null, destinationNote: null, procedureExecutionNodeId: null, reversalOfId: useRows[i].id, requestItemId: null, requestIssueId: null, actorUserId: actors[0].id, reason: "DEMO unused return", createdAt: FIXED_NOW }));
  const workRows = caseRows.flatMap((c, i) => Array.from({ length: 2 + (i % 3) }, (_, j) => ({
    id: id(`work:${i + 1}:${j + 1}`), repairCaseId: c.id, authorUserId: actors[(i + j) % actors.length].id,
    memo: ["DEMO 입고점검 완료", "DEMO 고장부위 진단", "DEMO 부품 교체 및 세정", "DEMO 최종 동작시험"][j % 4],
    recordKind: (["INTAKE_INSPECTION_RESULT", "DIAGNOSIS_REPAIR_SUMMARY", "GENERAL", "NEXT_PLANNED_ACTION"] as const)[j % 4],
    relatedWorkflowStepId: c.currentWorkflowStepId, relatedProcedureExecutionNodeId: null, clientRequestId: id(`work-client:${i + 1}:${j + 1}`),
    invalidatedAt: null, invalidatedBy: null, invalidationReason: null, createdAt: new Date(c.createdAt.getTime() + (j + 1) * 3600000),
  })));
  const requestRows = Array.from({ length: 40 }, (_, i) => ({
    id: id(`request:${i + 1}`), repairCaseId: caseRows[30 + i].id, requestedByUserId: actors[i % actors.length].id,
    status: (["PENDING", "CANCELLED", "REJECTED"] as const)[i % 3], note: "DEMO 부품 요청", version: 1,
    createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  }));
  const requestItemRows = requestRows.map((r, i) => ({
    id: id(`request-item:${i + 1}`), requestId: r.id, partId: partRows[(i + 30) % 60].id,
    requestedQuantity: 1 + (i % 3), issuedQuantity: 0, owner: balanceRows[(i + 30) % 60].owner,
    note: "DEMO 요청 품목", createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  }));

  await db.transaction(async (tx) => {
    // 테이블마다 행 타입이 달라 하나의 헬퍼로 묶으려면 제네릭이 필요하다.
    // InferInsertModel<T>로 묶으면 각 호출부에서 "그 테이블에 맞는 행"만
    // 넘길 수 있다 — any 두 개를 쓰면 오타 난 컬럼명이 런타임까지 통과한다.
    const upsert = async <T extends PgTable>(table: T, rows: InferInsertModel<T>[]) =>
      tx.insert(table).values(rows).onConflictDoNothing();
    await upsert(customers, customerRows); await upsert(endUsers, endUserRows); await upsert(endUserContacts, contactRows);
    await upsert(productModels, modelRows); await upsert(products, productRows); await upsert(repairCases, caseRows);
    await upsert(repairCaseWorkRecords, workRows); await upsert(parts, partRows); await upsert(partStockBalances, balanceRows);
    await upsert(stockTransactions, receiptRows); await upsert(stockTransactions, useRows); await upsert(stockTransactions, returnRows);
    await upsert(inventoryPartRequests, requestRows); await upsert(inventoryPartRequestItems, requestItemRows);
  });
  console.log(`Realistic DEMO seed: customers=${customerRows.length}, endUsers=${endUserRows.length}, contacts=${contactRows.length}, models=${modelRows.length}, products=${productRows.length}, repairCases=${caseRows.length}, workRecords=${workRows.length}, parts=${partRows.length}, transactions=${receiptRows.length + useRows.length + returnRows.length}, partRequests=${requestRows.length}`);
  const verification = await db.execute(sql`
    select
      (select count(*)::int from customers where name like 'DEMO 고객사 %') as demo_customers,
      (select count(*)::int from product_models where model_name like 'DEMO-%') as demo_models,
      (select count(*)::int from repair_cases rc join customers c on c.id = rc.customer_id where c.name like 'DEMO 고객사 %') as demo_cases,
      (select count(*)::int from repair_cases rc join customers c on c.id = rc.customer_id where c.name like 'DEMO 고객사 %' and rc.is_deleted) as demo_trashed,
      (select count(*)::int from parts where part_name like 'DEMO 재고부품 %') as demo_parts,
      (select count(*)::int from inventory_part_requests r join repair_cases rc on rc.id = r.repair_case_id join customers c on c.id = rc.customer_id where c.name like 'DEMO 고객사 %') as demo_requests,
      (select count(*)::int from (select p.serial_number from repair_cases rc join products p on p.id = rc.product_id join customers c on c.id = rc.customer_id where c.name like 'DEMO 고객사 %' group by p.serial_number having count(*) > 1) repeated) as repeated_serials,
      (select count(*)::int from parts where part_name in ('컨트롤 판넬','VVC','스위칭 전원')) as protected_named_parts
  `);
  const distributions = await db.execute(sql`
    select rc.billing_type, rc.priority, count(*)::int as count
    from repair_cases rc join customers c on c.id = rc.customer_id
    where c.name like 'DEMO 고객사 %'
    group by rc.billing_type, rc.priority order by rc.billing_type, rc.priority
  `);
  const workflowDistribution = await db.execute(sql`
    select wt.code as workflow, ws.step_order, count(*)::int as count
    from repair_cases rc join customers c on c.id = rc.customer_id
    join workflow_versions wv on wv.id = rc.workflow_version_id
    join workflow_templates wt on wt.id = wv.workflow_template_id
    join workflow_steps ws on ws.id = rc.current_workflow_step_id
    where c.name like 'DEMO 고객사 %'
    group by wt.code, ws.step_order order by wt.code, ws.step_order
  `);
  console.log("DEMO verification:", JSON.stringify(verification[0]));
  console.log("DEMO billing/priority distribution:", JSON.stringify(distributions));
  console.log("DEMO workflow/step distribution:", JSON.stringify(workflowDistribution));
}
