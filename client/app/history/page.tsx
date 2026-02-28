"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Trash2, CheckCircle2, Clock, ChevronRight, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppShell } from "@/components/app-shell"
import { getRuns, deleteRun } from "@/lib/store"
import { VelocityBadge } from "@/components/velocity-badge"
import type { Run } from "@/lib/types"

export default function HistoryPage() {
  const [runs, setRuns] = useState<Run[]>([])

  useEffect(() => {
    getRuns().then(setRuns)
  }, [])

  const handleDelete = async (id: string) => {
    await deleteRun(id)
    setRuns(await getRuns())
  }

  const formatINR = (n: number) => `₹${n.toLocaleString("en-IN")}`

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-balance">Run History</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All pricing runs — click a run to view results and submit feedback.
            </p>
          </div>
          <Link href="/new-run">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-1.5" />
              New Run
            </Button>
          </Link>
        </div>

        {runs.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">No runs yet</p>
            <p className="text-xs text-muted-foreground mb-4">Create your first pricing run to get recommendations.</p>
            <Link href="/new-run">
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                New Run
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {runs.map(run => {
              const avgPrice = run.results.length
                ? Math.round(run.results.reduce((s, r) => s + r.recommendedPrice, 0) / run.results.length)
                : 0
              const fastCount = run.results.filter(r => r.velocityCategory === "Fast").length

              return (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="block bg-card border border-border rounded-lg hover:border-primary/40 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-4 px-5 py-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-foreground truncate">{run.name}</p>
                        {run.feedbackSubmitted && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-primary font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            Reviewed
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(run.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Devices</p>
                        <p className="text-sm font-semibold">{run.devices.length}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Avg Price</p>
                        <p className="text-sm font-semibold text-primary">{run.results.length ? formatINR(avgPrice) : "—"}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Fast Movers</p>
                        <div className="flex justify-center mt-0.5">
                          {fastCount > 0 ? <VelocityBadge velocity="Fast" size="sm" /> : <span className="text-sm font-semibold">—</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={e => { e.preventDefault(); handleDelete(run.id) }}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
