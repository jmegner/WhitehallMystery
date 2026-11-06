import { worstCaseCrossingEliminations } from './inference'
import type { InvestigatorColor, PublicRoundEvidence } from './types'

export interface CrossingAnalysisRequest {
  evidence: PublicRoundEvidence
  nextStreetPositions?: Partial<Record<InvestigatorColor, string>>
  sprint?: boolean
}

self.onmessage = (event: MessageEvent<CrossingAnalysisRequest>) => {
  const { evidence, nextStreetPositions, sprint } = event.data
  self.postMessage(worstCaseCrossingEliminations(evidence, nextStreetPositions, sprint))
}
