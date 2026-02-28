"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Download, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  ArrowLeft, MessageSquare, Send, ExternalLink, Info
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AppShell } from "@/components/app-shell"
import { VelocityBadge } from "@/components/velocity-badge"
import { ConfidenceRing } from "@/components/confidence-ring"
import { getRun, saveRun, generateOutputCSV, addKBEntries } from "@/lib/store"
import type { Run, PricingResult, VelocityCategory, KnowledgeBaseEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import Link from "next/link"

export default function RunResultsPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [run, setRun] = useState<Run | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [feedbackMode, setFeedbackMode] = useState(false)
  const [feedbackSaved, setFeedbackSaved] = useState(false)
  const [localResults, setLocalResults] = useState<PricingResult[]>([])

  useEffect(() => {
    async function loadRun() {
      const r = await getRun(id)
      if (r) {
        setRun(r)
        setLocalResults(r.results.map(res => ({ ...res })))
      }
    }
    loadRun()
  }, [id])

  if (!run) {
    return (
      <AppShell>
        <div className="p-8 text-center text-muted-foreground">Run not found.</div>
      </AppShell>
    )
  }

  const toggleExpand = (deviceId: string) => {
    setExpanded(prev => ({ ...prev, [deviceId]: !prev[deviceId] }))
  }

  const updateFeedback = (deviceId: string, field: keyof PricingResult, value: string | number | boolean | VelocityCategory) => {
    setLocalResults(prev => prev.map(r => r.deviceId === deviceId ? { ...r, [field]: value } : r))
  }

  const downloadCSV = () => {
    const csv = generateOutputCSV({ ...run, results: localResults })
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `budli_output_${run.id.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const submitFeedback = async () => {
    // Save KB entries for reviewed devices
    const entries: KnowledgeBaseEntry[] = []
    localResults.forEach(result => {
      if (result.humanApprovedPrice || result.isAccepted) {
        const device = run.devices.find(d => d.id === result.deviceId)
        if (!device) return
        const approvedPrice = result.humanApprovedPrice ?? result.recommendedPrice
        entries.push({
          id: crypto.randomUUID(),
          brand: device.brand,
          model: device.model,
          ram: device.ram,
          storage: device.storage,
          conditionTier: device.conditionTier,
          recommendedPrice: result.recommendedPrice,
          humanApprovedPrice: approvedPrice,
          delta: approvedPrice - result.recommendedPrice,
          velocityCategory: result.velocityCategory,
          humanVelocityOverride: result.humanVelocityOverride,
          feedbackNote: result.humanFeedbackNote,
          runId: run.id,
          createdAt: new Date().toISOString(),
        })
      }
    })
    await addKBEntries(entries)

    const updated: Run = { ...run, results: localResults, feedbackSubmitted: true }
    await saveRun(updated)
    setRun(updated)
    setFeedbackSaved(true)
    setFeedbackMode(false)
  }

  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <Link href="/history" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to History
            </Link>
            <h1 className="text-2xl font-bold text-balance">{run.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {run.devices.length} device{run.devices.length !== 1 ? "s" : ""} &bull; {new Date(run.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              {run.feedbackSubmitted && (
                <span className="ml-2 inline-flex items-center gap-1 text-primary text-xs font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Feedback submitted
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!run.feedbackSubmitted && !feedbackMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFeedbackMode(true)}
              >
                <MessageSquare className="w-4 h-4 mr-1.5" />
                Review & Feedback
              </Button>
            )}
            <Button size="sm" onClick={downloadCSV} className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Download className="w-4 h-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: "Devices", value: run.devices.length },
            { label: "Avg Price", value: formatINR(Math.round(localResults.reduce((s, r) => s + r.recommendedPrice, 0) / localResults.length)) },
            { label: "Fast Movers", value: localResults.filter(r => r.velocityCategory === "Fast").length },
            { label: "Avg Confidence", value: `${Math.round(localResults.reduce((s, r) => s + r.confidenceScore, 0) / localResults.length)}%` },
          ].map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
              <p className="text-xl font-bold text-foreground">{stat.value}</p>
            </div>
          ))}
        </div>

        {feedbackSaved && (
          <div className="mb-6 flex items-center gap-2 text-sm text-primary bg-primary/10 border border-primary/20 rounded-md px-4 py-3">
            <CheckCircle2 className="w-4 h-4" />
            Feedback saved to Knowledge Base. Future runs will learn from these decisions.
          </div>
        )}

        {/* Results */}
        <div className="space-y-4">
          {run.devices.map(device => {
            const result = localResults.find(r => r.deviceId === device.id)
            if (!result) return null
            const isOpen = expanded[device.id]

            return (
              <div key={device.id} className="bg-card border border-border rounded-lg overflow-hidden">
                {/* Row summary */}
                <div className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">
                      {device.brand} {device.model}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {device.ram} &bull; {device.storage} &bull; {device.networkType} &bull; {device.conditionTier}
                      {device.warrantyMonths > 0 && ` &bull; ${device.warrantyMonths}mo warranty`}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="text-right shrink-0 w-36">
                    <p className="text-lg font-bold text-primary">{formatINR(result.recommendedPrice)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatINR(result.priceLow)} – {formatINR(result.priceHigh)}
                    </p>
                  </div>

                  {/* Velocity */}
                  <div className="shrink-0 w-24 text-center">
                    <VelocityBadge velocity={result.velocityCategory} />
                    <p className="text-xs text-muted-foreground mt-1">~{result.velocityDaysEstimate}d</p>
                  </div>

                  {/* Confidence */}
                  <div className="shrink-0">
                    <ConfidenceRing score={result.confidenceScore} />
                  </div>

                  {/* Expand */}
                  <button
                    onClick={() => toggleExpand(device.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors ml-1"
                  >
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <div className="border-t border-border px-5 py-5 space-y-5">
                    {/* Market signals */}
                    {result.marketSignals.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Market Signals</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                          {result.marketSignals.map(sig => {
                            const isSalePrice = sig.source.includes("Cashify") || sig.source.includes("Ovantica") || sig.source.includes("Refit")
                            const isVelocity = sig.source.includes("Flipkart") || sig.source.includes("Amazon")
                            return (
                              <a
                                key={sig.source}
                                href={sig.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-start gap-3 bg-muted rounded-md px-3 py-2.5 text-xs hover:bg-secondary transition-colors group"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-foreground truncate">{sig.source}</p>
                                  <p className="text-muted-foreground mt-0.5">
                                    {isSalePrice ? formatINR(sig.price) : sig.condition}
                                  </p>
                                  {isSalePrice && (
                                    <p className="text-muted-foreground/70 text-[10px] mt-0.5">Sale price ref.</p>
                                  )}
                                  {isVelocity && (
                                    <p className="text-muted-foreground/70 text-[10px] mt-0.5">Velocity signal</p>
                                  )}
                                </div>
                                <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0 mt-0.5 group-hover:text-primary transition-colors" />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Explanations */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="bg-muted/50 rounded-lg p-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pricing Rationale</p>
                        <p className="text-sm text-foreground leading-relaxed">{result.pricingExplanation}</p>
                      </div>
                      <div className="bg-muted/50 rounded-lg p-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Velocity Rationale</p>
                        <p className="text-sm text-foreground leading-relaxed">{result.velocityExplanation}</p>
                      </div>
                    </div>

                    {/* Risk flags */}
                    {result.riskFlags.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Risk Flags</p>
                        <div className="space-y-1.5">
                          {result.riskFlags.map((flag, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-accent/20 border border-accent/30 rounded-md px-3 py-2">
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                              {flag}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Source URL direct link */}
                    {result.sourceUrl && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ovantica Search Source</p>
                        <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 hover:bg-primary/20 transition-colors px-3 py-2 rounded-md font-medium">
                          <ExternalLink className="w-3.5 h-3.5" />
                          View search results used for analysis
                        </a>
                      </div>
                    )}

                    {/* Human review */}
                    {feedbackMode && (
                      <div className="border-t border-border pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Info className="w-4 h-4 text-primary" />
                          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Human Review</p>
                        </div>
                        <div className="grid md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Approved Price (₹)</label>
                            <Input
                              type="number"
                              placeholder={result.recommendedPrice.toString()}
                              value={result.humanApprovedPrice ?? ""}
                              onChange={e => updateFeedback(device.id, "humanApprovedPrice", parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Velocity Override</label>
                            <Select
                              value={result.humanVelocityOverride ?? ""}
                              onValueChange={v => updateFeedback(device.id, "humanVelocityOverride", v as VelocityCategory)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder={result.velocityCategory} />
                              </SelectTrigger>
                              <SelectContent>
                                {["Fast", "Medium", "Slow"].map(v => (
                                  <SelectItem key={v} value={v} className="text-xs">{v}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Accept recommendation?</label>
                            <Select
                              value={result.isAccepted !== undefined ? String(result.isAccepted) : ""}
                              onValueChange={v => updateFeedback(device.id, "isAccepted", v === "true")}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true" className="text-xs">Yes – Accept</SelectItem>
                                <SelectItem value="false" className="text-xs">No – Override</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="mt-3">
                          <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
                          <Textarea
                            placeholder="e.g. Market shows stronger demand, adjusted up by ₹2,000"
                            value={result.humanFeedbackNote ?? ""}
                            onChange={e => updateFeedback(device.id, "humanFeedbackNote", e.target.value)}
                            className="text-xs h-16 resize-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Submit feedback */}
        {feedbackMode && (
          <div className="mt-6 flex items-center gap-3 border-t border-border pt-6">
            <Button
              onClick={submitFeedback}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Send className="w-4 h-4 mr-2" />
              Submit Feedback to Knowledge Base
            </Button>
            <button
              onClick={() => setFeedbackMode(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <span className="text-xs text-muted-foreground ml-auto">
              Feedback is stored locally and informs future pricing runs
            </span>
          </div>
        )}
      </div>
    </AppShell>
  )
}
