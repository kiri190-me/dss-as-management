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

  const activeItem = navItems.find((item) => item.href === pathname);
  const title = activeItem?.label ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <div className="print:hidden">
        <TopBar title={title} user={user} onMenuClick={() => setMobileNavOpen(true)} />
      </div>
      <div className="flex flex-1 overflow-hidden print:overflow-visible">
        <aside className="hidden border-r border-zinc-200 md:flex md:w-60 md:flex-col print:hidden dark:border-zinc-800">
          <Sidebar activeHref={pathname} role={user.role} />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden print:hidden">
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside className="relative z-50 flex w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <Sidebar
                activeHref={pathname}
                role={user.role}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
