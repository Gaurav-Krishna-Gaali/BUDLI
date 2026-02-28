"use client"

import type { Run, KnowledgeBaseEntry, KBPattern } from "./types"

const RUNS_KEY = "budli_runs"
const KB_KEY = "budli_kb"

// ------- Runs -------

export function getRuns(): Run[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function getRun(id: string): Run | null {
  return getRuns().find(r => r.id === id) ?? null
}

export function saveRun(run: Run): void {
  if (typeof window === "undefined") return
  const runs = getRuns().filter(r => r.id !== run.id)
  runs.unshift(run)
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs))
}

export function deleteRun(id: string): void {
  if (typeof window === "undefined") return
  const runs = getRuns().filter(r => r.id !== id)
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs))
}

// ------- Knowledge Base -------

export function getKBEntries(): KnowledgeBaseEntry[] {
  if (typeof window === "undefined") return []
  try {
    return JSON.parse(localStorage.getItem(KB_KEY) ?? "[]")
  } catch {
    return []
  }
}

export function addKBEntries(entries: KnowledgeBaseEntry[]): void {
  if (typeof window === "undefined") return
  const existing = getKBEntries()
  localStorage.setItem(KB_KEY, JSON.stringify([...entries, ...existing]))
}

export function getKBPatterns(): KBPattern[] {
  const entries = getKBEntries()
  const map = new Map<string, { deltas: number[]; count: number }>()

  entries.forEach(e => {
    const key = `${e.brand}|${e.model}|${e.conditionTier}`
    const existing = map.get(key) ?? { deltas: [], count: 0 }
    existing.deltas.push(e.delta)
    existing.count++
    map.set(key, existing)
  })

  return Array.from(map.entries()).map(([key, val]) => {
    const avgDelta = val.deltas.reduce((a, b) => a + b, 0) / val.deltas.length
    const parts = key.split("|")
    const direction = avgDelta > 500 ? "consistently priced below market" : avgDelta < -500 ? "consistently over-priced" : "well-calibrated"
    return {
      key,
      avgDelta: Math.round(avgDelta),
      occurrences: val.count,
      insight: `${parts[0]} ${parts[1]} (${parts[2]}): ${direction} by ~₹${Math.abs(Math.round(avgDelta)).toLocaleString("en-IN")} on average across ${val.count} review(s).`,
    }
  })
}

// ------- CSV helpers -------

export function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n")
  if (lines.length < 2) return []
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""))
  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim().replace(/^"|"$/g, ""))
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = values[i] ?? ""
    })
    return row
  })
}

export function generateOutputCSV(run: Run): string {
  const headers = [
    "brand", "model", "ram_gb", "storage_gb", "network_type", "condition_tier", "warranty_months",
    "recommended_price", "predicted_price", "price_high", "confidence",
    "velocity", "velocity_days",
    "explanation", "velocity_explanation", "risk_flags",
    "human_approved_price", "human_velocity_override", "feedback_note", "accepted", "source_url"
  ]

  const rows = run.devices.map(device => {
    const result = run.results.find(r => r.deviceId === device.id)
    if (!result) return Array(headers.length).fill("").join(",")

    const row = [
      device.brand,
      device.model,
      device.ram,
      device.storage,
      device.networkType,
      device.conditionTier,
      device.warrantyMonths.toString(),
      result.recommendedPrice.toString(),
      result.priceLow.toString(), // predicted_price/low
      result.priceHigh.toString(),
      result.confidenceScore.toString(),
      result.velocityCategory,
      result.velocityDaysEstimate.toString(),
      `"${result.pricingExplanation.replace(/"/g, "'")}"`,
      `"${result.velocityExplanation.replace(/"/g, "'")}"`,
      `"${result.riskFlags.join("; ").replace(/"/g, "'")}"`,
      result.humanApprovedPrice?.toString() ?? "",
      result.humanVelocityOverride ?? "",
      result.humanFeedbackNote ?? "",
      result.isAccepted !== undefined ? (result.isAccepted ? "Yes" : "No") : "",
      result.sourceUrl ?? ""
    ]
    return row.join(",")
  })

  return [headers.join(","), ...rows].join("\n")
}

export function generateInputTemplateCSV(): string {
  const headers = ["brand", "model", "ram_gb", "storage_gb", "network_type", "condition_tier", "warranty_months"]
  const examples = [
    ["Apple", "iPhone 16", "4", "128", "5G", "Good", "6"],
    ["Apple", "iPhone 12", "4", "64", "5G", "Fair", "3"],
    ["Samsung", "Galaxy S21", "8", "128", "5G", "Good", "6"],
  ]
  return [headers.join(","), ...examples.map(r => r.join(","))].join("\n")
}
