"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/navigation";
import type { Role } from "@/lib/domain/types";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";

type AppShellProps = {
  children: React.ReactNode;
  // Required, not optional: (app)/layout.tsx — AppShell's only caller —
  // resolves and validates the acting user before ever rendering this
  // component, redirecting to /login otherwise. A shell without a known
  // user must never render, so the logout control can never be silently
  // hidden. `role` drives Sidebar's nav-item visibility filter only — a
  // UX convenience, never the enforcement boundary (every gated page
  // re-checks the same predicate server-side regardless of what this
  // shell renders).
  user: { name: string; roleLabel: string; role: Role };
};

export default function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Whole-sidebar narrow/icon-only mode — owned here (not inside Sidebar)
  // because the <aside>'s own width class must react to it too. Toggling
  // this never touches router state, so it can never change the current
  // route; it's also entirely separate from Sidebar's own per-group
  // collapsedGroupKeys state (see Sidebar.tsx's doc comment).
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const activeItem = navItems.find((item) => item.href === pathname);
  const title = activeItem?.label ?? "";

  return (
    // min-h-0 lets this root shrink to body's now-capped h-full height
    // instead of growing to fit its own content (the classic flex "min-
    // height:auto" gotcha) — the first link in the height chain that makes
    // <main>'s and the sidebar's own overflow-y-auto actually scroll
    // internally rather than inflating the whole page.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="print:hidden">
        <TopBar title={title} onMenuClick={() => setMobileNavOpen(true)} />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden print:overflow-visible">
        <aside
          className={`hidden min-h-0 border-r border-zinc-200 transition-[width] duration-150 md:flex md:flex-col print:hidden dark:border-zinc-800 ${isSidebarCollapsed ? "md:w-14" : "md:w-52"}`}
        >
          <Sidebar activeHref={pathname} role={user.role} user={user} isCollapsed={isSidebarCollapsed} onToggleCollapsed={() => setIsSidebarCollapsed((prev) => !prev)} />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden print:hidden">
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside className="relative z-50 flex min-h-0 w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <Sidebar
                activeHref={pathname}
                role={user.role}
                user={user}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
