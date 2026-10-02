/**
 * ============================================================================
 * 명판 QR 의 글 — **`TYPE,L/N,S/N` 셋을 쉼표로 이은 것**
 * ============================================================================
 * 교산(Kyosan) 장비 명판에 붙은 QR 은 접수폼의 필수 칸 셋과 1:1 로 맞는다.
 *
 *     MBK600M-AD1,WN6445,1808012
 *     CMK300M-IC2,WT9844,2207085
 *
 * MATCH BOX 와 RF GENERATOR 가 같은 꼴이고, 확인된 범위는 2016년~2024년
 * 제조분이다(2026-10-02 실측 13장).
 *
 * ── 🔴 왜 꼴을 이렇게 깐깐하게 보는가 ───────────────────────────────────
 * 장비에는 **다른 QR 도 붙어 있다** — ROM TYPE 딱지의 `M5259` 가 그것이다.
 * 실제 측정에서 그 값을 집어 온 적이 있다(jsQR 로 훑었을 때). 훑기는 사진의
 * 여러 자리를 차례로 보기 때문에, 꼴을 보지 않으면 **엉뚱한 QR 이 먼저 풀려
 * 그 값이 칸에 적힌다.** 빈칸은 사람이 알아채지만 틀린 글자는 알아챌 방법이
 * 없다 — 그래서 꼴이 안 맞으면 버리고 다음 자리로 간다.
 *
 * ── 🔴 2013년 구 양식에는 QR 이 아예 없다 ──────────────────────────────
 * 표 생김새부터 다르다(`CMK150M-IC2  S/N 1307009` 처럼 한 줄에 둘씩 적는다).
 * 못 읽는 것이 정답이다 — 여기서 글자를 추측해 메우려 들지 않는다.
 * ============================================================================
 */

/** 명판 QR 이 싣고 있는 셋. 접수폼의 `Model` · `L/N` · `S/N` 과 같다. */
export type NameplateCode = {
  modelName: string;
  lotNumber: string;
  serialNumber: string;
};

/** 접수폼에서 이 기능이 건드릴 수 있는 칸들의 현재 값. */
export type NameplateFields = {
  modelName: string;
  lotNumber: string;
  serialNumber: string;
};

/**
 * QR 이 싣고 있던 글을 셋으로 가른다.
 *
 * 🔴 **받아들이는 꼴은 하나뿐이다** — 쉼표로 정확히 셋으로 갈리고, 세 조각
 * 모두 공백을 뗀 뒤 비어 있지 않을 것. 그 밖은 전부 `null` 이다(던지지
 * 않는다 — 훑는 쪽이 「다음 자리」로 넘어갈 수 있어야 한다).
 */
export function parseNameplateCode(text: string | null | undefined): NameplateCode | null {
  if (typeof text !== "string") return null;
  const parts = text.split(",");
  if (parts.length !== 3) return null;
  const [modelName, lotNumber, serialNumber] = parts.map((part) => part.trim());
  if (!modelName || !lotNumber || !serialNumber) return null;
  return { modelName, lotNumber, serialNumber };
}

/**
 * 어느 칸을 채울 것인가.
 *
 * 🔴 **이미 적힌 칸은 칸마다 따로 판단해 건드리지 않는다.** 사람이 손으로
 * 적어 둔 값을 QR 이 덮으면, 덮였다는 사실 자체가 화면에 남지 않는다.
 * 공백만 들어 있는 칸은 「비어 있다」로 본다(사람이 지우다 만 자리다).
 *
 * 돌려주는 것은 **채울 칸만** 담은 조각이다 — 비어 있으면 채울 것이 없다.
 */
export function planNameplateFill(
  code: NameplateCode,
  current: NameplateFields
): Partial<NameplateFields> {
  const patch: Partial<NameplateFields> = {};
  if (!current.modelName.trim()) patch.modelName = code.modelName;
  if (!current.lotNumber.trim()) patch.lotNumber = code.lotNumber;
  if (!current.serialNumber.trim()) patch.serialNumber = code.serialNumber;
  return patch;
}

/** 칸 이름 — 화면이 「무엇이 들어왔는지」 한 줄로 말할 때 쓴다. */
const FIELD_LABELS: Record<keyof NameplateFields, string> = {
  modelName: "Model",
  lotNumber: "L/N",
  serialNumber: "S/N",
};

/** 사람이 볼 차례. 화면의 칸 차례와 같다. */
const FIELD_ORDER: (keyof NameplateFields)[] = ["modelName", "lotNumber", "serialNumber"];

/**
 * 「무엇이 들어왔는가」 한 줄.
 *
 * 팝업을 띄우지 않는 대신 이 한 줄이 남는다. 채운 것이 하나도 없으면
 * (세 칸이 이미 다 차 있었다는 뜻) 그 사실을 말한다 — 「읽었는데 아무 일도
 * 일어나지 않았다」로 보이면 사람이 단추가 고장 났다고 여긴다.
 */
export function summarizeNameplateFill(patch: Partial<NameplateFields>): string {
  const filled = FIELD_ORDER.filter((key) => patch[key] !== undefined).map(
    (key) => `${FIELD_LABELS[key]} ${patch[key]}`
  );
  if (filled.length === 0) return "QR 을 읽었지만 세 칸이 이미 모두 채워져 있어 그대로 두었습니다.";
  return `QR 에서 읽어 채웠습니다 — ${filled.join(" · ")}`;
}
