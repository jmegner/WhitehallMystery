// Render the existing board's SVG image/coordinate layers as a report, without
// changing the web app. The website labels sets, so node colors are derived.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = new URL('../../', import.meta.url)
const sourceUrl = 'https://whitehallmystery.com/main.js?v=7'
const response = await fetch(sourceUrl)
if (!response.ok) throw new Error(`Website source request failed: ${response.status}`)
const source = await response.text()
const parseArray = (pattern) => {
  const match = source.match(pattern)
  if (!match) throw new Error('Website data format changed')
  return JSON.parse(match[1].replace(/\/\/[^\n]*/g, ''))
}
// Parse published data only; never execute the downloaded JavaScript.
const regions = parseArray(/regions:\s*(\[[\s\S]*?\]),\s*locations:/)
const costs = parseArray(/costs:\s*(\[[\s\S]*?\]),\s*getTripCost:/)
const thresholds = Object.fromEntries(
  ['easyUpperBound', 'mediumLowerBound', 'mediumUpperBound', 'hardLowerBound'].map((key) => {
    const match = source.match(new RegExp(`${key}:\\s*([\\d.]+)`))
    if (!match) throw new Error(`Missing threshold: ${key}`)
    return [key, Number(match[1])]
  }),
)
const tiers = ['easy', 'medium', 'hard']
const colors = { easy: '#1677ff', medium: '#159447', hard: '#e32935' }
const sites = regions.flat()
if (regions.length !== 4 || sites.length !== 105 || new Set(sites.map((site) => site.id)).size !== 105) {
  throw new Error('Unexpected discovery location data')
}
const counters = Object.fromEntries(sites.map(({ id }) => [id, { easy: 0, medium: 0, hard: 0 }]))
const totals = { easy: 0, medium: 0, hard: 0 }
const setCounts = { easy: 0, medium: 0, hard: 0, unselectedGap: 0 }

// Mirror the acceptance adjustments in the site's Easy and Hard handlers.
const avoidance = {}
for (const tier of ['easy', 'hard']) {
  const handler = source.match(new RegExp(`\\$\\('#${tier}'\\)\\.click\\(function\\(\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}\\);`))
  const match = handler?.[1].match(/\[\{\s*id:\s*(\d+),\s*badness:\s*(\d+)\s*\/\s*(\d+)\s*\}\]/)
  if (!match) throw new Error(`Website ${tier} selection adjustments changed`)
  avoidance[tier] = { id: Number(match[1]), acceptance: Math.min(1, Number(match[3]) / Number(match[2])) }
}

const orders = []
for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
  if (a === b) continue
  for (let c = 0; c < 4; c++) {
    if (c === a || c === b) continue
    orders.push([a, b, c, 6 - a - b - c])
  }
}
let evaluatedSets = 0
for (const nw of regions[0]) for (const ne of regions[1]) {
  for (const se of regions[2]) for (const sw of regions[3]) {
    const selection = [nw, ne, se, sw]
    const ids = selection.map(({ id }) => id)
    let min = Infinity
    let max = -Infinity
    for (const [a, b, c, d] of orders) {
      const cost = costs[ids[a]][ids[b]] + costs[ids[b]][ids[c]] + costs[ids[c]][ids[d]]
      min = Math.min(min, cost)
      max = Math.max(max, cost)
    }
    const local = selection.reduce((sum, node) => sum + node.circles ** -1 * node.squares ** -0.8, 0)
    const difficulty = local * min ** 0.75 * max ** 0.25
    const tier = difficulty <= thresholds.easyUpperBound ? 'easy'
      : difficulty >= thresholds.mediumLowerBound && difficulty <= thresholds.mediumUpperBound ? 'medium'
        : difficulty >= thresholds.hardLowerBound ? 'hard' : 'unselectedGap'
    evaluatedSets++
    setCounts[tier]++
    if (tier === 'unselectedGap') continue
    const correction = avoidance[tier]
    const weight = correction && ids.includes(correction.id) ? correction.acceptance : 1
    totals[tier] += weight
    for (const id of ids) counters[id][tier] += weight
  }
}
if (evaluatedSets !== 444360) throw new Error(`Unexpected combination count: ${evaluatedSets}`)
// Exact output probabilities, not raw membership counts: the tier pools have
// different sizes. Rejection sampling makes accepted sets proportional to weight.
const circles = (await readFile(new URL('src/data/whitehall/circles.jsonl', root), 'utf8'))
  .trim().split(/\r?\n/).map(JSON.parse)
const byId = new Map(circles.map((node) => [node.id, node]))
const rows = sites.map((site) => {
  const node = byId.get(site.id)
  if (!node || node.color !== 'white') throw new Error(`Invalid discovery location: ${site.id}`)
  const probabilities = Object.fromEntries(tiers.map((tier) => [tier, counters[site.id][tier] / totals[tier]]))
  const ranked = tiers.toSorted((a, b) => probabilities[b] - probabilities[a])
  if (Math.abs(probabilities[ranked[0]] - probabilities[ranked[1]]) < 1e-12) {
    throw new Error(`Difficulty association tie at ${site.id}; do not assign an arbitrary color`)
  }
  return { id: site.id, x: node.x, y: node.y, tier: ranked[0], probabilities }
}).sort((a, b) => a.id - b.id)
for (const region of regions) for (const tier of tiers) {
  const sum = region.reduce((total, node) => total + counters[node.id][tier] / totals[tier], 0)
  if (Math.abs(sum - 1) > 1e-9) throw new Error(`Invalid normalized probabilities: ${tier}`)
}
const locationCounts = Object.fromEntries(tiers.map((tier) => [tier, rows.filter((node) => node.tier === tier).length]))
const report = {
  source: sourceUrl,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  retrievedAt: new Date().toISOString(),
  interpretation: 'Derived classification: each location is colored by the website mode with the highest probability of selecting that location. The website assigns difficulty to four-location sets, not individual locations.',
  formula: 'sum(circles^-1 * squares^-0.8) * minTripCost^0.75 * maxTripCost^0.25',
  thresholds, avoidance, evaluatedSets, setCounts, locationCounts, locations: rows,
}
const board = await readFile(new URL('public/map_pptx_simplified.jpg', root))
const highlights = rows.map((node) => `<g data-location="${node.id}" data-tier="${node.tier}"><title>Location ${node.id}: ${node.tier} association</title><circle cx="${node.x}" cy="${node.y}" r="19" fill="${colors[node.tier]}" fill-opacity="0.32" stroke="${colors[node.tier]}" stroke-opacity="0.85" stroke-width="2.5"/></g>`).join('\n')
const legend = tiers.map((tier, i) => `<g transform="translate(${32 + 320 * i} 1162)"><circle cx="12" cy="0" r="12" fill="${colors[tier]}" fill-opacity="0.32" stroke="${colors[tier]}" stroke-width="2"/><text x="34" y="7" font-size="21" font-weight="600">${tier[0].toUpperCase() + tier.slice(1)} (${locationCounts[tier]} locations)</text></g>`).join('\n')
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2620" viewBox="0 0 1200 1310" role="img" aria-labelledby="title desc">
<title id="title">Whitehall Mystery: location difficulty associations</title>
<desc id="desc">Blue easy, green medium, red hard. Derived from the published randomizer's output probabilities across all 444360 four-location combinations. These are not official per-location ratings.</desc>
<rect width="1200" height="1310" fill="#f7f4ed"/>
<image href="data:image/jpeg;base64,${board.toString('base64')}" width="1200" height="1200"/>
${highlights}
<g font-family="Arial, sans-serif" fill="#202b34">
<rect x="28" y="1080" width="1145" height="200" rx="8" fill="#f7f4ed" fill-opacity="0.98"/>
<text x="32" y="1115" font-size="27" font-weight="700">Whitehall Mystery — location difficulty associations</text>
${legend}
<text x="32" y="1201" font-size="18">Derived: color = the mode most likely to select this location, including selection adjustments.</text>
<text x="32" y="1232" font-size="18">The site rates four-location sets. Unhighlighted locations are not discovery candidates.</text>
<text x="32" y="1263" font-size="17" fill="#58616a">Source: whitehallmystery.com/main.js?v=7 · All 444,360 sets · Difficulty is for Jack</text>
</g>
</svg>
`
await writeFile(new URL('reports/whitehall-location-difficulty.json', root), JSON.stringify(report, null, 2) + '\n')
await writeFile(new URL('reports/whitehall-location-difficulty.svg', root), svg)
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL('reports/whitehall-location-difficulty.png', root)))
console.log(JSON.stringify({ evaluatedSets, setCounts, locationCounts, output: 'reports/whitehall-location-difficulty.png' }, null, 2))
