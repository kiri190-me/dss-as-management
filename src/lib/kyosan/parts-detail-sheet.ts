import { columnLettersToNumber, columnNumberToLetters, type GridCell } from "../xlsx/sheet-grid";
import { collapseWhitespace, isDashPlaceholder, normalizeKey, type GridLike } from "./card-grid";

/**
 * ============================================================================
 * 교산 연락서 판독기 — 「交換部品詳細」 시트 (2026-09-22)
 * ============================================================================
 * 🔴 **연락서 양식이 직접 지시하는 시트다.** Card 시트의 `５．処置` 머리글이
 * 「主原因の部品から選択し、残りは『交換部品詳細』ｼｰﾄに記入して…」 라고 적어 두었다 —
 * 주원인 부품만 Card 에 고르고 **나머지는 이 시트에 적으라**는 뜻이다. 그래서
 * Card 시트만 읽으면 교체 부품이 절반 이상 빠진다.
 *
 * 이 파일은 `card-fields.ts` 와 나란한 자리다 — `SheetGrid` 위에서 순수하게
 * 판독만 한다. DB 도 `server-only` 도 React 도 부르지 않는다.
 *
 * ── 실측 (2026-09-22, 연락서 472장 · 이 시트 636장) ────────────────────
 * 열 수 있었던 통합문서 472장 중 **연락서 469장 전부에** 이 시트가 있다. 남은
 * 3장은 연락서가 아니라 부품 출하증·빈 통합문서로, Card 시트도 없어
 * `readKyosanReport` 가 앞에서 이미 물린다. 그래도 **없으면 빈 목록**으로 둔다 —
 * 판본이 하나 더 나와 이 시트를 빼더라도 이식이 멈추면 안 된다.
 *
 * 시트 이름은 두 갈래다:
 *  · `交換部品詳細`          — 302장 (한 장에 시트 하나)
 *  · `交換部品詳細(RF)` + `交換部品詳細(DC)` — 167장 (한 장에 시트 **둘**)
 * 🔴 (RF)/(DC) 갈래를 한 시트만 읽으면 DC 부의 부품을 통째로 놓친다.
 *
 * ── 🔴 왜 고정 주소·고정 열을 쓰지 않는가 ──────────────────────────────
 * 실측한 머리글 배치가 **세 가지**다. 지시서가 적어 준 것은 그중 하나(C)뿐이었다:
 *
 *   A · 334시트 · 머리글 7행
 *       `B=措置 C=部品名 D=型式 E=仕様書番号 H=数量 I=対象 N=部品名リスト`
 *   B · 159시트 · 머리글 7행 + 40행(143시트) 또는 50행(16시트)
 *       `A=UNIT B=措置 C=部品名 E=型式 G=仕様書番号 I=数量 J=状況`
 *   C · 143시트 · 머리글 16행 + 29행 + 42행
 *       `B=部品名 / 型式 D=仕様書番号 / 型式 G=数量 H=状況`
 *
 * 같은 「수량」이 H · I · G 세 열에 앉고, 머리글 줄이 7 · 16 · 29 · 40 · 42 · 50 에
 * 앉는다. 그러므로 **머리글 줄을 글자로 찾아 그 줄에서 열을 배운다.** 한 시트에
 * 머리글이 여럿이면(묶음이 여럿이면) 각각을 따로 읽는다 — 실측으로 시트당 묶음이
 * 1개(334시트) · 2개(159시트) · 3개(143시트)다.
 *
 * ── 🔴 이름은 **품번 칸**에서 온다 (2026-10-28 뒤집음) ───────────────
 * 2026-09-22 부터 이 파일은 반대로 적고 있었다. **그 문장을 인용해 남긴다**:
 *
 *     「`型式`·`仕様書番号` 칸은 `spec` 이다」 ·
 *     「부품 이름. 🔴 `部品名` 칸이 비고 규격 칸만 적힌 줄에서는 규격 글자다」 ·
 *     「`交換部品詳細` 시트의 `spec`(형식번호)은 미리보기가 이미 버린다」
 *
 * 🔵 사용자가 **실물 연락서 두 장을 열어 보여 주었다**(2026-10-28). 거기서
 * 드러난 것이 이렇다:
 *
 *     탭 `交換部品詳細(RF)` · `部品名`=일본어 설명 · `型式`=**빈칸** · `仕様書番号`=**품번**
 *     탭 `交換部品詳細`     · `部品名`=일본어 설명 · `型式`=**품번**  · `仕様書番号`=빈칸
 *
 * 🔴 **`部品名` 은 두 장 다 「사람이 읽는 일본어 설명」이지 부품명이 아니다.**
 * 재고관리 시스템의 부품명과 같은 글자는 **품번**이고, 그것은 `型式` 과
 * `仕様書番号` 가운데 **값이 있는 쪽**에 적힌다 — 어느 쪽이 찰지는 장마다 다르고
 * 양식이 정해 주지 않는다. 이 품번으로 [고장 부품] 그래프가 재고관리 쪽 부품과
 * 같은 것으로 묶는다.
 *
 * 그래서 이름은 **`型式` → `仕様書番号` → `仕様書番号 / 型式` → `部品名`**
 * 차례로 고른다 (셋째 칸이 들어온 까닭은 아래 「판본 C 도 D열이 품번이다」):
 *  · 앞의 셋이 품번이다. 셋 다 보아야 세 판본을 다 담는다.
 *  · 🔵 `部品名` 은 **맨 마지막 비상구**다. 사람이 읽는 설명이라 재고관리와
 *    묶이지 않지만, 앞의 셋이 다 빈 줄에서 이름이 통째로 사라지는 것보다는
 *    설명이라도 남는 쪽이 낫다.
 *  · 🔴 **쓰지 않은 칸을 버리지 않는다.** `model`(`型式`) · `partName`(`部品名`) ·
 *    `spec`(`仕様書番号`)을 칸 글자 그대로 함께 싣는다. 「이름이 이상하다」는
 *    신고가 왔을 때 어느 칸에서 왔는지 되짚을 수 있어야 한다. `address` 도
 *    **이름을 가져온 칸**을 가리킨다(예전에는 언제나 `部品名` 열이었다).
 *  · 🔵 **품번만 싣는다.** 설명을 괄호로 덧붙이지 않는다(사용자 2026-10-28) —
 *    화면에도 저장에도 품번 글자 그대로 나간다.
 *
 * ── 🔴 판본 C 도 **D열이 품번**이다 (2026-10-29 운영 실측으로 뒤집음) ──
 * 2026-10-28 에는 판본 C 만 차례를 그대로 두었다. **그때의 글을 인용해 남긴다**
 * (지우지 않는 까닭은 아래 「왜 틀렸나」가 그 길로 되돌아가는 것을 막기 위해서다):
 *
 *     「⚠️ **판본 C(143시트)는 차례를 그대로 둔다.** 머리글이 `部品名 / 型式`
 *       (B열)과 `仕様書番号 / 型式`(D열)로 **두 칸 다 `型式` 을 품은 겹뜻**이라,
 *       품번이 어느 칸에 들었는지 가를 근거가 양식에 **없다.** … 판본 C 는
 *       지금까지처럼 `部品名…`(B열)을 먼저 쓰고, `仕様書番号…`(D열)은 앞이 빈
 *       줄의 비상구로 둔다(실측 11줄).
 *       🔴 그 차례를 지키려고 `仕様書番号 / 型式` 에만 **`specCombined` 라는
 *       따로 된 구실**을 주고 **고르는 차례의 맨 뒤**에 둔다.」
 *
 * 🔴 **그렇게 보았으나 실물이 아니었다.** 2026-10-29 에 사용자가 **판본 C 인
 * 운영 연락서 한 장**(`交換部品詳細` 탭 10줄)과 그 장이 만든 사용 부품 칸을
 * 나란히 열어 보여 주었다. 양식이 가를 근거를 안 줄 뿐이지 **실물은 한 가지로만
 * 적혀 있었다**:
 *
 *     B열(`部品名 / 型式`)   = 사람이 읽는 일본어 설명 (판본 A·B 의 `部品名` 과 같다)
 *     D열(`仕様書番号 / 型式`) = **품번** (판본 A·B 의 `型式`·`仕様書番号` 와 같다)
 *
 * 🔴 **무엇이 터졌나** — 그 장은 시트에 **10줄 · 수량 합 12** 가 적혀 있는데
 * 사용 부품 칸에 **6줄 · 수량 합 11** 이 들어갔다. 옛 차례가 B열(설명)을 이름으로
 * 집었고, **설명이 같고 품번이 다른 별개 부품 두 줄**이 한 줄로 뭉개지면서
 * 뒤 줄의 수량까지 사라졌다. 품번으로 집으면 둘이 애초에 안 묶인다.
 *
 * 🔵 **빈 B열 줄은 손해를 보지 않는다.** 옛 글이 비상구로 지키려던 「`部品名` 이
 * 비고 규격만 있는 줄」(실측 11줄)은 **고친 차례에서 그대로 집힌다** — D열을
 * **먼저** 보기 때문이다. 바뀌는 것은 둘 다 찬 줄에서 **어느 쪽이 이기는가**
 * 하나뿐이다.
 *
 * 🔵 **판본 A·B 는 닿지 않는다.** `仕様書番号 / 型式`(`specCombined`)은 판본 C
 * 에만 있는 머리글이고, 판본 A·B 는 홑뜻 `型式`·`仕様書番号` 를 쓴다. 그 둘은
 * 예전부터 1·2 순위라 자리가 그대로다.
 *
 * 🔴 **세지 못한 것** — `型式`·`仕様書番号`·`部品名` 이 한 줄에 어떤 짝으로
 * 차는지 그 분포는 재지 못했다(연락서 원본 xlsm 이 저장소에 없다). 본 것은
 * 사용자가 열어 준 **세 장**(판본 A·B 꼴 둘 + 판본 C 하나)과, 기록으로 남은
 * 「부품 줄 1,315줄 가운데 `部品名` 이 비고 규격만 있는 줄 11줄」뿐이다. 그래서
 * 떨어지는 길을 끝까지 남긴다 — 재지 못한 자리에서는 잃지 않는 쪽을 고른다.
 *
 * ── 🔴 드롭다운 목록 열을 부품으로 읽지 않는다 ────────────────────────
 * 이 시트에는 사람이 고르는 **부품 이름 목록**이 숨은 열에 통째로 들어 있다 —
 * A 판본은 N 열(`部品名リスト`)과 O 열, B 판본은 N 열, C 판본은 L·M 열이다.
 * 오른쪽으로 훑으면 교산의 부품 대장 100여 가지가 전부 「이 건에서 갈았다」로
 * 들어온다. 그래서 **머리글에 이름이 적힌 열만** 읽고, 이름이 `部品名リスト` ·
 * `変更後リスト` 인 열은 일부러 버린다.
 *
 * ── 🔴 아래쪽 「판본 이력」 표에서 멈춘다 ──────────────────────────────
 * A 판본은 부품 표 **아래에** 양식 개정 이력 표를 달고 있다:
 *     `B=変更実施日 C=変更及び追加内容 K=変更者`
 *     `B=<날짜> C=部品名リスト追加 K=<사람 이름>`
 * `C` 가 부품명 열과 같은 자리라, 멈추지 않으면 `部品名リスト追加` ·
 * `交換部品名リスト化` 같은 글자가 부품으로 들어온다. 실측으로 **2,004줄**이
 * 그렇게 들어왔다(진짜 부품 줄은 1,315줄이다 — 가짜가 더 많았다).
 * 그래서 묶음은 **다음 머리글 줄이나 남의 표 머리글 줄에서 끝난다.**
 *
 * ── 상태값은 부품이 아니다 ─────────────────────────────────────────────
 * 🔴 실측이 지시서와 다르다. 지시서는 `状況`(상황) 칸에 `交換無し` 가 온다고 했지만,
 * 실제로 `状況`·`対象` 칸에 오는 값은 여덟 가지뿐이고 상태값은 없다 —
 * `修理`(779) · `O/H`(231) · `故障・修理`(108) · `予防措置`(56) · `改修`(10) ·
 * `最新仕様Verアップ`(10) · `改修・改造`(9) · 빈칸(112).
 * `交換無し` 는 **`部品名` 칸**에 온다(187줄). 「바꾼 것이 없다」는 상태값이지
 * 물건 이름이 아니므로 줄로 만들지 않는다(`report-terms.ts` 의 「상태값」 절).
 *
 * ── 고장분 · 예방분 ────────────────────────────────────────────────────
 * A·B 판본은 `措置` 칸이 `故障①`…`故障⑩` · `予防①`…`予防⑳` 로 **미리 찍혀 있다** —
 * 거기서 가른다. C 판본에는 `措置` 칸이 없어 `状況` 을 본다(`予防措置` 면 예방분).
 * 🔴 `状況` 은 A·B 판본에서 갈래가 아니다 — `措置=予防⑤` 인데 `状況=修理` 인 줄이
 * 실측 141줄이다. 그래서 `措置` 가 있으면 `状況` 은 보지 않는다.
 *
 * ── 🔴 고객 정보 ───────────────────────────────────────────────────────
 * 돌려주는 값에는 교산 쪽 부품 이름·형식번호가 그대로 들어 있다. 부르는 쪽은
 * 결과를 저장소 안 파일이나 바깥 서비스로 내보내지 않는다.
 * ============================================================================
 */

/** 시트 이름 앞머리. `normalizeKey` 로 누른 뒤 견준다(반각·전각·대소문자 흡수). */
const PARTS_DETAIL_SHEET_PREFIX = "交換部品詳細";

/**
 * 「交換部品詳細」 계열 시트 이름인가. `交換部品詳細` · `交換部品詳細(RF)` ·
 * `交換部品詳細(DC)` 셋이 실측의 전부다. 앞머리 일치를 쓰는 까닭은 (RF)/(DC)
 * 꼬리를 한 줄로 잡기 위해서다 — Card 시트와 달리 여기서는 남의 시트를 잘못
 * 집을 위험이 없다(`交換部品詳細` 로 시작하는 딴 시트가 실측에 없다).
 */
export function isPartsDetailSheetName(sheetName: string): boolean {
  return normalizeKey(sheetName).startsWith(PARTS_DETAIL_SHEET_PREFIX);
}

/** 통합문서의 시트 이름들 중 이 시트들만, 적힌 차례 그대로. */
export function pickPartsDetailSheetNames(sheetNames: readonly string[]): string[] {
  return sheetNames.filter(isPartsDetailSheetName);
}

/**
 * 머리글 칸이 어느 구실을 하는가. `ignore` 는 드롭다운 목록 열, `foreign` 은 남의 표.
 *
 * 🔴 이름이 될 수 있는 칸이 **넷으로 갈라져 있다.** 네 칸의 값이 서로 다른
 * 물건이고 **고르는 차례가 다르기** 때문이다(머리말 「이름은 품번 칸에서 온다」):
 *   `model`(`型式`) · `spec`(`仕様書番号`)   — 품번. 판본 A·B 의 홑뜻 칸.
 *   `specCombined`(`仕様書番号 / 型式`)      — 품번. 판본 C 전용 겹뜻 칸(2026-10-29
 *                                            운영 실측). 홑뜻 둘 다음, `部品名` 앞.
 *   `name`(`部品名`)                        — 사람이 읽는 설명. 맨 마지막 비상구.
 *
 * 🔵 `specCombined` 가 `spec` 과 **따로 선 채로 남은** 까닭은 이제 차례가 아니라
 * **판본을 가리키는 표시**다. 둘은 같은 판본에 함께 나오지 않으므로(`allSpecColumns`
 * 의 주석), 합쳐도 지금은 값이 같다. 그래도 가르는 쪽을 둔다 — 「판본 C 의 D열을
 * 어떻게 다루기로 했나」를 되짚을 자리가 한 군데는 있어야 한다.
 */
type HeaderRole =
  | "name"
  | "model"
  | "spec"
  | "specCombined"
  | "quantity"
  | "status"
  | "measure"
  | "unit"
  | "ignore"
  | "foreign";

/**
 * 머리글 글자 → 구실. **정확히 같을 때만** 맞춘다(앞머리 일치가 아니다) —
 * `部品名リスト`(드롭다운 목록)가 `部品名` 으로 잡히면 교산 부품 대장이 통째로
 * 부품으로 들어오고, `単体(So側)型式：`(인수 정보 줄)이 `型式` 로 잡히면 **제품
 * 모델명이 부품 이름으로** 들어온다. 실측에서 둘 다 실제로 있는 글자다.
 * 🔴 `型式` 이 이름 칸이 된 2026-10-28 뒤로 뒤쪽 위험이 더 커졌다 — 예전에는
 * 모델명이 버려지는 `spec` 으로 떨어졌지만 이제는 곧바로 이름이 된다.
 */
const HEADER_ROLES: ReadonlyMap<string, HeaderRole> = new Map([
  // 🔴 드롭다운 목록 열 — 값이 아니라 고를 거리다. 버린다.
  ["部品名リスト", "ignore"],
  ["変更後リスト", "ignore"],
  // 🔴 아래쪽 「판본 이력」 표의 머리글. 여기서 묶음이 끝난다(위 머리말).
  ["変更実施日", "foreign"],
  ["変更及び追加内容", "foreign"],
  ["変更者", "foreign"],
  // 🔴 홀로 선 `型式` 열(판본 A 의 D열 · 판본 B 의 E열). **품번이고 1순위다.**
  ["型式", "model"],
  // 🔴 홀로 선 `仕様書番号` 열. **여기도 품번이다** — 실물 판본 ①(`(RF)` 탭)은
  //    `型式` 을 비워 두고 이 칸에 품번을 적는다(머리말). 2순위.
  ["仕様書番号", "spec"],
  // 🔴 사람이 읽는 일본어 설명. **맨 마지막 비상구**다(머리말).
  //    판본 C 의 `部品名 / 型式`(공백을 눌러 `部品名/型式` 이 된다)도 여기다 —
  //    머리글은 한 칸에 두 뜻을 겹쳐 적었지만, 운영 실물에서 이 칸에 들어 있는
  //    것은 판본 A·B 의 `部品名` 과 똑같은 **설명 글자**였다(2026-10-29, 머리말).
  ["部品名/型式", "name"],
  ["部品名", "name"],
  // 🔴 판본 C 전용 겹뜻 규격 칸. **여기도 품번이다**(2026-10-29 운영 실측으로
  //    뒤집었다 — 머리말). 고르는 차례는 홑뜻 둘 다음, `部品名` **앞**이다.
  ["仕様書番号/型式", "specCombined"],
  ["数量", "quantity"],
  ["状況", "status"],
  ["対象", "status"],
  ["措置", "measure"],
  ["unit", "unit"],
]);

/**
 * 머리글 줄로 치려면 한 줄에 아는 글자가 몇 개 있어야 하는가. 둘이면 남의 표도
 * 알아본다(`変更実施日`+`変更及び追加内容`+`変更者` 는 셋이다).
 */
const HEADER_MIN_LABELS = 2;

/**
 * 한 묶음에서 아래로 몇 줄까지 볼 것인가. 실측 최대 폭은 57줄(A 판본의 두 묶음)
 * 이고, 실제 자료는 머리글 아래 20줄 안에 있다. 세 배 남겨 둔 멈춤막이다 —
 * 정상적으로는 언제나 다음 머리글이나 시트 끝에서 먼저 끝난다.
 */
const PARTS_BLOCK_MAX_ROWS = 200;

/**
 * 🔴 부품 이름 칸에 이름 대신 적히는 **상태값**들. 「바꾼 것이 없다」는 뜻이라
 * 부품 줄로 만들지 않는다. 실측 187줄이 `交換無し` 이고, 나머지는 같은 뜻의
 * 표기 변이에 대비한 것이다. `report-terms.ts` 의 「상태값」 절과 같은 낱말이다.
 */
const STATE_ONLY_NAMES: ReadonlySet<string> = new Set([
  normalizeKey("交換無し"),
  normalizeKey("交換なし"),
  normalizeKey("交換無"),
]);

/**
 * 부품 이름 칸의 글자가 **상태값**인가 — 「바꾼 것이 없다」는 뜻이라 부품이 아니다.
 *
 * 🔴 **목록을 한 곳에만 둔다** (2026-09-22). 이 시트에는 걸려 있었는데 Card 시트
 * 경로(`card-fields.ts` 의 `交換部品` 목록)에는 걸려 있지 않아, **실측 469장 중
 * 165장**에서 `交換無し` 가 교체 부품 줄로 들어가고 있었다(화면에
 * 「[예방분] 교체 없음 (交換無し)」으로 보였고 사용자가 그것을 짚었다).
 * 그래서 판정을 두 벌로 적는 대신 이 함수를 두 경로가 **함께 쓴다** — 두 벌로
 * 적으면 한쪽만 고쳐지는 날 같은 결함이 되돌아온다.
 */
export function isKyosanStateOnlyPartName(name: string): boolean {
  return STATE_ONLY_NAMES.has(normalizeKey(name));
}

/** 예방분을 가리키는 앞머리. `措置=予防⑤` 는 NFKC 로 `予防5` 가 된다. */
const PREVENTIVE_PREFIX = normalizeKey("予防");

export type KyosanDetailPartKind = "fault" | "preventive";

/** 「交換部品詳細」 시트에서 읽은 부품 한 줄. */
export type KyosanDetailPart = {
  /**
   * 부품 이름 — 🔴 **품번**이다 (2026-10-28, 머리말 「이름은 품번 칸에서 온다」).
   * **`型式` → `仕様書番号` → `仕様書番号 / 型式` → `部品名`** 차례로 고른 값이고,
   * 앞의 셋이 품번(2026-10-29 에 셋째가 `部品名` 앞으로 올라왔다),
   * `部品名` 은 사람이 읽는 설명이라 **맨 마지막 비상구**다. 🔵 설명을 괄호로
   * 덧붙이지 않는다 — 고른 칸의 글자 그대로다. 넷이 다 비면 줄을 만들지 않으므로
   * 여기는 언제나 값이 있다.
   */
  name: string;
  /**
   * 🔴 `型式` 칸 글자 그대로. 없으면 null. **이름으로 쓴 줄에서도 비우지
   * 않는다** — 이름이 어느 칸에서 왔는지 되짚으려면 날것이 남아 있어야 한다.
   * 판본 C 에는 이 칸이 따로 없어 언제나 null 이다(머리말).
   * ⚠️ 제품 모델(`単体(So側)型式：`)이 아니라 **부품의 품번**이다.
   */
  model: string | null;
  /**
   * `部品名`(판본 C 는 `部品名 / 型式`) 칸 글자 그대로. 없으면 null. 이름으로 쓴
   * 줄에서도 비우지 않는다.
   * 🔴 **사람이 읽는 일본어 설명**이다(실물 세 장 모두 — 판본 C 도 그랬다,
   * 2026-10-29). 재고관리 부품명이 아니므로 이 글자로는 묶이지 않는다.
   */
  partName: string | null;
  /**
   * `仕様書番号`(판본 C 는 `仕様書番号 / 型式`) 칸 글자 그대로. 없으면 null.
   * 🔴 실물 판본 ①(`交換部品詳細(RF)` 탭)과 **판본 C** 는 **여기에 품번을 적는다** —
   * 「규격 번호라 버린다」가 아니다(머리말).
   * 🔴 2026-10-28 전에는 여기에 `型式` 이 섞여 들어왔고, 이름으로 올려 쓴 줄에서는
   * null 로 비웠다. 지금은 **칸 글자 그대로**다 — 비우지 않는다(위 `model` 과
   * 같은 까닭이다).
   */
  spec: string | null;
  kind: KyosanDetailPartKind;
  /**
   * 🔴 `数量` 칸의 수. **적히지 않은 줄은 null** 이다(실측 30/1,315줄) — 부르는
   * 쪽이 1 로 본다. 0 이하·정수가 아닌 값도 null 로 둔다(`repair_case_used_parts`
   * 의 CHECK 가 0 이하를 막는다).
   */
  quantity: number | null;
  /** `状況`·`対象` 칸 글자 그대로. 없으면 null. */
  status: string | null;
  /** `措置` 칸 글자 그대로(`故障③`·`予防①`). 없으면 null. */
  measure: string | null;
  /** 어느 시트에서 왔는가 — (RF)/(DC) 를 가르는 데 쓴다. */
  sheetName: string;
  /**
   * `C17` 꼴. 보고와 시험에서 어디를 읽었는지 말하려고 들고 있다.
   * 🔴 **이름을 가져온 칸**을 가리킨다(2026-10-28). 예전에는 이름이 어느 칸에서
   * 왔든 언제나 `部品名` 열을 적었는데, `型式` 이 이름이 된 뒤로 그 글자는
   * 거짓이 된다 — 「어디를 읽었는가」가 이 값의 유일한 쓸모다.
   */
  address: string;
};

/** 한 줄에서 알아본 머리글 글자들 — 구실 → 열 번호들(오름차순). */
type RowLabels = { count: number; byRole: Map<HeaderRole, number[]> };

function readRowLabels(grid: GridLike, row: number): RowLabels {
  const byRole = new Map<HeaderRole, number[]>();
  let count = 0;
  for (const [letters, cell] of grid.cells(row)) {
    if (cell.kind !== "text") continue;
    const role = HEADER_ROLES.get(normalizeKey(cell.text));
    if (role === undefined) continue;
    count += 1;
    const columns = byRole.get(role) ?? [];
    columns.push(columnLettersToNumber(letters));
    byRole.set(role, columns);
  }
  for (const columns of byRole.values()) columns.sort((a, b) => a - b);
  return { count, byRole };
}

/**
 * 부품 표의 머리글 줄인가 — 품명 열과 수량 열이 **둘 다** 있어야 한다.
 * ⚠️ `型式`(`model`)만 있고 `部品名` 이 없는 머리글은 부품 표로 치지 않는다.
 * `型式` 이 이름이 된 2026-10-28 뒤로도 그대로 둔다 — 실측 세 판본이 모두
 * `部品名` 을 갖고 있고, 재어 보지 않은 꼴을 여기서 열면 남의 표를 집는다.
 */
function isPartsHeaderRow(labels: RowLabels): boolean {
  return labels.count >= HEADER_MIN_LABELS && labels.byRole.has("name") && labels.byRole.has("quantity");
}

/** 묶음이 여기서 끝나는가 — 다음 머리글 줄이거나 남의 표 머리글 줄이다. */
function isBlockBoundaryRow(labels: RowLabels): boolean {
  return labels.byRole.has("foreign") || labels.count >= HEADER_MIN_LABELS;
}

/**
 * 칸 하나 → 값 글자. 빈칸 채움(`-`·`―`)은 값이 아니므로 null.
 * 숫자 칸은 그대로 숫자 글자로 돌려준다(`数量` 이 그렇게 온다).
 */
function cellText(grid: GridLike, row: number, column: number | undefined): string | null {
  if (column === undefined) return null;
  const cell: GridCell | undefined = grid.cells(row).get(columnNumberToLetters(column));
  if (!cell) return null;
  if (cell.kind === "number") return String(cell.value);
  const text = collapseWhitespace(cell.text);
  return text === "" || isDashPlaceholder(text) ? null : text;
}

/** 칸 하나를 집은 결과 — 글자와 **어느 열에서 왔는가**. `address` 가 그 열을 적는다. */
type PickedCell = { text: string; column: number };

/**
 * 열들을 왼쪽부터 보아 처음 값이 있는 칸. 같은 구실의 열이 **여럿일 수 있어서**
 * 배열을 받는다 — 실측 세 판본에서는 구실마다 한 머리글에 한 열씩이지만, 머리글을
 * 글자로 찾는 이상 같은 이름이 두 번 나오는 판본을 막아 둘 까닭이 없다.
 * 🔵 `spec` 칸에 실을 때만은 홑뜻 `仕様書番号` 와 겹뜻 `仕様書番号 / 型式` 을
 * 한 묶음으로 넘긴다(`allSpecColumns`) — 둘이 **같은 판본에 함께 나오지 않는다.**
 */
function firstCell(
  grid: GridLike,
  row: number,
  columns: readonly number[]
): PickedCell | null {
  for (const column of columns) {
    const text = cellText(grid, row, column);
    if (text !== null) return { text, column };
  }
  return null;
}

/** `firstCell` 의 글자만. */
function firstText(grid: GridLike, row: number, columns: readonly number[]): string | null {
  return firstCell(grid, row, columns)?.text ?? null;
}

/**
 * 🔴 이 줄의 **이름**은 어느 칸에서 오는가 — 열 묶음을 **적힌 차례대로** 보아
 * 처음 값이 있는 칸이 이름이다. 차례는 부르는 쪽이 적어 넘긴다(호출부에 칸
 * 이름이 한 줄씩 주석으로 붙어 있다 — 거기가 이 설계를 읽는 자리다).
 *
 * 🔴 **차례가 곧 설계다**(머리말 「이름은 품번 칸에서 온다」). 품번 칸이 먼저고,
 * 사람이 읽는 설명(`部品名`)이 맨 마지막 비상구다. 다 비면 null — 사람이 안
 * 적은 줄이다(양식이 미리 그려 둔 빈 줄).
 */
function pickPartName(
  grid: GridLike,
  row: number,
  columnsInOrder: readonly (readonly number[])[]
): PickedCell | null {
  for (const columns of columnsInOrder) {
    const picked = firstCell(grid, row, columns);
    if (picked !== null) return picked;
  }
  return null;
}

/** 수량 글자 → 1 이상의 정수, 아니면 null(부르는 쪽이 1 로 본다). */
function toQuantity(text: string | null): number | null {
  if (text === null) return null;
  const parsed = Number(text.normalize("NFKC").replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * 고장분인가 예방분인가. `措置` 가 있으면 그것만 본다 — A·B 판본에서 `状況` 은
 * 갈래가 아니다(위 머리말). `措置` 가 없는 C 판본에서는 `状況` 을 본다.
 */
function toPartKind(measure: string | null, status: string | null): KyosanDetailPartKind {
  const source = measure ?? status;
  if (source !== null && normalizeKey(source).startsWith(PREVENTIVE_PREFIX)) return "preventive";
  return "fault";
}

/**
 * 시트 하나에서 부품 줄들을 읽는다. 머리글을 못 찾으면 **빈 배열** — 던지지
 * 않는다(469장을 한 번에 돌리는 쪽이 한 장 때문에 멈추면 안 된다).
 */
export function readPartsDetailSheet(grid: GridLike, sheetName: string): KyosanDetailPart[] {
  const labelsByRow = new Map<number, RowLabels>();
  for (const row of grid.rowNumbers) labelsByRow.set(row, readRowLabels(grid, row));

  const lastRow = grid.rowNumbers.length === 0 ? 0 : grid.rowNumbers[grid.rowNumbers.length - 1];
  const parts: KyosanDetailPart[] = [];

  for (const headerRow of grid.rowNumbers) {
    const header = labelsByRow.get(headerRow);
    if (!header || !isPartsHeaderRow(header)) continue;

    const nameColumn = header.byRole.get("name")?.[0];
    const nameColumns = nameColumn === undefined ? [] : [nameColumn];
    const modelColumns = header.byRole.get("model") ?? [];
    const specColumns = header.byRole.get("spec") ?? [];
    const specCombinedColumns = header.byRole.get("specCombined") ?? [];
    // 규격 칸은 판본마다 **둘 중 하나만** 나온다(홑뜻 `仕様書番号` 은 판본 A·B,
    // 겹뜻 `仕様書番号 / 型式` 은 판본 C). `spec` 칸에 실을 때는 한 묶음으로 본다 —
    // 담기는 값의 뜻이 같은 규격 칸이고, 2026-10-29 뒤로는 **둘 다 품번**이다.
    // 🔵 그래도 구실을 가른 채 둔다 — 「판본 C 의 D열」을 되짚을 자리가 필요하다
    //    (`HeaderRole` 의 주석). 함께 나오지 않으므로 차례에서는 차이가 없다.
    const allSpecColumns = [...specColumns, ...specCombinedColumns].sort((a, b) => a - b);
    const quantityColumn = header.byRole.get("quantity")?.[0];
    const statusColumn = header.byRole.get("status")?.[0];
    const measureColumn = header.byRole.get("measure")?.[0];

    const stopRow = Math.min(lastRow, headerRow + PARTS_BLOCK_MAX_ROWS);
    for (let row = headerRow + 1; row <= stopRow; row++) {
      const labels = labelsByRow.get(row);
      if (labels && isBlockBoundaryRow(labels)) break;

      const partName = cellText(grid, row, nameColumn);
      // 🔴 「交換無し」 는 부품이 아니다(위 머리말). **`部品名` 칸으로 판정한다** —
      //    실측 187줄이 거기 적혀 있고, Card 시트 경로와 같은 판정이다. `型式` 을
      //    이름으로 쓰게 된 뒤에도 이 판정 자리를 옮기지 않는다: 옮기면 그 187줄의
      //    거름이 재어 보지 않은 규칙으로 바뀐다.
      if (partName !== null && isKyosanStateOnlyPartName(partName)) continue;

      // 🔴 **이름 고르기 차례 — 여기가 이 조각의 설계다**(머리말 「이름은 품번
      //    칸에서 온다」). 다 비면 사람이 안 적은 줄이다(양식이 그려 둔 빈 줄).
      const picked = pickPartName(grid, row, [
        modelColumns, // 1. `型式`           — 품번. 실물 판본 ②(`交換部品詳細` 탭)가 여기에 적는다.
        specColumns, // 2. `仕様書番号`      — 품번. 실물 판본 ①(`(RF)` 탭)이 여기에 적는다.
        specCombinedColumns, // 3. `仕様書番号 / 型式` — 품번. 판본 C 의 D열(2026-10-29 운영 실측).
        nameColumns, // 4. `部品名`          — 🔵 비상구. 사람이 읽는 일본어 설명이라 재고관리와 안 묶인다.
      ]);
      if (picked === null) continue;

      const measure = cellText(grid, row, measureColumn);
      const status = cellText(grid, row, statusColumn);
      parts.push({
        name: picked.text,
        // 🔴 쓰지 않은 칸도 날것 그대로 싣는다 — 이름이 어디서 왔는지 되짚는 길이다.
        model: firstText(grid, row, modelColumns),
        partName,
        spec: firstText(grid, row, allSpecColumns),
        kind: toPartKind(measure, status),
        quantity: toQuantity(cellText(grid, row, quantityColumn)),
        status,
        measure,
        sheetName,
        // 🔴 **이름을 가져온 칸**을 적는다(`型式` 열일 수도 `部品名` 열일 수도 있다).
        address: `${columnNumberToLetters(picked.column)}${row}`,
      });
    }
  }

  return parts;
}
