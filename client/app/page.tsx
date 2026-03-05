"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  UploadCloud, History, BookOpen, BarChart2,
  ArrowRight, CheckCircle2, Clock, AlertCircle, ChevronRight,
  Search, Loader2, ExternalLink
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AppShell } from "@/components/app-shell"
import { getRuns, getKBEntries, getKBPatterns } from "@/lib/store"
import { startBrowserScrape, getScrapeResults } from "@/lib/pricing-engine"
import { VelocityBadge } from "@/components/velocity-badge"
import type { Run, ScrapeResultsResponse } from "@/lib/types"

const WORKFLOW_STEPS = [
  { step: "01", title: "Upload Devices", desc: "Provide a CSV or enter up to 10 device models with specs and condition." },
  { step: "02", title: "Market Signal Collection", desc: "Engine references Flipkart, OLX & Cashify pricing and demand data." },
  { step: "03", title: "Pricing & Velocity", desc: "Rule-based logic computes recommended price and sell-through velocity." },
  { step: "04", title: "Explanation Generation", desc: "Human-readable rationale with market drivers and risk flags." },
  { step: "05", title: "Human Review", desc: "Pricing manager reviews, adjusts, and approves each recommendation." },
  { step: "06", title: "Feedback to KB", desc: "Approved decisions are stored — future runs learn from this history." },
]

const POLL_INTERVAL_MS = 2500

export default function DashboardPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [kbCount, setKbCount] = useState(0)
  const [patternCount, setPatternCount] = useState(0)

  // Live scrape (browser) state
  const [scrapeQuery, setScrapeQuery] = useState("")
  const [scrapeJobId, setScrapeJobId] = useState<string | null>(null)
  const [scrapeStatus, setScrapeStatus] = useState<"idle" | "starting" | "running" | "finished" | "error">("idle")
  const [scrapeResult, setScrapeResult] = useState<ScrapeResultsResponse | null>(null)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [liveUrls, setLiveUrls] = useState<string[]>([])

  useEffect(() => {
    getRuns().then(setRuns)
    getKBEntries().then(entries => setKbCount(entries.length))
    getKBPatterns().then(patterns => setPatternCount(patterns.length))
  }, [])

  // Poll scrape results when job is running
  const pollScrapeResults = useCallback(async (jobId: string) => {
    try {
      const data = await getScrapeResults(jobId)
      setScrapeResult(data)
      if (data.status === "finished") {
        setScrapeStatus("finished")
        return
      }
      if (data.status === "error") {
        setScrapeStatus("error")
        setScrapeError(data.error || "Scrape failed")
        return
      }
      // still running: poll again
      setTimeout(() => pollScrapeResults(jobId), POLL_INTERVAL_MS)
    } catch (e) {
      setScrapeStatus("error")
      setScrapeError(e instanceof Error ? e.message : "Failed to fetch results")
    }
  }, [])

  useEffect(() => {
    if (scrapeJobId && scrapeStatus === "running") {
      pollScrapeResults(scrapeJobId)
    }
  }, [scrapeJobId, scrapeStatus, pollScrapeResults])

  const handleStartScrape = async () => {
    const query = scrapeQuery.trim()
    if (!query) return
    setScrapeError(null)
    setScrapeResult(null)
    setScrapeStatus("starting")
    try {
      const { job_id, live_urls } = await startBrowserScrape(query)
      setScrapeJobId(job_id)
      setLiveUrls(live_urls || [])
      setScrapeStatus("running")
    } catch (e) {
      setScrapeStatus("error")
      setScrapeError(e instanceof Error ? e.message : "Failed to start scrape")
    }
  }

  const resetScrape = () => {
    setScrapeJobId(null)
    setScrapeStatus("idle")
    setScrapeResult(null)
    setScrapeError(null)
    setLiveUrls([])
  }

  const allResults = runs.flatMap(r => r.results)
  const avgConfidence = allResults.length
    ? Math.round(allResults.reduce((s, r) => s + r.confidenceScore, 0) / allResults.length)
    : 0

  const recentRuns = runs.slice(0, 4)
  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Hero */}
        <div className="mb-8 sm:mb-10">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">
                AI-Assisted Pricing POC
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-balance leading-tight mb-3">
                ReCommerce Pricing<br />Intelligence Platform
              </h1>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-lg">
                Upload a CSV of refurbished smartphone models and receive AI-generated pricing
                recommendations, sell-through velocity estimates, and human-readable explanations
                — with full human control over final decisions.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-4 sm:mt-6">
            <Link href="/new-run">
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90 w-full sm:w-auto">
                <UploadCloud className="w-4 h-4 mr-2 shrink-0" />
                Start New Run
              </Button>
            </Link>
            <Link href="/history" className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto">
                <History className="w-4 h-4 mr-2 shrink-0" />
                View History
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
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

        <div className="grid md:grid-cols-2 gap-6 sm:gap-8 mb-8 sm:mb-10">
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

        {/* Live price search (browser scrape) */}
        <div className="mb-8 sm:mb-10">
          <h2 className="text-sm font-semibold text-foreground mb-4">Live price search (browser scrape)</h2>
          <div className="bg-card border border-border rounded-lg p-4 sm:p-5">
            <p className="text-xs text-muted-foreground mb-4">
              Start a browser-based scrape across Ovantica, ReFit Global, and Cashify. Requires <code className="bg-muted px-1 rounded">BROWSER_USE_API_KEY</code> on the server.
            </p>
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 sm:gap-3 mb-4">
              <Input
                placeholder="e.g. Apple iPhone 15 Pro Max"
                value={scrapeQuery}
                onChange={(e) => setScrapeQuery(e.target.value)}
                className="sm:max-w-xs h-9 text-sm w-full"
                onKeyDown={(e) => e.key === "Enter" && handleStartScrape()}
              />
              <Button
                size="sm"
                onClick={handleStartScrape}
                disabled={!scrapeQuery.trim() || scrapeStatus === "starting" || scrapeStatus === "running"}
              >
                {scrapeStatus === "starting" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting…
                  </>
                ) : scrapeStatus === "running" ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Scraping…
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Start scrape
                  </>
                )}
              </Button>
              {(scrapeStatus === "finished" || scrapeStatus === "error") && (
                <Button variant="ghost" size="sm" onClick={resetScrape}>
                  Reset
                </Button>
              )}
            </div>
            {/* Live session iframes: show while job is running, hide when we have results */}
            {liveUrls.length > 0 && scrapeStatus === "running" && (
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Live browser session(s) — watch until results are ready. If the frame is blank, use &quot;Open in new tab&quot; (the session may block embedding).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {liveUrls.map((url, i) => (
                    <div key={i} className="rounded-lg border border-border overflow-hidden bg-muted/30">
                      <p className="text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/50 truncate" title={url}>
                        Session {i + 1}
                      </p>
                      <iframe
                        src={url}
                        title={`Live scrape session ${i + 1}`}
                        className="w-full h-[320px] min-h-[240px] border-0 bg-background"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        allow="fullscreen"
                      />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline px-2 py-1.5"
                      >
                        Open in new tab <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {scrapeError && (
              <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mb-4">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {scrapeError}
              </div>
            )}
            {scrapeStatus === "finished" && scrapeResult?.devices && scrapeResult.devices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Results ({scrapeResult.count ?? scrapeResult.devices.length} devices)
                </p>
                <div className="border border-border rounded-md overflow-x-auto">
                  <table className="w-full text-xs min-w-[320px]">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left py-2 px-3 font-medium">Name</th>
                        <th className="text-left py-2 px-3 font-medium">Price</th>
                        <th className="text-left py-2 px-3 font-medium">Source</th>
                        <th className="text-left py-2 px-3 font-medium">Storage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scrapeResult.devices.map((d, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="py-2 px-3">{d.name ?? "—"}</td>
                          <td className="py-2 px-3">{d.price ?? "—"}</td>
                          <td className="py-2 px-3">{d.source ?? "—"}</td>
                          <td className="py-2 px-3">{d.storage ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {scrapeStatus === "finished" && scrapeResult?.devices?.length === 0 && (
              <p className="text-xs text-muted-foreground">No devices returned from scrape.</p>
            )}
          </div>
        </div>

        {/* Workflow */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-4">How It Works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

          <div className="mt-4 bg-secondary/50 border border-border rounded-lg px-4 sm:px-5 py-4 flex flex-col sm:flex-row items-start gap-3">
            <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Data sources:</span> Use &quot;Live price search&quot; above to scrape Ovantica, ReFit Global, and Cashify via the browser (requires <code className="bg-muted px-1 rounded">BROWSER_USE_API_KEY</code>). New runs use the same scrape + Bedrock flow and show source URLs and demand signals per device. All final pricing decisions remain with the pricing manager.
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
