import { useState, type ReactNode } from 'react'
import { saveBooleanPreference } from './game/persistence'
import { publicHuntLog } from './game/publicLog'
import type { GameState } from './game/types'

function LogSection({ storageKey, title, defaultOpen, className, children }: {
  storageKey: string
  title: string
  defaultOpen: boolean
  className: string
  children: ReactNode
}) {
  const [chosenOpen, setChosenOpen] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return saved === 'true' ? true : saved === 'false' ? false : null
    } catch { return null }
  })
  const open = chosenOpen ?? defaultOpen
  return <details className={className} open={open}>
    <summary onClick={event => {
      event.preventDefault()
      const next = !open
      setChosenOpen(next)
      // Save the user choice immediately, before a possible refresh or handoff.
      try { saveBooleanPreference(localStorage, storageKey, next) } catch { /* Storage may be unavailable. */ }
    }}>{title}</summary>
    {children}
  </details>
}

export default function PublicHuntLog({ state, recap, gameId }: {
  state: GameState
  recap: string[]
  gameId: string
}) {
  const sections = publicHuntLog(state).reverse()
  const storageKey = `whitehall-mystery.hunt-log.${gameId}`
  return <LogSection storageKey={storageKey} title="Public hunt log" defaultOpen className="public-log">
    {recap.length > 0 && <LogSection storageKey={`${storageKey}.recap`} title="Revealed action recap" defaultOpen className="public-log-recap">
      <ol reversed>{[...recap].reverse().map((entry, index) => <li key={`${recap.length - index}-${entry}`}>{entry}</li>)}</ol>
    </LogSection>}
    {sections.map(section => <LogSection
      key={section.id}
      storageKey={`${storageKey}.${section.id}`}
      title={section.title}
      defaultOpen={section === sections[0]}
      className="public-log-section"
    >
      <ol reversed>{[...section.entries].reverse().map((entry, index) => <li key={`${section.entries.length - index}-${entry}`}>{entry}</li>)}</ol>
    </LogSection>)}
  </LogSection>
}
