/**
 * ============================================================================
 * 통문증 물품정보 표 — **PRV No.** 와 **Q코드** 를 뽑고 판정한다.
 * ============================================================================
 * 설정이 서로 다른 **세 번**(pass-slip-preprocess.ts 의 PASS_SLIP_GOODS_PASSES)을
 * 읽어 투표한다. 여기 있는 것은 그 세 벌의 글자를 받아 「채울 값」을 정하는
 * 순수 계산이다 — 사진도 글자 인식기도 모른다.
 *
 * 저장소 밖 측정 폴더의 `scripts/decide-lib.js` 를 한 줄도 바꾸지 않고 옮긴
 * 것이다(통문증 14장에 Q코드 14/14 · PRV No. 14/14, 망가뜨린 사진 140회에
 * 「틀린 값을 채움」 0회 · 「있는데 없다고 함」 0회 — 2026-10-01 측정).
 * 단 한 곳만 일부러 다르다 → 아래 「아는 Q코드 목록」.
 *
 * ── 🔴 판정이 **세 갈래**다. 둘로 합치지 마라 ───────────────────────────
 *   READ   — 읽었다. 칸에 채운다.
 *   ABSENT — **그 통문증에 그 값이 없다.** 채울 것이 없다는 뜻이니 사람은
 *            빈칸으로 두면 된다. (구미 통문증에는 PRV No. 가 없는 건이 많다)
 *   UNREAD — 못 읽었다. 사람이 손으로 적어야 한다.
 *
 * ABSENT 과 UNREAD 를 하나로 합치면 사람은 모든 빈칸에 대해 "원본을 열어
 * 확인"해야 한다 — 그러면 이 기능이 아낀 시간이 그대로 사라진다.
 *
 * ── 🔴 「없다」고 말할 자격 — 증거 조건 ─────────────────────────────────
 * 「꼴에 맞는 것이 안 보인다」만으로 ABSENT 을 내면 **흐린 사진이 빈 글로 읽힌
 * 것**까지 「서류에 없다」가 된다. 측정에서 그렇게 짰을 때 **「없다」 오판이 17건**
 * 나왔다(가장 위험한 오판이다 — 사람이 빈칸으로 두고 넘어간다). 그 줄을 실제로
 * 읽었다는 증거(같은 줄의 Q코드 + 그 건의 S/N)를 요구하니 **0건**이 됐다.
 * evidence() 를 떼지 마라.
 *
 * ── 🔴 Q코드는 반드시 `Q` 로 시작한다 ───────────────────────────────────
 * 「영문 4 + 숫자 5」로 넓히면 구미 통문증의 Part No.(`RDAC01543` · `RDAD05022`)가
 * 그 꼴에 **정확히** 들어맞아 구미 건마다 엉뚱한 값을 채운다. 실제로 확인했다.
 * ============================================================================
 */

/** PRV No. — `R2601-2795429` 꼴. 🔴 엑셀 30종이 전부 이 꼴이었다. */
const PRV_PATTERN = /R\s?([0-9]{4})\s?[-–—~]\s?([0-9]{7})/g;

/**
 * PRV 「비슷한 것」 — 꼴에 못 미치지만 그 자리에 무언가 보이기는 한 것.
 *
 * 이것이 걸리면 「없다」고 말하지 않는다. `R` 이 `B·P·8` 로, 숫자 `0·1` 이
 * `O·I·l` 로 읽히는 일이 잦아 그 글자들을 받아 준다.
 */
const PRV_NEAR_PATTERN = /\b[RBP8]\s?[0-9OIl]{3,5}\s?[-–—~_]\s?[0-9OIl]{6,8}\b/g;

/** Q코드 — `Q` + 영문 대문자 3 + 숫자 5. 🔴 `Q` 를 빼지 마라(위 머리말). */
const Q_PATTERN = /\bQ[A-Z]{3}[0-9]{5}\b/g;

/** Q 「비슷한 것」. 첫 글자가 `O·0·G` 로 읽히는 일이 있다. */
const Q_NEAR_PATTERN = /\b[QO0G][A-Z0-9]{3}[0-9OIl]{4,6}\b/g;

/** 물품정보 표의 `S/N : 1706124`. 구분자가 `|` 로 읽히기도 한다. */
const SN_PATTERN = /S\s*[\/|]\s*N\s*[:;.]?\s*([A-Z0-9]{6,12})/gi;

/** 「Part No.」 머리글(또는 수량 단위 `EA`) — 표를 읽기는 했다는 표시. */
const PART_NO_HINT = /P\s?a\s?r\s?t\s*N\s?o/i;
const EA_HINT = /\bEA\b/;

/** 사람이 적어 둔 Q코드가 이 꼴이면 「아는 값」 목록에 넣는다. */
export const Q_CODE_SHAPE = /^Q[A-Z]{3}[0-9]{5}$/;

/** 한 패스(한 번 읽은 글자)에서 뽑아낸 것들. */
export type GoodsPassReading = {
  /** 꼴에 맞는 PRV. 나온 차례대로(중복 그대로). */
  prv: string[];
  /** 꼴에 못 미치지만 비슷한 것. 「없다」를 막는 데만 쓴다. */
  prvNear: string[];
  q: string[];
  qNear: string[];
  sn: string[];
  /**
   * 항번 묶음 — 🔴 **새 PRV 가 나올 때마다 끊는다.**
   *
   * 파주 양식은 읽히는 차례가 `PRV → (관리No.) → Q코드 → 품명 → S/N` 이라,
   * 그렇게 끊으면 사이에 든 S/N 이 그 항번의 것이 된다.
   */
  items: { prvs: string[]; sns: string[] }[];
  /** 「Part No.」 머리글을 읽었는가 — 표를 읽었다는 증거의 한 조각. */
  partNo: boolean;
};

/** 🔴 세 갈래. 머리말의 까닭대로 ABSENT 과 UNREAD 를 합치지 마라. */
export type GoodsFieldState = "READ" | "ABSENT" | "UNREAD";

export type QCodeDecision =
  | {
      state: "READ";
      value: string;
      /**
       * 🔴 그 고객사에 **이미 저장돼 있던 Q코드**인가.
       *
       * false 여도 **채운다** — 목록에 없다고 거절하면 목록이 얇은 처음에는
       * 기능이 아무 일도 못 한다(개발 DB 는 건이 3개다). 대신 화면이 「확인
       * 필요(노랑)」로 보인다. 목록이 쌓일수록 저절로 안전해지는 쪽이다.
       */
      inKnownList: boolean;
      why: string;
    }
  | { state: "ABSENT"; value: null; inKnownList: false; why: string }
  | { state: "UNREAD"; value: null; inKnownList: false; why: string };

export type PrvDecision =
  | { state: "READ"; value: string; rows: number; why: string }
  | { state: "ABSENT"; value: null; rows: number; why: string }
  | { state: "UNREAD"; value: null; rows: number; why: string };

/* ────────────────────────────────────────────────────────────────────────── *
 * 1. 글자에서 뽑기
 * ────────────────────────────────────────────────────────────────────────── */

/** S/N 을 견주기 좋게 다듬는다 — 대문자 · 영숫자만. */
function normalizeSerial(value: string | null | undefined): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * 두 S/N 이 같은 것인가.
 *
 * 한쪽이 다른 쪽에 들어 있어도 같은 것으로 본다 — 인식기가 앞뒤에 글자 하나를
 * 더 붙여 읽는 일이 잦다. 너무 짧은 것(6자 미만)에는 그 완화를 쓰지 않는다.
 */
export function serialsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeSerial(a);
  const right = normalizeSerial(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 6 && right.length >= 6 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return false;
}

/** 한 패스의 글자를 읽어 뽑아낸다. */
export function parseGoodsPass(text: string): GoodsPassReading {
  // 🔴 `matchAll` 은 전역 정규식의 lastIndex 를 건드리지 않는다(사본을 쓴다).
  //    exec 로 바꾸면 모듈 상수를 쓰는 이 코드가 두 번째 호출부터 조용히 틀린다.
  const body = (text ?? "").replace(/\r/g, "");

  const prvMarks = [...body.matchAll(PRV_PATTERN)].map((m) => ({
    at: m.index ?? 0,
    value: `R${m[1]}-${m[2]}`,
  }));
  const snMarks = [...body.matchAll(SN_PATTERN)].map((m) => ({
    at: m.index ?? 0,
    value: m[1].toUpperCase(),
  }));
  const q = [...body.matchAll(Q_PATTERN)].map((m) => m[0]);
  const qNear = [...body.matchAll(Q_NEAR_PATTERN)]
    .map((m) => m[0])
    .filter((found) => !Q_CODE_SHAPE.test(found));
  const prvNear = [...body.matchAll(PRV_NEAR_PATTERN)]
    .map((m) => m[0].replace(/\s/g, ""))
    .filter((found) => !/^R[0-9]{4}-[0-9]{7}$/.test(found));

  // 항번 묶기 — PRV 가 나오면 새 묶음, 그 뒤의 S/N 은 그 묶음의 것.
  const marks = [
    ...prvMarks.map((mark) => ({ ...mark, kind: "prv" as const })),
    ...snMarks.map((mark) => ({ ...mark, kind: "sn" as const })),
  ].sort((a, b) => a.at - b.at);

  const items: { prvs: string[]; sns: string[] }[] = [];
  let current: { prvs: string[]; sns: string[] } | null = null;
  for (const mark of marks) {
    if (mark.kind === "prv") {
      // 같은 PRV 가 한 줄에 두 번 보이는 양식이 있다(Part No. 칸과 품명 칸).
      if (current && current.prvs.includes(mark.value)) continue;
      // 아직 S/N 을 못 만난 묶음이면 같은 줄의 다른 표기로 본다.
      if (current && current.sns.length === 0) {
        current.prvs.push(mark.value);
        continue;
      }
      current = { prvs: [mark.value], sns: [] };
      items.push(current);
    } else {
      if (!current) {
        current = { prvs: [], sns: [] };
        items.push(current);
      }
      if (!current.sns.includes(mark.value)) current.sns.push(mark.value);
    }
  }

  return {
    prv: prvMarks.map((mark) => mark.value),
    prvNear,
    q,
    qNear,
    sn: snMarks.map((mark) => mark.value),
    items,
    partNo: PART_NO_HINT.test(body) || EA_HINT.test(body),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 2. 투표
 * ────────────────────────────────────────────────────────────────────────── */

/** 같은 값끼리 세어 많은 차례로. 같은 표면 글자 차례로(결과가 흔들리지 않게). */
export function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** 길이가 같을 때 몇 글자가 다른가. 길이가 다르면 99(= 다른 값). */
function differingChars(a: string, b: string): number {
  if (a.length !== b.length) return 99;
  let count = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) count += 1;
  return count;
}

/** 아는 Q코드 목록에 기대지 않는 날것의 투표. 증거 판단도 이것을 쓴다. */
function voteQ(
  passes: GoodsPassReading[]
): { state: "READ"; value: string; votes: number; second: number; passes: number } | { state: "NONE" } | { state: "SPLIT"; counts: [string, number][] } {
  const all = passes.flatMap((pass) => pass.q);
  const counts = tally(all);
  if (counts.length === 0) return { state: "NONE" };
  const [top, votes] = counts[0];
  const second = counts[1] ? counts[1][1] : 0;
  const passesWith = passes.filter((pass) => pass.q.includes(top)).length;
  if (passesWith >= 2 && votes > second) {
    return { state: "READ", value: top, votes, second, passes: passesWith };
  }
  return { state: "SPLIT", counts };
}

/**
 * 「없다」고 말해도 되는가 — **그 항번 줄을 실제로 읽었다는 증거.**
 *
 * 🔴 떼지 마라. 머리말의 「17건 → 0건」이 이 함수다.
 */
function evidence(passes: GoodsPassReading[], serialKey: string | null) {
  const keySerialPasses = passes.filter((pass) =>
    pass.sn.some((found) => serialsMatch(found, serialKey))
  ).length;
  const partNoPasses = passes.filter((pass) => pass.partNo).length;
  const qRead = voteQ(passes).state === "READ";
  return {
    keySerialPasses,
    partNoPasses,
    qRead,
    // 그 건의 S/N 을 찾았고, 표를 읽은 흔적이 두 패스 이상 있을 때만 자격이 있다.
    rowRead: keySerialPasses >= 1 && (partNoPasses >= 2 || keySerialPasses >= 2),
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 3. 판정
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Q코드를 정한다.
 *
 * 🔴 **Q코드는 「서류에 없다」고 말하지 않는다.** 표본 14장 전부에 인쇄돼 있었고,
 * 「없다」고 단정할 독립 근거(같은 줄의 다른 칸)가 없다. 안 보이면 못 읽은 것으로
 * 둔다 — 그래서 이 함수는 ABSENT 을 내지 않는다. 타입에 ABSENT 이 있는 것은
 * PRV 와 같은 모양으로 다루기 위해서다.
 *
 * `knownQCodes` 는 **거절하는 목록이 아니라 안심하는 목록**이다(타입 주석 참조).
 */
export function decideQCode(
  passes: GoodsPassReading[],
  knownQCodes?: ReadonlySet<string> | null
): QCodeDecision {
  const voted = voteQ(passes);
  if (voted.state === "READ") {
    const known = Boolean(knownQCodes && knownQCodes.size > 0 && knownQCodes.has(voted.value));
    return {
      state: "READ",
      value: voted.value,
      inKnownList: known,
      why: `${voted.passes}패스 일치(${voted.votes}표 / 2위 ${voted.second})${
        known ? " · 이 고객사에 이미 있는 Q코드" : " · 이 고객사에서 처음 보는 Q코드"
      }`,
    };
  }
  if (voted.state === "SPLIT") {
    return {
      state: "UNREAD",
      value: null,
      inKnownList: false,
      why: `읽은 값이 갈렸습니다: ${voted.counts.map(([v, n]) => `${v}×${n}`).join(" / ")}`,
    };
  }
  const near = passes.flatMap((pass) => pass.qNear);
  if (near.length > 0) {
    return {
      state: "UNREAD",
      value: null,
      inKnownList: false,
      why: `꼴에 가까운 것만 보입니다: ${[...new Set(near)].slice(0, 4).join(", ")}`,
    };
  }
  return { state: "UNREAD", value: null, inKnownList: false, why: "Q코드 꼴이 보이지 않습니다" };
}

/**
 * PRV No. 를 정한다. `serialKey` 는 **그 건의 S/N**(우리 시스템의 값)이다.
 *
 * 🔴 **항번이 2개 이상이면 세 패스 전원이 같은 줄을 가리킬 때만 채운다.** 사진을
 * 2°만 기울여 찍어도 묶기가 무너져 **항번1의 값이 항번2 자리에 들어가는 일**이
 * 실제로 일어났다(측정 2026-10-01). 이 조건이 그것을 막는다.
 */
export function decidePrvNumber(
  passes: GoodsPassReading[],
  serialKey: string | null
): PrvDecision {
  const all = passes.flatMap((pass) => pass.prv);
  const near = passes.flatMap((pass) => pass.prvNear);

  if (all.length === 0) {
    const found = evidence(passes, serialKey);
    if (near.length > 0) {
      return {
        state: "UNREAD",
        value: null,
        rows: 1,
        why: `비슷한 것만 보입니다: ${[...new Set(near)].slice(0, 4).join(", ")}`,
      };
    }
    // 🔴 증거가 없으면 「없다」가 아니라 「못 읽었다」다.
    if (!(found.rowRead && found.qRead)) {
      return {
        state: "UNREAD",
        value: null,
        rows: 1,
        why: `그 줄을 읽었다는 증거가 없습니다(S/N 짝 ${found.keySerialPasses}패스 · Q코드 ${found.qRead ? "읽음" : "못 읽음"})`,
      };
    }
    return {
      state: "ABSENT",
      value: null,
      rows: 1,
      why: "같은 줄의 Q코드와 S/N 은 읽혔는데 PRV No. 꼴이 없습니다",
    };
  }

  // 묶기가 깨져도(기울어진 사진 등) 서로 많이 다른 PRV 가 둘 이상이면 여러 줄로 본다.
  // 한 글자만 다른 것은 같은 값의 오독이다.
  const unique = [...new Set(all)];
  const clusters: string[][] = [];
  for (const value of unique) {
    const found = clusters.find((cluster) =>
      cluster.some((other) => differingChars(other, value) <= 2)
    );
    if (found) found.push(value);
    else clusters.push([value]);
  }
  const rows = Math.max(
    ...passes.map((pass) => pass.items.filter((item) => item.prvs.length > 0).length),
    clusters.length
  );

  // 그 건의 S/N 이 든 줄을 패스마다 하나씩 고른다.
  const bySerial: string[] = [];
  for (const pass of passes) {
    const hit = pass.items.filter(
      (item) => item.prvs.length > 0 && item.sns.some((sn) => serialsMatch(sn, serialKey))
    );
    if (hit.length === 1 && hit[0].prvs.length === 1) bySerial.push(hit[0].prvs[0]);
  }
  const serialVotes = tally(bySerial);
  const need = rows >= 2 ? passes.length : 2;
  if (
    serialVotes.length > 0 &&
    serialVotes[0][1] >= need &&
    (!serialVotes[1] || serialVotes[0][1] > serialVotes[1][1])
  ) {
    return {
      state: "READ",
      value: serialVotes[0][0],
      rows,
      why: `S/N ${serialKey ?? "-"} 줄에서 ${serialVotes[0][1]}/${passes.length}패스 일치`,
    };
  }

  if (rows <= 1) {
    const counts = tally(all);
    const passesWith = passes.filter((pass) => pass.prv.includes(counts[0][0])).length;
    if (passesWith >= 2 && counts[0][1] > (counts[1] ? counts[1][1] : 0)) {
      return {
        state: "READ",
        value: counts[0][0],
        rows,
        why: `항번이 하나인 서류에서 ${passesWith}패스 일치(${counts[0][1]}표)`,
      };
    }
    return {
      state: "UNREAD",
      value: null,
      rows,
      why: `읽은 값이 갈렸습니다: ${counts.map(([v, n]) => `${v}×${n}`).join(" / ")}`,
    };
  }

  // 🔴 항번이 여럿인데 어느 줄인지 확실하지 않다 — 채우지 않는다.
  return {
    state: "UNREAD",
    value: null,
    rows,
    why: `항번이 ${rows}줄인데 S/N(${serialKey ?? "-"}) 짝이 확실하지 않습니다`,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 4. 🔴 이 통문증이 **정말 이 건의 것인가** — S/N 맞춰보기
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 서류에 적힌 S/N 과 그 건의 S/N 이 맞는가.
 *
 * ── 🔴 왜 필요한가 ─────────────────────────────────────────────────────
 * 항번이 하나뿐인 서류는 **S/N 짝을 따지지 않고** 채운다(그것이 14/14 를 낸
 * 규칙이다 — 서류에 적힌 S/N 이 우리 쪽 S/N 과 다른 건이 실제로 있다). 그래서
 * 엔지니어가 통문증을 **엉뚱한 건에 올리면** 남의 PRV No. · Q코드가 아무 말 없이
 * 들어간다. 개발 자료에서 실제로 그런 줄이 있었다(2026-10-01).
 *
 * ── 🔴 막지 않는다. 알리기만 한다 ───────────────────────────────────────
 * 이 함수는 **판정(READ/ABSENT/UNREAD)에 손대지 않는다.** 화면이 색과 글자를
 * 더할 뿐이고 값은 그대로 채운다 — 사람이 보고 [저장]을 누르는 구조이므로,
 * 채워 두고 알리는 쪽이 낫다(아는 Q코드 목록과 같은 방식이다).
 */
export type SerialCheckState = "MATCH" | "MISMATCH" | "UNREAD";

export type SerialCheck = {
  state: SerialCheckState;
  /** 서류에서 읽은 S/N(여럿이면 표를 가장 많이 받은 것). 못 읽었으면 null. */
  documentSerial: string | null;
  why: string;
};

export function checkSerialAgainstDocument(
  passes: GoodsPassReading[],
  serialKey: string | null
): SerialCheck {
  const all = passes.flatMap((pass) => pass.sn);
  const top = tally(all)[0]?.[0] ?? null;

  if (!normalizeSerial(serialKey)) {
    return {
      state: "UNREAD",
      documentSerial: top,
      why: "이 건에 S/N 이 적혀 있지 않아 맞춰보지 못했습니다",
    };
  }
  if (all.length === 0) {
    return { state: "UNREAD", documentSerial: null, why: "서류에서 S/N 을 읽지 못했습니다" };
  }
  const matched = all.find((found) => serialsMatch(found, serialKey));
  if (matched) {
    return { state: "MATCH", documentSerial: matched, why: "서류의 S/N 이 이 건의 S/N 과 같습니다" };
  }
  return {
    state: "MISMATCH",
    documentSerial: top,
    why: `서류의 S/N(${top})이 이 건의 S/N(${serialKey})과 다릅니다`,
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * 5. 아는 Q코드 목록 만들기
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 서버가 내려준 「이미 저장된 Q코드」들을 견줄 수 있는 모양으로 만든다.
 *
 * 꼴에 안 맞는 것은 버린다 — 사람이 손으로 적다 만 값(`Q`, `QDA` 같은 것)이
 * 목록에 끼면 「아는 값」의 뜻이 흐려진다.
 */
export function toKnownQCodeSet(values: readonly string[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const value of values ?? []) {
    const normalized = String(value ?? "")
      .trim()
      .toUpperCase();
    if (Q_CODE_SHAPE.test(normalized)) set.add(normalized);
  }
  return set;
}
