import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const directories = ['src/data/whitehall', 'image_tools/wm_helper'].map(path => resolve(root, path))
const readJsonLines = async (directory, name) =>
  (await readFile(resolve(directory, name), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)

// Refuse to generate groups for two different boards. The helper's manually
// edited geometry/connections must be propagated to the game first.
const [circles, crossings, connections] = await Promise.all(
  ['circles.jsonl', 'squares.jsonl', 'connections.jsonl'].map(async name => {
    const copies = await Promise.all(directories.map(directory => readJsonLines(directory, name)))
    if (JSON.stringify(copies[0]) !== JSON.stringify(copies[1])) {
      throw new Error(`${name} differs between the helper and game. Propagate the edits before recalculating alleys.`)
    }
    return copies[0]
  }),
)
const nodes = new Map([...circles, ...crossings].map(node => [String(node.id), node]))
const neighbors = new Map([...nodes.keys()].map(id => [id, []]))
for (const [a, b] of connections) {
  if (!nodes.has(a) || !nodes.has(b) || a === b || neighbors.get(a).includes(b)) {
    throw new Error(`Invalid or duplicate connection: ${a}, ${b}`)
  }
  neighbors.get(a).push(b)
  neighbors.get(b).push(a)
}
for (const [id, adjacent] of neighbors) {
  if (adjacent.length === 0) throw new Error(`Disconnected map node: ${id}`)
  const origin = nodes.get(id)
  const angle = target => Math.atan2(nodes.get(target).y - origin.y, nodes.get(target).x - origin.x)
  adjacent.sort((a, b) => angle(a) - angle(b))
}

// Walk each directed edge once, taking the next edge around the same face.
// With these image coordinates, bounded faces have positive signed area;
// the outside boundary is negative. Faces bordering blue circles are water,
// not alleys. Bridges may repeat a circle on a face, so deduplicate its IDs.
const visited = new Set()
const groups = []
let faceCount = 0
let outsideCount = 0
for (const [start, adjacent] of neighbors) for (const first of adjacent) {
  if (visited.has(`${start}:${first}`)) continue
  const boundary = []
  let from = start
  let to = first
  while (!visited.has(`${from}:${to}`)) {
    visited.add(`${from}:${to}`)
    boundary.push(from)
    const around = neighbors.get(to)
    const next = around[(around.indexOf(from) + around.length - 1) % around.length]
    from = to
    to = next
  }
  if (from !== start || to !== first) throw new Error('A map face did not close.')
  faceCount += 1
  const twiceArea = boundary.reduce((sum, id, index) => {
    const a = nodes.get(id)
    const b = nodes.get(boundary[(index + 1) % boundary.length])
    return sum + a.x * b.y - b.x * a.y
  }, 0)
  if (twiceArea < 0) outsideCount += 1
  if (twiceArea <= 0 || boundary.some(id => nodes.get(id).color === 'blue')) continue
  const circleIds = [...new Set(boundary.filter(id => /^\d+$/.test(id)))]
  if (circleIds.length < 2) continue
  const smallest = circleIds.indexOf(String(Math.min(...circleIds.map(Number))))
  groups.push([...circleIds.slice(smallest), ...circleIds.slice(0, smallest)])
}
if (outsideCount !== 1 || nodes.size - connections.length + faceCount !== 2) {
  throw new Error('The map must be one connected planar graph. Check its coordinates and connections.')
}
groups.sort((a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference = Number(a[i]) - Number(b[i])
    if (difference) return difference
  }
  return a.length - b.length
})

for (const directory of directories) {
  if (process.argv.includes('--check')) {
    const existing = await readJsonLines(directory, 'alley_groups.jsonl')
    if (JSON.stringify(existing) !== JSON.stringify(groups)) {
      throw new Error(`${directory}/alley_groups.jsonl is stale. Run npm run generate:alley-groups.`)
    }
  } else {
    const output = groups.map(group => `[${group.map(id => JSON.stringify(id)).join(', ')}]`).join('\n') + '\n'
    await writeFile(resolve(directory, 'alley_groups.jsonl'), output)
  }
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Generated'} ${groups.length} alley groups in both map directories.`)
