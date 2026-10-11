import { worstCaseCrossingEliminations } from './inference'
import type { InvestigatorColor, PublicRoundEvidence } from './types'

export interface CrossingAnalysisRequest {
  evidence: PublicRoundEvidence
  nextStreetPositions?: Partial<Record<InvestigatorColor, string>>
}

self.onmessage = (event: MessageEvent<CrossingAnalysisRequest>) => {
  const { evidence, nextStreetPositions } = event.data
  self.postMessage(worstCaseCrossingEliminations(evidence, nextStreetPositions))
}
