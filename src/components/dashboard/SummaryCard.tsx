import Link from "next/link";

type SummaryCardProps = {
  label: string;
  value: number;
  href: string;
  tone?: "neutral" | "success" | "danger";
};

const toneClasses: Record<NonNullable<SummaryCardProps["tone"]>, string> = {
  neutral:
    "border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-50",
  success:
    "border-green-200 dark:border-green-900 text-green-700 dark:text-green-400",
  danger:
    "border-red-200 dark:border-red-900 text-red-700 dark:text-red-400",
};

export default function SummaryCard({
  label,
  value,
  href,
  tone = "neutral",
}: SummaryCardProps) {
  return (
    <Link
      href={href}
      className={`flex flex-col gap-1 rounded-lg border bg-white p-4 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${toneClasses[tone]}`}
    >
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className={`text-2xl font-semibold ${tone === "neutral" ? "text-zinc-900 dark:text-zinc-50" : ""}`}>
        {value}건
      </span>
    </Link>
  );
}
