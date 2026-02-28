"use client"

import { useEffect, useState } from "react"
import { BarChart2, TrendingUp, Activity, Target } from "lucide-react"
import { AppShell } from "@/components/app-shell"
import { getRuns, getKBEntries } from "@/lib/store"
import type { Run, KnowledgeBaseEntry } from "@/lib/types"
import { VelocityBadge } from "@/components/velocity-badge"

interface BrandStat {
  brand: string
  count: number
  avgPrice: number
  avgConfidence: number
  fastCount: number
}

export default function AnalyticsPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([])

  useEffect(() => {
    setRuns(getRuns())
    setEntries(getKBEntries())
  }, [])

  const allResults = runs.flatMap(r => r.results)
  const allDevices = runs.flatMap(r => r.devices)

  const totalDevices = allDevices.length
  const avgPrice = allResults.length ? Math.round(allResults.reduce((s, r) => s + r.recommendedPrice, 0) / allResults.length) : 0
  const avgConfidence = allResults.length ? Math.round(allResults.reduce((s, r) => s + r.confidenceScore, 0) / allResults.length) : 0
  const acceptanceRate = entries.length
    ? Math.round((entries.filter(e => Math.abs(e.delta) <= 1000).length / entries.length) * 100)
    : 0

  // Brand breakdown
  const brandMap = new Map<string, { prices: number[]; confidence: number[]; fast: number }>()
  allDevices.forEach(d => {
    const result = allResults.find(r => r.deviceId === d.id)
    if (!result) return
    const existing = brandMap.get(d.brand) ?? { prices: [], confidence: [], fast: 0 }
    existing.prices.push(result.recommendedPrice)
    existing.confidence.push(result.confidenceScore)
    if (result.velocityCategory === "Fast") existing.fast++
    brandMap.set(d.brand, existing)
  })
  const brandStats: BrandStat[] = Array.from(brandMap.entries()).map(([brand, val]) => ({
    brand,
    count: val.prices.length,
    avgPrice: Math.round(val.prices.reduce((a, b) => a + b, 0) / val.prices.length),
    avgConfidence: Math.round(val.confidence.reduce((a, b) => a + b, 0) / val.confidence.length),
    fastCount: val.fast,
  })).sort((a, b) => b.count - a.count)

  // Condition distribution
  const conditionMap = new Map<string, number>()
  allDevices.forEach(d => {
    conditionMap.set(d.conditionTier, (conditionMap.get(d.conditionTier) ?? 0) + 1)
  })

  // Velocity distribution
  const velocityMap = new Map<string, number>()
  allResults.forEach(r => {
    velocityMap.set(r.velocityCategory, (velocityMap.get(r.velocityCategory) ?? 0) + 1)
  })

  // Price adjustment trend (KB)
  const avgDelta = entries.length
    ? Math.round(entries.reduce((s, e) => s + e.delta, 0) / entries.length)
    : 0

  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  const isEmpty = runs.length === 0

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-balance">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aggregate insights across all pricing runs and knowledge base entries.
          </p>
        </div>

        {isEmpty ? (
          <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
            <BarChart2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">No data yet</p>
            <p className="text-xs text-muted-foreground">Run a pricing analysis to see aggregate insights here.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Devices Priced", value: totalDevices, icon: Target, sub: `Across ${runs.length} run${runs.length !== 1 ? "s" : ""}` },
                { label: "Avg Recommended Price", value: formatINR(avgPrice), icon: TrendingUp, sub: "All devices & conditions" },
                { label: "Avg AI Confidence", value: `${avgConfidence}%`, icon: Activity, sub: "Across all recommendations" },
                { label: "KB Acceptance Rate", value: entries.length ? `${acceptanceRate}%` : "—", icon: BarChart2, sub: entries.length ? `${entries.length} reviewed` : "No feedback yet" },
              ].map(kpi => (
                <div key={kpi.label} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <kpi.icon className="w-4 h-4 text-primary" />
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </div>
              ))}
            </div>

            {/* Velocity distribution */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold mb-4">Velocity Distribution</h3>
                {(["Fast", "Medium", "Slow"] as const).map(v => {
                  const count = velocityMap.get(v) ?? 0
                  const pct = allResults.length ? Math.round((count / allResults.length) * 100) : 0
                  const barColor = v === "Fast" ? "bg-primary" : v === "Medium" ? "bg-accent" : "bg-destructive"
                  return (
                    <div key={v} className="flex items-center gap-3 mb-3">
                      <VelocityBadge velocity={v} size="sm" />
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div className={`${barColor} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{count} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>

              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold mb-4">Condition Distribution</h3>
                {["Like New", "Excellent", "Good", "Fair"].map((c, i) => {
                  const count = conditionMap.get(c) ?? 0
                  const pct = totalDevices ? Math.round((count / totalDevices) * 100) : 0
                  const opacity = ["opacity-100", "opacity-80", "opacity-60", "opacity-40"][i]
                  return (
                    <div key={c} className="flex items-center gap-3 mb-3">
                      <span className="text-xs w-20 shrink-0">{c}</span>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div className={`bg-primary ${opacity} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{count} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Brand breakdown */}
            {brandStats.length > 0 && (
              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="text-sm font-semibold">Brand Breakdown</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      {["Brand", "Devices", "Avg Price", "Avg Confidence", "Fast Movers"].map(h => (
                        <th key={h} className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brandStats.map(stat => (
                      <tr key={stat.brand} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-semibold">{stat.brand}</td>
                        <td className="px-5 py-3 text-muted-foreground">{stat.count}</td>
                        <td className="px-5 py-3 text-primary font-medium">{formatINR(stat.avgPrice)}</td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-muted rounded-full h-1.5 w-16">
                              <div
                                className="bg-primary h-1.5 rounded-full"
                                style={{ width: `${stat.avgConfidence}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{stat.avgConfidence}%</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {stat.fastCount > 0
                            ? <VelocityBadge velocity="Fast" size="sm" />
                            : <span className="text-xs text-muted-foreground">—</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* KB learning summary */}
            {entries.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-5">
                <h3 className="text-sm font-semibold mb-3">Knowledge Base Learning Summary</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Total Feedback Entries</p>
                    <p className="text-2xl font-bold">{entries.length}</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Avg Human Adjustment</p>
                    <p className="text-2xl font-bold text-foreground">
                      {avgDelta > 0 ? "+" : ""}{formatINR(avgDelta)}
                    </p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4">
                    <p className="text-xs text-muted-foreground mb-1">Near-Acceptance Rate</p>
                    <p className="text-2xl font-bold text-primary">{acceptanceRate}%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">within ₹1,000 of recommendation</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
