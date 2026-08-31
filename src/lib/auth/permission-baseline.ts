import { canManageIntakeMailSettings } from "./intake-mail-authorization";
import type { Role } from "@/lib/domain/types";
import {
  PERMISSION_AREAS,
  lowerPermissionLevel,
  permissionLevelRank,
  type PermissionLevel,
} from "./permission-areas";

import {
  canViewCustomers,
  canEditCustomers,
  canDeleteCustomers,
  canCreateEndUser,
  canRenameEndUser,
  canAddEndUserContact,
  canEditEndUserContact,
  canRemoveEndUserContact,
} from "./customer-authorization";
import {
  canViewInventory,
  canCreateOrEditPart,
  canDeleteParts,
  canProcessPartRequests,
  canReceiveStock,
  canReturnStock,
  canUseStock,
  canViewTransactionHistory,
  canViewPartRequests,
  canCreatePartRequest,
} from "./inventory-authorization";
import { canEditDomesticOrders, canViewDomesticOrders } from "./domestic-order-authorization";
import { canDeleteQuotes, canEditQuotes, canViewQuotes } from "./quote-authorization";
import { canViewMyActiveWork } from "./my-active-work-authorization";
import {
  canViewProductModels,
  canEditProductModels,
  canDeleteProductModels,
  canManageProductModelFiles,
} from "./product-model-authorization";
import {
  canBulkDeleteRepairCases,
  canRestoreRepairCases,
  canPermanentlyDeleteRepairCases,
  canEditSection,
} from "./repair-case-edit-authorization";
import {
  canViewWorkRecords,
  canCreateWorkRecord,
  canInvalidateWorkRecord,
} from "./repair-case-work-record-authorization";
import {
  canViewProcedureExecution,
  canPerformOrdinaryExecutionMutation,
  canReopenCompletedOrSkippedNode,
} from "./procedure-case-execution-authorization";
import {
  canViewProcedureValidationManagement,
  canResolveProcedureValidationIssues,
} from "./procedure-template-authorization";
import { canManageRolePermissions } from "./role-permission-authorization";
import {
  canEditCustomerStatus,
  canManageCustomerLinks,
  canViewCustomerPortal,
} from "./customer-portal-authorization";
import {
  maxMeaningfulLevelOfLeaf,
  minMeaningfulLevelOfLeaf,
  isPermissionLeafKey,
} from "./permission-features";
import {
  canViewRepairCaseFlowcharts,
  canMutateRepairCaseFlowchart,
  canManageRepairCaseFlowchartsGlobally,
  canPermanentlyDeleteRepairCaseFlowchart,
} from "./repair-case-flowchart-authorization";
import {
  canViewPublishedTechnicalTemplates,
  canEditTechnicalTemplateDraft,
  canPublishTechnicalTemplates,
  canManageTechnicalTemplates,
  canDeleteTechnicalTemplates,
} from "./technical-procedure-template-authorization";
import { canEditWeeklyReportGoals } from "./weekly-report-authorization";
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

    case "weeklyReport":
      // **보는 쪽은 여전히 전원이다**(read: true) — 대시보드의 하위메뉴이고,
      // 볼 수 있는 역할을 대시보드와 같게 둔다는 승인된 결정은 그대로다.
      // 여기를 빠뜨리면 default 로 떨어져 NONE 이 되고, 그러면 최고관리자까지
      // 화면에서 튕긴다 — 이 저장소가 실제로 겪은 함정이라 이 파일 아래
      // default 주석이 그 경위를 적어 두고 있다.
      //
      // 달라진 것은 **적을 수 있는가** 하나다. `금주 목표`가 생기면서 실제로
      // 저장하는 조작이 붙었으므로 다른 영역들처럼 사다리로 접는다. 여기서도
      // 표로 옮겨 적지 않고 *-authorization.ts를 **호출해서** 구한다(이 파일
      // 맨 위 주석) — 영업이 목표를 적을 수 있는지 없는지는 저쪽 한 곳에만
      // 적혀 있어야 한다.
      return ladder({ write: canEditWeeklyReportGoals(role), read: true });

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

    case "customerPortal":
      // 세 단계가 실제 조작과 짝이 맞는다(permission-areas.ts 의 같은 항목).
      // 표로 옮겨 적지 않고 *-authorization.ts 를 **불러서** 구한다 — 기본값이
      // 바뀌면 저쪽 한 곳만 고치면 된다.
      return ladder({
        manage: canManageCustomerLinks(role),
        write: canEditCustomerStatus(role),
        read: canViewCustomerPortal(role),
      });

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
      return ladder({ manage: canDeleteCustomers(role), write: canEditCustomers(role), read: canViewCustomers(role) });

    case "productModels":
      return ladder({ manage: canDeleteProductModels(role), write: canEditProductModels(role), read: canViewProductModels(role) });

    case "technicalProcedures":
      return ladder({
        manage: canPublishTechnicalTemplates(role),
        write: canEditTechnicalTemplateDraft(role),
        read: canViewPublishedTechnicalTemplates(role),
      });

    case "inventory":
      return ladder({
        manage: canProcessPartRequests(role) || canDeleteParts(role),
        write: canCreateOrEditPart(role),
        read: canViewInventory(role),
      });

    case "domesticOrders":
      // 2단계에서 행 추가·수정이 생겼다 — 서버 액션(actions/domestic-orders.ts)이
      // 실제로 저장하므로 다른 영역들처럼 사다리로 접는다. 관리는 없다:
      // 삭제·휴지통은 아직 만들지 않았고, 없는 조작을 상한에 올려 두면 고른
      // 사람은 무언가 달라졌다고 믿지만 실제로는 아무것도 달라지지 않는다.
      // 여기서도 표로 옮겨 적지 않고 *-authorization.ts를 **호출해서**
      // 구한다(이 파일 맨 위 주석).
      return ladder({ write: canEditDomesticOrders(role), read: canViewDomesticOrders(role) });

    case "quotes":
      // 내자 정리와 같은 모양이다 — 만들기·고치기는 서버 액션이 실제로 저장하고
      // (4단계), 삭제·복원은 관리자 이상이다. 여기서도 역할 목록을 옮겨 적지 않고
      // *-authorization.ts 를 **호출해서** 구한다(이 파일 맨 위 주석).
      return ladder({ manage: canDeleteQuotes(role), write: canEditQuotes(role), read: canViewQuotes(role) });

    case "repairLabor":
      // 보는 것은 견적서와 같다 — 견적을 내려면 어떤 작업이 얼마인지 알아야 하고,
      // 못 보게 하면 사람은 다시 Excel 을 연다.
      //
      // 고치는 것은 **견적서를 지울 수 있는 사람과 같은 집합**이다. 여기 값을
      // 바꾸면 앞으로의 모든 견적 금액이 바뀌므로 개별 견적서를 고치는 것과
      // 무게가 다르다. write 를 따로 두지 않는 이유는 그 중간이 뜻을 갖지 않기
      // 때문이다(permission-areas.ts 의 같은 항목).
      return ladder({ manage: canDeleteQuotes(role), read: canViewQuotes(role) });

    case "mailSettings":
      // 🔴 여기를 빠뜨리면 아래 default 로 떨어져 NONE 이 되고, 최고관리자까지
      // 화면에서 튕긴다 — 이 파일이 겪었다고 적어 둔 함정이 정확히 그것이다.
      //
      // 표로 옮겨 적지 않고 *-authorization.ts 를 **호출해서** 구한다(이 파일
      // 맨 위 주석). 누가 이 설정을 만질 수 있는지는 저쪽 한 곳에만 있어야 한다.
      return ladder({ manage: canManageIntakeMailSettings(role), read: canManageIntakeMailSettings(role) });

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

/**
 * ============================================================================
 * 하위 기능 노드의 상한
 * ============================================================================
 * 메뉴 상한과 같은 원칙이다 — 표로 옮겨 적지 않고 *-authorization.ts를 **호출해서**
 * 구한다. 정책이 바뀌면 상한도 저절로 따라 바뀐다.
 *
 * ── 맥락 인자를 받는 함수는 '가장 유리한 맥락'으로 부른다 ───────────────
 * canCreateWorkRecord(role, ctx)처럼 맥락을 함께 보는 함수가 있다. 상한은
 * "이 역할이 최선의 상황에서 할 수 있는 최대치"여야 하므로, 잠기지 않았고
 * 본인이 담당인 맥락을 넣어 역할 부분만 뽑는다.
 *
 * 이렇게 해도 권한이 새지 않는다. 실제 판정에서는 그 함수가 **진짜 맥락으로
 * 다시 불린다** — 이 트리는 "누가"만 정하고, "언제"는 종전대로 그 함수가 정한다.
 * 담당이 아닌 엔지니어는 상한이 쓰기여도 남의 건에는 여전히 기록을 못 남긴다.
 * ============================================================================
 */

/** 잠기지 않았고, 본인이 담당이고, 대상이 존재하는 맥락. 위 주석 참조. */
const PERMISSIVE_WORK_RECORD = { isAssignedToCase: true, isCaseLocked: false } as const;
const PERMISSIVE_CASE_LOCK = { isCaseLocked: false } as const;
const PERMISSIVE_USE_STOCK = { hasRepairCase: true, isCaseLocked: false } as const;
const PERMISSIVE_ASSIGNMENT = { effectiveAssigneeId: "self", actorUserId: "self" } as const;

function rawLeafBaseline(leafKey: string, role: Role): PermissionLevel {
  switch (leafKey) {
    // ── 전체 A/S 현황 ─────────────────────────────────────────────────────
    case "repairCases.view":
      // 역할 검사 없음 — 로그인한 사람은 모두 목록을 본다.
      return "READ";
    case "repairCases.edit":
      return canEditAnyRepairCaseSection(role) ? "WRITE" : "NONE";
    case "repairCases.workRecords":
      return ladder({
        manage: canInvalidateWorkRecord(role, PERMISSIVE_CASE_LOCK),
        write: canCreateWorkRecord(role, PERMISSIVE_WORK_RECORD),
        read: canViewWorkRecords(role),
      });
    case "repairCases.lifecycle":
      return ladder({
        manage:
          canBulkDeleteRepairCases(role) ||
          canRestoreRepairCases(role) ||
          canPermanentlyDeleteRepairCases(role),
        read: false,
      });
    case "repairCases.files":
      // 첨부에는 아직 아무 역할 검사도 없다 — 지금 화면은 데모라서 로그인한
      // 사람이면 누구나 목록을 보고 메타데이터를 등록한다. 그런 영역의 상한은
      // "그 잎에서 의미 있는 가장 높은 수준"이다(이 파일 맨 위 주석). 낮춰
      // 적으면 표를 만들었을 뿐인데 지금 되던 일이 막히는 셈이 된다.
      //
      // 실제 저장을 붙이는 다음 단계에서 attachment-authorization.ts 가 생기면
      // 다른 잎들처럼 그 함수를 **호출해서** 구하도록 바꾼다. 이 노드를
      // SETTINGS_ENFORCED_LEAVES 에 넣지 않은 것도 같은 이유다 — 아직 이
      // 설정을 최종 관문으로 읽는 코드가 없어서, 넣으면 화면이 거짓말을 한다.
      return ladder({ write: true, read: true });
    case "repairCases.procedureExecution":
      return ladder({
        manage: canReopenCompletedOrSkippedNode(role),
        write: canPerformOrdinaryExecutionMutation(role, PERMISSIVE_ASSIGNMENT),
        read: canViewProcedureExecution(role),
      });

    // ── 진단 Flowchart 관리 ───────────────────────────────────────────────
    case "diagnosisFlowcharts.view":
      return canViewRepairCaseFlowcharts(role) ? "READ" : "NONE";
    case "diagnosisFlowcharts.edit":
      return canMutateRepairCaseFlowchart(role, PERMISSIVE_CASE_LOCK) ? "WRITE" : "NONE";
    case "diagnosisFlowcharts.permanentDelete":
      // canManageRepairCaseFlowchartsGlobally를 여기 섞지 않는다 — 그 함수는
      // canMutateRepairCaseFlowchart와 같은 역할 집합(엔지니어 포함)이라
      // 함께 접으면 영구 삭제가 엔지니어에게 열린다.
      return ladder({ manage: canPermanentlyDeleteRepairCaseFlowchart(role), read: false });

    // ── 워크플로 관리 ─────────────────────────────────────────────────────
    case "workflows.view":
      return canViewWorkflowTemplates(role) ? "READ" : "NONE";
    case "workflows.editDraft":
      return canEditWorkflowTemplates(role) ? "WRITE" : "NONE";
    case "workflows.publish":
      return ladder({ manage: canPublishWorkflowTemplates(role), read: false });

    // ── 사용자 관리 ───────────────────────────────────────────────────────
    case "users.view":
      // 역할 검사 없음 — 지금은 로그인한 누구나 계정 목록을 본다.
      return "READ";
    case "users.shipmentRepresentatives":
      // shipment-representatives.ts가 최고관리자만 통과시킨다.
      return ladder({ manage: role === "SUPER_ADMIN", read: false });
    case "users.rolePermissions":
      // 고정 노드다(permission-features.ts의 fixed). 설정으로 바꿀 수 없고,
      // 여기서는 화면에 표시할 현재 값을 알려 주기 위해서만 계산한다.
      return ladder({ manage: canManageRolePermissions(role), read: false });

    // ── 고객사 관리 ───────────────────────────────────────────────────────
    case "customers.view":
      return canViewCustomers(role) ? "READ" : "NONE";
    case "customers.edit":
      return ladder({ write: canEditCustomers(role), read: canViewCustomers(role) });
    case "customers.endUsers":
      // 등록(영업까지)과 이름 변경(관리자만)이 갈린다 — 쓰기/관리로 나눠 담는다.
      return ladder({
        manage: canRenameEndUser(role),
        write: canCreateEndUser(role),
        read: canViewCustomers(role),
      });
    case "customers.contacts":
      // 추가·수정(영업까지)과 삭제(관리자만)가 갈린다.
      return ladder({
        manage: canRemoveEndUserContact(role),
        write: canAddEndUserContact(role) || canEditEndUserContact(role),
        read: canViewCustomers(role),
      });

    case "customers.lifecycle":
      // 삭제·복원·완전삭제가 한 함수다(customer-authorization.ts) — 셋을
      // 따로 두면 되돌릴 수 없는 역할이 만들어진다.
      return ladder({ manage: canDeleteCustomers(role), read: false });

    // ── 제품 모델 관리 ────────────────────────────────────────────────────
    case "productModels.view":
      return canViewProductModels(role) ? "READ" : "NONE";
    case "productModels.edit":
      return ladder({ write: canEditProductModels(role), read: canViewProductModels(role) });

    case "productModels.files":
      // 수정(위 edit)보다 넓다 — 사진·도면은 엔지니어까지 올린다. 두 함수를
      // 한 칸에 접으면 엔지니어에게 모델명·제조사 수정이 함께 열린다.
      //
      // read를 false로 둔다. 이 잎에서 '보기'는 뜻이 없다 — 사진·도면을 보는
      // 일은 productModels.view가 이미 맡고 있어서, 여기에 읽기를 주면 조회
      // 노드와 구분되지 않는다(minMeaningfulLevel이 WRITE라 어차피 NONE으로
      // 접히지만, 접히는 값을 적어 두면 이 노드가 열람도 준다고 읽힌다).
      // productModels.lifecycle과 같은 모양이다.
      return ladder({ write: canManageProductModelFiles(role), read: false });

    case "productModels.lifecycle":
      // 고객사 쪽과 같은 판단 — 삭제·복원·완전삭제가 한 함수다.
      return ladder({ manage: canDeleteProductModels(role), read: false });

    // ── 기술 작업 절차 ────────────────────────────────────────────────────
    case "technicalProcedures.view":
      return canViewPublishedTechnicalTemplates(role) ? "READ" : "NONE";
    case "technicalProcedures.editDraft":
      return ladder({
        write: canEditTechnicalTemplateDraft(role),
        read: canViewPublishedTechnicalTemplates(role),
      });
    case "technicalProcedures.publish":
      return ladder({
        manage: canPublishTechnicalTemplates(role) || canManageTechnicalTemplates(role),
        read: false,
      });
    case "technicalProcedures.validation":
      return ladder({
        write: canResolveProcedureValidationIssues(role),
        read: canViewProcedureValidationManagement(role),
      });

    case "technicalProcedures.lifecycle":
      // 실제 판정은 분류까지 본다(canDeleteTechnicalTemplates는 TECHNICAL_TASK
      // 전용). 상한은 "역할이 최선의 경우 무엇까지 되는가"이므로 그 분류를
      // 넣어 역할 부분만 뽑는다 — 이 파일 위쪽 '맥락 인자를 받는 함수' 주석과
      // 같은 규칙이다.
      return ladder({ manage: canDeleteTechnicalTemplates(role, "TECHNICAL_TASK"), read: false });

    // ── 재고 관리 ─────────────────────────────────────────────────────────
    case "inventory.view":
      return canViewInventory(role) ? "READ" : "NONE";
    case "inventory.parts":
      return ladder({ write: canCreateOrEditPart(role), read: canViewInventory(role) });
    case "inventory.stock":
      return ladder({
        write: canReceiveStock(role) || canReturnStock(role) || canUseStock(role, PERMISSIVE_USE_STOCK),
        read: canViewInventory(role),
      });
    case "inventory.history":
      return canViewTransactionHistory(role) ? "READ" : "NONE";
    case "inventory.requests":
      return ladder({
        write: canCreatePartRequest(role, PERMISSIVE_CASE_LOCK),
        read: canViewPartRequests(role),
      });
    case "inventory.requestProcessing":
      return ladder({ manage: canProcessPartRequests(role), read: false });
    case "inventory.lifecycle":
      // 등록·수정(재고 담당자까지)보다 좁다 — 삭제는 관리자 이상이다.
      return ladder({ manage: canDeleteParts(role), read: false });

    default:
      // 트리에 없는 키는 열어 주지 않는다. 노드를 permission-features.ts에만
      // 추가하고 여기를 빠뜨리면 조용히 전원 허용되는 편보다 낫다.
      return "NONE";
  }
}

/**
 * 이 역할이 이 잎에서 가질 수 있는 가장 높은 수준.
 *
 * 하위 기능이 없는 메뉴는 잎이 메뉴 자체이므로 메뉴 상한을 그대로 쓴다.
 */
export function baselineLeafLevel(leafKey: string, role: Role): PermissionLevel {
  if (!isPermissionLeafKey(leafKey)) return "NONE";
  if (!leafKey.includes(".")) return baselinePermissionLevel(leafKey, role);

  const clamped = lowerPermissionLevel(rawLeafBaseline(leafKey, role), maxMeaningfulLevelOfLeaf(leafKey));

  // 최소 의미 수준에 못 미치면 그 기능은 이 역할에게 없는 것이다. 예를 들어
  // '고객사 정보 수정'은 쓰기부터 의미가 있으므로, 보기만 되는 역할에게는
  // 읽기가 아니라 접근 불가다 — 보는 일은 같은 메뉴의 '고객사 조회'가 맡는다.
  // 여기서 읽기로 남겨 두면 화면에 고를 수 없는 값이 표시된다.
  if (permissionLevelRank(clamped) < permissionLevelRank(minMeaningfulLevelOfLeaf(leafKey))) {
    return "NONE";
  }
  return clamped;
}
