import "server-only";

import type { QuoteEditData } from "@/lib/db/queries/quotes";
import { quoteTemplateKey } from "@/lib/domain/quote-template-variant";
import { isRepairSectionDropped } from "@/lib/domain/quote-work-scope-suppression";
import { readOhQuoteTemplate, readQuoteTemplate, readQuoteTemplateFor } from "@/lib/storage/quote-template";
import { fillQuoteWorkbook } from "@/lib/xlsx/quote-template";
import { fillOhQuoteWorkbook } from "@/lib/xlsx/oh-quote-template";
import { fillMatcherQuoteWorkbook, type MatcherWorkScope } from "@/lib/xlsx/matcher-quote-template";
import {
  fillCableQuoteWorkbook,
  type CableQuoteInput,
  type CableQuoteLine,
} from "@/lib/xlsx/cable-quote-template";

/**
 * ============================================================================
 * 저장된 견적서 값에 원본 양식을 씌워 xlsx 바이트를 만든다 — 두 받기 통로가 나눠 쓴다
 * ============================================================================
 * 보기 권한자의 받기(GET /api/quotes/{id}/xlsx)와 수정 권한자의 [견적서 받기]
 * (POST /api/quotes/{id}/issue)가 **같은 함수로 같은 바이트를** 만든다. 원래 GET 라우트의
 * 6~7번(양식 읽기 · 채우기)에 있던 코드를 **그대로 옮긴 것**이다(2026-09-15 B1b) — 값도
 * 차례도 바꾸지 않았다. 옮긴 까닭은 route.ts 가 Next 가 정한 이름 말고는 export 할 수
 * 없어서 다른 통로가 불러 쓸 수 없기 때문이다.
 *
 * 오류는 여기서 잡지 않는다 — 양식을 못 읽으면 QuoteTemplateError, 셀을 못 찾으면 그 밖의
 * 오류가 그대로 올라간다. 무엇으로 답할지(503 · 500)는 부르는 통로가 정한다.
 *
 * 만든 바이트를 디스크에 남기는지도 이 함수는 모른다 — GET 은 남기지 않고, [견적서 받기]는
 * 사용자 결정대로 공유폴더와 첨부 칸에 남긴다(두 라우트의 머리말).
 * ============================================================================
 */
export async function renderQuoteWorkbook(quote: QuoteEditData): Promise<Buffer> {
  // 양식은 다섯이고 셀 자리가 서로 겹치지 않는다. 장비 종류 × 견적서 종류로
  // 고른다 — 케이블만 장비가 없다(domain/quote-template-variant.ts).
  const templateKey = quoteTemplateKey(quote.laborEquipmentKind, quote.kind);

  /**
   * 🔴 케이블은 **여기서 갈라 나간다** — 아래 `common` 을 만들지도 않는다.
   *
   * 그 양식에는 작업 범위 · 작업비 · O/H 부품 칸이 아예 없고(xlsx/cable-quote-template.ts
   * 머리말), 대신 앞선 셋에 없는 **규격 칸 · 설명 줄 · 특이사항**이 있다. `common` 을
   * 만들어 넘기면 케이블 채우개가 쓰지도 않을 값을 요구하게 되고, 부르는 쪽은 0 과 빈
   * 배열을 지어내야 한다 — `CableQuoteInput` 이 `QuoteInput` 을 물려받지 않은 그 까닭이다.
   *
   * 🔴 **앞선 셋의 갈래는 한 글자도 달라지지 않는다.** 이 되돌림이 그 위에서 끝난다.
   */
  if (templateKey === "CABLE") {
    return fillCableQuoteWorkbook(await readQuoteTemplateFor("CABLE"), cableQuoteInputOf(quote));
  }

  const isOverhaul = quote.kind === "OVERHAUL";
  const common = {
    quoteNumber: quote.quoteNumber,
    // date 칼럼이 "YYYY-MM-DD" 로 온다. new Date("2026-08-28") 은 UTC 자정으로
    // 읽혀 시간대에 따라 하루가 밀리므로, 글자를 그대로 쪼개 로컬 날짜를 만든다
    // (xlsx/sheet-patch.ts 의 toExcelSerialDate 가 로컬 연·월·일을 본다).
    quoteDate: parseDateOnly(quote.quoteDate),
    customerName: quote.customerNameText,
    subject: quote.subject,
    modelName: quote.modelNameText ?? undefined,
    serialNumber: quote.serialNumberText ?? undefined,
    lotNumber: quote.lotNumberText ?? undefined,
    // null 은 "양식의 기본 문구를 그대로 쓴다"는 뜻이라 undefined 로 넘긴다
    // (quote-template.ts 의 '비워 두면 양식의 기본 문구').
    validity: quote.validity ?? undefined,
    delivery: quote.delivery ?? undefined,
    payment: quote.payment ?? undefined,
    // 양식의 `1) 부품 비용` 칸으로 갈 줄들. OH 표시가 붙은 줄은 빼고
    // 아래 overhaulParts 로 보낸다 — 두 그룹은 양식에서 자리가 다르다.
    parts: quote.items
      .filter((item) => !item.isOverhaulPart)
      .map((item) => ({
        name: item.partNameText,
        quantity: item.quantity,
        // numeric 은 문자열로 온다. 숫자를 요구하는 엔진에 넘기는 **이 한
        // 지점에서만** 바꾼다(schema/quotes.ts 의 '금액은 numeric 이다').
        unitPrice: Number(item.unitPrice),
      })),
    workCost: Number(quote.workCost),
    /**
     * 견적서에 적히는 작업 내역 세 묶음. **양식 넷 모두** 이 구역을 갖는다 —
     * 예전에는 매쳐에만 넘겨서, 제너레이터 견적서는 화면에 세 칸이 떠 있는데
     * 파일에는 무슨 수리를 했는지가 한 줄도 안 나갔다.
     *
     * 🔴 빈 묶음은 양식의 기본 문구를 그대로 둔다는 뜻이다(채우개 쪽 규칙).
     * 그래서 이 기능이 생기기 전에 저장된 견적서(작업 내역이 전부 비어 있다)를
     * 다시 내려받아도 표준 문구가 사라지지 않는다.
     */
    workScope: groupWorkScope(quote.workScopeLines),
    /**
     * 통전작업을 빼고 청구한 장이면 **「③ 통전검사」 구역을 머리글까지
     * 지운다.** 작업비에서 그 몫을 뺐는데 문서에는 「절연저항치·내압시험 …」
     * 이 그대로 찍혀 나가면, 하지 않은 시험을 했다고 적어 보내는 셈이다.
     *
     * 🔴 **빈 묶음과 정반대의 뜻이다** — 빈 묶음은 "양식 그대로 둔다"이고
     * 이것은 "없앤다"이다(생성기 셋의 powerTestExcluded 주석).
     *
     * 생성기 셋이 이 객체를 나눠 쓰므로 이 한 줄로 양식 넷이 전부 이어진다.
     * 옛 견적서는 false 라 결과가 한 바이트도 달라지지 않는다.
     */
    powerTestExcluded: quote.powerTestExcluded,
    /**
     * 제너레이터에서 수리 작업을 하나도 고르지 않은 장이면 「② 수리 작업」을
     * 머리글까지 지운다(2026-09-15 사용자). 판정은 도메인 한 곳이다 — 미리보기와
     * 수정 화면이 같은 함수를 본다. 매쳐 채우개는 이 값을 받지 않는다(그 양식의
     * 수리작업에는 기본 목록이 있고, 도메인도 매쳐에는 늘 거짓을 준다).
     */
    repairSectionDropped: isRepairSectionDropped({
      equipmentKind: quote.laborEquipmentKind,
      chosenRepairTaskCount: quote.repairTasks.length,
    }),
    /**
     * 조사 칸을 손대서 비운 채 저장한 장이면 「① 조사작업」을 머리글까지 지운다
     * (2026-09-15 사용자). **저장된 결정을 그대로 넘긴다** — 빈 조사 줄만 보고
     * 셈하면 옛 견적서의 표준 목록까지 사라진다(schema/quotes.ts 의 그 항목).
     * 생성기 셋 모두 받는다.
     */
    investigationExcluded: quote.investigationExcluded,
  };

  if (templateKey.startsWith("MATCHER:")) {
    /**
     * 매쳐 양식에는 O/H 부품 칸이 따로 없다 — **부품이 한 목록**이라 나눈
     * 것을 다시 합쳐 넘긴다. 대신 줄 수가 고정이 아니어서 담을 만큼 늘어난다
     * (xlsx/matcher-quote-template.ts).
     */
    return fillMatcherQuoteWorkbook(await readQuoteTemplateFor(templateKey), {
      ...common,
      parts: quote.items.map((item) => ({
        name: item.partNameText,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })),
    });
  } else {
    return isOverhaul
      ? fillOhQuoteWorkbook(await readOhQuoteTemplate(), {
          ...common,
          // `2) OH 부품 비용` 칸(34~46행). OH 표시가 붙은 줄만 여기로 간다.
          overhaulParts: quote.items
            .filter((item) => item.isOverhaulPart)
            .map((item) => ({
              name: item.partNameText,
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice),
            })),
        })
      : fillQuoteWorkbook(await readQuoteTemplate(), common);
  }
}

/**
 * ============================================================================
 * 저장된 케이블 견적서 한 장 → 케이블 채우개가 받는 입력
 * ============================================================================
 * **순수 함수로 떼어 놓은 것은 시험 때문이다** — 위 renderQuoteWorkbook 은 디스크에서
 * 양식을 읽으므로 그 파일 없이는 부를 수 없다. 여기서 정해지는 것(줄의 차례 · 설명 줄 ·
 * 규격 · 날짜)이 곧 문서에 적히는 값이라, 그 규칙만은 양식 없이도 못 박을 수 있어야 한다.
 *
 * ── 🔴 `items` 가 아니라 `itemLines` 를 본다 ────────────────────────────────
 * `items` 에는 **설명 줄이 빠져 있고 규격도 없다**(db/queries/quotes.ts 의 두 목록).
 * 그것으로 케이블 양식을 채우면 `* 20kW RFG 부속케이블 Parts 3종` 같은 줄이 소리 없이
 * 사라진 견적서가 고객사로 나간다 — 사람은 자기가 적은 대로 나간 줄 안다.
 *
 * ── 차례를 그대로 옮긴다 ────────────────────────────────────────────────────
 * 설명 줄이 **어느 품목 묶음 위에 붙는지**가 그 줄의 내용이다(그 목록의 머리말). 그래서
 * 종류로 나누지 않고 `line_no` 차례 그대로 한 목록으로 넘긴다 — 채우개가 아홉 자리에
 * 위에서부터 앉히고, 번호는 품목 줄만 센다.
 *
 * 아홉 줄을 넘는지 · 값이 비었는지는 여기서 보지 않는다. 채우개의
 * `validateCableQuoteInput` 이 한 곳에서 던진다(자르지 않는다 — 그 파일의 머리말).
 * ============================================================================
 */
export function cableQuoteInputOf(quote: QuoteEditData): CableQuoteInput {
  return {
    quoteNumber: quote.quoteNumber,
    // 앞선 셋과 **같은 함수**로 읽는다 — `new Date(문자열)` 은 UTC 로 읽혀 하루가 밀린다.
    quoteDate: parseDateOnly(quote.quoteDate),
    customerName: quote.customerNameText,
    subject: quote.subject,
    // null 은 "양식의 기본 문구를 그대로 쓴다"는 뜻이라 undefined 로 넘긴다(위 common 과 같다).
    validity: quote.validity ?? undefined,
    delivery: quote.delivery ?? undefined,
    payment: quote.payment ?? undefined,
    /**
     * 특이사항은 **케이블에만 있는 칸**이다(quotes.remarks). 안 적었으면 undefined —
     * 빈 글자를 넘기면 양식의 그 칸을 빈 글자로 덮어쓰게 되고, 둘은 뜻이 다르다.
     */
    remarks: quote.remarks ?? undefined,
    lines: quote.itemLines.map(toCableQuoteLine),
  };
}

function toCableQuoteLine(line: QuoteEditData["itemLines"][number]): CableQuoteLine {
  /**
   * 설명 줄의 글은 품명 칸에 들어 있다(quote_items.part_name_text). 수량 · 단가는 DB 가
   * NULL 을 보증하고(CHECK quote_items_amounts_item_line_only), 케이블 채우개의
   * `CableQuoteNoteLine` 에도 그 칸이 아예 없다 — 여기서 지어낼 것이 없다.
   */
  if (line.kind === "NOTE") return { kind: "NOTE", text: line.partNameText };

  return {
    kind: "ITEM",
    name: line.partNameText,
    // 규격은 없을 수 있다. 채우개가 빈 자리에 `-` 를 적는다(CABLE_QUOTE_EMPTY_SPEC).
    spec: line.partSpecText,
    /**
     * 🔴 **0 으로 접지 않는다** — 품목 줄의 수량 · 단가는 CHECK 가 보증하므로 여기
     * `?? 0` 이 실제로 쓰이는 일은 없다. 만에 하나 비어 있으면 0 이 되어
     * `validateCableQuoteInput` 이 「수량은 0보다 커야 합니다」로 멈춘다 — 0원짜리
     * 품목이 적힌 문서가 나가는 것보다 낫다.
     */
    quantity: line.quantity ?? 0,
    // numeric 은 문자열로 온다. 숫자를 요구하는 엔진에 넘기는 이 한 지점에서만 바꾼다.
    unitPrice: Number(line.unitPrice ?? 0),
  };
}

/**
 * 작업 내역 줄을 세 묶음으로 나눈다. 차례는 조회가 이미 묶음별로 매겨 준다
 * (db/queries/quotes.ts).
 */
function groupWorkScope(
  lines: readonly { section: keyof MatcherWorkScope; text: string }[]
): MatcherWorkScope {
  const grouped: Record<keyof MatcherWorkScope, string[]> = {
    INVESTIGATION: [],
    REPAIR: [],
    POWER_TEST: [],
  };
  for (const line of lines) grouped[line.section].push(line.text);
  return grouped;
}

/** "YYYY-MM-DD" → 그 날짜의 로컬 Date. `new Date(문자열)` 은 UTC 로 읽혀 하루가 밀린다. */
function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
