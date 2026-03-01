export type ConditionTier = "Like New" | "Excellent" | "Good" | "Fair"
export type NetworkType = "5G" | "4G" | "3G"
export type VelocityCategory = "Fast" | "Medium" | "Slow"
export type RunStatus = "pending" | "processing" | "completed" | "error"

export interface DeviceInput {
  id: string
  brand: string
  model: string
  ram: string
  storage: string
  networkType: NetworkType
  conditionTier: ConditionTier
  warrantyMonths: number
  customerSamplePrice?: number
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
