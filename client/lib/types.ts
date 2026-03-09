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

/** Amazon velocity listing (title, link, rating, reviews, bought) for run detail UI */
export interface AmazonVelocityItem {
  title?: string | null
  link?: string | null
  rating?: string | null
  reviews?: string | null
  bought?: string | null
}

/** Flipkart velocity listing (title, link, price, rating) for run detail UI */
export interface FlipkartVelocityItem {
  title?: string | null
  link?: string | null
  price?: string | null
  rating?: string | null
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
  /** Velocity listings for UI: Amazon (bought, rating, reviews, title, link) and Flipkart (rating, price, title, link) */
  amazonVelocityItems?: AmazonVelocityItem[]
  flipkartVelocityItems?: FlipkartVelocityItem[]
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
  /** Per-source scrape tables (ovantica, refitglobal, cashify -> list of rows). Stored in DB, shown on run detail. */
  scrapeResults?: Record<string, BrowserScrapeRow[]> | null
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

/** Per-row shape from browser scrape (per source). */
export interface BrowserScrapeRow {
  Storage?: string
  Model?: string
  Ram?: string
  Color?: string
  Condition?: string
  Price?: string
}

export interface ScrapeResultsResponse {
  job_id: string
  status: "running" | "finished" | "error"
  query?: string
  error?: string
  /** Per-source results: ovantica, refitglobal, cashify -> list of rows */
  results?: Record<string, BrowserScrapeRow[]>
  devices?: ScrapedDeviceItem[]
  count?: number
}

export interface VelocityScrapeRequest {
  model: string
  ram: string
  storage: string
  color: string
  limit?: number
}

export interface VelocityScrapeItem {
  title?: string | null
  link?: string | null
  rating?: string | null
  reviews?: string | null
  bought?: string | null
}

export interface VelocityScrapeResponse {
  query: Record<string, unknown>
  results: VelocityScrapeItem[]
  non_matching: VelocityScrapeItem[]
}

export interface FlipkartScrapeItem {
  title?: string | null
  link?: string | null
  price?: string | null
  rating?: string | null
}

export interface FlipkartScrapeResponse {
  query: Record<string, unknown>
  results: FlipkartScrapeItem[]
  non_matching: FlipkartScrapeItem[]
}

// Async analyze-devices (POST /analyze-devices/start, GET /analyze-devices/status/{job_id})
export interface AnalyzeDevicesStartResponse {
  job_id: string
  /** 3 URLs per device: [Ovantica, ReFit Global, Cashify]. One entry per device. */
  live_urls_by_device: string[][]
}

export interface AnalyzeDevicesStatusResponse {
  job_id: string
  status: "running" | "finished" | "error"
  /** 3 URLs per device when running. */
  live_urls_by_device?: string[][]
  error?: string
  results?: Array<{
    id: string
    predicted_price?: string
    explanation?: string
    risk_flags?: string[]
    data_found_in?: string[]
    source_url?: string
    source_urls?: Array<{ source: string; url: string }>
    amazon_bought_tags?: string[]
    flipkart_rating_tags?: string[]
    /** Full velocity items for UI: title, link, rating, reviews, bought (Amazon); title, link, price, rating (Flipkart) */
    amazon_velocity_items?: AmazonVelocityItem[]
    flipkart_velocity_items?: FlipkartVelocityItem[]
  }>
  scrape_results?: Record<string, BrowserScrapeRow[]>
}
