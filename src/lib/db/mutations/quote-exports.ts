import "server-only";

import { db } from "../client";
import { insertAuditLog } from "./audit-logs";

/**
 * 견적서 파일을 내보낸 사실을 감사 로그에 남긴다.
 *
 * ── 왜 남기는가 ─────────────────────────────────────────────────────────
 * 이 파일에는 **법인 직인이 찍혀 있고 거래 금액이 적혀 있다.** 고객사에 실제로
 * 나가는 문서이므로, 누가 언제 어느 견적서를 뽑아 갔는지는 남아 있어야 한다.
 * SECURITY_POLICY.md 가 "파일 접근은 반드시 애플리케이션을 통해서만"으로 못
 * 박은 이유가 그것이고(로그인·권한·감사 셋을 한꺼번에 잃지 않기 위해서),
 * 첨부 다운로드가 FILE_DOWNLOAD 를 남기는 것과 같은 자리다.
 *
 * ── FILE_DOWNLOAD 가 아니라 EXCEL_EXPORT 다 ─────────────────────────────
 * FILE_DOWNLOAD 는 **저장돼 있던 파일을 꺼내 간 일**이다. 이쪽은 요청을 받은
 * 순간 만들어 낸 문서라, 디스크에 그런 파일이 있었던 적이 없다. 감사 기록을
 * 읽는 사람이 "그 파일을 찾아보자"고 했을 때 찾을 것이 없는 종류다. 두 가지를
 * 같은 이름으로 남기면 그 구분이 사라진다.
 *
 * ── 값은 담지 않는다 ────────────────────────────────────────────────────
 * 금액도 품명도 신고증상도 적지 않는다. **무엇을 누가 가져갔는지는 견적서 id 와
 * 발행번호가 이미 답한다**(quotes 표를 보면 나머지가 전부 있다). 감사 로그는
 * 3년 보관 대상이라, 거기에 사본을 한 벌 더 만들면 지워야 할 자료가 두 곳이
 * 된다. 품명·신고증상에는 고객사 사정이 섞인다(schema/quotes.ts 의 PII 항목).
 */
export async function recordQuoteExport(params: {
  quoteId: string;
  quoteNumber: string;
  actorUserId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await insertAuditLog(tx, {
      actorUserId: params.actorUserId,
      actionType: "EXCEL_EXPORT",
      targetEntity: "quotes",
      targetRecordId: params.quoteId,
      // 내보내기는 상태를 바꾸지 않으므로 previousValue 가 없다.
      newValue: { quoteNumber: params.quoteNumber },
    });
  });
}
