import "server-only";

import { db } from "../client";
import { insertAuditLog } from "./audit-logs";
import type { ServiceReportKind } from "@/lib/xlsx/service-report-template";

/**
 * 검사·수리 보고서 파일을 내보낸 사실을 감사 로그에 남긴다.
 *
 * ── 왜 남기는가 ─────────────────────────────────────────────────────────
 * 이 파일에는 **법인 직인이 찍혀 있고**, 우리 회사 이름으로 "이 장비를 이렇게
 * 확인했고 원인은 이것이었다"고 적힌 문서다. 고객사에 실제로 나가는 것이므로,
 * 누가 언제 어느 접수 건의 어떤 종류 보고서를 뽑아 갔는지는 남아 있어야 한다.
 * SECURITY_POLICY.md 가 "파일 접근은 반드시 애플리케이션을 통해서만"으로 못
 * 박은 이유가 그것이고(로그인·권한·감사 셋을 한꺼번에 잃지 않기 위해서),
 * 견적서 내보내기(quote-exports.ts)와 첨부 다운로드가 있는 자리와 같다.
 *
 * 여기가 **라우트가 아니라 mutations 인 이유**도 같은 규율이다: 이 함수는
 * 상태를 바꾸지 않지만 audit_logs 에 **쓴다.** 쓰기는 mutations 에 모아 두고,
 * insertAuditLog 가 트랜잭션을 요구하므로 그 트랜잭션을 열 자리가 여기다
 * (attachment-trash.ts 의 recordAttachmentDownload 와 같은 판단).
 *
 * ── FILE_DOWNLOAD 가 아니라 EXCEL_EXPORT 다 ─────────────────────────────
 * FILE_DOWNLOAD 는 **저장돼 있던 파일을 꺼내 간 일**이다. 이쪽은 요청을 받은
 * 순간 만들어 낸 문서라, 디스크에 그런 파일이 있었던 적이 없다. 감사 기록을
 * 읽는 사람이 "그 파일을 찾아보자"고 했을 때 찾을 것이 없는 종류다. 두 가지를
 * 같은 이름으로 남기면 그 구분이 사라진다.
 *
 * ── 🔴 값은 담지 않는다 — 견적서보다 아픈 선택이다 ──────────────────────
 * 확인내용도 조치도 정리도 비고도 적지 않는다. 종류(검사/수리)와 문서번호,
 * 그리고 어느 접수 건이었나뿐이다.
 *
 * 🔴 **견적서와 사정이 다르다는 것을 알고 하는 선택이다.** 견적서는 감사에
 * 발행번호만 남겨도 되는데, quotes 표를 보면 나머지가 전부 있기 때문이다.
 * **보고서는 아직 DB 에 표가 없다** — 문서 내용이 요청과 함께 왔다가 파일로
 * 나가고 끝이라, 여기 안 적으면 **되짚어 볼 원본이 어디에도 없다.**
 *
 * 그래도 안 적는다. 판단은 견적서와 같다: 감사 로그는 3년 보관 대상이라,
 * 거기에 사본을 한 벌 더 만들면 지워야 할 자료가 두 곳이 된다. 확인내용·조치에는
 * 고객사의 장비 사정이 그대로 섞인다. 감사 로그가 답해야 하는 질문은 "무엇이
 * 적혀 있었나"가 아니라 **"누가 언제 우리 이름으로 문서를 만들어 갔나"** 이고,
 * 그 질문에는 이 네 값으로 충분하다.
 *
 * 원본을 되짚어야 한다면 답은 감사 로그가 아니라 **보고서 표를 만드는 것**이다
 * (다음 단계). 그때 이 함수는 그대로 두면 된다 — 남길 것이 늘지 않는다.
 */
export async function recordServiceReportExport(params: {
  repairCaseId: string;
  kind: ServiceReportKind;
  reportNumber: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "EXCEL_EXPORT",
      // plain text 라 새 값이라도 마이그레이션이 필요 없다.
      targetEntity: "repair_cases",
      targetRecordId: params.repairCaseId,
      // 내보내기는 상태를 바꾸지 않으므로 previousValue 가 없다.
      newValue: { kind: params.kind, reportNumber: params.reportNumber },
    });
  });
}
