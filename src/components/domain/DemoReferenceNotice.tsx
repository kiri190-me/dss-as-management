import { DEMO_REFERENCE_DATE, formatDemoReferenceDateLabel } from "@/lib/domain/demo-clock";

export default function DemoReferenceNotice() {
  return (
    <p className="text-xs text-zinc-500 dark:text-zinc-400">
      데모 기준일: {formatDemoReferenceDateLabel(DEMO_REFERENCE_DATE)}
    </p>
  );
}
