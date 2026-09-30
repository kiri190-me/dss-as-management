"use server";

import { resolveActingUserForSession } from "@/lib/auth/acting-user";
import { hasPermission } from "@/lib/auth/permission-resolver";
import { readSession } from "@/lib/auth/session";
import { getAuthSource } from "@/lib/config/auth-source";
import {
  buildCustomerPortalExportGrid,
  prepareCustomerPortalExport,
  resolveCustomerPortalFolderTarget,
  saveCustomerPortalExport,
  type CustomerPortalExportGrid,
} from "@/lib/server/services/customer-portal-export";

/**
 * ============================================================================
 * 고객사 양식 현황표 엑셀 — 서버 액션 (미리보기 · 공유폴더 저장 · 폴더 열기)
 * ============================================================================
 * 이 층이 하는 일은 문지기와 응답 모양뿐이다 — 저장 모드 · 세션 · 승인 · 권한을 보고,
 * 나머지는 services/customer-portal-export.ts 가 한다. 「고객 안내 창구」의 다른
 * 액션들과 같은 문(requireActor)을 쓴다.
 *
 * ── 권한 ────────────────────────────────────────────────────────────────
 *  · 미리보기 · 폴더 열기 → `customerPortal` READ. 화면에서 이미 그 표를 보고 있는
 *    사람이고, 아무것도 바꾸지 않는다.
 *  · 공유폴더에 저장   → `customerPortal` WRITE. 사내 공유폴더에 **파일을 만든다** —
 *    줄마다의 값을 고치는 것과 같은 무게로 본다.
 *
 * ── 🔴 양식 · 파일 이름 · 폴더를 화면에서 받지 않는다 ─────────────────────
 * 들어오는 것은 고객사 id 하나뿐이다. 양식은 서버가 고객사 이름으로 고르고
 * (setCustomerStatusAction 과 같은 규칙), 파일 이름은 공유폴더의 직전 파일에서 나오고,
 * 폴더는 환경변수에서 나온다. 화면이 「어디에 무엇으로 저장할지」를 정하지 못한다.
 * ============================================================================
 */

async function requireActor() {
  if (getAuthSource() !== "database") {
    return { ok: false as const, message: "데이터베이스 저장 모드가 아닙니다." };
  }
  const session = await readSession();
  if (!session) return { ok: false as const, message: "로그인이 필요합니다." };
  const actingUser = await resolveActingUserForSession(session);
  if (!actingUser) return { ok: false as const, message: "로그인이 필요합니다." };
  if (actingUser.approvalStatus !== "APPROVED") {
    return { ok: false as const, message: "계정이 아직 승인되지 않았습니다." };
  }
  return { ok: true as const, actingUser };
}

/** 미리보기가 화면에 건네는 것. 그림은 싣지 않는다(서비스 머리말). */
export type CustomerFormExportPreview = {
  grid: CustomerPortalExportGrid;
  /** 값이 들어간 탭 이름. */
  sheetName: string;
  /** 저장하면 붙을 새 이름(만든 날짜가 들어 있다). */
  fileName: string;
  /** 바탕이 된 직전 파일 이름. */
  previousFileName: string;
  rowCount: number;
  previousRowCount: number;
  /** 새 탭을 더하는 양식인가(JUSUNG) — 화면이 문장을 가른다. */
  addsTab: boolean;
};

export type CustomerFormExportPreviewResult =
  | ({ ok: true } & CustomerFormExportPreview)
  | { ok: false; message: string };

/** 만들어 볼 뿐 — 디스크에 아무것도 쓰지 않는다. */
export async function previewCustomerFormExportAction(input: {
  customerId: string;
}): Promise<CustomerFormExportPreviewResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "READ"))) {
    return { ok: false, message: "고객 안내 현황을 볼 권한이 없습니다." };
  }

  const prepared = await prepareCustomerPortalExport(input.customerId);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const drawn = buildCustomerPortalExportGrid(prepared.plan);
  if (!drawn.ok) return { ok: false, message: drawn.message };

  return {
    ok: true,
    grid: drawn.grid,
    sheetName: prepared.plan.sheetName,
    fileName: prepared.plan.fileName,
    previousFileName: prepared.plan.previousFileName,
    rowCount: prepared.plan.rowCount,
    previousRowCount: prepared.plan.previousRowCount,
    addsTab: prepared.plan.spec.placement.kind === "PREPEND_COPY",
  };
}

export type CustomerFormExportSaveResult =
  /** 🔴 `status` 를 화면까지 가져간다 — 화면이 「새로 만듦」과 「덮어씀」을 다른 결로 낸다. */
  | { ok: true; message: string; fileName: string; status: "saved" | "replaced" | "unchanged" }
  | { ok: false; message: string };

/**
 * ============================================================================
 * 공유폴더에 **오늘 이름으로** 저장한다 — 같은 이름이 있으면 덮어쓴다
 * ============================================================================
 * 🔴 **덮어쓰면 사람이 그 파일을 손으로 고쳐 둔 내용이 사라진다.** 조용히 넘어가면 사람은
 * 자기 수정이 없어진 것을 모른 채 그 파일을 고객사에 보낸다. 그래서 세 문장을 **가른다**:
 *
 *   saved     공유폴더에 새로 만들었습니다 — …
 *   replaced  🔴 같은 이름의 파일을 덮어썼습니다 — … (손으로 고쳐 둔 내용이 있었다면 …)
 *   unchanged 내용이 같은 파일이 이미 있어 그대로 두었습니다 — …
 *
 * 문장만이 아니라 `status` 도 함께 올린다 — 화면이 덮어쓴 경우만 눈에 띄게 낸다
 * (CustomerFormExportPanel: 경고 결).
 * 🔴 견적서 저장은 이 규칙과 무관하다 — 그쪽은 그대로 ` (2)` 로 넘어간다.
 * ============================================================================
 */
export async function saveCustomerFormExportAction(input: {
  customerId: string;
}): Promise<CustomerFormExportSaveResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "WRITE"))) {
    return { ok: false, message: "공유폴더에 저장할 권한이 없습니다." };
  }

  const prepared = await prepareCustomerPortalExport(input.customerId);
  if (!prepared.ok) return { ok: false, message: prepared.message };

  const saved = await saveCustomerPortalExport(prepared.plan);
  if (!saved.ok) return { ok: false, message: saved.message };

  return {
    ok: true,
    fileName: saved.fileName,
    status: saved.status,
    message: saveMessage(saved.status, saved.fileName),
  };
}

function saveMessage(status: "saved" | "replaced" | "unchanged", fileName: string): string {
  switch (status) {
    case "replaced":
      return `같은 이름의 파일이 있어 덮어썼습니다 — ${fileName}. 그 파일을 손으로 고쳐 두셨다면 그 내용은 사라졌습니다.`;
    case "unchanged":
      return `내용이 같은 파일이 이미 있어 그대로 두었습니다 — ${fileName}`;
    case "saved":
      return `공유폴더에 새로 저장했습니다 — ${fileName}`;
  }
}

export type CustomerFormExportFolderResult =
  | { ok: true; link: string; relativePath: string; uncPath?: string }
  | { ok: false; message: string };

/**
 * [폴더 열기]에 필요한 것 — 도우미 주소와(설정이 있으면) 탐색기에 붙여넣을 전체 주소.
 * 🔴 서버 안 경로(CUSTOMER_PORTAL_ARCHIVE_DIR)는 담지 않는다.
 */
export async function customerFormExportFolderAction(): Promise<CustomerFormExportFolderResult> {
  const gate = await requireActor();
  if (!gate.ok) return gate;
  if (!(await hasPermission(gate.actingUser, "customerPortal", "READ"))) {
    return { ok: false, message: "고객 안내 현황을 볼 권한이 없습니다." };
  }

  const target = resolveCustomerPortalFolderTarget();
  if (target.status === "disabled") {
    return { ok: false, message: "공유폴더 위치가 설정되지 않았습니다 — 관리자에게 문의해 주세요." };
  }
  return {
    ok: true,
    link: target.link,
    relativePath: target.relativePath,
    ...(target.uncPath === undefined ? {} : { uncPath: target.uncPath }),
  };
}
