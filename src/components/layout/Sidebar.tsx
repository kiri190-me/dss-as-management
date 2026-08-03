import Link from "next/link";
import { navItems } from "@/lib/navigation";

type SidebarProps = {
  activeHref: string;
  onNavigate?: () => void;
};

export default function Sidebar({ activeHref, onNavigate }: SidebarProps) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {navItems.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md border-l-2 border-zinc-900 bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 dark:border-zinc-50 dark:bg-zinc-800 dark:text-zinc-50"
                : "rounded-md border-l-2 border-transparent px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
