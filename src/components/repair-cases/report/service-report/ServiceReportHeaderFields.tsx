"use client";

import {
  serviceReportFieldError,
  serviceReportManufacturedPatch,
  serviceReportUsedPeriodPatch,
  type ServiceReportFormValues,
  type ServiceReportOccurredOnMode,
} from "@/lib/domain/service-report-form";
import {
  DateField,
  editInputClass,
  editLabelClass,
  FieldGroup,
  SelectField,
  ServiceReportSection,
  TextAreaField,
  TextField,
} from "./ServiceReportField";

/**
 * 보고서 머리 칸 — 양식의 8~26행.
 *
 * 칸의 차례는 **양식을 읽는 차례**다. 사람이 종이 양식과 화면을 나란히 놓고
 * 옮겨 적으므로, 화면에서만 보기 좋은 순서로 바꾸면 옮겨 적다 한 칸씩 밀린다.
 */
export default function ServiceReportHeaderFields({
  values,
  onChange,
  fieldErrors,
  choices,
  serialNumberWarning,
  disabled,
}: {
  values: ServiceReportFormValues;
  onChange: (patch: Partial<ServiceReportFormValues>) => void;
  fieldErrors: Record<string, string> | null;
  /** 🔴 양식에서 읽은 드롭다운 목록. 못 읽었으면 빈 목록이다. */
  choices: { situationRequests: readonly string[]; productNames: readonly string[] };
  serialNumberWarning: string | null;
  disabled: boolean;
}) {
  const error = (key: string) => serviceReportFieldError(fieldErrors, key);

  /**
   * 🔴 사슬을 잇는 자리 — S/N → 제조년월 → 사용 기간.
   *
   * 고친 값을 **먼저 얹은 폼**으로 사용 기간을 다시 센다. 방금 채워진 제조년월로
   * 세야 하므로 `values` 그대로 부르면 한 박자 늦는다 — 사람은 S/N 을 한 번
   * 적었는데 사용 기간은 다음 입력에야 채워지는 것으로 보인다.
   *
   * 사용 기간이 달라지는 입력은 넷이다: S/N · 제조 년 · 제조 월 · 접수일.
   */
  const withUsedPeriod = (patch: Partial<ServiceReportFormValues>) => ({
    ...patch,
    ...serviceReportUsedPeriodPatch({ ...values, ...patch }),
  });

  return (
    <ServiceReportSection
      title="머리 칸"
      description="접수 건에서 옮겨 온 값은 초기값일 뿐입니다. 문서에 적을 값이 다르면 그대로 고치세요 — 접수 건은 바뀌지 않습니다."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="고객사명"
          required
          value={values.customerName}
          onChange={(customerName) => onChange({ customerName })}
          error={error("customerName")}
          hint="문서 맨 위, 「님」 앞"
          disabled={disabled}
        />
        <DateField
          label="발행일"
          required
          value={values.issuedOn}
          onChange={(issuedOn) => onChange({ issuedOn })}
          error={error("issuedOn")}
          disabled={disabled}
        />

        {/*
          🔴 세 칸을 나란히 둔다. 양식이 `No. {앞} - {중간} - {뒤}` 로 나뉘어
          있어서, 한 칸에 몰아 받으면 화면과 문서가 다르게 보인다. 사이의 `-` 는
          양식이 갖고 있으므로 여기서는 글자로 보여 주기만 한다.
        */}
        <FieldGroup
          label="문서번호"
          required
          error={
            error("reportNumber") ??
            error("reportNumber.prefix") ??
            error("reportNumber.middle") ??
            error("reportNumber.tail")
          }
          hint="No. 앞 - 중간 - 뒤"
        >
          <div className="flex items-center gap-1">
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">No.</span>
            <input
              value={values.reportNumberPrefix}
              onChange={(event) => onChange({ reportNumberPrefix: event.target.value })}
              disabled={disabled}
              placeholder="Z494"
              aria-label="문서번호 앞"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">-</span>
            <input
              value={values.reportNumberMiddle}
              onChange={(event) => onChange({ reportNumberMiddle: event.target.value })}
              disabled={disabled}
              placeholder="P33A3"
              aria-label="문서번호 중간"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">-</span>
            <input
              value={values.reportNumberTail}
              onChange={(event) => onChange({ reportNumberTail: event.target.value })}
              disabled={disabled}
              placeholder="4013"
              aria-label="문서번호 뒤"
              className={editInputClass}
            />
          </div>
        </FieldGroup>

        <TextField
          label="고객"
          value={values.customer}
          onChange={(customer) => onChange({ customer })}
          error={error("customer")}
          disabled={disabled}
        />
        {/* 🔴 접수일이 사용 기간의 기준일이다 — 고치면 사용 기간을 다시 센다. */}
        <DateField
          label="접수일"
          value={values.receivedOn}
          onChange={(receivedOn) => onChange(withUsedPeriod({ receivedOn }))}
          error={error("receivedOn")}
          disabled={disabled}
        />
        <OccurredOnField values={values} onChange={onChange} error={error("occurredOn")} disabled={disabled} />

        <TextField
          label="발생 장소"
          value={values.occurrencePlace}
          onChange={(occurrencePlace) => onChange({ occurrencePlace })}
          error={error("occurrencePlace")}
          disabled={disabled}
        />
        <TextField
          label="발생 장소 상세"
          value={values.occurrencePlaceDetail}
          onChange={(occurrencePlaceDetail) => onChange({ occurrencePlaceDetail })}
          error={error("occurrencePlaceDetail")}
          hint="예: 공장"
          disabled={disabled}
        />
        <SelectField
          label="품명"
          value={values.productName}
          options={choices.productNames}
          onChange={(productName) => onChange({ productName })}
          error={error("productName")}
          hint="양식의 목록"
          disabled={disabled}
        />

        <TextField
          label="품명 구분"
          value={values.productCategory}
          onChange={(productCategory) => onChange({ productCategory })}
          error={error("productCategory")}
          hint="품명 둘째 줄"
          disabled={disabled}
        />
        <TextField
          label="형식"
          value={values.modelName}
          onChange={(modelName) => onChange({ modelName })}
          error={error("modelName")}
          disabled={disabled}
        />
        {/*
          🔴 S/N 이 7자리면 제조년월이 저절로 채워진다(`YYMMNNN`). 다만 **빈 칸일
          때만** — 사람이 명판을 보고 적은 값을 덮지 않는다. 규칙은
          `domain/service-report-form.ts` 의 `serviceReportManufacturedPatch`.
        */}
        <FieldGroup
          label="제조 년월"
          error={error("manufacturedYear") ?? error("manufacturedMonth")}
          hint="S/N 이 7자리면 저절로 채워집니다"
        >
          <div className="flex items-center gap-1">
            <input
              value={values.manufacturedYear}
              onChange={(event) =>
                onChange(withUsedPeriod({ manufacturedYear: event.target.value }))
              }
              disabled={disabled}
              inputMode="numeric"
              placeholder="2019"
              aria-label="제조 년"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">년</span>
            <input
              value={values.manufacturedMonth}
              onChange={(event) =>
                onChange(withUsedPeriod({ manufacturedMonth: event.target.value }))
              }
              disabled={disabled}
              inputMode="numeric"
              placeholder="7"
              aria-label="제조 월"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">월</span>
          </div>
        </FieldGroup>

        <TextField
          label="L/N"
          value={values.lotNumber}
          onChange={(lotNumber) => onChange({ lotNumber })}
          error={error("lotNumber")}
          disabled={disabled}
        />
        <div className="flex flex-col">
          <TextField
            label="S/N"
            value={values.serialNumber}
            /*
             * 🔴 S/N 을 고치면 제조년월도 따라 채워진다 — **빈 칸일 때만**.
             * 처음 화면을 열 때만 채우면, 접수 때 S/N 을 안 적었다가 여기서
             * 적는 흔한 경우에 제조년월이 끝까지 빈 채로 나간다.
             *
             * 🔴 그리고 **한 번의 입력으로 사용 기간까지 이어진다** — 제조년월
             * 조각을 먼저 얹고, 그것이 든 폼으로 사용 기간을 센다.
             */
            onChange={(serialNumber) =>
              onChange(
                withUsedPeriod({
                  serialNumber,
                  ...serviceReportManufacturedPatch(serialNumber, values),
                })
              )
            }
            error={error("serialNumber")}
            disabled={disabled}
          />
          {/*
            🔴 경고일 뿐 막지 않는다. 양식이 7자리를 보지만 그 판정 칸은 인쇄
            영역 밖이라 문서에는 나오지 않는다 — 7자리가 아니라는 이유로 발행을
            막으면 사람이 없는 숫자를 지어내게 된다.
          */}
          {serialNumberWarning && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{serialNumberWarning}</p>
          )}
        </div>
        {/*
          🔴 제조 년월과 접수일이 있으면 사용 기간이 저절로 채워진다 — 다만
          **빈 칸일 때만**. 기준일은 발행일이 아니라 **접수일**이고(원본 발행본에서
          실측했다), 개월이 0이면 비워 둔다. 규칙과 그 근거는
          `domain/service-report-form.ts` 의 `serviceReportUsedPeriod`.

          저절로 채워지는 칸인데 안내가 없으면, 사람은 자기가 적은 값이 지워질까
          봐 불안해한다 — 위 「제조 년월」과 같은 말투로 적어 둔다.
        */}
        <FieldGroup
          label="사용 기간"
          error={error("usedYears") ?? error("usedMonths")}
          hint="숫자만 · 제조 년월과 접수일이 있으면 저절로 채워집니다"
        >
          <div className="flex items-center gap-1">
            <input
              value={values.usedYears}
              onChange={(event) => onChange({ usedYears: event.target.value })}
              disabled={disabled}
              inputMode="numeric"
              aria-label="사용 년수"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">년</span>
            <input
              value={values.usedMonths}
              onChange={(event) => onChange({ usedMonths: event.target.value })}
              disabled={disabled}
              inputMode="numeric"
              aria-label="사용 개월수"
              className={editInputClass}
            />
            <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">개월</span>
          </div>
        </FieldGroup>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <SelectField
          label="상황 (의뢰 종류)"
          value={values.situationRequest}
          options={choices.situationRequests}
          onChange={(situationRequest) => onChange({ situationRequest })}
          error={error("situation.request")}
          hint="양식의 목록"
          disabled={disabled}
        />
        <TextAreaField
          label="상황 (내용)"
          value={values.situationDetail}
          onChange={(situationDetail) => onChange({ situationDetail })}
          error={error("situation.detail")}
          rows={4}
          disabled={disabled}
        />
      </div>
    </ServiceReportSection>
  );
}

/**
 * 「발생 년월일」 — 날짜와 글자를 둘 다 받는다.
 *
 * 🔴 날짜를 모르는 건이 흔해서 양식이 `―――` 를 적어 두었고, 채우개도 `Date` 와
 * 글자를 둘 다 받는다. 날짜만 받게 하면 그 성질이 죽어서, 사람이 모르는 날짜를
 * 아무거나 골라 넣게 된다.
 */
function OccurredOnField({
  values,
  onChange,
  error,
  disabled,
}: {
  values: ServiceReportFormValues;
  onChange: (patch: Partial<ServiceReportFormValues>) => void;
  error: string | null;
  disabled: boolean;
}) {
  const setMode = (occurredOnMode: ServiceReportOccurredOnMode) => onChange({ occurredOnMode });

  return (
    <FieldGroup label="발생 년월일" error={error}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="radio"
            name="occurredOnMode"
            checked={values.occurredOnMode === "DATE"}
            onChange={() => setMode("DATE")}
            disabled={disabled}
            className="h-3.5 w-3.5"
          />
          날짜
        </label>
        <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="radio"
            name="occurredOnMode"
            checked={values.occurredOnMode === "TEXT"}
            onChange={() => setMode("TEXT")}
            disabled={disabled}
            className="h-3.5 w-3.5"
          />
          직접 적기
        </label>
      </div>
      {values.occurredOnMode === "DATE" ? (
        <input
          type="date"
          value={values.occurredOnDate}
          onChange={(event) => onChange({ occurredOnDate: event.target.value })}
          disabled={disabled}
          aria-label="발생 년월일(날짜)"
          className={editInputClass}
        />
      ) : (
        <>
          <input
            value={values.occurredOnText}
            onChange={(event) => onChange({ occurredOnText: event.target.value })}
            disabled={disabled}
            placeholder="―――"
            aria-label="발생 년월일(글자)"
            className={editInputClass}
          />
          <span className={editLabelClass}>날짜를 모르면 양식처럼 `―――` 를 적습니다.</span>
        </>
      )}
    </FieldGroup>
  );
}
