/**
 * 기타건 상세의 탭 하나가 **아직 내용 대신 한 줄만** 보여 줄 때 쓰는 상자
 * (2026-11-06).
 *
 * 🔴 **빈 화면을 내밀지 않기 위한 조각이다.** 탭 자리를 먼저 세우고 내용을 다음
 * 조각에서 채우는 동안, 눌렀을 때 아무것도 없으면 사람은 그 탭이 **깨졌다**고
 * 읽는다 — 그러면 멀쩡한 화면까지 의심하게 되고, 그 의심은 보고로 돌아온다.
 * 「아직 없다」와 「고장났다」는 눈으로 가려지지 않으므로 글로 적는다.
 *
 * 권한이 모자라 못 보는 탭에도 같은 상자를 쓴다 — 그때는 **까닭이 다른 한 줄**이
 * 들어간다(「볼 권한이 없습니다」). 빈 화면으로 두면 관리자에게 무엇을 풀어 달라고
 * 해야 하는지 알 수 없다(/no-access 안내 화면이 있는 것과 같은 까닭).
 *
 * `<h1>` 이 아니라 `<h2>` 다 — 이 상자는 탭 **안**에 서고, 그 페이지의 `<h1>` 은
 * 레이아웃의 머리 카드(「기타건 상세」)가 이미 갖고 있다. 한 화면에 `<h1>` 이 둘이면
 * 화면 낭독기가 제목 뼈대를 잘못 읽는다.
 */
export default function DomesticOrderDetailNotice({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
    </section>
  );
}
