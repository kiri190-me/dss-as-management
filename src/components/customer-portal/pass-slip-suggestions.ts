import type { PassSlipReadOutcome } from "@/lib/ocr/pass-slip-reader";

/**
 * ============================================================================
 * 통문증에서 읽은 것을 **칸에 어떻게 옮길 것인가** — 순수 계산
 * ============================================================================
 * 화면에서 떼어 둔 까닭: 여기서 틀리면 **엉뚱한 건의 PRV No. · Q코드가 고객사
 * 표에 들어간다.** 화면 안에 묻어 두면 눌러 보지 않고는 확인할 수 없는데, 여기
 * 있으면 갈래마다 시험으로 못 박을 수 있다(pass-slip-suggestions.test.ts).
 *
 * ── 🔴 **서류의 S/N 이 이 건과 다르면 한 칸도 쓰지 않는다** ─────────────
 * (사용자 결정 2026-10-01 — 「통문증이 수리건과 맞지 않다면 아무 내용도 넣지
 * 말고 … 불러오기가 끝난 시점에 안내 팝업을 띄워줘」)
 *
 * 처음에는 채워 두고 저장할 때 막는 식이었다. 바꾼 까닭은 **잘못된 값이 화면에
 * 아예 뜨지 않는 쪽이 안전하기 때문**이다 — 떠 있으면 사람이 눌러 저장할 여지가
 * 남고, 줄마다 긴 경고문이 붙어 표가 옆으로 밀린다.
 *
 * 🔴 **「못 읽음(UNREAD)」은 다르다.** 사진이 조금 흐려 S/N 이 안 읽힌 것까지
 * 버리면 쓸 수 있는 값을 버리게 된다 — 그때는 채우고 노란 글로 알린다.
 * ============================================================================
 */

/** 칸 하나의 읽기 결과. 색과 글자가 **언제나 함께** 간다. */
export type PassSlipFieldOutcome = {
  /**
   * ok=초록(믿을 만하다) · warn=노랑(꼭 확인) · absent=파랑(서류에 없는 칸) ·
   * none=회색(손으로 적어야 한다)
   *
   * 🔴 absent 와 none 을 하나로 합치지 마라 — 이 구분이 이 기능의 핵심이다.
   */
  tone: "ok" | "warn" | "absent" | "none";
  /**
   * 색을 못 보는 사람에게도 같은 뜻을 전하는 **짧은** 글자.
   *
   * 🔴 짧게 적어라. 열이 열셋인 표라 칸 밑의 글이 길면 그 열이 넓어지고, 마지막
   * 열([저장])이 짓눌려 글자가 세로로 쪼개진다(실측 2026-10-01). 자세한 것은
   * 풀이(detail)나 팝업으로 미룬다.
   */
  text: string;
  /** 마우스를 올리면 보이는 까닭(선택). 표를 넓히지 않으려고 여기로 미룬다. */
  detail?: string;
  /** 칸에 채워 넣을 값. 없으면 채우지 않는다. */
  value?: string;
};

/** 줄 하나의 결과 — **칸 키 → 그 칸의 결과.** 안 읽은 칸은 키가 없다. */
export type PassSlipRowOutcome = Record<string, PassSlipFieldOutcome>;

/**
 * 읽은 값을 칸에 **얹는다**(저장하지 않는다).
 *
 * 🔴 **아직 손대지 않은 칸에만 얹는다.** 「비었는가」가 아니라 「그 키가 있는가」로
 * 가리는 까닭 둘 — 저장된 값이 있으면 키가 있으므로 덮지 않고, 사람이 적었다가
 * **지운** 칸도 키가 남으므로 다시 채워 넣지 않는다(지운 값이 되살아나면 지운
 * 사람은 영문을 모른다).
 */
export function applyPassSlipSuggestions(
  typedValues: Record<string, string>,
  outcome: PassSlipRowOutcome | null | undefined
): Record<string, string> {
  let values = typedValues;
  for (const [key, field] of Object.entries(outcome ?? {})) {
    if (!field.value) continue;
    if (Object.prototype.hasOwnProperty.call(typedValues, key)) continue;
    values = { ...values, [key]: field.value };
  }
  return values;
}

/** 읽어 채우는 세 칸의 키. 양식 쪽 키와 같아야 한다(PassSlipOcrPanel 이 준다). */
export type PassSlipColumnKeys = {
  passNumber: string;
  prvNumber: string;
  qCode: string;
};

/** 셈. 마침 글이 그대로 읽어 준다. */
export type PassSlipRowCounts = {
  filled: number;
  warned: number;
  absent: number;
  missed: number;
  /** 🔴 S/N 이 맞지 않아 **불러오지 않은** 칸. 「못 읽음」과 다르다. */
  skipped: number;
};

/** 🔴 S/N 이 맞지 않아 아무것도 불러오지 않은 줄. 팝업이 모아 보여 준다. */
export type PassSlipMismatchRow = {
  /** 표에 보이는 줄 번호(1부터). */
  rowNumber: number;
  intakeNumber: string | null;
  /** 이 건의 S/N. */
  caseSerial: string | null;
  /** 통문증에 적힌 S/N. */
  documentSerial: string | null;
};

export type PassSlipRowBuild = {
  outcome: PassSlipRowOutcome;
  counts: PassSlipRowCounts;
  /** 어긋난 줄이면 팝업에 실을 것, 아니면 null. */
  mismatch: { caseSerial: string | null; documentSerial: string | null } | null;
};

const NO_COUNTS: PassSlipRowCounts = {
  filled: 0,
  warned: 0,
  absent: 0,
  missed: 0,
  skipped: 0,
};

/** 못 읽은 칸에 쓰는 글. 한 군데서만 적는다. */
export const WRITE_BY_HAND = "못 읽음 — 손으로 적어 주세요";

/**
 * 한 줄의 읽기 결과를 **칸별 결과와 셈**으로 옮긴다.
 *
 * 🔴 줄 단위 알림(사진 없음 · S/N 어긋남 · 통째로 실패)은 **그 줄의 맨 왼쪽 빈
 * 칸 밑**에 한 번만 짧게 붙인다. 칸마다 되풀이하면 표가 글자로 막히고, 시스템
 * 칸(탈착품 S/N) 밑에 붙이면 그 열이 넓어져 [저장] 열이 짓눌린다.
 */
export function buildPassSlipRow(input: {
  outcome: PassSlipReadOutcome;
  keys: PassSlipColumnKeys;
  /** 이 줄에서 읽어 보려던 **빈 칸들**(차례는 표의 열 차례). */
  targetKeys: string[];
}): PassSlipRowBuild {
  const { outcome, keys, targetKeys } = input;
  const anchor = targetKeys[0];

  if (outcome.status === "FAILED") {
    return {
      outcome: anchor
        ? { [anchor]: { tone: "none", text: "읽지 못했습니다", detail: outcome.message } }
        : {},
      counts: { ...NO_COUNTS, missed: targetKeys.length },
      mismatch: null,
    };
  }

  /*
   * 🔴 **서류의 S/N 이 이 건과 다르면 한 칸도 쓰지 않는다.**
   *
   * 읽기는 끝났지만 그 값들은 **다른 건의 것**이다. 채워 두면 사람이 그대로
   * 저장할 여지가 남는다 — 자세한 것은 읽기가 다 끝난 뒤 팝업이 말한다.
   */
  if (outcome.serialCheck?.state === "MISMATCH") {
    return {
      outcome: anchor
        ? {
            [anchor]: {
              tone: "warn",
              text: "통문증이 이 건의 것이 아닙니다",
              detail: `올라온 통문증에 적힌 S/N 은 ${outcome.serialCheck.documentSerial ?? "(못 읽음)"} 입니다. 값을 불러오지 않았습니다.`,
            },
          }
        : {},
      counts: { ...NO_COUNTS, skipped: targetKeys.length },
      mismatch: {
        caseSerial: null,
        documentSerial: outcome.serialCheck.documentSerial,
      },
    };
  }

  const row: PassSlipRowOutcome = {};
  const counts: PassSlipRowCounts = { ...NO_COUNTS };

  const passNumber = outcome.passNumber;
  if (passNumber) {
    if (passNumber.state === "READ" && passNumber.dateVerified) {
      counts.filled += 1;
      row[keys.passNumber] = {
        tone: "ok",
        text: "읽음 · 작성일과 맞음",
        detail: `통문번호 ${passNumber.value} · 통문작성일 ${passNumber.writtenDates.join(", ") || "-"}`,
        value: passNumber.value,
      };
    } else if (passNumber.state === "READ") {
      counts.warned += 1;
      row[keys.passNumber] = {
        tone: "warn",
        text: "읽음 · 작성일 안 맞음",
        detail: `통문번호 ${passNumber.value} 안의 날짜와 통문작성일(${passNumber.writtenDates.join(", ") || "못 읽음"})이 어긋납니다. 글자 하나가 잘못 읽혔을 수 있습니다.`,
        value: passNumber.value,
      };
    } else {
      counts.missed += 1;
      row[keys.passNumber] = { tone: "none", text: WRITE_BY_HAND };
    }
  }

  const qCode = outcome.qCode;
  if (qCode) {
    if (qCode.state === "READ" && qCode.inKnownList) {
      counts.filled += 1;
      row[keys.qCode] = {
        tone: "ok",
        text: "읽음 · 쓰던 값",
        detail: `읽은 값 ${qCode.value} — 이 고객사에 이미 저장돼 있는 Q코드입니다. (${qCode.why})`,
        value: qCode.value,
      };
    } else if (qCode.state === "READ") {
      counts.warned += 1;
      row[keys.qCode] = {
        tone: "warn",
        text: "읽음 · 처음 보는 값",
        detail: `읽은 값 ${qCode.value} — 이 고객사에 저장된 적 없는 Q코드입니다. 글자 하나가 잘못 읽혔을 수 있으니 통문증과 견주어 보세요. (${qCode.why})`,
        value: qCode.value,
      };
    } else {
      counts.missed += 1;
      row[keys.qCode] = { tone: "none", text: WRITE_BY_HAND, detail: qCode.why };
    }
  }

  const prvNumber = outcome.prvNumber;
  if (prvNumber) {
    if (prvNumber.state === "READ") {
      counts.filled += 1;
      row[keys.prvNumber] = {
        tone: "ok",
        text: "읽음",
        // 🔴 읽은 값을 풀이에 적어 둔다 — 사람이 그 칸에 이미 적어 둔 값이
        //    있으면 **덮지 않으므로**, 칸의 값과 이 알림이 다를 수 있다.
        detail: `읽은 값 ${prvNumber.value} (${prvNumber.why})`,
        value: prvNumber.value,
      };
    } else if (prvNumber.state === "ABSENT") {
      // 🔴 「못 읽음」이 아니다 — 채워야 할 칸이 아니라는 뜻이다.
      counts.absent += 1;
      row[keys.prvNumber] = {
        tone: "absent",
        text: "이 통문증에 없음",
        detail: `${prvNumber.why}. 빈칸으로 두시면 됩니다 — 구미에서 나온 통문증에는 PRV No. 가 없는 건이 있습니다.`,
      };
    } else {
      counts.missed += 1;
      row[keys.prvNumber] = { tone: "none", text: WRITE_BY_HAND, detail: prvNumber.why };
    }
  }

  // S/N 을 **못 읽은**(UNREAD) 줄은 값을 쓰되 한 번 짚어 둔다 — 이 사진이 이 건의
  // 것인지 확인하지 못했다는 뜻이다. 🔴 어긋남(MISMATCH)과 달리 버리지 않는다.
  if (outcome.serialCheck?.state === "UNREAD" && anchor) {
    row[anchor] = row[anchor] ?? { tone: "warn", text: "" };
    row[anchor] = {
      ...row[anchor],
      // 칸의 제 알림이 있으면 그 뒤에 덧붙인다(줄에 하나만 더 붙는다).
      text: row[anchor].text
        ? `${row[anchor].text} · 서류 S/N 확인 못 함`
        : "서류의 S/N 을 못 읽었습니다",
      tone: "warn",
    };
  }

  return { outcome: row, counts, mismatch: null };
}

/**
 * 읽기가 **다 끝난 뒤** 한 번 띄우는 팝업의 글.
 *
 * 🔴 **무엇이 맞지 않는지 구체적으로** 적는다 — 어느 줄인지 · 두 S/N 이 각각
 * 무엇인지 · 그래서 불러오지 않았다는 것 · **무엇을 하면 되는지**. 「맞지
 * 않습니다」만 알리면 사람은 무엇을 해야 할지 모른 채 갇힌다.
 */
export function passSlipMismatchMessage(rows: PassSlipMismatchRow[]): {
  title: string;
  lines: string[];
} {
  return {
    title: "통문증을 불러오지 못한 줄이 있습니다",
    lines: [
      ...rows.map(
        (row) =>
          `${row.rowNumber}번 줄 (${row.intakeNumber ?? "접수번호 없음"}) — 이 건의 S/N 은 ` +
          `${row.caseSerial ?? "(없음)"} 인데, 올라온 통문증에 적힌 S/N 은 ` +
          `${row.documentSerial ?? "(못 읽음)"} 입니다. 다른 건의 통문증으로 보여 값을 불러오지 않았습니다.`
      ),
      "통문증 사진이 이 건의 것인지 확인해 주세요. 올바른 사진으로 바꾸시거나, 값을 직접 적으시면 됩니다.",
    ],
  };
}
