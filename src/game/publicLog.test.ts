import { describe, expect, test } from 'vitest'
import { currentRoundPublicLog } from './publicLog'

describe('current-round public hunt log', () => {
  test('keeps setup entries until Jack reveals the first Discovery Location', () => {
    const entries = ['Locations locked.', 'Investigators deployed.']
    expect(currentRoundPublicLog(entries)).toEqual(entries)
  })

  test('starts at the initial Discovery Location reveal', () => {
    const entries = [
      'Locations locked.',
      'M0: Jack began the hunt at Discovery Location 33.',
      'M1: Jack advanced to move 1.',
    ]
    expect(currentRoundPublicLog(entries)).toEqual(entries.slice(1))
  })

  test('shows every entry since the latest Discovery Location reveal', () => {
    const priorRound = [
      'M0: Jack began the hunt at Discovery Location 33.',
      'M1: Jack advanced to move 1.',
      'M1: yellow searched 12: no clue.',
    ]
    const currentRound = [
      'M7: Jack reached Discovery Location 46.',
      'M0: Round 2 begins from 46.',
      ...Array.from({ length: 10 }, (_, index) => `M${index + 1}: current round entry ${index + 1}.`),
    ]

    expect(currentRoundPublicLog([...priorRound, ...currentRound])).toEqual(currentRound)
  })
})
