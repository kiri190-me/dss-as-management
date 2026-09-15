/**
 * ============================================================================
 * 이름 대조 — 고객사·END-USER·모델 이름을 기존 목록과 맞춰 볼 때
 * ============================================================================
 * 엑셀에는 같은 고객사가 `ＴＥＳＴ Corp`·`test  corp` 처럼 조금씩 다르게 적힌다.
 * `nfkcNameKey` 가 같으면 **같은 이름**으로 본다(전각/반각 · 대소문자 · 공백 차이).
 * 키가 다르지만 비슷한 것은 `suggestSimilarNames` 가 "혹시 이것?" 으로 내놓는다 —
 * 고르는 것은 사람이다. 여기서 자동으로 합치지 않는다.
 * ============================================================================
 */

/** NFKC + trim + 공백 접기 + 소문자. */
export function nfkcNameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const MAX_EDIT_DISTANCE = 2;

/**
 * 비슷한 이름들, 가까운 순으로 최대 `limit` 개.
 *
 *  · 키가 **같은** 후보는 뺀다 — 그것은 제안이 아니라 이미 같은 이름이다.
 *  · 키가 서로를 **포함**하면(어느 쪽이든) 넣는다 — `RF-3000` ↔ `RF-3000 PLUS`.
 *  · 편집거리(글자 단위)가 2 이하면 넣는다 — 오타 한두 자.
 *
 * 가까움 = 편집거리. 포함 관계의 편집거리는 두 키의 길이 차이와 같다(남는 글자를
 * 지우면 된다). 같으면 키, 그다음 id 순 — 같은 입력이면 늘 같은 순서다.
 */
export function suggestSimilarNames<T extends { id: string; name: string }>(
  name: string,
  candidates: readonly T[],
  limit = 5
): T[] {
  const key = nfkcNameKey(name);
  if (key === "" || limit <= 0) return [];
  const target = Array.from(key);

  const scored: { candidate: T; key: string; distance: number }[] = [];
  for (const candidate of candidates) {
    const candidateKey = nfkcNameKey(candidate.name);
    if (candidateKey === "" || candidateKey === key) continue;

    const chars = Array.from(candidateKey);
    const lengthGap = Math.abs(chars.length - target.length);
    if (candidateKey.includes(key) || key.includes(candidateKey)) {
      scored.push({ candidate, key: candidateKey, distance: lengthGap });
      continue;
    }
    if (lengthGap > MAX_EDIT_DISTANCE) continue;
    const distance = editDistance(target, chars);
    if (distance <= MAX_EDIT_DISTANCE) scored.push({ candidate, key: candidateKey, distance });
  }

  scored.sort(
    (a, b) =>
      a.distance - b.distance || compareText(a.key, b.key) || compareText(a.candidate.id, b.candidate.id)
  );
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/** 레벤슈타인 거리. 글자(코드 포인트) 단위라 한자·가나도 한 글자가 한 칸이다. */
function editDistance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/** 로캘에 기대지 않는 비교 — 서버 로캘이 달라도 순서가 같다. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
