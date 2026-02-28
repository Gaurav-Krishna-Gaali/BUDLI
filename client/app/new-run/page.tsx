"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { UploadCloud, Plus, Trash2, Download, AlertCircle, CheckCircle2, Loader2, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { AppShell } from "@/components/app-shell"
import { saveRun, parseCSV, generateInputTemplateCSV, getKBPatterns } from "@/lib/store"
import { processRun } from "@/lib/pricing-engine"
import type { DeviceInput, ConditionTier, NetworkType } from "@/lib/types"
import { cn } from "@/lib/utils"

const CONDITIONS: ConditionTier[] = ["Like New", "Excellent", "Good", "Fair"]
const NETWORKS: NetworkType[] = ["5G", "4G", "3G"]
const WARRANTY_OPTIONS = [0, 3, 6, 12]

function emptyDevice(): DeviceInput {
  return {
    id: crypto.randomUUID(),
    brand: "",
    model: "",
    ram: "",
    storage: "",
    networkType: "4G",
    conditionTier: "Good",
    warrantyMonths: 0,
    customerSamplePrice: undefined,
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

        const mapped: DeviceInput[] = rows.map(row => ({
          id: crypto.randomUUID(),
          brand: row["brand"] ?? "",
          model: row["model"] ?? "",
          ram: row["ram_gb"] ?? "",
          storage: row["storage_gb"] ?? "",
          networkType: (row["network_type"] as NetworkType) || "4G",
          conditionTier: (row["condition_tier"] as ConditionTier) || "Good",
          warrantyMonths: parseInt(row["warranty_months"] ?? "0") || 0,
          customerSamplePrice: undefined, // no longer in CSV template
        }))
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
      if (!d.brand) return "Brand is required for all devices."
      if (!d.model) return "Model is required for all devices."
      if (!d.ram) return "RAM is required for all devices."
      if (!d.storage) return "Storage is required for all devices."
    }
    return null
  }

  const handleSubmit = async () => {
    const err = validateDevices()
    if (err) { setCsvError(err); return }

    setProcessing(true)

    try {
      const kbPatterns = getKBPatterns()
      const results = await processRun(devices, kbPatterns)
      const run = {
        id: crypto.randomUUID(),
        name: runName || `Run ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`,
        status: "completed" as const,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        devices,
        results,
        feedbackSubmitted: false,
      }
      saveRun(run)
      router.push(`/runs/${run.id}`)
    } catch (apiError: any) {
      setCsvError(apiError.message || "An error occurred while generating recommendations.")
      setProcessing(false)
    }
  }

  const isValid = devices.every(d => d.brand && d.model && d.ram && d.storage)

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground text-balance">New Pricing Run</h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Upload a CSV or enter up to 10 device models. The engine will generate pricing recommendations,
            velocity estimates, and explanations.
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
            className="max-w-sm"
          />
        </div>

        {/* Tab switcher */}
        <div className="flex gap-2 mb-6 border-b border-border">
          {(["manual", "csv"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
          <div className="mb-6">
            <div
              className="border-2 border-dashed border-border rounded-lg p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <UploadCloud className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">Click to upload CSV</p>
              <p className="text-xs text-muted-foreground">Up to 10 devices &bull; Brand, Model, RAM, Storage, Network, Condition, Warranty</p>
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

        {/* Device table */}
        <div className="space-y-3 mb-6">
          {devices.map((device, idx) => (
            <div key={device.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Device {idx + 1}</span>
                {devices.length > 1 && (
                  <button
                    onClick={() => removeDevice(device.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-xs mb-1 block">Brand *</Label>
                  <Input
                    placeholder="e.g. Apple"
                    value={device.brand}
                    onChange={e => updateDevice(device.id, "brand", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Model *</Label>
                  <Input
                    placeholder="e.g. iPhone 16"
                    value={device.model}
                    onChange={e => updateDevice(device.id, "model", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">RAM (GB) *</Label>
                  <Input
                    placeholder="e.g. 6"
                    value={device.ram}
                    onChange={e => updateDevice(device.id, "ram", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Storage (GB) *</Label>
                  <Input
                    placeholder="e.g. 128"
                    value={device.storage}
                    onChange={e => updateDevice(device.id, "storage", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Network</Label>
                  <Select value={device.networkType} onValueChange={v => updateDevice(device.id, "networkType", v as NetworkType)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NETWORKS.map(n => <SelectItem key={n} value={n} className="text-xs">{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Condition</Label>
                  <Select value={device.conditionTier} onValueChange={v => updateDevice(device.id, "conditionTier", v as ConditionTier)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs mb-1 block">Warranty (Months)</Label>
                  <Select value={String(device.warrantyMonths)} onValueChange={v => updateDevice(device.id, "warrantyMonths", parseInt(v))}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WARRANTY_OPTIONS.map(w => <SelectItem key={w} value={String(w)} className="text-xs">{w === 0 ? "No warranty" : `${w} months`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {/* <div>
                  <Label className="text-xs mb-1 block">Sample Price (₹)</Label>
                  <Input
                    type="number"
                    placeholder="Optional"
                    value={device.customerSamplePrice ?? ""}
                    onChange={e => updateDevice(device.id, "customerSamplePrice", parseFloat(e.target.value) || 0)}
                    className="h-8 text-xs"
                  />
                </div> */}
              </div>
            </div>
          ))}
        </div>

        {/* Add device */}
        {devices.length < 10 && (
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

        <div className="flex items-center gap-3">
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
          <span className="text-xs text-muted-foreground">
            {devices.length} device{devices.length !== 1 ? "s" : ""} &bull; Sale prices: Cashify, Ovantica, Refit Global &bull; Velocity: Flipkart &amp; Amazon
          </span>
        </div>
      </div>
    </AppShell>
  )
}
