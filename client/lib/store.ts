"use client"

import type { Run, KnowledgeBaseEntry, KBPattern } from "./types"

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

// ------- Runs -------

export async function getRuns(): Promise<Run[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/runs`)
    if (!res.ok) return []
    return await res.json()
  } catch (err) {
    console.error("Failed to get runs", err)
    return []
  }
}

export async function getRun(id: string): Promise<Run | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/runs/${id}`)
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    console.error("Failed to get run", err)
    return null
  }
}

export async function saveRun(run: Run): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run)
    })
  } catch (err) {
    console.error("Failed to save run", err)
  }
}

export async function deleteRun(id: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/runs/${id}`, {
      method: "DELETE"
    })
  } catch (err) {
    console.error("Failed to delete run", err)
  }
}

// ------- Knowledge Base -------

export async function getKBEntries(): Promise<KnowledgeBaseEntry[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/kb`)
    if (!res.ok) return []
    return await res.json()
  } catch (err) {
    console.error("Failed to get KB entries", err)
    return []
  }
}

export async function addKBEntries(entries: KnowledgeBaseEntry[]): Promise<void> {
  if (!entries || entries.length === 0) return
  try {
    await fetch(`${API_BASE_URL}/kb`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries)
    })
  } catch (err) {
    console.error("Failed to save KB entries", err)
  }
}

export async function getKBPatterns(): Promise<KBPattern[]> {
  const entries = await getKBEntries()
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
