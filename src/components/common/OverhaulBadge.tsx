import { assessOverhaul, formatElapsed, formatProduction } from "@/lib/domain/overhaul";

/**
 * ============================================================================
 * O/H 대상 표시 — 알려 주기만 한다
 * ============================================================================
 * S/N 에 적힌 생산 연월으로 4년 기준을 본다(domain/overhaul.ts).
 *
 * ── 🔴 이 표시가 무엇을 정하지는 않는다 ─────────────────────────────────
 * O/H 대상품이어도 **일반 견적서와 OH 견적서를 모두 발행한다**(사용자 확인).
 * 그러니 이 배지 때문에 화면이 갈라지거나 견적서 종류가 정해지면 안 된다 —
 * 사람이 보고 판단하도록 근거와 함께 보여 주기만 한다.
 *
 * ── 판정하지 못한 것을 '아님'으로 말하지 않는다 ─────────────────────────
 * S/N 형식이 다르면(`WU8042` 처럼) 아무것도 그리지 않는다. "O/H 대상 아님"이라고
 * 쓰면 그건 틀린 답이다 — 모르는 것과 아닌 것은 다르다.
 *
 * OP TIME 5만 시간 기준은 그 값을 담는 칸이 아직 없어 보지 못한다. 대상이
 * **아닌** 쪽으로 판정될 때 그 사실을 함께 적는다 — 4년은 안 됐지만 5만 시간을
 * 넘긴 장비를 시스템이 잘라 말하면 안 되기 때문이다.
 * ============================================================================
 */
export default function OverhaulBadge({
  serialNumber,
  referenceDate,
  className,
}: {
  serialNumber: string | null | undefined;
  /** 서버가 정한 오늘. 클라이언트에서 만들면 hydration 이 어긋난다. */
  referenceDate: Date;
  className?: string;
}) {
  const result = assessOverhaul(serialNumber, referenceDate);
  if (result.kind === "UNKNOWN") return null;

  const { production, monthsElapsed, isDue } = result;
  const basis = `${formatProduction(production)} · ${formatElapsed(monthsElapsed)}`;

  if (isDue) {
    return (
      <span
        className={`inline-flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs dark:border-amber-800 dark:bg-amber-950 ${className ?? ""}`}
      >
        <b className="text-amber-900 dark:text-amber-200">O/H 대상품</b>
        <span className="text-amber-800 dark:text-amber-300">{basis}</span>
        <span className="text-amber-700/80 dark:text-amber-400/80">(생산 4년 경과)</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 ${className ?? ""}`}
    >
      <span>{basis}</span>
      <span>· 생산 4년 미만</span>
      {/* 반쪽 판정임을 감추지 않는다(파일 머리말). */}
      <span className="text-zinc-400 dark:text-zinc-500">· OP TIME 은 확인할 수 없습니다</span>
    </span>
  );
}
