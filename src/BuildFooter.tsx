import { buildInfo } from './buildInfo'
import './BuildFooter.css'

const timestamp = (iso: string) => {
  const date = new Date(iso)
  const offset = -date.getTimezoneOffset()
  const pad = (value: number) => String(value).padStart(2, '0')
  // Format local wall-clock fields, using this instant's offset (including DST).
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, -1)
  return `${local}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
}

export default function BuildFooter() {
  const { commitHash, committedAt, builtAt } = buildInfo
  return <footer className="build-footer" aria-label="Build information">
    <span>Commit {commitHash ? <a href={`https://github.com/jmegner/WhitehallMystery/commit/${commitHash}`}
      title={`View source commit ${commitHash} on GitHub`} target="_blank" rel="noreferrer">
      {commitHash.slice(0, 7)}
    </a> : 'unavailable'}</span>
    <span>Committed {committedAt ? <time dateTime={committedAt}>{timestamp(committedAt)}</time> : 'unavailable'}</span>
    <span>Built <time dateTime={builtAt}>{timestamp(builtAt)}</time></span>
  </footer>
}
