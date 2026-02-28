import type {
  DeviceInput,
  PricingResult,
  MarketSignal,
  VelocityCategory,
  KBPattern,
} from "./types"

// -------------------------------------------------------------------
// -------------------------------------------------------------------
// Market reference data
//
// Sale price sources  : Cashify (cashify.in/buy-refurbished-gadgets),
//                       Ovantica (ovantica.com),
//                       Refit Global (refitglobal.com)
// Velocity sources    : Flipkart listing depth + Amazon bestseller rank
//                       used as demand/supply proxies
// -------------------------------------------------------------------

interface MarketRef {
  brand: string
  model: string
  // Sale price anchors (certified refurbished / C2B sell price)
  cashifyAvg: number       // Cashify certified refurb sell price
  ovanticaAvg: number      // Ovantica selling price
  refitGlobalAvg: number   // Refit Global selling price
  // Velocity proxies
  flipkartListings: number // # of Flipkart 3rd-party refurb listings (proxy for supply)
  amazonRank: number       // Amazon Electronics refurb BSR bucket (1=top, 10=niche)
  demandScore: number      // 1–10 composite demand (search volume + review velocity)
}

const MARKET_REFS: MarketRef[] = [
  // ── Apple ────────────────────────────────────────────────────────
  { brand: "Apple", model: "iPhone 15",       cashifyAvg: 58000, ovanticaAvg: 61000, refitGlobalAvg: 59500, flipkartListings: 130, amazonRank: 1, demandScore: 9 },
  { brand: "Apple", model: "iPhone 14",       cashifyAvg: 46000, ovanticaAvg: 49000, refitGlobalAvg: 47500, flipkartListings: 190, amazonRank: 1, demandScore: 9 },
  { brand: "Apple", model: "iPhone 13",       cashifyAvg: 34000, ovanticaAvg: 36500, refitGlobalAvg: 35000, flipkartListings: 260, amazonRank: 2, demandScore: 8 },
  { brand: "Apple", model: "iPhone 12",       cashifyAvg: 26000, ovanticaAvg: 28000, refitGlobalAvg: 27000, flipkartListings: 310, amazonRank: 2, demandScore: 7 },
  { brand: "Apple", model: "iPhone 11",       cashifyAvg: 20000, ovanticaAvg: 21500, refitGlobalAvg: 20800, flipkartListings: 370, amazonRank: 3, demandScore: 7 },
  { brand: "Apple", model: "iPhone X",        cashifyAvg: 14500, ovanticaAvg: 15800, refitGlobalAvg: 15000, flipkartListings: 280, amazonRank: 4, demandScore: 5 },
  // ── Samsung ──────────────────────────────────────────────────────
  { brand: "Samsung", model: "S24",           cashifyAvg: 52000, ovanticaAvg: 55000, refitGlobalAvg: 53500, flipkartListings: 105, amazonRank: 2, demandScore: 8 },
  { brand: "Samsung", model: "S21",           cashifyAvg: 24000, ovanticaAvg: 26000, refitGlobalAvg: 25000, flipkartListings: 220, amazonRank: 3, demandScore: 7 },
  { brand: "Samsung", model: "A73 5G",        cashifyAvg: 18000, ovanticaAvg: 19500, refitGlobalAvg: 18800, flipkartListings: 300, amazonRank: 4, demandScore: 6 },
  { brand: "Samsung", model: "A52 5G",        cashifyAvg: 14000, ovanticaAvg: 15200, refitGlobalAvg: 14600, flipkartListings: 340, amazonRank: 4, demandScore: 6 },
  { brand: "Samsung", model: "M34 5G",        cashifyAvg: 10500, ovanticaAvg: 11500, refitGlobalAvg: 11000, flipkartListings: 380, amazonRank: 5, demandScore: 5 },
  // ── Google ───────────────────────────────────────────────────────
  { brand: "Google", model: "Pixel 8",        cashifyAvg: 48000, ovanticaAvg: 51000, refitGlobalAvg: 49500, flipkartListings: 75,  amazonRank: 2, demandScore: 7 },
  { brand: "Google", model: "Pixel 6a",       cashifyAvg: 22000, ovanticaAvg: 24000, refitGlobalAvg: 23000, flipkartListings: 120, amazonRank: 3, demandScore: 7 },
  // ── Vivo ─────────────────────────────────────────────────────────
  { brand: "Vivo", model: "V25",              cashifyAvg: 14500, ovanticaAvg: 15800, refitGlobalAvg: 15000, flipkartListings: 260, amazonRank: 5, demandScore: 5 },
  { brand: "Vivo", model: "V23",              cashifyAvg: 12500, ovanticaAvg: 13800, refitGlobalAvg: 13000, flipkartListings: 290, amazonRank: 5, demandScore: 5 },
  { brand: "Vivo", model: "Y75 5G",           cashifyAvg: 9000,  ovanticaAvg: 9800,  refitGlobalAvg: 9400,  flipkartListings: 350, amazonRank: 6, demandScore: 4 },
  // ── Oneplus ──────────────────────────────────────────────────────
  { brand: "Oneplus", model: "9",             cashifyAvg: 20000, ovanticaAvg: 21800, refitGlobalAvg: 21000, flipkartListings: 190, amazonRank: 3, demandScore: 7 },
  { brand: "Oneplus", model: "Nord CE 2 Lite",cashifyAvg: 11000, ovanticaAvg: 12000, refitGlobalAvg: 11500, flipkartListings: 310, amazonRank: 5, demandScore: 5 },
  // ── Xiaomi ───────────────────────────────────────────────────────
  { brand: "Xiaomi", model: "11T Pro 5G",     cashifyAvg: 18500, ovanticaAvg: 20000, refitGlobalAvg: 19200, flipkartListings: 200, amazonRank: 4, demandScore: 6 },
  { brand: "Xiaomi", model: "Redmi Note 12",  cashifyAvg: 9500,  ovanticaAvg: 10500, refitGlobalAvg: 10000, flipkartListings: 430, amazonRank: 5, demandScore: 5 },
  { brand: "Xiaomi", model: "Redmi 9A",       cashifyAvg: 5000,  ovanticaAvg: 5600,  refitGlobalAvg: 5300,  flipkartListings: 500, amazonRank: 7, demandScore: 3 },
  // ── Oppo ─────────────────────────────────────────────────────────
  { brand: "Oppo", model: "Reno 8",           cashifyAvg: 16000, ovanticaAvg: 17500, refitGlobalAvg: 16800, flipkartListings: 240, amazonRank: 5, demandScore: 5 },
  { brand: "Oppo", model: "Reno 7",           cashifyAvg: 13000, ovanticaAvg: 14200, refitGlobalAvg: 13600, flipkartListings: 270, amazonRank: 5, demandScore: 5 },
  { brand: "Oppo", model: "F19 Pro",          cashifyAvg: 10500, ovanticaAvg: 11500, refitGlobalAvg: 11000, flipkartListings: 290, amazonRank: 6, demandScore: 4 },
  // ── Poco ─────────────────────────────────────────────────────────
  { brand: "Poco", model: "F4 5G",            cashifyAvg: 15500, ovanticaAvg: 17000, refitGlobalAvg: 16200, flipkartListings: 230, amazonRank: 4, demandScore: 6 },
]

// -------------------------------------------------------------------
// Multipliers & premiums
// -------------------------------------------------------------------

const CONDITION_MULTIPLIERS: Record<string, number> = {
  "Like New": 0.96,
  "Excellent": 0.87,
  "Good": 0.74,
  "Fair": 0.59,
}

const WARRANTY_PREMIUM: Record<number, number> = {
  0: 0,
  3: 0.03,
  6: 0.055,
  12: 0.09,
}

const NETWORK_PREMIUM: Record<string, number> = {
  "5G": 0.05,
  "4G": 0,
  "3G": -0.10,
}

// -------------------------------------------------------------------
// Velocity estimation — driven by Flipkart & Amazon signals
// -------------------------------------------------------------------

export async function processRun(devices: DeviceInput[], kbPatterns: KBPattern[]): Promise<PricingResult[]> {
  try {
    const payload = {
      devices: devices.map(d => ({
        id: d.id,
        brand: d.brand,
        model: d.model,
        storage_gb: d.storage,
        ram_gb: d.ram,
        network_type: d.networkType,
        condition_tier: d.conditionTier,
        warranty_months: d.warrantyMonths.toString()
      }))
    }

    const res = await fetch("http://localhost:8000/analyze-devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      throw new Error(`API error: ${res.statusText}`)
    }

    const data = await res.json()
    const results: PricingResult[] = data.results.map((r: any) => {
      const rec = parseInt(r.predicted_price || "0") || 0
      const low = Math.round((rec * 0.92) / 100) * 100
      const high = Math.round((rec * 1.08) / 100) * 100
      
      let velCat: VelocityCategory = "Medium"
      if (r.velocity === "Very Good" || r.velocity === "Good" || r.velocity === "Fast") velCat = "Fast"
      if (r.velocity === "Average" || r.velocity === "Slow") velCat = "Slow"
      
      const velDays = velCat === "Fast" ? 5 : velCat === "Medium" ? 18 : 42

      return {
        deviceId: r.id,
        recommendedPrice: rec,
        priceLow: low,
        priceHigh: high,
        confidenceScore: rec > 0 ? 80 : 0,
        velocityCategory: velCat,
        velocityDaysEstimate: velDays,
        pricingExplanation: r.explanation || "No explanation provided.",
        velocityExplanation: r.velocity || "No velocity data.",
        riskFlags: r.risk_flags || [],
        marketSignals: [],
      }
    })

    return results

  } catch (error) {
    console.error("Failed to process run with backend API:", error)
    // Fallback or re-throw
    throw error
  }
}
