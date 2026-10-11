import { useEffect, useState } from 'react'
import { worstCaseCrossingEliminations } from './game/inference'
import type { CrossingAnalysisRequest } from './game/crossingAnalysis.worker'
import type { InvestigatorColor, PublicRoundEvidence } from './game/types'

const emptyCounts = new Map<string, number>()
const cache = new WeakMap<PublicRoundEvidence, Map<string, Map<string, number>>>()

interface AnalysisResult {
  evidence: PublicRoundEvidence
  perspective: string
  counts: Map<string, number>
}

export function useWorstCrossingEliminations(
  evidence: PublicRoundEvidence | null,
  nextStreetPositions?: Partial<Record<InvestigatorColor, string>>,
): Map<string, number> {
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const nextTurn = !!nextStreetPositions
  const yellow = nextStreetPositions?.yellow
  const blue = nextStreetPositions?.blue
  const red = nextStreetPositions?.red
  const perspective = nextTurn ? `next:${[yellow, blue, red].filter(Boolean).sort().join(',')}` : 'current'

  useEffect(() => {
    if (!evidence || cache.get(evidence)?.has(perspective)) return
    const positions = nextTurn ? { yellow, blue, red } : undefined
    let cancelled = false
    let finished = false
    let worker: Worker | undefined
    const finish = (counts: Map<string, number>) => {
      if (cancelled || finished) return
      finished = true
      const perspectives = cache.get(evidence) ?? new Map<string, Map<string, number>>()
      perspectives.set(perspective, counts)
      cache.set(evidence, perspectives)
      setResult({ evidence, perspective, counts })
      worker?.terminate()
    }
    // A browser that cannot start a worker still gets the same exact answers.
    const fallback = () => {
      worker?.terminate()
      if (!cancelled && !finished) finish(worstCaseCrossingEliminations(evidence, positions))
    }
    try {
      worker = new Worker(new URL('./game/crossingAnalysis.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<Map<string, number>>) => finish(event.data)
      worker.onerror = fallback
      worker.onmessageerror = fallback
      worker.postMessage({ evidence, nextStreetPositions: positions } satisfies CrossingAnalysisRequest)
    } catch {
      fallback()
    }
    return () => {
      cancelled = true
      worker?.terminate()
    }
  }, [evidence, perspective, nextTurn, yellow, blue, red])

  if (!evidence) return emptyCounts
  if (result?.evidence === evidence && result.perspective === perspective) return result.counts
  // Hide results from an older turn/perspective while its replacement is being
  // computed. Cached Ctrl toggles can restore their numbers immediately.
  return cache.get(evidence)?.get(perspective) ?? emptyCounts
}
