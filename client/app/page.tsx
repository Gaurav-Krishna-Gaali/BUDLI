"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  UploadCloud, History, BookOpen, BarChart2,
  ArrowRight, CheckCircle2, Clock, AlertCircle, ChevronRight
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell"
import { getRuns, getKBEntries, getKBPatterns } from "@/lib/store"
import { VelocityBadge } from "@/components/velocity-badge"
import type { Run } from "@/lib/types"

const WORKFLOW_STEPS = [
  { step: "01", title: "Upload Devices", desc: "Provide a CSV or enter up to 10 device models with specs and condition." },
  { step: "02", title: "Market Signal Collection", desc: "Engine references Flipkart, OLX & Cashify pricing and demand data." },
  { step: "03", title: "Pricing & Velocity", desc: "Rule-based logic computes recommended price and sell-through velocity." },
  { step: "04", title: "Explanation Generation", desc: "Human-readable rationale with market drivers and risk flags." },
  { step: "05", title: "Human Review", desc: "Pricing manager reviews, adjusts, and approves each recommendation." },
  { step: "06", title: "Feedback to KB", desc: "Approved decisions are stored — future runs learn from this history." },
]

export default function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [kbCount, setKbCount] = useState(0)
  const [patternCount, setPatternCount] = useState(0)

  useEffect(() => {
    getRuns().then(setRuns)
    getKBEntries().then(entries => setKbCount(entries.length))
    getKBPatterns().then(patterns => setPatternCount(patterns.length))
  }, [])

  const allResults = runs.flatMap(r => r.results)
  const avgConfidence = allResults.length
    ? Math.round(allResults.reduce((s, r) => s + r.confidenceScore, 0) / allResults.length)
    : 0

  const recentRuns = runs.slice(0, 4)
  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">
                AI-Assisted Pricing POC
              </p>
              <h1 className="text-3xl font-bold text-balance leading-tight mb-3">
                ReCommerce Pricing<br />Intelligence Platform
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-lg">
                Upload a CSV of refurbished smartphone models and receive AI-generated pricing
                recommendations, sell-through velocity estimates, and human-readable explanations
                — with full human control over final decisions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <Link href="/new-run">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <UploadCloud className="w-4 h-4 mr-2" />
                Start New Run
              </Button>
            </Link>
            <Link href="/history">
              <Button variant="outline">
                <History className="w-4 h-4 mr-2" />
                View History
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: "Total Runs", value: runs.length || "—", sub: "pricing analyses" },
            { label: "Devices Priced", value: runs.flatMap(r => r.devices).length || "—", sub: "across all runs" },
            { label: "KB Entries", value: kbCount || "—", sub: `${patternCount} learned pattern${patternCount !== 1 ? "s" : ""}` },
            { label: "Avg Confidence", value: avgConfidence ? `${avgConfidence}%` : "—", sub: "AI recommendation quality" },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.sub}</p>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-10">
          {/* Recent runs */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-foreground">Recent Runs</h2>
              <Link href="/history" className="flex items-center gap-1 text-xs text-primary hover:underline">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {recentRuns.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
                <Clock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No runs yet. Start your first analysis.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recentRuns.map(run => {
                  const avgPrice = run.results.length
                    ? Math.round(run.results.reduce((s, r) => s + r.recommendedPrice, 0) / run.results.length)
                    : 0
                  return (
                    <Link
                      key={run.id}
                      href={`/runs/${run.id}`}
                      className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{run.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {run.devices.length} device{run.devices.length !== 1 ? "s" : ""} &bull; {new Date(run.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {run.results.length > 0 && (
                          <span className="text-sm font-semibold text-primary">{formatINR(avgPrice)}</span>
                        )}
                        {run.feedbackSubmitted
                          ? <CheckCircle2 className="w-4 h-4 text-primary" />
                          : <AlertCircle className="w-4 h-4 text-muted-foreground" />
                        }
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-4">Quick Actions</h2>
            <div className="space-y-2">
              {[
                { href: "/new-run", icon: UploadCloud, label: "New Pricing Run", desc: "Upload CSV or enter devices manually" },
                { href: "/history", icon: History, label: "View Run History", desc: "Review past results and submit feedback" },
                { href: "/knowledge-base", icon: BookOpen, label: "Knowledge Base", desc: `${kbCount} entries, ${patternCount} learned patterns` },
                { href: "/analytics", icon: BarChart2, label: "Analytics", desc: "Aggregate insights across all runs" },
              ].map(action => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3 hover:border-primary/40 hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center shrink-0">
                    <action.icon className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{action.label}</p>
                    <p className="text-xs text-muted-foreground">{action.desc}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Workflow */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-4">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-3">
            {WORKFLOW_STEPS.map((s, i) => (
              <div key={s.step} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center text-[10px]">
                    {i + 1}
                  </span>
                  <p className="text-sm font-semibold">{s.title}</p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 bg-secondary/50 border border-border rounded-lg px-5 py-4 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Data sources:</span> Pricing benchmarks are referenced from Flipkart (new price), OLX (used market average), and Cashify (certified refurbished average) for the Indian market. No live scraping — market data is embedded for POC purposes. All final pricing decisions remain with the pricing manager.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
