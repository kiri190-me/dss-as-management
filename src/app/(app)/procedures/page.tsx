import { redirect } from "next/navigation";

/**
 * Checkpoint 1 (기술 절차 템플릿 IA removal) — the old all-category
 * procedure-template list is no longer a user-facing entry point. Redirects
 * (not a 404/placeholder) so any existing bookmark/link still lands
 * somewhere usable — 기술 작업 절차 (/procedures/technical), the template
 * category this app's users actually work with. Neither the underlying
 * procedure_templates table, its FULL_SERVICE/REFERENCE/TECHNICAL_TASK rows,
 * nor the shared /procedures/[id] detail/edit/validation routes are touched
 * — this file only removes the all-category list's own route.
 */
export default function ProceduresPage() {
  redirect("/procedures/technical");
}
