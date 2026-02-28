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
    "Brand", "Model", "RAM", "Storage", "Network", "Condition", "Warranty (months)",
    "Recommended Price (₹)", "Price Low (₹)", "Price High (₹)", "Confidence (%)",
    "Velocity", "Est. Days to Sell",
    "Pricing Explanation", "Velocity Explanation", "Risk Flags",
    "Human Approved Price (₹)", "Human Velocity Override", "Feedback Note", "Accepted"
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
      result.priceLow.toString(),
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
    ]
    return row.join(",")
  })

  return [headers.join(","), ...rows].join("\n")
}

export function generateInputTemplateCSV(): string {
  const headers = ["Brand", "Model", "RAM", "Storage", "Network", "Condition", "Warranty (months)", "Sample Price (₹)"]
  const examples = [
    ["Apple", "iPhone 14", "6GB", "128GB", "5G", "Excellent", "6", ""],
    ["Samsung", "Galaxy S23", "8GB", "256GB", "5G", "Good", "0", ""],
    ["OnePlus", "11", "16GB", "256GB", "5G", "Like New", "12", ""],
  ]
  return [headers.join(","), ...examples.map(r => r.join(","))].join("\n")
}
