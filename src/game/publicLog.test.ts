import { describe, expect, test } from 'vitest'
import { publicHuntLog } from './publicLog'

describe('public hunt log sections', () => {
  test('keeps setup entries until Jack reveals the first Discovery Location', () => {
    const entries = ['Locations locked.', 'Investigators deployed.']
    expect(publicHuntLog({ publicLog: entries, round: 1 })).toEqual([
      { id: 'setup', title: 'Setup', round: null, entries },
    ])
    expect(publicHuntLog({ publicLog: [], round: 1 })).toEqual([])
  })

  test('starts at the initial Discovery Location reveal', () => {
    const entries = [
      'Locations locked.',
      'M0: Jack began the hunt at Discovery Location 33.',
      'M1: Jack advanced to move 1.',
    ]
    expect(publicHuntLog({ publicLog: entries, round: 1 })).toEqual([
      { id: 'setup', title: 'Setup', round: null, entries: entries.slice(0, 1) },
      { id: 'round-1', title: 'Round 1', round: 1, entries: entries.slice(1) },
    ])
  })

  test('keeps arrivals in the round they completed and retains all earlier entries', () => {
    const priorRound = [
      'M0: Jack began the hunt at Discovery Location 33.',
      'M1: Jack advanced to move 1.',
      'M1: yellow searched 12: no clue.',
      'M7: Jack reached Discovery Location 46.',
    ]
    const currentRound = [
      'M0: Round 2 begins from 46.',
      ...Array.from({ length: 10 }, (_, index) => `M${index + 1}: current round entry ${index + 1}.`),
    ]

    const publicLog = [...priorRound, ...currentRound]
    const original = [...publicLog]
    const sections = publicHuntLog({ publicLog, round: 2 })
    expect(sections).toEqual([
      { id: 'round-1', title: 'Round 1', round: 1, entries: priorRound },
      { id: 'round-2', title: 'Round 2', round: 2, entries: currentRound },
    ])
    expect(sections.flatMap(section => section.entries)).toEqual(original)
    expect(publicLog).toEqual(original)
  })

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

  test('keeps the final discovery in round 3, without inventing a round 4', () => {
    const sections = publicHuntLog({ publicLog: entries, round: 3 })
    expect(sections.map(section => section.title)).toEqual(['Setup', 'Round 1', 'Round 2', 'Round 3'])
    expect(sections.at(-1)?.entries).toEqual(entries.slice(7))
    expect(sections.flatMap(section => section.entries)).toEqual(entries)
  })

  test('retains all rounds during play, before the final discovery', () => {
    const publicLog = entries.slice(0, -1)
    const sections = publicHuntLog({ publicLog, round: 3 })
    expect(sections.map(section => section.title)).toEqual(['Setup', 'Round 1', 'Round 2', 'Round 3'])
    expect(sections.flatMap(section => section.entries)).toEqual(publicLog)
  })

  test('uses the saved round when an older snapshot lacks the round-start entry', () => {
    const publicLog = ['M2: yellow searched 12: no clue.', 'M3: Jack advanced to move 3.']
    expect(publicHuntLog({ publicLog, round: 2 })).toEqual([
      { id: 'round-2', title: 'Round 2', round: 2, entries: publicLog },
    ])
  })
})
