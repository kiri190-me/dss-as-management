"use client";

import type { ReactNode } from "react";

import {
  SERVICE_REPORT_CLOSING_MARK,
  type ServiceReportBodyMetrics,
} from "@/lib/domain/service-report-body-wrap";
import {
  countServiceReportBodyRows,
  countServiceReportRemarkRows,
  serviceReportBodyLines,
  serviceReportFieldError,
  type ServiceReportFormLimits,
  type ServiceReportFormValues,
} from "@/lib/domain/service-report-form";
import { ServiceReportBodyPreview, ServiceReportRemarkPreview } from "./ServiceReportBodyPreview";
import { RowCounter, ServiceReportSection, TextAreaField } from "./ServiceReportField";
import {
  SERVICE_REPORT_GRID_CONTAINER_CLASS,
  SERVICE_REPORT_GRID_ROW_CLASS,
  serviceReportGridInputMaxWidthCss,
  serviceReportGridScaleStyle,
} from "./service-report-grid";

/**
 * ============================================================================
 * 🔴 적는 칸이 문서와 **같은 자리에서** 줄을 바꾼다 (2026-10-18)
 * ============================================================================
 * 첫 조각은 칸의 **폭**을 문서의 칸 폭(600px)에 맞췄다. 그런데 사용자가 눈으로
 * 보고 짚었다 — 줄 바뀌는 자리가 여전히 다르다:
 *
 *   문서·미리보기 — `… I=2060으로 정상 OFF인식하고 있는 것을` / `확인하였습니다.`
 *   적는 칸       — `… 있는 것을 확인하였습니다` / `다. (규격: …)`
 *
 * 폭이 맞아도 **세는 단위**가 달랐다. 문서는 고정폭 84칸(한글 2 · 영숫자 1)으로
 * 세는데 보통 글꼴은 영숫자가 한글의 절반보다 좁아, 영숫자가 섞이면 적는 칸이
 * 더 많이 담는다. 그래서 이 조각은 **글꼴과 폭을 한 벌로** 바꾼다 —
 * `service-report-grid.ts` 하나가 적는 칸·미리보기·이 배치 상자에 치수를 나눠 준다.
 *
 *   본문 84칸 → 한글 42자 폭 588px → 상한 **614px**(여백 12×2 + 테두리 1×2)
 *   비고 51칸 → 357px → 상한 **383px**
 *
 * 🔴 **2026-10-18 셋째 조각에서 글꼴이 맑은 고딕으로 바뀌었다**(사용자 요청 —
 * 엑셀 본문 글꼴이 그것이다). 맑은 고딕은 영숫자가 가변폭이라 「한글 1자 = 영숫자
 * 2칸」이 성립하지 않는다. 위의 폭은 **한글로 찬 줄**이 문서와 같은 자리에서
 * 바뀌게 하는 값이고, 영숫자가 섞인 줄은 적는 칸이 문서보다 **일찍** 바꾼다.
 * 정확한 자리는 오른쪽 미리보기가 맡는다 — 그 역할 나눔이 아래 안내문에 적혀 있다.
 *
 * 🔴 숫자를 여기 적지 않는다. `serviceReportGridInputMaxWidthPx(칸 수)` 가
 * 돌려주고, 칸 수는 양식에서 나온 값이다(`SERVICE_REPORT_BODY_WRAP_WIDTH`).
 *
 * ── 그래서 오른쪽이 비었다 → 미리보기를 놓았다 ───────────────────────────
 * 칸을 좁히고 나니 오른쪽이 통째로 비었다(사용자 지적: 「빈 공간이 너무
 * 낭비되는 것 같아」). 그 자리에 **문서에서 어떻게 나올지**를 그린다
 * (`ServiceReportBodyPreview.tsx`). 🔴 그 미리보기는 채우개가 쓰는 **바로 그
 * 나누기 함수**와 **바로 그 라벨·맺음 표시**를 쓴다.
 *
 * 🔴 **상한이지 고정 폭이 아니다.** `editInputClass` 의 `w-full` 이 그대로라
 * 좁은 화면에서는 화면을 따라 줄어든다(가로 스크롤이 생기지 않는다).
 * 🔴 `editInputClass` 는 손대지 않는다 — 저장소 전체가 쓰는 입력칸 모양이라
 * 거기에 폭을 적으면 수리건 상세 같은 상관없는 화면이 함께 좁아진다.
 *
 * ── 🔴 넷째 조각: 「가로폭을 다 채우도록」 (2026-10-18) ──────────────────
 * 사용자가 화면을 보고 짚었다 — 「여유공간이 너무 많네. 미리보기의 세로 길이를
 * 본문 창에 맞게 더 늘려주고, 본문 내용을 적는 칸과 미리보기가 본문 창의 가로폭을
 * 다 채우도록 해줘.」 이어서 「브라우저의 크기에 따라 **적절하게 반응형으로**」.
 *
 * 🔴 **폭만 늘릴 수는 없다.** 위의 614px 은 「한글 42자」라는 뜻이고, 폭만 늘리면
 * 한 줄에 43·44자가 들어가 문서와 다른 자리에서 줄이 바뀐다. 그래서 **글꼴과 폭을
 * 같은 비율로** 함께 키운다 — 치수는 전부 `service-report-grid.ts` 가 만드는
 * `calc(비율 × var(--sr-grid-font))` 이고, 글꼴 크기는 CSS 가 칸의 안쪽 폭에서
 * 뽑는다(`@container` · `cqi` · `clamp()`). 까닭과 상·하한은 그 파일 머리말에 있다.
 *
 * ── 🔴 다섯째 조각: 칸 수가 **props 로 들어온다** (2026-10-18) ──────────────
 * 위의 84·51 은 양식의 열 너비에서 나온 값인데, **화면이 굳혀 들고 있었다.**
 * 사용자가 양식 넷에 도장만 바꿔 저장했더니 Excel 이 열 너비를 다시 써서
 * (1.875 → 1.90625) 84 가 85 가 되었다 — 채우개는 따라갔고 화면만 뒤처졌다.
 * 이제 서버가 그 건의 양식에서 읽어 넘긴다(`metrics`).
 *
 * 🔴 **못 읽으면 옛 숫자로 물러서지 않는다.** 적는 칸은 눈금 없이 보통 입력칸이
 * 되고(`gridColumns` 를 안 준다), 미리보기 자리에는 까닭 한 줄이 뜬다. 조용히
 * 옛 폭으로 그리면 「문서와 같다」는 약속이 거짓이 된다.
 * ============================================================================
 */

/**
 * 🔴 적는 칸과 미리보기가 들어가는 **줄** — 본문과 비고가 **같은 것**을 쓴다.
 *
 * 바깥이 폭을 재는 자(`@container`)이고, 안쪽이 그 폭에서 뽑은 글꼴 크기를 변수로
 * 심어 둔다. 둘을 갈라 둔 까닭은 CSS 가 **자기 자신의** 컨테이너 질의에는 걸리지
 * 않기 때문이다 — 재는 칸과 그 값을 쓰는 칸이 달라야 한다.
 *
 * 🔴 세로 맞춤을 안 적는다(= stretch). 그래야 미리보기 상자가 옆에 있는 적는 칸들
 * **전체 높이만큼** 늘어난다. 내용이 그보다 길면 줄 자체가 길어진다 — 잘리거나
 * 상자 안에서 따로 미끄러지지 않는다.
 *
 * 🔴 양식을 못 읽었으면 **치수를 안 심는다.** 글꼴 크기 식이 칸 폭에서 나오는데
 * 그 칸 폭을 모르기 때문이다 — 그때는 보통 세로 배치다.
 */
function ServiceReportGridRow({
  metrics,
  children,
}: {
  metrics: ServiceReportBodyMetrics | null;
  children: ReactNode;
}) {
  if (metrics === null) return <div className="flex flex-col gap-4">{children}</div>;
  return (
    <div className={SERVICE_REPORT_GRID_CONTAINER_CLASS}>
      <div style={serviceReportGridScaleStyle(metrics)} className={SERVICE_REPORT_GRID_ROW_CLASS}>
        {children}
      </div>
    </div>
  );
}

/**
 * 본문 세 구역과 비고.
 *
 * ── 줄 수를 늘 보여 준다 ────────────────────────────────────────────────
 * 🔴 본문 상한과 비고 상한은 **서버 페이지가 상수에서 읽어 넘긴 값**이다
 * (`limits`). 화면에 숫자를 적어 두면 양식이 늘어난 날 화면만 뒤처진다.
 *
 * 본문 줄 수에는 눈에 안 보이는 줄들이 든다 — 정형 문구 한 줄, 구역과 구역
 * 사이의 빈 줄, 문서 끝의 맺음 표시(`～이　상～`)와 그 위아래 여백. 그래서
 * 세어 놓은 수가 적은 줄 수보다 크다. 그것을 감춰 두면 "298줄밖에 안 적었는데
 * 왜 넘었다고 하나"가 된다.
 *
 * ⚠️ 그래도 **어림값**이다(`countServiceReportBodyRows` 머리말). 문서가 실제로
 * 쓰는 줄 수는 이 값보다 크거나 같다.
 *
 * ── 정형 문구 칸 ────────────────────────────────────────────────────────
 * 🔴 기본 문구가 미리 채워져 있고 **지울 수 있다.** 지우면 문서의 확인내용
 * 첫 줄이 비고, 되살리려면 다시 적으면 된다. 지운 것과 안 적은 것을 화면이
 * 구별할 필요는 없다 — 보이는 대로 나간다.
 */
export default function ServiceReportBodyFields({
  values,
  onChange,
  fieldErrors,
  limits,
  bodyMetrics,
  rowLimitErrors,
  disabled,
}: {
  values: ServiceReportFormValues;
  onChange: (patch: Partial<ServiceReportFormValues>) => void;
  fieldErrors: Record<string, string> | null;
  limits: ServiceReportFormLimits;
  /**
   * 🔴 서버가 **그 건이 쓸 양식**에서 읽어 넘긴 칸 폭 한 벌. 양식을 못 읽었으면
   * `null` 이고, 그때는 눈금도 미리보기도 없다(머리말의 '못 읽으면').
   */
  bodyMetrics: ServiceReportBodyMetrics | null;
  rowLimitErrors: { body?: string; remark?: string };
  disabled: boolean;
}) {
  const error = (key: string) => serviceReportFieldError(fieldErrors, key);
  const bodyRows = countServiceReportBodyRows(serviceReportBodyLines(values), limits.bodyLayout);
  const remarkRows = countServiceReportRemarkRows(values);

  /**
   * 적는 칸들이 들어가는 **왼쪽 기둥**의 폭 상한.
   *
   * 🔴 입력칸의 상한과 **같은 셈에서** 나온다. 기둥이 더 좁으면 `w-full` 인
   * 입력칸이 기둥에 먼저 잘려, 애써 맞춘 글 폭이 조용히 줄어든다.
   * 🔴 상한이라 좁은 화면에서는 화면을 따라 줄어든다 — 가름을 붙이지 않는다.
   * 🔴 양식을 못 읽었으면 상한 자체가 없다 — 지어낸 폭으로 좁히지 않는다.
   */
  const bodyColumnMaxWidth =
    bodyMetrics === null
      ? undefined
      : serviceReportGridInputMaxWidthCss(bodyMetrics.bodyWrapWidth);

  return (
    <>
      <ServiceReportSection
        title="본문"
        description="한 줄이 문서의 한 줄입니다. 줄 사이를 띄우려면 빈 줄을 넣으세요 — 그대로 문서에 반영됩니다."
      >
        {/*
          🔴 적는 칸과 미리보기를 **나란히**. 좁은 화면에서는 아래로 내려간다
          (`flex-col` 이 기본이고 넓을 때만 `flex-row` 다) — 가로로 미는 화면을
          만들지 않는다.

          🔴 넷째 조각에서 가름의 기준이 **창 1536px 에서 칸 1152px** 로 바뀌었다.
          창이 아니라 칸을 재면 사이드바를 접고 편 것이 그대로 셈에 들고, 1152px 은
          「둘이 나란히 서면서 가로가 남지 않는 가장 좁은 폭」이다 — 더 좁아지면
          글자를 더 줄이는 대신 아래로 내린다(`service-report-grid.ts` 머리말).
        */}
        <ServiceReportGridRow metrics={bodyMetrics}>
          <div
            style={{ maxWidth: bodyColumnMaxWidth }}
            className="flex w-full min-w-0 flex-col gap-4 @6xl:shrink-0"
          >
            {/* 🔴 머리글도 문서에서는 확인내용의 **첫 줄**이다 — 같은 칸에 같은 눈금으로 들어간다. */}
            <TextAreaField
              label="확인내용 머리글 (정형 문구)"
              value={values.findingsIntro}
              onChange={(findingsIntro) => onChange({ findingsIntro })}
              error={error("body.findingsIntro")}
              rows={2}
              hint="비우면 문서에 안 들어갑니다"
              disabled={disabled}
              gridColumns={bodyMetrics?.bodyWrapWidth}
            />
            <TextAreaField
              label="확인내용"
              value={values.findings}
              onChange={(findings) => onChange({ findings })}
              error={error("body.findings")}
              rows={8}
              disabled={disabled}
              gridColumns={bodyMetrics?.bodyWrapWidth}
            />
            <TextAreaField
              label="조치"
              value={values.actions}
              onChange={(actions) => onChange({ actions })}
              error={error("body.actions")}
              rows={8}
              disabled={disabled}
              gridColumns={bodyMetrics?.bodyWrapWidth}
            />
            {/* 🔴 「정리」는 수리 보고서에만 있다. 검사로 고르면 사라지고 보내지도 않는다. */}
            {values.kind === "REPAIR" && (
              <TextAreaField
                label="정리"
                value={values.summary}
                onChange={(summary) => onChange({ summary })}
                error={error("body.summary")}
                rows={5}
                disabled={disabled}
                gridColumns={bodyMetrics?.bodyWrapWidth}
              />
            )}
          </div>

          {/*
            🔴 값을 **글자 그대로** 넘긴다. 미리보기가 `useMemo` 로 다시 나누는
            짝이 전부 원시값이 되어, 다른 칸을 칠 때는 본문을 다시 나누지 않는다.
            🔴 「정리」는 수리 보고서에만 있다 — 검사로 고르면 문서에 안 들어가므로
            미리보기에서도 빠져야 한다(적는 칸이 사라지는 것과 같은 조건).
          */}
          <ServiceReportBodyPreview
            metrics={bodyMetrics}
            findingsIntro={values.findingsIntro}
            findings={values.findings}
            actions={values.actions}
            summary={values.kind === "REPAIR" ? values.summary : ""}
          />
        </ServiceReportGridRow>

        <RowCounter used={bodyRows} limit={limits.maxBodyRows} />
        {/*
          🔴 **이 글은 지금 사실과 맞아야 한다.** 앞 조각까지는 적는 칸이 고정폭
          글꼴이라 문서와 **같은 자리에서** 줄이 바뀌었고, 그래서 「긴 줄은 문서에서
          다시 나뉜다」만 적어 두어도 됐다. 이제 글꼴이 맑은 고딕(가변폭)이라 영숫자가
          섞인 줄은 적는 칸이 **문서보다 일찍** 바꾼다 — 그 사실을 안 적으면 화면이
          거짓말을 한다(`service-report-grid.ts` 머리말의 「역할을 나눈다」).
          🔴 맺음 표시 글자는 **상수에서** 온다 — 여기 적으면 두 벌이 된다.
        */}
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          정형 문구 한 줄, 구역 사이의 빈 줄, 문서 끝의 「{SERVICE_REPORT_CLOSING_MARK}」과 그 위아래
          여백이 함께 셈에 듭니다. 적는 칸이 줄을 바꾸는 자리는 대략입니다 — 한글만 있는 줄은 문서와
          같지만, 영숫자가 섞이면 문서보다 일찍 바뀝니다. 문서에서 실제로 어디서 나뉘는지는 오른쪽
          미리보기를 보세요 — 줄 수도 그만큼 늘 수 있습니다.
        </p>
        {rowLimitErrors.body && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {rowLimitErrors.body}
          </p>
        )}
        {error("body") && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error("body")}
          </p>
        )}
      </ServiceReportSection>

      <ServiceReportSection title="비고">
        {/*
          본문과 **같은 자리에서** 갈라진다 — 두 구역의 미리보기가 같은 선에서 시작한다.
          🔴 기둥의 폭 상한도 **본문 것**을 쓴다. 비고 칸은 문서에서 더 좁지만
          (`gridColumns` 가 그만큼 작다) 기둥까지 좁히면 두 구역의 미리보기가 서로
          다른 선에서 시작한다. 그리고 글꼴은 본문 줄에서 뽑은 것을 비고도 **그대로**
          쓴다 — 두 구역의 글자 크기가 다르면 같은 문서처럼 안 보인다. 그래서 비고
          줄에서는 오른쪽이 조금 남는데, 그것이 **문서가 그런 것**이다(비고 칸이 본문의
          5/8 폭이다).
        */}
        <ServiceReportGridRow metrics={bodyMetrics}>
          <div
            style={{ maxWidth: bodyColumnMaxWidth }}
            className="flex w-full min-w-0 flex-col gap-4 @6xl:shrink-0"
          >
            {/* 🔴 비고 칸은 문서에서 본문보다 좁다(`H60:AF60`) — 칸 수도 그만큼이다. */}
            <TextAreaField
              label="비고"
              value={values.remark}
              onChange={(remark) => onChange({ remark })}
              error={error("remark")}
              rows={4}
              disabled={disabled}
              gridColumns={bodyMetrics?.remarkWrapWidth}
            />
          </div>
          <ServiceReportRemarkPreview metrics={bodyMetrics} remark={values.remark} />
        </ServiceReportGridRow>
        <RowCounter used={remarkRows} limit={limits.maxRemarkRows} />
        {rowLimitErrors.remark && (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {rowLimitErrors.remark}
          </p>
        )}
      </ServiceReportSection>
    </>
  );
}
