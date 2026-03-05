export type ConditionTier = "Like New" | "Excellent" | "Good" | "Fair" | "superb" | "fair" | "good"
/** Condition for device form/CSV (aligned with main.py schema) */
export type Condition = "superb" | "fair" | "good"
export type NetworkType = "5G" | "4G" | "3G"
export type VelocityCategory = "Fast" | "Medium" | "Slow"
export type RunStatus = "pending" | "processing" | "completed" | "error"

/** Device input: Storage, Model, Ram, Color, Condition, Price (aligned with main.py) */
export interface DeviceInput {
  id: string
  storage: string
  model: string
  ram: string
  color: string
  condition: Condition
  price?: string
}

export interface MarketSignal {
  source: string
  price: number
  condition: string
  url?: string
  scrapedAt: string
}

export interface DemandSignal {
  demand_index?: number       // 0-1 composite score
  demand_label?: string       // Very High / High / Medium / Low / Very Low
  growth_rate?: number        // (recent - prev) / prev
  acceleration?: number       // slope pts/week
  direction?: string          // increasing / flat / decreasing
  recent_4w_avg?: number      // 0-100
  prev_4w_avg?: number
  latest?: number
}

export interface PricingResult {
  deviceId: string
  recommendedPrice: number
  priceLow: number
  priceHigh: number
  confidenceScore: number // 0-100
  velocityCategory: VelocityCategory
  velocityDaysEstimate: number
  pricingExplanation: string
  velocityExplanation: string
  riskFlags: string[]
  marketSignals: MarketSignal[]
  sourceUrl?: string
  demandSignal?: DemandSignal   // Demand signal from Google Trends
  // Human review fields
  humanApprovedPrice?: number
  humanVelocityOverride?: VelocityCategory
  humanFeedbackNote?: string
  isAccepted?: boolean
  reviewedAt?: string
}

export interface Run {
  id: string
  name: string
  status: RunStatus
  createdAt: string
  completedAt?: string
  devices: DeviceInput[]
  results: PricingResult[]
  feedbackSubmitted: boolean
}

export interface KnowledgeBaseEntry {
  id: string
  brand: string
  model: string
  ram: string
  storage: string
  conditionTier: ConditionTier
  recommendedPrice: number
  humanApprovedPrice: number
  delta: number // human - recommended
  velocityCategory: VelocityCategory
  humanVelocityOverride?: VelocityCategory
  feedbackNote?: string
  runId: string
  createdAt: string
}

export interface KBPattern {
  key: string // brand+model+condition
  avgDelta: number
  occurrences: number
  insight: string
}

// Browser scrape job (POST /scrape/start, GET /scrape/results/{job_id})
export interface ScrapeStartResponse {
  job_id: string
  live_urls: string[]
  query: string
}

export interface ScrapedDeviceItem {
  name?: string | null
  price?: string | null
  link?: string | null
  source?: string | null
  storage?: string | null
  original_price?: string | null
  effective_price?: string | null
  discount_pct?: string | null
  rating?: string | null
  image?: string | null
}

export interface ScrapeResultsResponse {
  job_id: string
  status: "running" | "finished" | "error"
  query?: string
  error?: string
  results?: Record<string, unknown[]>
  devices?: ScrapedDeviceItem[]
  count?: number
}
