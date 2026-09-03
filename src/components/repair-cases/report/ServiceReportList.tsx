import Link from "next/link";

/**
 * ============================================================================
 * 「보고서」 탭 — 이 접수 건으로 저장해 둔 보고서들
 * ============================================================================
 * 한 줄을 누르면 그 보고서를 **다시 열어 고친다.** 갈림길(ReportKindChoice)은 이
 * 목록 아래에 그대로 남는다 — 한 접수 건에 여러 장이 붙는다(검사 한 장 + 수리 한
 * 장이 실제로 있다).
 *
 * ── ⚠️ "use client" 가 없다(서버 컴포넌트다) ────────────────────────────
 * 링크 목록뿐이라 브라우저에서 할 일이 없다. 그리고 종류 이름은 채우개의
 * `SERVICE_REPORT_TITLES` 에서 오는데 그 모듈이 `node:fs`·`node:zlib` 를 끌고
 * 오므로 클라이언트 번들에 들어갈 수 없다 — 그래서 이 조각도 `ReportKindChoice`
 * 와 똑같이 **다 만들어진 글자만 받아서** 그린다.
 *
 * ── 🔴 본문도 고객사명도 여기 오지 않는다 ──────────────────────────────
 * 조회(`queries/service-reports.ts`)가 일부러 담지 않는 값들이다 — 목록을 그리는
 * 데 필요하지 않고, 담으면 로그와 오류 보고에 딸려 나갈 자리가 는다. 이 조각의
 * props 에 그 칸을 더하고 싶어지면 **먼저 그 조회의 PII 항목을 읽을 것.**
 *
 * ⚠️ 줄의 이름(`모델명_L/N_S/N`)은 그 규칙 밖이 아니다 — 장비 식별자이고, 조회가
 * **다 만들어진 한 글자**로 넘긴다(`domain/service-report-list.ts`). 여기서 칸
 * 셋을 따로 받아 잇지 않는 까닭은 그러면 이름 규칙이 두 곳에 살기 때문이다
 * (「사용중」과 「휴지통」이 한 장을 다른 이름으로 부르게 된다).
 *
 * ── 빈 목록은 그리지 않는다 ────────────────────────────────────────────
 * 한 장도 없으면 페이지가 이 조각을 아예 부르지 않는다. "저장된 보고서가
 * 없습니다"라는 빈 상자는, 바로 아래에 만들기 갈림길이 있는 화면에서 아무것도
 * 알려 주지 않는다.
 *
 * ── 🔴 한 줄에 링크가 여럿인데 `<a>` 는 겹치지 않는다 ──────────────────
 * 줄 전체를 누르면 **고치기**로 가고, 오른쪽의 `미리보기 · PDF` 는 인쇄 화면으로,
 * `엑셀 받기` 는 내려받기 라우트로 간다. 그런데 줄 전체를 `<Link>` 로 감싸고 그 안에
 * 다른 링크를 넣으면 **중첩 링크**가 되어 잘못된 HTML 이다 — 브라우저마다 다르게
 * 고쳐 그리고, 보조기술은 무엇을 읽어야 할지 모른다.
 *
 * 그래서 줄(`<li>`)을 `relative` 로 두고, 고치기 링크에 `after:absolute
 * after:inset-0` 을 얹어 **가짜 요소가 줄 전체를 덮게** 한다. 오른쪽 링크들은
 * 그 위(`relative z-10`)에 앉는다. `<a>` 는 형제라 겹치지 않는데, 누를 수 있는
 * 넓이는 예전 그대로다.
 *
 * ⚠️ 오른쪽 둘은 **한 묶음**(`<span>`)이다. 줄이 `justify-between` 이라 따로
 * 두면 좁은 화면에서 둘이 양끝으로 벌어져 미리보기가 줄 한가운데에 떠 버린다.
 * 묶음에 `z-10` 을 주므로 안쪽 링크는 각자 얹지 않아도 덮개 위에 앉는다.
 *
 * ── 생김새는 견적서 목록에서 가져왔다 ──────────────────────────────────
 * 외곽선 단추 둘 — `quotes/QuoteListScreen.tsx` 의 `PreviewLink`·`DownloadLink`
 * 와 **같은 클래스, 같은 말투**다. 두 화면은 하는 일이 같다: 고객사로 나가는
 * 문서 한 장을 미리 보고, 파일로 받는다. 그런데 여기만 밑줄 친 파란 글자였다.
 *
 * 그 글자에는 두 가지 문제가 있었다.
 *   1. 같은 줄에 회색 잔글씨가 이미 셋이다(발행일·문서번호·마지막 수정). 크기가
 *      같으니 **할 수 있는 일이 읽을 거리에 섞였다.**
 *   2. 누를 자리가 12px 글자뿐인데, 그 아래는 줄 전체를 덮은 고치기 덮개다
 *      (바로 위 절). 손가락이 조금만 빗나가면 편집 화면이 열린다 — 현장에서
 *      태블릿으로 보는 화면이라 이것이 제일 컸다.
 *
 * 🔴 **단추는 자기 배경을 갖는다**(`bg-white dark:bg-zinc-900`). 견적서 목록을
 * 그대로 베끼면 안 되는 한 곳이다 — 그쪽 표는 줄이 hover 에 반응하지 않지만
 * **이 줄은 통째로 밝아진다**(`hover:bg-zinc-50`). 단추 배경을 비워 두면 단추가
 * 줄 색을 그대로 비추고, 단추의 `hover:bg-zinc-50` 이 줄의 hover 색과 같아져
 * **가리키는 동안 아무 반응도 없는 것처럼 보인다.** 그래서 배경을 흰색으로 붙들고
 * 단추의 hover 는 한 칸 더 진한 `zinc-100` 으로 둔다.
 *
 * ── 🔴 「엑셀 받기」는 `<a>` 다 — `<Link>` 가 아니다 ───────────────────
 * 그 주소는 화면이 아니라 **파일을 흘려보내는 API** 다(`Content-Disposition:
 * attachment`). `<Link>` 로 두면 Next 가 화면 전환으로 여겨 미리 가져오려 든다.
 * 파일 이름도 서버가 정한다 — `download` 를 붙여 화면이 이름을 정하면 목록과
 * 편집 화면이 같은 장을 다른 이름으로 저장하는 날이 온다(견적서 목록의
 * `DownloadLink` 와 같은 판단).
 * ============================================================================
 */

export type ServiceReportListRow = {
  id: string;
  /** 이 장을 여는 주소. 페이지가 만든다(`…/service-report?id=…`). */
  href: string;
  /**
   * 이 장의 미리보기 주소. **페이지가 만든다**(`…/service-report/print?id=…`) —
   * 조각이 주소를 조립하면 주소가 두 곳에 살게 된다(`href` 와 같은 원칙).
   */
  printHref: string;
  /**
   * 이 장을 xlsx 로 받는 주소. **페이지가 만든다**
   * (`/api/repair-cases/{건}/service-report/xlsx?id={보고서}`) — `href` 와 같은 원칙.
   *
   * 🔴 **권한이 없으면 `null` 이고, 그때는 단추를 그리지 않는다.** 판단은
   * 페이지가 한다(`canEditServiceReports`) — 눌러도 403 이 나는 단추를 두지
   * 않는다. 라우트는 화면이 감추든 말든 스스로 세션·권한을 다시 확인한다.
   */
  xlsxHref: string | null;
  /** 「검사보고서」·「수리보고서」 — 양식의 제목에서 온다. */
  kindLabel: string;
  /**
   * 줄의 이름 — `모델명_L/N_S/N`. 조회가 만들어 넘긴다
   * (`domain/service-report-list.ts`). **빈 글자로 오지 않는다** — 장비 셋이 다
   * 비면 문서번호로, 그것도 비면 「이름 없음」으로 되돌아간다.
   */
  name: string;
  /**
   * `No. [앞]-[중간]-[뒤]` 를 이은 것. 세 칸을 다 비워 두고 저장할 수 있어 빈
   * 글자일 수 있고, **그때는 그리지 않는다.**
   *
   * 🔴 이름 자리에서 물러났을 뿐 없애지 않았다 — 사람이 손으로 매긴 값이라
   * 적힌 줄에서는 그것이 그 장을 가리키는 이름이다.
   */
  reportNumber: string;
  /** "YYYY-MM-DD" */
  issuedOn: string;
  /** 마지막으로 고친 때(`2026-09-02 14:33`). 읽을 수 없으면 null. */
  updatedAtLabel: string | null;
};

export default function ServiceReportList({ rows }: { rows: readonly ServiceReportListRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">저장된 보고서</h2>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          누르면 그 보고서를 다시 열어 고칩니다.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            // `relative` 는 고치기 링크의 덮개(`after:inset-0`)가 기댈 자리다 —
            // 머리말의 '한 줄에 링크가 여럿인데 `<a>` 는 겹치지 않는다'.
            className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-zinc-200 bg-white px-4 py-3 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <Link
              href={row.href}
              // `min-w-0` 이 없으면 이름이 긴 줄에서 이 묶음이 줄지 않고 오른쪽
              // 단추들을 밀어낸다 — 단추가 생기면서 오른쪽이 넓어졌다.
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 after:absolute after:inset-0 after:rounded-lg"
            >
              <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
                {row.kindLabel}
              </span>
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.name}</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">발행일 {row.issuedOn}</span>
              {/* 이름 자리를 내준 문서번호. 적혀 있을 때만 그린다 — 안 적힌 줄에
                  「문서번호 없음」을 적어 두면 그 사실이 이름처럼 보인다. */}
              {row.reportNumber !== "" && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  No. {row.reportNumber}
                </span>
              )}
              {row.updatedAtLabel !== null && (
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  마지막 수정 {row.updatedAtLabel}
                </span>
              )}
            </Link>

            {/* 🔴 덮개 **위**에 앉아야 눌린다(`z-10`). 둘을 한 묶음으로 두는
                까닭은 머리말의 '⚠️ 오른쪽 둘은 한 묶음이다' 참조. 한 화면에 같은
                글자가 여럿이라 무엇의 것인지 이름으로 밝힌다. */}
            <span className="relative z-10 flex shrink-0 flex-wrap items-center gap-1">
              <PreviewLink row={row} />

              {/* 권한이 없으면 아예 그리지 않는다 — 위 `xlsxHref` 의 주석. */}
              {row.xlsxHref !== null && <DownloadLink row={row} href={row.xlsxHref} />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * 두 단추의 생김새. 견적서 목록은 같은 글자를 두 조각에 각각 적어 두었지만, 여기서는
 * 한 줄에 나란히 서는 둘이라 **한쪽만 바뀌면 그 자리에서 바로 어긋나 보인다.**
 *
 * 🔴 `bg-white dark:bg-zinc-900` 와 `hover:bg-zinc-100` 이 견적서 쪽과 다른 유일한
 * 두 곳이다 — 까닭은 머리말의 '단추는 자기 배경을 갖는다'.
 */
const ACTION_LINK_CLASS =
  "inline-block rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

/**
 * 미리보기 · PDF. 견적서 목록과 같은 글자다 — 인쇄 화면이 곧 PDF 내려받기이고
 * (브라우저의 「PDF로 저장」), 그 사실을 아는 사람은 단추에서 그걸 읽는다.
 */
function PreviewLink({ row }: { row: ServiceReportListRow }) {
  return (
    <Link
      href={row.printHref}
      // 한 화면에 같은 글자가 여럿이라 무엇의 것인지 이름으로 밝힌다. 견적서
      // 목록에는 없는데, 그쪽은 표라서 줄의 다른 칸이 이미 그 일을 한다.
      aria-label={`${row.kindLabel} ${row.name} 미리보기`}
      className={ACTION_LINK_CLASS}
    >
      미리보기 · PDF
    </Link>
  );
}

/**
 * xlsx 를 받는 링크. 글자가 견적서의 「견적서 받기」와 다른 까닭은, 이 줄에는
 * **받는 길이 둘**이기 때문이다 — 옆 단추도 (PDF 로) 문서를 받는다. 「보고서
 * 받기」라고 적으면 둘 중 무엇이 무엇인지 글자가 말해 주지 못한다.
 */
function DownloadLink({ row, href }: { row: ServiceReportListRow; href: string }) {
  return (
    <a
      href={href}
      aria-label={`${row.kindLabel} ${row.name} 엑셀 내려받기`}
      className={ACTION_LINK_CLASS}
    >
      엑셀 받기
    </a>
  );
}
