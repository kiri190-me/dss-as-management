import type { Role } from "@/lib/domain/types";
import { PERMISSION_AREAS, lowerPermissionLevel, type PermissionLevel } from "./permission-areas";

import { canViewCustomers, canEditCustomers } from "./customer-authorization";
import { canManageExcelImports } from "./excel-import-authorization";
import { canViewInventory, canCreateOrEditPart, canProcessPartRequests } from "./inventory-authorization";
import { canViewMyActiveWork } from "./my-active-work-authorization";
import { canViewProductModels, canEditProductModels } from "./product-model-authorization";
import { canBulkDeleteRepairCases, canRestoreRepairCases, canEditSection } from "./repair-case-edit-authorization";
import {
  canViewRepairCaseFlowcharts,
  canManageRepairCaseFlowchartsGlobally,
  canPermanentlyDeleteRepairCaseFlowchart,
} from "./repair-case-flowchart-authorization";
import {
  canViewPublishedTechnicalTemplates,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
} from "./technical-procedure-template-authorization";
import {
  canViewWorkflowTemplates,
  canEditWorkflowTemplates,
  canPublishWorkflowTemplates,
} from "./workflow-template-authorization";

/**
 * ============================================================================
 * 상한(baseline) — 지금 코드가 이미 허용하는 것
 * ============================================================================
 * 권한 설정 화면의 드롭다운은 이 값보다 높은 수준을 내놓지 않는다. 설정으로는
 * 좁힐 수만 있고 넓힐 수는 없다는 규칙이 여기서 나온다.
 *
 * ── 손으로 적은 표가 아니라 기존 함수를 그대로 부른다 ───────────────────
 * 이게 이 파일의 핵심이다. 상한을 별도 표로 적어 두면 정책이 바뀔 때 한쪽만
 * 고쳐지고, 그러면 "화면에서는 고를 수 있는데 실제로는 막히는" 또는 그 반대의
 * 어긋남이 생긴다. 이 프로젝트는 같은 종류의 어긋남을 이미 여러 번 겪었다
 * (유·무상 규칙이 서버·화면 세 곳에 복제되어 있던 건). 그래서 상한은
 * *-authorization.ts를 **호출해서** 구한다 — 정책이 바뀌면 상한도 저절로
 * 따라 바뀐다.
 *
 * ── 아직 아무 역할 검사도 없는 영역 ─────────────────────────────────────
 * 대시보드·A/S 접수·Excel 생성·시스템 설정은 지금 로그인만 하면 누구나 쓴다.
 * 그런 영역의 상한은 "그 영역에서 의미 있는 가장 높은 수준"이다 — 낮춰 적으면
 * 그 자체가 새로운 제한이 되어, 화면을 만들었을 뿐인데 동작이 달라진다.
 * 그 영역들은 앞으로 이 설정이 사실상 유일한 제한 장치가 된다.
 * ============================================================================
 */

/** 어느 구간이라도 편집할 수 있으면 접수 건에 쓰기가 있는 것으로 본다. */
function canEditAnyRepairCaseSection(role: Role): boolean {
  return (
    canEditSection(role, "INTAKE") ||
    canEditSection(role, "PRODUCT") ||
    canEditSection(role, "FAULT_SERVICE")
  );
}

/**
 * 참/거짓 사다리를 수준으로 접는다. 위에서부터 처음 참인 칸이 상한이다 —
 * "관리는 되는데 읽기는 안 된다" 같은 조합은 존재하지 않으므로 순서대로 본다.
 */
function ladder(params: { manage?: boolean; write?: boolean; read: boolean }): PermissionLevel {
  if (params.manage) return "MANAGE";
  if (params.write) return "WRITE";
  if (params.read) return "READ";
  return "NONE";
}

function rawBaseline(areaKey: string, role: Role): PermissionLevel {
  switch (areaKey) {
    case "dashboard":
      // 역할 검사 없음 — 볼 것밖에 없는 화면이다.
      return "READ";

    case "repairCases":
      return ladder({
        manage: canBulkDeleteRepairCases(role) || canRestoreRepairCases(role),
        write: canEditAnyRepairCaseSection(role),
        read: true,
      });

    case "myActiveWork":
      return canViewMyActiveWork(role) ? "READ" : "NONE";

    case "repairCaseNew":
      // 접수 생성에는 역할 검사가 없다(로그인+승인만 본다).
      return "WRITE";

    case "diagnosisFlowcharts":
      return ladder({
        manage: canPermanentlyDeleteRepairCaseFlowchart(role) || canManageRepairCaseFlowchartsGlobally(role),
        // 접수 건별 편집 가능 여부는 담당 배정 같은 실행 시점 맥락에 달려 있어
        // (canMutateRepairCaseFlowchart가 ctx를 받는다) 역할만으로는 정할 수
        // 없다. 볼 수 있는 역할은 쓰기까지 상한을 열어 두고, 실제 가부는
        // 종전대로 그 함수가 맥락을 보고 판정한다.
        write: canViewRepairCaseFlowcharts(role),
        read: canViewRepairCaseFlowcharts(role),
      });

    case "workflows":
      return ladder({
        manage: canPublishWorkflowTemplates(role),
        write: canEditWorkflowTemplates(role),
        read: canViewWorkflowTemplates(role),
      });

    case "excelKyosanIntakeList":
      // 역할 검사 없음. 자료를 바꾸지 않고 내려받기만 한다.
      return "READ";

    case "users":
      // 지금은 로그인한 누구나 목록을 본다. 출하 대표자 지정은 최고관리자만이고
      // (shipment-representatives.ts), 이 권한 설정 화면은 관리자 이상이다.
      return ladder({
        manage: role === "SUPER_ADMIN" || role === "ADMIN",
        write: false,
        read: true,
      });

    case "customers":
      return ladder({ write: canEditCustomers(role), read: canViewCustomers(role) });

    case "productModels":
      return ladder({ write: canEditProductModels(role), read: canViewProductModels(role) });

    case "repairCaseExcelImport":
      return canManageExcelImports(role) ? "MANAGE" : "NONE";

    case "technicalProcedures":
      return ladder({
        manage: canPublishTechnicalTemplates(role),
        write: canEditTechnicalTemplateDraft(role),
        read: canViewPublishedTechnicalTemplates(role),
      });

    case "inventory":
      return ladder({
        manage: canProcessPartRequests(role),
        write: canCreateOrEditPart(role),
        read: canViewInventory(role),
      });

    case "settings":
      // 아직 안내 문구만 있는 화면이다.
      return "READ";

    default:
      // 목록에 없는 영역은 열어 주지 않는다. 새 영역을 PERMISSION_AREAS에만
      // 추가하고 여기를 빠뜨리면 조용히 전원 허용되는 편보다 낫다.
      return "NONE";
  }
}

/**
 * 이 역할이 이 영역에서 가질 수 있는 가장 높은 수준.
 * 영역이 정한 "의미 있는 최고 수준"으로도 한 번 더 자른다.
 */
export function baselinePermissionLevel(areaKey: string, role: Role): PermissionLevel {
  const area = PERMISSION_AREAS.find((candidate) => candidate.key === areaKey);
  if (!area) return "NONE";
  return lowerPermissionLevel(rawBaseline(areaKey, role), area.maxMeaningfulLevel);
}

/** 역할 하나의 전 영역 상한. 화면이 드롭다운 선택지를 만들 때 쓴다. */
export function baselinePermissionMap(role: Role): Record<string, PermissionLevel> {
  const map: Record<string, PermissionLevel> = {};
  for (const area of PERMISSION_AREAS) {
    map[area.key] = baselinePermissionLevel(area.key, role);
  }
  return map;
}
