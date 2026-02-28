"use client"

import { useEffect, useState } from "react"
import { BookOpen, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { getKBEntries, getKBPatterns } from "@/lib/store"
import type { KnowledgeBaseEntry, KBPattern } from "@/lib/types"
import { VelocityBadge } from "@/components/velocity-badge"
import { cn } from "@/lib/utils"

export default function KnowledgeBasePage() {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([])
  const [patterns, setPatterns] = useState<KBPattern[]>([])

  useEffect(() => {
    getKBEntries().then(setEntries)
    getKBPatterns().then(setPatterns)
  }, [])

  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  const deltaLabel = (delta: number) => {
    if (delta > 500) return { text: `+${formatINR(delta)} higher`, icon: TrendingUp, color: "text-primary" }
    if (delta < -500) return { text: `${formatINR(delta)} lower`, icon: TrendingDown, color: "text-destructive" }
    return { text: "Accepted as-is", icon: Minus, color: "text-muted-foreground" }
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-balance">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            Historical human review decisions. Patterns here are used to improve future pricing recommendations.
          </p>
        </div>

        {/* Patterns */}
        {patterns.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Lightbulb className="w-4 h-4 text-accent-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Learned Patterns</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {patterns.map(p => (
                <div key={p.key} className="bg-accent/10 border border-accent/30 rounded-lg px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-foreground">{p.insight}</p>
                    <span className="shrink-0 text-xs bg-accent/20 text-amber-800 border border-accent/30 rounded-full px-2 py-0.5 font-medium">
                      {p.occurrences}x
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Avg adjustment: {p.avgDelta > 0 ? "+" : ""}{formatINR(p.avgDelta)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty */}
        {entries.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
            <BookOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">Knowledge Base is empty</p>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              Complete a pricing run, review the recommendations, and submit feedback to start building the knowledge base.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">Review History</h2>
              <span className="text-xs text-muted-foreground">{entries.length} entr{entries.length !== 1 ? "ies" : "y"}</span>
            </div>
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Device", "Condition", "Recommended", "Approved", "Delta", "Velocity", "Date"].map(h => (
                      <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const { text, icon: Icon, color } = deltaLabel(entry.delta)
                    return (
                      <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium">{entry.brand} {entry.model}</p>
                          <p className="text-xs text-muted-foreground">{entry.ram} &bull; {entry.storage}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-secondary text-secondary-foreground rounded-full px-2 py-0.5">
                            {entry.conditionTier}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatINR(entry.recommendedPrice)}</td>
                        <td className="px-4 py-3 font-semibold text-foreground">{formatINR(entry.humanApprovedPrice)}</td>
                        <td className="px-4 py-3">
                          <span className={cn("flex items-center gap-1 text-xs font-medium", color)}>
                            <Icon className="w-3.5 h-3.5" />
                            {text}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <VelocityBadge velocity={entry.humanVelocityOverride ?? entry.velocityCategory} size="sm" />
                            {entry.humanVelocityOverride && entry.humanVelocityOverride !== entry.velocityCategory && (
                              <span className="text-xs text-muted-foreground">overrode {entry.velocityCategory}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {entries.some(e => e.feedbackNote) && (
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-accent-foreground" />
              <h2 className="text-sm font-semibold">Pricing Manager Notes</h2>
            </div>
            <div className="space-y-2">
              {entries.filter(e => e.feedbackNote).map(entry => (
                <div key={entry.id} className="flex items-start gap-3 bg-muted/50 rounded-lg px-4 py-3">
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">
                      {entry.brand} {entry.model} &bull; {entry.conditionTier}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{entry.feedbackNote}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
