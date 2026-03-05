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
    "Storage", "Model", "Ram", "Color", "Condition",
    "recommended_price", "predicted_price", "price_high",
    "data_found_in", "explanation", "risk_flags",
    "human_approved_price", "human_velocity_override", "feedback_note", "accepted", "source_url"
  ]

  const rows = run.devices.map(device => {
    const result = run.results.find(r => r.deviceId === device.id)
    if (!result) return Array(headers.length).fill("").join(",")

    const row = [
      device.storage,
      device.model,
      device.ram,
      device.color,
      device.condition,
      result.recommendedPrice.toString(),
      result.priceLow.toString(),
      result.priceHigh.toString(),
      (result.dataFoundIn ?? []).join("; "),
      `"${(result.pricingExplanation ?? "").replace(/"/g, "'")}"`,
      `"${(result.riskFlags ?? []).join("; ").replace(/"/g, "'")}"`,
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
  const headers = ["Storage", "Model", "Ram", "Color", "Condition"]
  const examples = [
    ["128", "iPhone 16", "6", "Black", "good"],
    ["64", "iPhone 12", "4", "Blue", "fair"],
    ["128", "Galaxy S21", "8", "Phantom Black", "superb"],
  ]
  return [headers.join(","), ...examples.map(r => r.join(","))].join("\n")
}
