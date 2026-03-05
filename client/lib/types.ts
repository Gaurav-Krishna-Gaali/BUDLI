export type ConditionTier = "Like New" | "Excellent" | "Good" | "Fair" | "superb" | "fair" | "good"
/** Condition for device form/CSV (aligned with main.py schema) */
export type Condition = "superb" | "fair" | "good"
export type NetworkType = "5G" | "4G" | "3G"
export type VelocityCategory = "Fast" | "Medium" | "Slow"
export type RunStatus = "pending" | "processing" | "completed" | "error"

/** Device input: Storage, Model, Ram, Color, Condition (aligned with main.py) */
export interface DeviceInput {
  id: string
  storage: string
  model: string
  ram: string
  color: string
  condition: Condition
}

export interface MarketSignal {
  source: string
  price: number
  condition: string
  url?: string
  scrapedAt: string
}

export interface PricingResult {
  deviceId: string
  recommendedPrice: number
  priceLow: number
  priceHigh: number
  /** Sources that had scraped data (e.g. ["Ovantica", "ReFit Global", "Cashify"]) */
  dataFoundIn?: string[]
  /** @deprecated Backend no longer returns; kept for old runs */
  confidenceScore?: number
  /** @deprecated Backend no longer returns; kept for old runs */
  velocityCategory?: VelocityCategory
  /** @deprecated Backend no longer returns; kept for old runs */
  velocityDaysEstimate?: number
  pricingExplanation: string
  /** @deprecated Backend no longer returns; kept for old runs */
  velocityExplanation?: string
  riskFlags: string[]
  marketSignals: MarketSignal[]
  sourceUrl?: string
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
