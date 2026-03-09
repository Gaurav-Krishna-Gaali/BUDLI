"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { UploadCloud, Plus, Trash2, Download, AlertCircle, CheckCircle2, Loader2, FileText, ExternalLink, ChevronDown, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { AppShell } from "@/components/app-shell"
import { saveRun, parseCSV, generateInputTemplateCSV, getKBPatterns } from "@/lib/store"
import { startAnalyzeDevices, getAnalyzeDevicesStatus, mapAnalyzeResultsToPricingResults, startAmazonVelocityScrape, startFlipkartVelocityScrape } from "@/lib/pricing-engine"
import type { DeviceInput, Condition, BrowserScrapeRow, PricingResult, VelocityScrapeResponse, FlipkartScrapeResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

const POLL_INTERVAL_MS = 15_000 // 15 seconds

type DeviceVelocityState = {
  loading: boolean
  error: string | null
  amazon: VelocityScrapeResponse | null
  flipkart: FlipkartScrapeResponse | null
}

const CONDITIONS: Condition[] = ["superb", "fair", "good"]

function emptyDevice(): DeviceInput {
  return {
    id: crypto.randomUUID(),
    storage: "",
    model: "",
    ram: "",
    color: "",
    condition: "good",
  }
}

export default function NewRunPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [runName, setRunName] = useState("")
  const [devices, setDevices] = useState<DeviceInput[]>([emptyDevice()])
  const [csvError, setCsvError] = useState<string | null>(null)
  const [csvSuccess, setCsvSuccess] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [activeTab, setActiveTab] = useState<"manual" | "csv">("manual")
  const [jobId, setJobId] = useState<string | null>(null)
  /** 3 live session URLs per device: [Ovantica, ReFit Global, Cashify] */
  const [liveUrlsByDevice, setLiveUrlsByDevice] = useState<string[][]>([])
  const [analyzeJobId, setAnalyzeJobId] = useState<string | null>(null)
  const [lastScrapeResults, setLastScrapeResults] = useState<Record<string, BrowserScrapeRow[]> | null>(null)
  /** Per-device pricing results when run completes (same order as devices) */
  const [lastRunResults, setLastRunResults] = useState<PricingResult[] | null>(null)
  const [completedRunId, setCompletedRunId] = useState<string | null>(null)
  const [velocityByDevice, setVelocityByDevice] = useState<Record<string, DeviceVelocityState>>({})

  const addDevice = () => {
    if (devices.length >= 10) return
    setDevices(prev => [...prev, emptyDevice()])
  }

  const removeDevice = (id: string) => {
    setDevices(prev => prev.filter(d => d.id !== id))
  }

  const updateDevice = (id: string, field: keyof DeviceInput, value: string | number) => {
    setDevices(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d))
  }

  const handleFetchDeviceVelocity = async (device: DeviceInput) => {
    if (!device.model || !device.ram || !device.storage || !device.color) return
    setVelocityByDevice(prev => ({
      ...prev,
      [device.id]: {
        amazon: prev[device.id]?.amazon ?? null,
        flipkart: prev[device.id]?.flipkart ?? null,
        error: null,
        loading: true,
      },
    }))
    try {
      const payload = {
        model: device.model,
        ram: device.ram,
        storage: device.storage,
        color: device.color,
        limit: 8,
      }
      const [amazonRes, flipkartRes] = await Promise.all([
        startAmazonVelocityScrape(payload),
        startFlipkartVelocityScrape(payload),
      ])
      setVelocityByDevice(prev => ({
        ...prev,
        [device.id]: {
          amazon: amazonRes,
          flipkart: flipkartRes,
          error: null,
          loading: false,
        },
      }))
    } catch (e) {
      setVelocityByDevice(prev => ({
        ...prev,
        [device.id]: {
          amazon: prev[device.id]?.amazon ?? null,
          flipkart: prev[device.id]?.flipkart ?? null,
          error: e instanceof Error ? e.message : "Failed to fetch velocity signals",
          loading: false,
        },
      }))
    }
  }

  const resetDeviceVelocity = (id: string) => {
    setVelocityByDevice(prev => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvError(null)
    setCsvSuccess(false)
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      try {
        const rows = parseCSV(text)
        if (rows.length === 0) { setCsvError("CSV appears to be empty."); return }
        if (rows.length > 10) { setCsvError("CSV must contain at most 10 devices."); return }

        // Skipping the `ALLOWED_CATALOGUE` brand/model validation per user request
        /*
        for (const row of rows) {
          const b = row["brand"]?.trim() ?? ""
          const m = row["model"]?.trim() ?? ""
          const allowedModels = ALLOWED_CATALOGUE[b]
          if (!allowedModels) { setCsvError(`Unknown brand "${b}". Only allowed brands: ${ALLOWED_BRANDS.join(", ")}.`); return }
          if (!allowedModels.includes(m)) { setCsvError(`Model "${m}" is not in the allowed list for ${b}. Allowed: ${allowedModels.join(", ")}.`); return }
        }
        */

        const mapped: DeviceInput[] = rows.map(row => {
          const cond = (row["Condition"] ?? row["condition"] ?? "good").toLowerCase()
          return {
            id: crypto.randomUUID(),
            storage: row["Storage"] ?? row["storage"] ?? "",
            model: row["Model"] ?? row["model"] ?? "",
            ram: row["Ram"] ?? row["ram"] ?? "",
            color: row["Color"] ?? row["color"] ?? "",
            condition: (cond === "superb" || cond === "fair" || cond === "good" ? cond : "good") as Condition,
          }
        })
        setDevices(mapped)
        setCsvSuccess(true)
      } catch {
        setCsvError("Failed to parse CSV. Please check the format.")
      }
    }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const csv = generateInputTemplateCSV()
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "budli_input_template.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const validateDevices = (): string | null => {
    for (const d of devices) {
      if (!d.storage) return "Storage is required for all devices."
      if (!d.model) return "Model is required for all devices."
      if (!d.ram) return "RAM is required for all devices."
      if (!d.color) return "Color is required for all devices."
    }
    return null
  }

  const handleSubmit = async () => {
    const err = validateDevices()
    if (err) { setCsvError(err); return }

    const runId = crypto.randomUUID()
    setJobId(runId)
    setCsvError(null)
    setLastScrapeResults(null)
    setLastRunResults(null)
    setCompletedRunId(null)
    setProcessing(true)
    setLiveUrlsByDevice([])
    setAnalyzeJobId(null)

    try {
      const payload = {
        devices: devices.map((d) => ({
          id: d.id,
          brand: "",
          model: d.model,
          storage_gb: d.storage,
          ram_gb: d.ram,
          network_type: "4G",
          condition_tier: d.condition,
          warranty_months: "0",
        })),
      }
      const { job_id, live_urls_by_device } = await startAnalyzeDevices(payload)
      setAnalyzeJobId(job_id)
      setLiveUrlsByDevice(live_urls_by_device ?? [])
    } catch (apiError: unknown) {
      setCsvError(apiError instanceof Error ? apiError.message : "Failed to start analysis.")
      setProcessing(false)
      setJobId(null)
    }
  }

  const pollAnalyzeStatus = useCallback(async (aid: string) => {
    try {
      const data = await getAnalyzeDevicesStatus(aid)
      if (data.status === "finished" && data.results) {
        const results = mapAnalyzeResultsToPricingResults(data.results)
        const run = {
          id: jobId!,
          name: runName || `Run ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
          status: "completed" as const,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          devices,
          results,
          scrapeResults: data.scrape_results ?? null,
          feedbackSubmitted: false,
        }
        await saveRun(run)
        setLastScrapeResults(data.scrape_results ?? null)
        setLastRunResults(results)
        setCompletedRunId(run.id)
        setProcessing(false)
        setAnalyzeJobId(null)
        setLiveUrlsByDevice([])
        return
      }
      if (data.status === "error") {
        setCsvError(data.error ?? "Analysis failed.")
        setProcessing(false)
        setAnalyzeJobId(null)
        setLiveUrlsByDevice([])
        return
      }
      setTimeout(() => pollAnalyzeStatus(aid), POLL_INTERVAL_MS)
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : "Failed to fetch status.")
      setProcessing(false)
      setAnalyzeJobId(null)
      setLiveUrlsByDevice([])
    }
  }, [devices, jobId, runName])

  useEffect(() => {
    if (analyzeJobId && processing) {
      pollAnalyzeStatus(analyzeJobId)
    }
  }, [analyzeJobId, processing, pollAnalyzeStatus])

  const isValid = devices.every(d => d.storage && d.model && d.ram && d.color)

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground text-balance">New Pricing Run</h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Upload a CSV or enter up to 10 device models. The engine will generate pricing recommendations,
            pricing recommendations and explanations. We match your devices to scraped listings and show which sources had data.
          </p>
        </div>

        {/* Run name */}
        <div className="mb-6">
          <Label htmlFor="run-name" className="text-sm font-medium mb-2 block">Run Name (optional)</Label>
          <Input
            id="run-name"
            placeholder="e.g. Weekly iPhone Batch – Jan 2025"
            value={runName}
            onChange={e => setRunName(e.target.value)}
            className="w-full sm:max-w-sm"
            disabled={processing}
          />
        </div>

        {/* Tab switcher */}
        <div className={cn("flex gap-2 mb-6 border-b border-border", processing && "pointer-events-none opacity-60")}>
          {(["manual", "csv"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              disabled={processing}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "manual" ? "Manual Entry" : "CSV Upload"}
            </button>
          ))}
        </div>

        {activeTab === "csv" ? (
          <div className={cn("mb-6", processing && "pointer-events-none opacity-60")}>
            <div
              className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onClick={() => !processing && fileRef.current?.click()}
            >
              <UploadCloud className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Click to upload CSV</p>
              <p className="text-xs text-muted-foreground">Up to 10 devices &bull; Storage, Model, Ram, Color, Condition (superb/fair/good)</p>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
            </div>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download input template
              </button>
              <span className="text-border">|</span>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                budli_input_template.csv
              </span>
            </div>
            {csvError && (
              <div className="mt-3 flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {csvError}
              </div>
            )}
            {csvSuccess && (
              <div className="mt-3 flex items-start gap-2 text-xs text-primary bg-primary/10 border border-primary/20 rounded-md px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {devices.length} device(s) loaded from CSV. Review below before processing.
              </div>
            )}
          </div>
        ) : null}

        {/* Run complete link — once when done */}
        {completedRunId && !processing && (
          <div className="mb-4 flex items-center gap-2 text-sm text-primary">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Run complete.</span>
            <Link href={`/runs/${completedRunId}`} className="font-medium underline">
              View run
            </Link>
          </div>
        )}

        {/* Device list: each device shows form, then (when processing) job ID + iframes, then (when done) tables — all collapsible. No pointer-events-none so live sessions stay interactive. */}
        <div className="space-y-4 mb-6">
          {devices.map((device, idx) => (
            <div key={device.id} className="bg-card border border-border rounded-lg overflow-hidden">
              {/* Device form */}
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Device {idx + 1}</span>
                  {devices.length > 1 && !processing && (
                    <button
                      onClick={() => removeDevice(device.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">Storage *</Label>
                    <Input
                      placeholder="e.g. 128"
                      value={device.storage}
                      onChange={e => updateDevice(device.id, "storage", e.target.value)}
                      className="h-8 text-xs"
                      disabled={processing}
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Model *</Label>
                    <Input
                      placeholder="e.g. iPhone 16"
                      value={device.model}
                      onChange={e => updateDevice(device.id, "model", e.target.value)}
                      className="h-8 text-xs"
                      disabled={processing}
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Ram *</Label>
                    <Input
                      placeholder="e.g. 6"
                      value={device.ram}
                      onChange={e => updateDevice(device.id, "ram", e.target.value)}
                      className="h-8 text-xs"
                      disabled={processing}
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Color *</Label>
                    <Input
                      placeholder="e.g. Black"
                      value={device.color}
                      onChange={e => updateDevice(device.id, "color", e.target.value)}
                      className="h-8 text-xs"
                      disabled={processing}
                    />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">Condition</Label>
                    <Select value={device.condition} onValueChange={v => updateDevice(device.id, "condition", v as Condition)}>
                      <SelectTrigger className="h-8 text-xs" disabled={processing}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITIONS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Velocity signals for this device */}
              <div className="px-4 pb-4 pt-2 border-t border-border bg-muted/5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Velocity (Amazon &amp; Flipkart)
                  </p>
                  {velocityByDevice[device.id] && (
                    <button
                      onClick={() => resetDeviceVelocity(device.id)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <button
                  onClick={() => handleFetchDeviceVelocity(device)}
                  disabled={
                    processing ||
                    !!velocityByDevice[device.id]?.loading ||
                    !device.storage ||
                    !device.model ||
                    !device.ram ||
                    !device.color
                  }
                  className="inline-flex items-center gap-1.5 text-[11px] text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {velocityByDevice[device.id]?.loading ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Fetching velocity…
                    </>
                  ) : (
                    <>
                      <Search className="w-3 h-3" />
                      Check velocity for this config
                    </>
                  )}
                </button>
                {velocityByDevice[device.id]?.error && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {velocityByDevice[device.id]?.error}
                  </p>
                )}
                {(() => {
                  const v = velocityByDevice[device.id]
                  if (!v || v.loading || v.error) return null
                  const amazonResults = v.amazon?.results ?? []
                  const flipkartResults = v.flipkart?.results ?? []
                  if (amazonResults.length === 0 && flipkartResults.length === 0) {
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        No matching Amazon or Flipkart listings for this configuration.
                      </p>
                    )
                  }
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {amazonResults.length > 0 && (
                        <div className="rounded-md border border-border bg-card px-2.5 py-2">
                          <p className="text-[11px] font-semibold text-foreground mb-1">
                            Amazon ({amazonResults.length})
                          </p>
                          <ul className="space-y-1">
                            {amazonResults.slice(0, 3).map((item, i) => (
                              <li key={i} className="text-[11px] text-muted-foreground">
                                {item.link ? (
                                  <a
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 hover:underline"
                                  >
                                    <span className="truncate max-w-[180px] inline-block align-middle">
                                      {item.title ?? "—"}
                                    </span>
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                ) : (
                                  <span>{item.title ?? "—"}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {flipkartResults.length > 0 && (
                        <div className="rounded-md border border-border bg-card px-2.5 py-2">
                          <p className="text-[11px] font-semibold text-foreground mb-1">
                            Flipkart ({flipkartResults.length})
                          </p>
                          <ul className="space-y-1">
                            {flipkartResults.slice(0, 3).map((item, i) => (
                              <li key={i} className="text-[11px] text-muted-foreground flex items-center justify-between gap-2">
                                <span className="truncate max-w-[150px]">
                                  {item.title ?? "—"}
                                </span>
                                <span className="shrink-0 text-[11px] text-foreground">
                                  {item.price ?? "—"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* Under this device: Job ID + Live iframes (collapsible) when processing */}
              {processing && jobId && (liveUrlsByDevice[idx]?.length ?? 0) > 0 && (
                <Collapsible defaultOpen className="group border-t border-border">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 text-left text-sm font-medium transition-colors">
                    <span>Job ID & live browser sessions — Device {idx + 1}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-3 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Job ID: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">{jobId}</code>
                      </p>
                      <p className="text-[10px] text-muted-foreground">If a frame is blank, use &quot;Open in new tab&quot;.</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {(liveUrlsByDevice[idx] ?? []).map((url, i) => {
                          const sourceLabels = ["Ovantica", "ReFit Global", "Cashify"]
                          const label = sourceLabels[i] ?? `Session ${i + 1}`
                          return (
                            <div key={i} className="rounded-lg border border-border overflow-hidden bg-muted/30">
                              <p className="text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/50 font-medium truncate" title={url}>
                                {label}
                              </p>
                              <iframe
                                src={url}
                                title={`Device ${idx + 1}: ${label}`}
                                className="w-full h-[240px] min-h-[180px] border-0 bg-background"
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
                          )
                        })}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Under this device: Result + Scraped data tables (collapsible) when done */}
              {!processing && lastScrapeResults && (lastRunResults?.[idx] != null || lastScrapeResults) && (
                <Collapsible defaultOpen={false} className="group border-t border-border">
                  <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/60 text-left text-sm font-medium transition-colors">
                    <span>Result & scraped data — Device {idx + 1}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-4">
                      {lastRunResults?.[idx] != null && (
                        <div className="rounded-lg border border-border p-3 bg-muted/20">
                          <p className="text-xs font-medium text-foreground mb-1">Recommended price</p>
                          <p className="text-lg font-semibold text-primary">₹{lastRunResults[idx].recommendedPrice?.toLocaleString() ?? "—"}</p>
                          <p className="text-xs text-muted-foreground mt-2">{lastRunResults[idx].pricingExplanation ?? "—"}</p>
                        </div>
                      )}
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Scraped data by source</p>
                      {[
                        { key: "ovantica", label: "Ovantica" },
                        { key: "refitglobal", label: "ReFit Global" },
                        { key: "cashify", label: "Cashify" },
                      ].map(({ key, label }) => {
                        const rows = lastScrapeResults[key] ?? []
                        return (
                          <div key={key} className="rounded-lg border border-border overflow-hidden bg-card">
                            <div className="px-3 py-2 bg-muted/50 border-b border-border">
                              <p className="text-sm font-medium text-foreground">{label}</p>
                              <p className="text-[10px] text-muted-foreground">{rows.length} listing(s)</p>
                            </div>
                            <div className="overflow-x-auto">
                              {rows.length > 0 ? (
                                <table className="w-full text-xs min-w-[320px]">
                                  <thead>
                                    <tr className="bg-muted/30 border-b border-border">
                                      <th className="text-left py-2 px-3 font-medium">Storage</th>
                                      <th className="text-left py-2 px-3 font-medium">Model</th>
                                      <th className="text-left py-2 px-3 font-medium">RAM</th>
                                      <th className="text-left py-2 px-3 font-medium">Color</th>
                                      <th className="text-left py-2 px-3 font-medium">Condition</th>
                                      <th className="text-left py-2 px-3 font-medium">Price</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row, i) => (
                                      <tr key={i} className="border-b border-border last:border-0">
                                        <td className="py-2 px-3">{row.Storage ?? "—"}</td>
                                        <td className="py-2 px-3">{row.Model ?? "—"}</td>
                                        <td className="py-2 px-3">{row.Ram ?? "—"}</td>
                                        <td className="py-2 px-3">{row.Color ?? "—"}</td>
                                        <td className="py-2 px-3">{row.Condition ?? "—"}</td>
                                        <td className="py-2 px-3">{row.Price ?? "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : (
                                <p className="text-xs text-muted-foreground px-3 py-4">No listings from this source.</p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          ))}
        </div>

        {/* Add device */}
        {devices.length < 10 && !processing && (
          <button
            onClick={addDevice}
            className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors mb-6 border border-dashed border-primary/30 rounded-lg px-4 py-2.5 w-full justify-center hover:bg-primary/5"
          >
            <Plus className="w-4 h-4" />
            Add another device ({devices.length}/10)
          </button>
        )}

        {/* Process */}
        {csvError && !csvSuccess && (
          <div className="mb-4 flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            {csvError}
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            onClick={handleSubmit}
            disabled={!isValid || processing}
            className="bg-primary text-primary-foreground hover:bg-primary/90 px-6"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4 mr-2" />
                Generate Recommendations
              </>
            )}
          </Button>
          <div className="flex flex-col gap-0.5">
            {jobId && (
              <p className="text-xs font-medium text-foreground">
                Job ID: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px] font-mono">{jobId}</code>
              </p>
            )}
            <span className="text-xs text-muted-foreground">
              {devices.length} device{devices.length !== 1 ? "s" : ""} &bull; Sale prices: Cashify, Ovantica, Refit Global &bull; Velocity: Flipkart &amp; Amazon
            </span>
          </div>
        </div>

      </div>
    </AppShell>
  )
}
