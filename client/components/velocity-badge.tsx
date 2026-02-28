import { cn } from "@/lib/utils"
import type { VelocityCategory } from "@/lib/types"
import { TrendingUp, Minus, TrendingDown } from "lucide-react"

const CONFIG: Record<VelocityCategory, { label: string; className: string; icon: React.ElementType }> = {
  Fast: {
    label: "Fast",
    className: "bg-primary/10 text-primary border border-primary/20",
    icon: TrendingUp,
  },
  Medium: {
    label: "Medium",
    className: "bg-accent/20 text-amber-700 border border-accent/30",
    icon: Minus,
  },
  Slow: {
    label: "Slow",
    className: "bg-destructive/10 text-destructive border border-destructive/20",
    icon: TrendingDown,
  },
}

export function VelocityBadge({ velocity, size = "md" }: { velocity: VelocityCategory; size?: "sm" | "md" }) {
  const { label, className, icon: Icon } = CONFIG[velocity]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        className
      )}
    >
      <Icon className={cn(size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5")} />
      {label}
    </span>
  )
}
