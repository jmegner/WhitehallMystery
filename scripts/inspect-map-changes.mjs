// Read-only version of the comparisons used while correcting alley group 98.
// Usage: node scripts/inspect-map-changes.mjs [git-ref] (defaults to HEAD).
// Run npm run generate:alley-groups first to see recalculated group changes.
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const reference = process.argv[2] ?? 'HEAD'
const helper = 'image_tools/wm_helper'
const game = 'src/data/whitehall'
const parse = text => text.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
const read = async path => parse(await readFile(resolve(root, path), 'utf8'))
const previous = path => parse(execFileSync('git', ['show', `${reference}:${path}`], { cwd: root, encoding: 'utf8' }))
const connectionKey = edge => [...edge].sort().join(':')
const groupKey = group => [...group].map(Number).sort((a, b) => a - b).join(',')
const difference = (a, b, key) => {
  const known = new Set(b.map(key))
  return a.filter(row => !known.has(key(row)))
}

const sync = {}
for (const name of ['circles', 'squares', 'connections', 'alley_groups', 'water_groups']) {
  const copies = await Promise.all([helper, game].map(directory => read(`${directory}/${name}.jsonl`)))
  sync[name] = JSON.stringify(copies[0]) === JSON.stringify(copies[1])
}
const connections = await read(`${helper}/connections.jsonl`)
const oldConnections = previous(`${helper}/connections.jsonl`)
const groups = await read(`${helper}/alley_groups.jsonl`)
const oldGroups = previous(`${helper}/alley_groups.jsonl`)
const withIds = (changed, all) => changed.map(group => ({ id: all.indexOf(group) + 1, locations: group.map(Number) }))
console.log(JSON.stringify({
  reference,
  helperMatchesGame: sync,
  connections: {
    added: difference(connections, oldConnections, connectionKey),
    removed: difference(oldConnections, connections, connectionKey),
  },
  alleys: {
    previousCount: oldGroups.length,
    currentCount: groups.length,
    removed: withIds(difference(oldGroups, groups, groupKey), oldGroups),
    added: withIds(difference(groups, oldGroups, groupKey), groups),
    duplicateGroups: groups.filter((group, index) => groups.findIndex(other => groupKey(group) === groupKey(other)) !== index),
  },
}, null, 2))
