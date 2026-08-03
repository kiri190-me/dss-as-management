"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { navItems } from "@/lib/navigation";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";

type AppShellProps = {
  children: React.ReactNode;
  user?: { name: string; roleLabel: string };
};

export default function AppShell({ children, user }: AppShellProps) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const activeItem = navItems.find((item) => item.href === pathname);
  const title = activeItem?.label ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title={title} user={user} onMenuClick={() => setMobileNavOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden border-r border-zinc-200 md:flex md:w-60 md:flex-col dark:border-zinc-800">
          <Sidebar activeHref={pathname} />
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <button
              type="button"
              aria-label="메뉴 닫기"
              onClick={() => setMobileNavOpen(false)}
              className="absolute inset-0 bg-black/40"
            />
            <aside className="relative z-50 flex w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <Sidebar
                activeHref={pathname}
                onNavigate={() => setMobileNavOpen(false)}
              />
            </aside>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
