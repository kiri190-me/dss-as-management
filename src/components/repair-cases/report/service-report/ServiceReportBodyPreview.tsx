"use client";

import { useMemo, type ReactNode } from "react";

import {
  SERVICE_REPORT_BODY_COLUMN_WIDTH,
  SERVICE_REPORT_REMARK_COLUMN_WIDTH,
  serviceReportBodyPreviewRows,
  serviceReportBodyPreviewSections,
  serviceReportRemarkPreviewLines,
} from "@/lib/domain/service-report-body-wrap";
import { serviceReportLines } from "@/lib/domain/service-report-form";

import {
  SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX,
  serviceReportGridDocumentBoxCss,
  serviceReportGridLabelBoxCss,
  serviceReportGridPreviewScaledCss,
  serviceReportGridPreviewTextStyle,
  serviceReportGridRemarkPreviewTextStyle,
} from "./service-report-grid";

/**
 * ============================================================================
 * 적는 칸 옆에서 「문서에서 어떻게 나올지」를 보여 준다 (2026-10-18)
 * ============================================================================
 * 바로 앞 조각이 적는 칸을 문서 폭에 맞춰 좁혔다. 그래서 오른쪽이 통째로 비었고,
 * 사용자 지적이 「빈 공간이 너무 낭비되는 것 같아」였다. 원래 목적은 「자연스러운
 * 줄바꿈을 고려하면서 내용을 작성」하는 것이고, 그 목적은 **옆에 실제 결과를
 * 놓는 것**으로 가장 잘 산다.
 *
 * ── 🔴 둘째 조각: 「정말 최종 결과물 같은 화면으로」 (사용자 말 그대로) ──
 * 처음 판은 글자만 줄 단위로 늘어놓았다. 발행본과 견주면 빠진 것이 넷이다:
 *   ① 바깥 테두리와 **왼쪽 라벨 칸**(세로줄로 나뉜다)
 *   ② 라벨이 **두 줄로 쪼개진 전각 글자**다 — `확　내`/`인　용`
 *   ③ 본문 끝에 가운데 정렬로 `～이　상～`
 *   ④ 구역과 구역 사이의 빈 줄
 * 넷 다 **글자를 지어내지 않았다** — `domain/service-report-body-wrap.ts` 의
 * `SERVICE_REPORT_BODY_LABELS`·`SERVICE_REPORT_CLOSING_MARK`·`…GAP_ROWS` 에서
 * 오고, 그 상수들은 채우개가 쓰는 바로 그것이다(원래 채우개에 있었고 이 조각에서
 * 순수 모듈로 옮겨 **둘이 나눠 쓴다**).
 *
 * ── 🔴 무엇을 그리고 무엇을 안 그리는가 ─────────────────────────────────
 * 그린다  — 본문 세 구역의 **줄 나뉨** · 라벨 · 구역 사이의 빈 줄 · 맺음 표시,
 *            그리고 비고의 줄(비고는 나누지 않는다). 🔴 셋째 조각부터는 **칸의
 *            실제 치수**(글꼴·글자 크기·줄 높이·칸 폭·테두리·맞춤)도 그린다 —
 *            그것은 채워진 문서에서 값으로 읽어 낼 수 있기 때문이다(아래 「문서와 1:1」).
 * 안 그린다 — 머리 항목(접수·발생장소·기기번호…), 구역이 문서의 **몇 행**에서
 *            시작하는지, 맺음 표시 **아래**의 두 줄.
 *
 * 까닭: 전체 문서를 그리려면 서버에서 엑셀을 매번 채워 다시 읽어야 한다(지금
 * 미리보기 화면이 그렇게 한다 — `.../report/service-report/print`). 타자 한
 * 글자마다 그럴 수는 없다. **줄 나누기 규칙만 알면 본문은 화면에서 그릴 수
 * 있고**, 행 자리는 양식 파일 안에 있어 브라우저가 알 수 없다
 * (`domain/service-report-body-wrap.ts` 머리말).
 *
 * ⚠️ 그래서 구역 **사이**는 채우개가 반드시 넣는 한 줄까지만 그린다. 문서에서는
 * 다음 구역이 제 행에서 시작하느라 더 벌어질 수 있다 — 적게 그리는 쪽이다.
 *
 * ── 🔴 규칙은 한 벌이다 ─────────────────────────────────────────────────
 * 나누는 함수는 채우개가 쓰는 **바로 그 함수**다
 * (`serviceReportBodyPreviewSections` → `splitBodyLine` → `wrapTextToWidth`).
 * 베껴 적으면 화면이 「여기서 나뉜다」고 그려 놓고 문서는 다르게 나누는 날이
 * 오고, 그때 미리보기는 거짓말이 되어 **없느니만 못하다.**
 *
 * ── 🔴 셋째 조각: 상자 안이 **문서와 1:1** 이다 (2026-10-18) ────────────
 * 사용자가 지금 모습을 보고 「나쁘지 않은데 **조금 더** 진짜 미리보기처럼」이라고
 * 했다. 그래서 채워진 문서를 미리보기 화면과 **같은 격자**로 읽어
 * (`xlsx/sheet-print-grid.ts` 의 `readSheetPrintGrid`) 지금 그림과 견주고, 다른
 * 값을 문서 쪽으로 맞췄다 — 실측값과 자리는 `service-report-grid.ts` 머리말에
 * 적어 두었다. 바뀐 것은 다섯이다:
 *
 *   ① 글꼴이 문서와 **같아졌다** — 맑은 고딕 9pt(= 12px)
 *   ② 상자 폭이 문서의 칸 그 자체다 — 본문 `H:AU` **600px** · 비고 `H:AF` 375px
 *      (앞 조각은 「84칸 × 12 ÷ 2 = 504px」이라 영숫자로 찬 줄이 테두리를
 *      넘쳐 나갔다 — 문서에서는 넘치지 않는데 화면에서만 넘쳤다)
 *   ③ 라벨 칸이 문서의 `C:G` **70px** 다(앞 조각은 라벨 **글자** 폭인 36px)
 *   ④ 줄 높이가 문서의 행 높이다 — 본문 14.1pt · 비고 15pt
 *   ⑤ 테두리와 맞춤이 문서를 따른다 — 본문 상자 **위가 double**, 비고 줄은
 *      **가운데 맞춤**(양식이 그렇다)
 *
 * 🔴 **상자의 오른쪽 선은 이제 「줄이 바뀌는 자리」가 아니다.** 문서의 칸 끝이고,
 * 글은 그 안에서 안전 여백(16.7%)을 두고 먼저 끊긴다 — 문서가 그렇기 때문이다
 * (`contentWrapWidth`). 줄이 어디서 바뀌는지는 **그려진 줄 자체**가 보여 준다.
 *
 * ── 🔴 넷째 조각: 상자가 **창을 따라 커지고, 옆만큼 길어진다** (2026-10-18) ──
 * 사용자 말: 「미리보기의 **세로 길이**를 본문 창에 맞게 더 늘려주고, … **가로폭을
 * 다 채우도록** 해줘.」 둘 다 이 파일과 `service-report-grid.ts` 에서 푼다:
 *
 *   **가로** — 치수를 px 로 적지 않고 `calc(비율 × var(--sr-grid-preview-font))` 로
 *     적는다. 글꼴·칸 폭·줄 높이·안쪽 여백이 **한 배율로** 함께 커지므로, 상자 안은
 *     어느 크기에서나 문서와 1:1 이고 🔴 **줄 나뉨은 한 글자도 달라지지 않는다**
 *     (나누는 일은 애초에 글꼴이 아니라 JS 가 한다).
 *   **세로** — 줄(`ServiceReportGridRow`)의 세로 맞춤이 stretch 라 이 칸이 옆의
 *     적는 칸들만큼 길어지고, 상자가 그 높이를 **채운다**(`flex-1`). 내용이 짧아도
 *     상자는 그 높이를 지킨다 — 문서도 칸이 미리 정해져 있어 그게 더 닮았다.
 *     🔴 내용이 **더 길면 줄 자체가 길어진다.** 잘리지도, 상자 안에서 따로
 *     미끄러지지도 않는다 — 미리보기에서 숨겨진 줄이 생기면 그 순간 믿을 수
 *     없는 그림이 된다.
 * ============================================================================
 */

/** 왼쪽 라벨 칸의 폭 — 문서의 `C`~`G` 열 너비(× 배율)다. */
const LABEL_WIDTH = serviceReportGridLabelBoxCss();

/**
 * 미리보기 상자의 테두리와 머리말. 폭을 정하는 것은 안쪽이다.
 *
 * 🔴 세로로 **늘어나는 칸**이다 — 바깥 줄이 stretch 라 이 칸이 옆의 적는 칸들만큼
 * 길어지고, `flex-1` 이 그 높이를 머리말 아래의 상자에 그대로 넘긴다. 중간의
 * `flex` 들이 하나라도 빠지면 늘어남이 거기서 끊긴다.
 */
function PreviewBox({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">{caption}</p>
      {/*
        🔴 이 상자만 가로로 밀린다. 좁은 화면에서 미리보기는 적는 칸 **아래로**
        내려가고(바깥 배치), 그래도 자리가 모자라면 글을 다시 접는 대신 여기서
        민다 — 접으면 문서에 없는 줄바꿈을 보여 주는 거짓말이 된다.

        ⚠️ `flex-1` 에 `min-h-0` 을 붙이지 않는다. 붙이면 내용이 길 때 상자가
        눌려 **세로 스크롤막대**가 생기고, 미리보기에 안 보이는 줄이 생긴다.
      */}
      <div className="flex flex-1 overflow-x-auto">
        <div className="flex w-max flex-col">{children}</div>
      </div>
    </div>
  );
}

/** 빈 줄도 **자리를 지킨다** — 사람이 사이를 띄우려고 넣은 줄이다. */
function cellText(text: string): string {
  // 글자가 없으면 높이를 잃는다. 눈에 안 보이는 글자라 코드포인트로 적는다.
  return text === "" ? " " : text;
}

/**
 * 본문 세 구역의 미리보기 — **발행본의 본문 상자 모양**이다.
 *
 * 🔴 **값을 글자 그대로 받는다.** `useMemo` 의 짝이 전부 원시값이라, 비고를
 * 치거나 머리 항목을 고칠 때는 다시 나누지 않는다 — 타자가 끊기지 않게 하는
 * 자리가 여기다.
 */
export function ServiceReportBodyPreview({
  findingsIntro,
  findings,
  actions,
  summary,
}: {
  findingsIntro: string;
  findings: string;
  actions: string;
  summary: string;
}) {
  const rows = useMemo(
    () =>
      serviceReportBodyPreviewRows(
        serviceReportBodyPreviewSections({
          findingsIntro,
          findings: serviceReportLines(findings),
          actions: serviceReportLines(actions),
          summary: serviceReportLines(summary),
        })
      ),
    [findingsIntro, findings, actions, summary]
  );

  const contentWidth = serviceReportGridDocumentBoxCss(SERVICE_REPORT_BODY_COLUMN_WIDTH);

  return (
    <PreviewBox caption="문서에서 이렇게 나옵니다">
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">본문을 적으면 여기 보입니다.</p>
      ) : (
        /*
          🔴 상자의 네 변이 문서의 본문 상자다 — **위만 겹줄(double)** 이고 나머지
          셋은 가는 선이다(실측: 31행 위 `double` · 좌우 `thin` · 59행 아래 `thin`).
          위가 겹줄인 것은 바로 위 「원인」 칸과 나뉘는 자리라서다.

          🔴 `flex-1` 이 **세로로 늘리는** 자리다 — 옆의 적는 칸들만큼 길어지고,
          내용이 그보다 길면 (`min-height:auto` 라서) 상자가 더 길어진다.
        */
        <div
          style={serviceReportGridPreviewTextStyle}
          className="flex-1 border border-t-[3px] border-zinc-400 bg-white text-zinc-800 [border-top-style:double] dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {rows.map((row, index) => (
            // 줄 글자는 같은 것이 여럿일 수 있어 자리로 센다 — 목록이 통째로
            // 다시 그려지는 자리라 재사용 문제가 없다.
            <div key={index} className="flex">
              <span
                style={{ width: LABEL_WIDTH }}
                className="shrink-0 border-r border-zinc-400 text-center whitespace-pre dark:border-zinc-500"
              >
                {cellText(row.label)}
              </span>
              {/*
                🔴 왼쪽 여백은 **엑셀이 칸 안쪽에 두는 그 여백**이다(문서에서 2px).
                글자가 칸막이에 붙지 않게 하는 것이고, 상자는 `border-box` 라 그만큼
                글 놓이는 자리가 줄 뿐 상자 폭은 문서의 칸 그대로다. 🔴 이것도 **배율을
                탄다** — 안 태우면 확대했을 때 글이 칸막이 쪽으로 붙어 보인다.
              */}
              <span
                style={{
                  width: contentWidth,
                  paddingLeft: serviceReportGridPreviewScaledCss(
                    SERVICE_REPORT_GRID_CELL_PADDING_LEFT_PX
                  ),
                }}
                className={`shrink-0 whitespace-pre ${row.closing ? "text-center" : ""}`}
              >
                {cellText(row.text)}
              </span>
            </div>
          ))}
        </div>
      )}
    </PreviewBox>
  );
}

/**
 * 비고의 미리보기 — 본문보다 **좁은 칸**이다(문서 `H60:AF60`).
 *
 * 🔴 **나누지 않는다.** 채우개는 비고 줄을 한 행에 하나씩 그대로 쓰고, 폭을
 * 넘는 줄은 Excel 이 칸 밖으로 흘리거나 자른다. 여기서 나눠 그리면 문서에 없는
 * 줄바꿈을 보여 주게 된다 — 대신 넘치는 줄을 다른 색으로 칠하고, 그 글자가 칸
 * 끝 선을 실제로 넘어가 보이게 둔다.
 *
 * ⚠️ 본문과 달리 **라벨 칸을 그리지 않는다.** 문서의 「비　고」 라벨 글자는
 * 채우개 안의 확인용 표에만 있고 내보내는 상수가 아니다 — 지어내지 않는다.
 * (빈 라벨 칸만 그리는 길도 있지만, 문서에는 글자가 있으므로 그것은 **거짓말**이다.)
 *
 * 🔴 **가운데 맞춤이다.** 실측으로 `H60:AF60`~`H63:AF63` 의 가로 맞춤이 `center`
 * 였다(본문은 `left`). 줄 높이도 본문(14.1pt)보다 조금 높은 15pt 다.
 */
export function ServiceReportRemarkPreview({ remark }: { remark: string }) {
  const lines = useMemo(
    () => serviceReportRemarkPreviewLines(serviceReportLines(remark)),
    [remark]
  );
  const hasOverflow = lines.some((line) => line.overflows);
  const contentWidth = serviceReportGridDocumentBoxCss(SERVICE_REPORT_REMARK_COLUMN_WIDTH);

  return (
    /*
      🔴 이 바깥 칸도 세로로 늘어나야 한다 — 안의 `PreviewBox` 가 `flex-1` 로 받는
      높이가 여기서 나온다. 경고 한 줄은 상자 **아래**에 붙는다.
    */
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <PreviewBox caption="문서의 비고 칸">
        {lines.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-zinc-500">비고를 적으면 여기 보입니다.</p>
        ) : (
          <div
            style={{ ...serviceReportGridRemarkPreviewTextStyle, width: contentWidth }}
            className="flex-1 border border-zinc-400 bg-white text-zinc-800 dark:border-zinc-500 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {lines.map((line, index) => (
              <div
                key={index}
                className={`whitespace-pre text-center ${
                  line.overflows ? "text-amber-700 dark:text-amber-400" : ""
                }`}
              >
                {cellText(line.text)}
              </div>
            ))}
          </div>
        )}
      </PreviewBox>
      {hasOverflow && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          주황색 줄은 문서의 비고 칸보다 깁니다. 비고는 본문과 달리 자동으로 나뉘지 않아 칸 밖으로
          흘러나가거나 잘립니다 — 줄을 나눠 적어 주세요.
        </p>
      )}
    </div>
  );
}
