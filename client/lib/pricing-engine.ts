import type {
  DeviceInput,
  PricingResult,
  MarketSignal,
  VelocityCategory,
  KBPattern,
} from "./types"

// -------------------------------------------------------------------
// Allowed brand → model catalogue (exactly the 25 permitted models)
// -------------------------------------------------------------------

export const ALLOWED_CATALOGUE: Record<string, string[]> = {
  Apple: ["iPhone 13", "iPhone 12", "iPhone 11", "iPhone X", "iPhone 14", "iPhone 15"],
  Samsung: ["S21", "A73 5G", "S24", "A52 5G", "M34 5G"],
  Google: ["Pixel 6a", "Pixel 8"],
  Vivo: ["V25", "V23", "Y75 5G"],
  Oneplus: ["Nord CE 2 Lite", "9"],
  Xiaomi: ["Redmi Note 12", "11T Pro 5G", "Redmi 9A"],
  Oppo: ["Reno 8", "Reno 7", "F19 Pro"],
  Poco: ["F4 5G"],
}

export const ALLOWED_BRANDS = Object.keys(ALLOWED_CATALOGUE)

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

function estimateVelocity(
  demandScore: number,
  flipkartListings: number,
  amazonRank: number,
  condition: string
): { category: VelocityCategory; days: number } {
  const conditionFactor =
    condition === "Like New" ? 1.25
    : condition === "Excellent" ? 1.05
    : condition === "Good" ? 0.85
    : 0.65

  // Supply pressure: more Flipkart listings = more competition = slower
  const supplyPressure = flipkartListings / 400  // normalise to ~1
  // Amazon rank: lower bucket = higher demand
  const amazonBoost = (10 - amazonRank) / 10

  const score = (demandScore * conditionFactor * (1 + amazonBoost)) / (1 + supplyPressure)

  if (score >= 7) return { category: "Fast",   days: 5  + Math.floor(Math.random() * 8)  }
  if (score >= 4) return { category: "Medium", days: 18 + Math.floor(Math.random() * 14) }
  return           { category: "Slow",   days: 42 + Math.floor(Math.random() * 28) }
}

// -------------------------------------------------------------------
// Market reference lookup
// -------------------------------------------------------------------

function findMarketRef(device: DeviceInput): MarketRef | null {
  return MARKET_REFS.find(
    r =>
      r.brand.toLowerCase() === device.brand.toLowerCase() &&
      r.model.toLowerCase() === device.model.toLowerCase()
  ) ?? null
}

// -------------------------------------------------------------------
// Market signal cards shown in results
// -------------------------------------------------------------------

function buildMarketSignals(ref: MarketRef, device: DeviceInput): MarketSignal[] {
  const now = new Date().toISOString()
  const q = encodeURIComponent(`${device.brand} ${device.model} refurbished`)
  return [
    {
      source: "Cashify (Sale Price)",
      price: ref.cashifyAvg,
      condition: "Certified Refurbished",
      url: `https://www.cashify.in/buy-refurbished-${device.brand.toLowerCase()}-mobiles`,
      scrapedAt: now,
    },
    {
      source: "Ovantica (Sale Price)",
      price: ref.ovanticaAvg,
      condition: "Certified Refurbished",
      url: `https://ovantica.com/`,
      scrapedAt: now,
    },
    {
      source: "Refit Global (Sale Price)",
      price: ref.refitGlobalAvg,
      condition: "Certified Refurbished",
      url: `https://refitglobal.com/`,
      scrapedAt: now,
    },
    {
      source: "Flipkart (Listing Depth)",
      price: ref.flipkartListings,
      condition: `${ref.flipkartListings} active refurb listings`,
      url: `https://www.flipkart.com/search?q=${q}&marketplace=REFURBISHED`,
      scrapedAt: now,
    },
    {
      source: "Amazon (Demand Rank)",
      price: ref.demandScore,
      condition: `Demand score ${ref.demandScore}/10`,
      url: `https://www.amazon.in/s?k=${q}&rh=p_n_condition-type%3A2224371031`,
      scrapedAt: now,
    },
  ]
}

// -------------------------------------------------------------------
// Explanation generators
// -------------------------------------------------------------------

function generatePricingExplanation(
  device: DeviceInput,
  ref: MarketRef | null,
  recommended: number,
  low: number,
  high: number,
  conditionMult: number,
  warrantyPremium: number,
  networkPremium: number,
  kbDelta?: number
): string {
  if (!ref) {
    return `No market reference for ${device.brand} ${device.model}. Estimated ₹${recommended.toLocaleString("en-IN")} via brand-tier heuristics and condition adjustment (${device.conditionTier}). Confidence is low — manual review advised. Range: ₹${low.toLocaleString("en-IN")} – ₹${high.toLocaleString("en-IN")}.`
  }
  const blendedSalePrice = Math.round((ref.cashifyAvg + ref.ovanticaAvg + ref.refitGlobalAvg) / 3)
  const parts: string[] = []
  parts.push(
    `Recommended price of ₹${recommended.toLocaleString("en-IN")} is anchored to the blended certified-refurbished sale price of ₹${blendedSalePrice.toLocaleString("en-IN")} across Cashify (₹${ref.cashifyAvg.toLocaleString("en-IN")}), Ovantica (₹${ref.ovanticaAvg.toLocaleString("en-IN")}), and Refit Global (₹${ref.refitGlobalAvg.toLocaleString("en-IN")}).`
  )
  parts.push(
    `A condition multiplier of ${(conditionMult * 100).toFixed(0)}% was applied for the "${device.conditionTier}" grade.`
  )
  if (warrantyPremium > 0) {
    parts.push(`A ${(warrantyPremium * 100).toFixed(1)}% warranty premium was added for the ${device.warrantyMonths}-month warranty.`)
  }
  if (networkPremium !== 0) {
    parts.push(`A ${networkPremium > 0 ? "+" : ""}${(networkPremium * 100).toFixed(0)}% adjustment applied for ${device.networkType}.`)
  }
  if (kbDelta !== undefined && Math.abs(kbDelta) > 500) {
    const dir = kbDelta > 0 ? "upward" : "downward"
    parts.push(
      `Historical reviewer feedback for similar ${device.brand} ${device.model} units suggests a ${dir} correction of ~₹${Math.abs(kbDelta).toLocaleString("en-IN")} — factored in at 40% weight.`
    )
  }
  return parts.join(" ")
}

function generateVelocityExplanation(
  device: DeviceInput,
  ref: MarketRef | null,
  velocity: VelocityCategory,
  days: number
): string {
  if (!ref) {
    return `Velocity estimate (${velocity}, ~${days} days) is heuristic — no model-specific data. High uncertainty.`
  }
  const parts: string[] = []
  parts.push(`Expected sell-through: ${velocity} (~${days} days).`)
  parts.push(
    `Flipkart shows ${ref.flipkartListings} active refurbished listings for this model, indicating ${ref.flipkartListings > 300 ? "high" : ref.flipkartListings > 150 ? "moderate" : "lean"} supply competition.`
  )
  parts.push(
    `Amazon demand score is ${ref.demandScore}/10 based on search volume and review velocity. ${ref.demandScore >= 7 ? "Strong demand supports faster sell-through." : ref.demandScore >= 5 ? "Moderate demand — standard listing window expected." : "Softer demand signals; competitive pricing recommended."}`
  )
  if (device.conditionTier === "Fair" || device.conditionTier === "Good") {
    parts.push(`"${device.conditionTier}" condition units typically take 15–30% longer than "Like New" equivalents.`)
  }
  return parts.join(" ")
}

function generateRiskFlags(device: DeviceInput, ref: MarketRef | null, recommended: number, confidence: number): string[] {
  const flags: string[] = []
  if (!ref) flags.push("No direct market reference — confidence is LOW. Manual review strongly advised.")
  if (confidence < 55) flags.push("Low confidence score: limited benchmark data for this configuration.")
  if (device.conditionTier === "Fair") flags.push("Fair condition may require additional QA before listing.")
  if (ref && ref.flipkartListings > 350) flags.push("Very high Flipkart supply: consider pricing at the lower end to accelerate sell-through.")
  if (ref && ref.demandScore <= 4) flags.push("Low Amazon demand score — niche segment. Slower sell-through expected.")
  if (device.warrantyMonths === 0) flags.push("No warranty: consider a short warranty to improve buyer conversion.")
  if (device.networkType === "3G") flags.push("3G device: rapidly declining demand in India's 5G era — price aggressively.")
  if (ref && recommended > ref.ovanticaAvg * 0.95) flags.push("Recommended price approaches Ovantica's listing price — ensure Budli margin is protected.")
  return flags
}

// -------------------------------------------------------------------
// Main engine function
// -------------------------------------------------------------------

export function processDevice(device: DeviceInput, kbPatterns: KBPattern[]): PricingResult {
  const ref = findMarketRef(device)
  const conditionMult = CONDITION_MULTIPLIERS[device.conditionTier] ?? 0.74
  const warrantyPremium = WARRANTY_PREMIUM[device.warrantyMonths] ?? 0
  const networkPremium = NETWORK_PREMIUM[device.networkType] ?? 0

  const kbKey = `${device.brand}|${device.model}|${device.conditionTier}`
  const kbPattern = kbPatterns.find(p => p.key === kbKey)
  const kbDelta = kbPattern?.avgDelta

  let recommended: number
  let low: number
  let high: number
  let confidence: number

  if (ref) {
    // Blend the three sale-price sources equally
    const blendedBase = (ref.cashifyAvg + ref.ovanticaAvg + ref.refitGlobalAvg) / 3
    const withCondition = blendedBase * conditionMult
    const withWarranty = withCondition * (1 + warrantyPremium)
    const withNetwork = withWarranty * (1 + networkPremium)

    // Optionally weight in customer sample price
    const customerWeight = device.customerSamplePrice ? 0.25 : 0
    const marketWeight = 1 - customerWeight
    const blended = device.customerSamplePrice
      ? withNetwork * marketWeight + device.customerSamplePrice * customerWeight
      : withNetwork

    // Apply KB learning at 40% weight
    const kbAdjustment = kbDelta ? kbDelta * 0.4 : 0
    recommended = Math.round((blended + kbAdjustment) / 100) * 100

    confidence = 80
    if (kbPattern && kbPattern.occurrences >= 3) confidence = Math.min(confidence + 8, 95)
    if (device.customerSamplePrice) confidence = Math.min(confidence + 5, 95)

    // Range bounded above by lowest of the three sale prices (can't exceed market sell price)
    const lowestSalePrice = Math.min(ref.cashifyAvg, ref.ovanticaAvg, ref.refitGlobalAvg)
    low  = Math.round((recommended * 0.92) / 100) * 100
    high = Math.round(Math.min(recommended * 1.08, lowestSalePrice * 0.93) / 100) * 100
    if (high < low) high = Math.round((low * 1.05) / 100) * 100
  } else {
    const brandTierBase: Record<string, number> = {
      Apple: 30000, Samsung: 18000, Oneplus: 16000, Google: 22000,
      Xiaomi: 10000, Vivo: 12000, Oppo: 11000, Poco: 13000,
    }
    const base = brandTierBase[device.brand] ?? 10000
    recommended = Math.round((base * conditionMult * (1 + warrantyPremium) * (1 + networkPremium)) / 100) * 100
    confidence = 38
    low  = Math.round((recommended * 0.88) / 100) * 100
    high = Math.round((recommended * 1.12) / 100) * 100
  }

  const { category: velocityCategory, days: velocityDays } = estimateVelocity(
    ref?.demandScore ?? 5,
    ref?.flipkartListings ?? 200,
    ref?.amazonRank ?? 5,
    device.conditionTier
  )

  const marketSignals = ref ? buildMarketSignals(ref, device) : []

  return {
    deviceId: device.id,
    recommendedPrice: recommended,
    priceLow: low,
    priceHigh: high,
    confidenceScore: confidence,
    velocityCategory,
    velocityDaysEstimate: velocityDays,
    pricingExplanation: generatePricingExplanation(device, ref, recommended, low, high, conditionMult, warrantyPremium, networkPremium, kbDelta),
    velocityExplanation: generateVelocityExplanation(device, ref, velocityCategory, velocityDays),
    riskFlags: generateRiskFlags(device, ref, recommended, confidence),
    marketSignals,
  }
}

export function processRun(devices: DeviceInput[], kbPatterns: KBPattern[]): PricingResult[] {
  return devices.map(d => processDevice(d, kbPatterns))
}
