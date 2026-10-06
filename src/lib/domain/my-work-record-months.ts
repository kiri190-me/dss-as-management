import { toKstYearMonth } from "./date-only";

/**
 * ============================================================================
 * 「내 작업기록」 화면의 달 묶기 — 전부 한국시간 기준
 * ============================================================================
 * 작업기록의 created_at 은 timestamptz 다. 서버가 UTC 로 도는 자리(운영 컨테이너)
 * 에서 getUTCFullYear/getUTCMonth 로 달을 가르면 **한국시간 1일 00:00~09:00 에
 * 적은 기록이 통째로 전 달로 들어간다.** 매달 첫날 아침에 적은 것이 사라진 것처럼
 * 보이는 종류의 고장이고, 보는 사람은 그것이 틀렸다는 것조차 알기 어렵다.
 *
 * 그래서 이 파일에 있는 모든 판정이 Asia/Seoul 을 거친다. 시간대를 다루는 방식은
 * 새로 만들지 않고 이미 있는 것을 그대로 쓴다 — domain/date-only.ts 의
 * toKstYearMonth(그 파일 주석에 같은 함정이 이미 적혀 있다). 시·분만 이 파일이
 * 따로 뽑는데, date-only.ts 는 이름 그대로 **날짜까지만** 다루는 자리라서다.
 *
 * ⚠️ 한국시간은 서머타임이 없다(고정 UTC+9). 그래서 아래 KST_OFFSET_MS 상수 하나로
 * 「한국시간 자정 = 그 전날 15:00 UTC」가 언제나 성립한다 — 날짜별로 다시 물어볼
 * 필요가 없다.
 * ============================================================================
 */

/** 한국시간은 서머타임이 없다 — 고정 +09:00. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 이번 달을 **포함해** 최근 몇 달을 가져오는가.
 *
 * 🔴 한도를 두는 까닭: 이 화면 계열(내 담당 제품 / 내 작업기록)은 페이지 나누기가
 * 없고 서버가 고른 것을 전량 클라이언트로 내려보낸다. 한도가 없으면 한 사람이
 * 몇 해 동안 적은 기록이 전부 한 응답에 실려, 해가 갈수록 느려지다 어느 날
 * 갑자기 못 쓰게 된다. 12개월은 「작년 이맘때와 견준다」가 되는 가장 짧은 길이다.
 */
export const MY_WORK_RECORD_MONTH_WINDOW = 12;

const KST_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  // h23 을 명시한다 — hour12:false 만으로는 자정이 "24" 로 나오는 조합이 있다.
  hourCycle: "h23",
});

function kstParts(instant: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of KST_DATE_TIME_FORMATTER.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

/**
 * 「MM-DD HH:mm」(한국시간). 연도는 묶음 머리(「2026년 10월」)가 이미 말하고
 * 있으므로 줄마다 되풀이하지 않는다.
 */
export function formatKstDayTime(isoString: string): string {
  const parts = kstParts(new Date(isoString));
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 「YYYY-MM」(한국시간 달). 묶음의 열쇠이자 정렬 기준이다. */
export function toMyWorkRecordMonthKey(isoString: string): string {
  return toKstYearMonth(new Date(isoString));
}

/** 「YYYY-MM」 → 「2026년 10월」. 0 을 떼는 것은 사람이 그렇게 읽기 때문이다. */
export function formatMyWorkRecordMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-");
  return `${year}년 ${Number(month)}월`;
}

/**
 * 12개월 창의 **시작 순간**(그 달 1일 한국시간 00:00 을 가리키는 진짜 시각).
 * 조회의 `created_at >= ?` 에 그대로 넣는다.
 *
 * 🔴 UTC 자정이 아니라 **한국시간 자정**이어야 한다. UTC 자정으로 자르면 창의
 * 첫날 00:00~09:00(한국시간)에 적은 기록이 창 밖으로 떨어져, 묶음은 그려지는데
 * 그 달 첫날 아침치만 빠진 목록이 된다.
 */
export function myWorkRecordWindowStart(now: Date): Date {
  const [year, month] = toKstYearMonth(now).split("-").map(Number);
  // 이번 달을 포함해 12개월 → 11개월 전 1일부터. 연·월을 한 숫자로 접었다
  // 되돌리면 연도 넘김(1월에서 뒤로 가기)을 따로 적지 않아도 된다.
  const monthIndex = year * 12 + (month - 1) - (MY_WORK_RECORD_MONTH_WINDOW - 1);
  const startYear = Math.floor(monthIndex / 12);
  const startMonthIndex = ((monthIndex % 12) + 12) % 12;
  return new Date(Date.UTC(startYear, startMonthIndex, 1) - KST_OFFSET_MS);
}

/** 달 묶기에 필요한 것은 적힌 시각 하나뿐이다 — 조회 모듈(server-only)을 끌어오지 않으려고 모양만 받는다. */
export type MonthGroupableRecord = { createdAt: string };

export type MyWorkRecordMonthGroup<T extends MonthGroupableRecord> = {
  /** 「YYYY-MM」(한국시간). */
  yearMonth: string;
  /** 「2026년 10월」. */
  label: string;
  /** 이 달의 기록 수 — records.length 와 늘 같지만, 묶음 머리가 읽는 값이 무엇인지 분명히 하려고 칸으로 둔다. */
  count: number;
  /** 그 달의 기록, **새것부터**. */
  records: T[];
};

/**
 * 기록을 한국시간 달로 묶는다. **최근 달이 위**, 달 안에서는 **새것이 위**.
 *
 * 🔴 **기록이 없는 달은 묶음 자체를 만들지 않는다.** 12개월 창을 미리 펼쳐 놓고
 * 빈 줄을 채우지 않는다는 뜻이다 — 「0건」짜리 줄이 여덟 개 늘어서면 정작 기록이
 * 있는 달을 찾는 데 방해가 된다(설계 결정).
 *
 * 창 밖(12개월보다 오래된) 기록을 여기서 다시 거르지 않는다. 자르는 자리는
 * 조회 한 곳(myWorkRecordWindowStart)이고, 여기서 또 자르면 같은 규칙이 두 곳에
 * 적혀 서로 어긋날 수 있다.
 */
export function groupMyWorkRecordsByKstMonth<T extends MonthGroupableRecord>(
  records: readonly T[]
): MyWorkRecordMonthGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const record of records) {
    const yearMonth = toMyWorkRecordMonthKey(record.createdAt);
    const bucket = buckets.get(yearMonth);
    if (bucket) bucket.push(record);
    else buckets.set(yearMonth, [record]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([yearMonth, bucket]) => ({
      yearMonth,
      label: formatMyWorkRecordMonthLabel(yearMonth),
      count: bucket.length,
      // 조회가 이미 새것부터 주지만 여기서도 못 박는다 — 이 함수만 보고 쓰는
      // 사람이 줄 차례까지 믿을 수 있어야 한다. 시각이 같으면 받은 차례가
      // 그대로 남는다(ES2019 부터 sort 는 안정 정렬이다).
      records: [...bucket].sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    }));
}
