import { describe, expect, test } from 'vitest'
import { currentRoundPublicLog, publicHuntLog } from './publicLog'

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

describe('finished-game public hunt log', () => {
  const entries = [
    'All three Investigators have deployed.',
    'M0: Jack began the hunt at Discovery Location 33.',
    'M1: yellow searched 12: no clue.',
    'M7: Jack reached Discovery Location 46.',
    'M0: Round 2 begins from 46.',
    'M2: blue attempted an arrest at 55: missed.',
    'M8: Jack reached Discovery Location 147.',
    'M0: Round 3 begins from 147.',
    'M6: Jack reached Discovery Location 159.',
  ]

  test('shows all rounds and setup after game over, even without an action-history recap', () => {
    expect(publicHuntLog({ stage: 'gameOver', publicLog: entries })).toEqual(entries)
  })

  test('still filters to the current round during play and after undoing game over', () => {
    const publicLog = entries.slice(0, -1)
    expect(publicHuntLog({ stage: 'investigatorAction', publicLog })).toEqual(publicLog.slice(6))
    expect(publicHuntLog({ stage: 'gameOver', publicLog })).toEqual(publicLog)
    expect(publicHuntLog({ stage: 'investigatorAction', publicLog })).toEqual(publicLog.slice(6))
  })
})
