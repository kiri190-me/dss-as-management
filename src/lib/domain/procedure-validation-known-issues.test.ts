import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyKnownValidationIssue } from "./procedure-validation-known-issues";

test("classifyKnownValidationIssue: matches a known Group 1 HIGH-confidence issue by stable identity", () => {
  const result = classifyKnownValidationIssue({
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (4)기본 정전 검사",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#57",
  });
  assert.ok(result);
  assert.equal(result?.group, "GROUP_1_DETERMINISTIC");
  assert.equal(result?.confidence, "HIGH");
});

test("classifyKnownValidationIssue: matches a known Group 2 MEDIUM-confidence issue", () => {
  const result = classifyKnownValidationIssue({
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (5)통전검사(3상입력)",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#274",
  });
  assert.ok(result);
  assert.equal(result?.group, "GROUP_2_NEEDS_CONFIRMATION");
  assert.equal(result?.confidence, "MEDIUM");
});

test("classifyKnownValidationIssue: matches a known Group 3 LOW-confidence issue", () => {
  const result = classifyKnownValidationIssue({
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(MB) 출하완료",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#11",
  });
  assert.ok(result);
  assert.equal(result?.group, "GROUP_3_NEEDS_BUSINESS_INPUT");
  assert.equal(result?.confidence, "LOW");
});

test("classifyKnownValidationIssue: returns undefined for an unmatched (future) issue, never throws", () => {
  const result = classifyKnownValidationIssue({
    templateCode: "rfg-full-lifecycle",
    sourceWorksheet: "(RFG) (9)어떤 미래 시트",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#999",
  });
  assert.equal(result, undefined);
});

test("classifyKnownValidationIssue: a matching sourceReference on the wrong template does not match", () => {
  const result = classifyKnownValidationIssue({
    templateCode: "mb-full-lifecycle",
    sourceWorksheet: "(RFG) (4)기본 정전 검사",
    issueType: "DANGLING_CONNECTOR",
    sourceReference: "connector#57",
  });
  assert.equal(result, undefined);
});

test("classifyKnownValidationIssue: exactly 13 known issues are classified across both templates", () => {
  const rfgWorksheetRefs: [string, string, string][] = [
    ["(RFG) (4)기본 정전 검사", "DANGLING_CONNECTOR", "connector#57"],
    ["(RFG) (4)기본 정전 검사", "MISSING_OUTGOING_PATH", "shape#50"],
    ["(RFG) (4)기본 정전 검사", "MISSING_OUTGOING_PATH", "shape#183"],
    ["(RFG) (5)통전검사(3상입력)", "DANGLING_CONNECTOR", "connector#274"],
    ["(RFG) (6)개선 사항 확인", "DANGLING_CONNECTOR", "connector#7"],
    ["(RFG) (7)원복 검사 및 개선 작업", "MISSING_OUTGOING_PATH", "shape#26"],
    ["(RFG) (7)원복 검사 및 개선 작업", "MISSING_OUTGOING_PATH", "shape#69"],
    ["(RFG) (7)원복 검사 및 개선 작업", "MISSING_OUTGOING_PATH", "shape#328"],
    ["(RFG) (8)고객 연락", "MISSING_OUTGOING_PATH", "shape#10"],
  ];
  const mbWorksheetRefs: [string, string, string][] = [
    ["(MB) 통전검사", "DANGLING_CONNECTOR", "connector#8"],
    ["(MB) 통전검사", "DANGLING_CONNECTOR", "connector#19"],
    ["(MB) 출하완료", "DANGLING_CONNECTOR", "connector#11"],
    ["(MB) 출하완료", "DANGLING_CONNECTOR", "connector#13"],
  ];

  let matchedCount = 0;
  for (const [sourceWorksheet, issueType, sourceReference] of rfgWorksheetRefs) {
    if (classifyKnownValidationIssue({ templateCode: "rfg-full-lifecycle", sourceWorksheet, issueType, sourceReference })) matchedCount++;
  }
  for (const [sourceWorksheet, issueType, sourceReference] of mbWorksheetRefs) {
    if (classifyKnownValidationIssue({ templateCode: "mb-full-lifecycle", sourceWorksheet, issueType, sourceReference })) matchedCount++;
  }
  assert.equal(matchedCount, 13);

  const confidenceCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const [sourceWorksheet, issueType, sourceReference] of [...rfgWorksheetRefs]) {
    const r = classifyKnownValidationIssue({ templateCode: "rfg-full-lifecycle", sourceWorksheet, issueType, sourceReference });
    if (r) confidenceCounts[r.confidence]++;
  }
  for (const [sourceWorksheet, issueType, sourceReference] of mbWorksheetRefs) {
    const r = classifyKnownValidationIssue({ templateCode: "mb-full-lifecycle", sourceWorksheet, issueType, sourceReference });
    if (r) confidenceCounts[r.confidence]++;
  }
  assert.equal(confidenceCounts.HIGH, 4);
  assert.equal(confidenceCounts.MEDIUM, 1);
  assert.equal(confidenceCounts.LOW, 8);
});
