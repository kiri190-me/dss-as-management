import "server-only";
import { assessOverhaul } from "@/lib/domain/overhaul";
import { composeIntakeMail } from "@/lib/domain/intake-mail-body";
import { referencedCids } from "@/lib/domain/mail-signature-html";
import {
  getIntakeMailDispatchSettings,
  getSignatureImagesByCids,
  listActiveRecipientEmails,
} from "@/lib/db/queries/intake-mail-settings";
import { getRepairCaseById } from "@/lib/db/queries/repair-cases";
import { getRelatedRepairHistory } from "@/lib/db/queries/procedure-case-execution";
import { sendMail } from "@/lib/server/mail/send";

/**
 * ============================================================================
 * 접수가 등록되면 전사원에게 알린다 — 보낼지 말지부터 여기서 정한다
 * ============================================================================
 *
 * ■ 🔴 던지지 않는다
 *
 * 이 함수는 **접수가 이미 만들어진 뒤에** 불린다. 여기서 무슨 일이 나든 접수는
 * 되돌아가면 안 된다 — 메일 서버가 죽었다고 접수가 실패하면 담당자는 물건을
 * 앞에 두고 아무것도 못 한다. 그래서 모든 실패를 값으로 돌려주고, 부르는 쪽이
 * try/catch 를 빠뜨려도 그 규율이 지켜지게 한다.
 *
 * ■ 안 보내는 경우가 많고, 그게 정상이다
 *
 *   DISABLED         자동 발송이 꺼져 있다(기본값)
 *   NO_RECIPIENTS    고른 사람이 없다 — "안 골랐으니 전원"이 아니다
 *   CASE_NOT_FOUND   방금 만든 접수를 못 읽었다(있을 수 없지만 조용히 넘어가지 않는다)
 *
 * 이유를 갈라 돌려주는 것은 **감사 기록에 남기기 위해서**다. "안 갔다"만 남으면
 * 껐기 때문인지 고장인지 나중에 아무도 답할 수 없다.
 *
 * ■ 대량 이관에서는 부르지 않는다
 *
 * 그 판단은 부르는 쪽(services/create-repair-case.ts)이 한다 — 과거 자료를
 * 옮길 때마다 수백 통이 나가면 안 된다.
 * ============================================================================
 */

export type IntakeMailDispatchResult =
  | { sent: true; recipients: number }
  | {
      sent: false;
      reason: "DISABLED" | "NO_RECIPIENTS" | "CASE_NOT_FOUND" | "SEND_FAILED";
      detail?: string;
    };

export async function sendIntakeNotificationMail(params: {
  repairCaseId: string;
  /** O/H 판정 기준일. 인자로 받는 이유는 domain/overhaul.ts 와 같다 — 시험 가능해야 한다. */
  referenceDate?: Date;
}): Promise<IntakeMailDispatchResult> {
  try {
    const settings = await getIntakeMailDispatchSettings();
    if (!settings.isEnabled) return { sent: false, reason: "DISABLED" };

    const recipients = await listActiveRecipientEmails();
    if (recipients.length === 0) return { sent: false, reason: "NO_RECIPIENTS" };

    const repairCase = await getRepairCaseById(params.repairCaseId);
    if (!repairCase) return { sent: false, reason: "CASE_NOT_FOUND" };

    /*
     * 과거 이력은 **동일 제품만** 싣는다(사용자 결정). 조회는 동일 모델 참고
     * 이력도 함께 주지만 여기서 쓰지 않는다 — 같은 모델이라는 이유로 남의
     * 물건 고장 이력이 전사 메일에 실리면 읽는 사람이 이 물건 이력으로 오해한다.
     */
    const history = repairCase.productId
      ? (await getRelatedRepairHistory(repairCase.id, repairCase.productId)).sameProduct
      : [];

    const composed = composeIntakeMail({
      template: {
        subject: settings.subjectTemplate,
        intro: settings.introText,
        outro: settings.outroText,
      },
      // 저장된 서명은 이미 정화된 것이다(mutations/intake-mail-settings.ts).
      signature: settings.signatureHtml,
      intake: {
        intakeNumber: repairCase.intakeNumber,
        receivedAt: repairCase.receivedAt,
        customerName: repairCase.customerName,
        endUserName: repairCase.endUserName,
        modelName: repairCase.modelName,
        serialNumber: repairCase.serialNumber,
        lotNumber: repairCase.lotNumber,
        reportedSymptom: repairCase.reportedSymptom,
        billingType: repairCase.billingType,
        overhaul: assessOverhaul(repairCase.serialNumber, params.referenceDate ?? new Date()),
      },
      history: history.map((row) => ({
        intakeNumber: row.intakeNumber,
        receivedAt: row.receivedAt,
        reportedSymptom: row.reportedSymptom,
        actualShipmentDate: row.actualShipmentDate,
      })),
    });

    const images = await getSignatureImagesByCids(referencedCids(settings.signatureHtml));

    const result = await sendMail({
      to: recipients,
      subject: composed.subject,
      text: composed.body,
      html: composed.html,
      attachments: images,
    });

    if (!result.ok) return { sent: false, reason: "SEND_FAILED", detail: result.message };
    return { sent: true, recipients: result.accepted };
  } catch (error) {
    // 예상 못 한 것까지 여기서 멈춘다. 위 주석의 "던지지 않는다"가 이 catch 다.
    return {
      sent: false,
      reason: "SEND_FAILED",
      detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}
