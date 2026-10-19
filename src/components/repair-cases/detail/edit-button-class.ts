/**
 * 수리 건 상세의 [수정] 단추 옷 — **여기 한 곳에만 적는다**.
 *
 * 2026-10-19 사용자 결정: 「[수정] 단추에 박스를 씌워 단추임이 보이게 한다 ·
 * 글자 굵기는 font-semibold」. 그 전까지 이 일곱 자리는 테두리도 배경도 없는
 * `hover:underline` 글자였고, **일곱 파일에 같은 className 이 글자 그대로
 * 복사되어** 있었다. 갈래가 셋으로 갈린 까닭이 바로 그 복사다 — 한 곳만
 * 고쳐지는 날이 반드시 온다. 그래서 상수로 모은다.
 *
 * `hover:underline` 은 일부러 뺐다: 테두리가 생긴 뒤에도 밑줄이 함께 나오면
 * 링크처럼도 단추처럼도 안 보인다. 박스 안이 밝아지는 것(`hover:bg-*`)으로
 * 충분하다.
 *
 * 이 옷을 입는 일곱:
 *   UsedPartsSection · ProductInfoSection · IntakeInfoSection ·
 *   FaultServiceSection · DomesticOrderDatesSection
 *     — 구역 제목 줄에서 <h2> 와 나란히 선다(부모가 flex items-center).
 *   edit/ReportNumberEditCell · edit/EngineerEditCell
 *     — **값 옆 글줄에 끼어** 선다. 아래 정렬 클래스를 **더해서** 쓴다.
 *
 * 이 파일은 "use client" 를 달지 않는다 — 글자 상수뿐이라 서버·클라이언트
 * 어느 쪽에서 불러도 된다.
 */
export const detailEditButtonClass =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

/**
 * 값 옆 글줄에 끼어 서는 둘(`ReportNumberEditCell` · `EngineerEditCell`)만
 * 위의 옷에 **더해서** 입는다.
 *
 * 그 둘은 `담당자이름 [수정]` 처럼 값과 한 줄에 선다. 글자뿐이던 때는 높이가
 * 글줄과 같아 저절로 맞았지만, 테두리와 안쪽 여백(px-2 py-1)이 붙으면 단추가
 * 글줄보다 높아져 위아래로 떠 보이기 쉽다.
 *
 * `self-center` 하나다. 지금 부모는 `<span className="inline-flex items-center">`
 * 라 단추는 **flex 항목**이고, 세로 가운데 정렬을 **단추 스스로** 쥐게 해서
 * 부모의 `items-*` 가 나중에 `items-baseline` 등으로 바뀌어도 딸려가지 않게
 * 한다 — 그 둘을 감싼 바깥 묶음이 실제로 `items-baseline` 이다(DetailHeader).
 *
 * `align-middle`(= vertical-align)은 **일부러 넣지 않는다**: flex 항목에는 듣지
 * 않아 아무 일도 하지 않고, 읽는 사람에게는 무언가 하고 있는 것으로 보인다.
 */
export const inlineEditButtonAlignClass = "self-center";
