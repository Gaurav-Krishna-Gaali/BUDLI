"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UploadCloud, History, BookOpen, BarChart2, Home } from "lucide-react"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/new-run", label: "New Run", icon: UploadCloud },
  { href: "/history", label: "Run History", icon: History },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
]

export function SidebarNav() {
  const pathname = usePathname()

  return (
    <aside className="w-60 min-h-screen bg-sidebar flex flex-col shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="bg-white rounded-md px-2 py-1.5 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/images-KS4hgNiGSIlTd0kFUMI1nYa64CNtsX.png"
            alt="Budli"
            width={88}
            height={32}
            className="object-contain"
          />
        </div>
      </div>

      {/* Label */}
      <div className="px-5 pt-4 pb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          Pricing Intelligence
        </p>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-3 flex-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-sidebar-border">
        <p className="text-xs text-sidebar-foreground/30 leading-relaxed">
          POC v1.0 &mdash; Human-in-the-loop pricing for refurbished devices
        </p>
      </div>
    </aside>
  )
}
