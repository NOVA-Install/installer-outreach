"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Building2,
  Map,
  Sparkles,
  Upload,
  Download,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/installers", label: "Installers", icon: Building2 },
  { href: "/map", label: "Map View", icon: Map },
  { href: "/cleanup", label: "Data Cleanup", icon: Wrench },
  { href: "/enrichment", label: "Enrichment", icon: Sparkles },
  { href: "/import", label: "Import Data", icon: Upload },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      {/* Workspace header */}
      <div className="flex h-[52px] items-center px-3.5">
        <div className="flex flex-col">
          <Image
            src="/NOVA Logo White.png"
            alt="NOVA"
            width={80}
            height={20}
            className="shrink-0"
          />
          <span className="text-[9px] uppercase tracking-[0.25em] text-sidebar-foreground/30 font-medium mt-0.5 pl-px">
            Installer Tracker
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 pt-1 space-y-0.5">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] font-medium transition-colors",
                isActive
                  ? "bg-white/[0.08] text-white"
                  : "text-[#9a9a9a] hover:bg-white/[0.05] hover:text-white"
              )}
            >
              <item.icon className="h-[16px] w-[16px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-2 pb-3">
        <div className="mb-1.5 mx-2.5 border-t border-white/[0.08]" />
        <a
          href="/api/installers/export"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-[6px] text-[13px] font-medium text-[#9a9a9a] transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <Download className="h-[16px] w-[16px] shrink-0" />
          Export CSV
        </a>
      </div>
    </aside>
  );
}
