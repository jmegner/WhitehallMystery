// Refresh the factual location/connectivity data used by the original randomizer.
// Do not execute downloaded JavaScript.
import { writeFile } from 'node:fs/promises'

const source = await (await fetch('https://whitehallmystery.com/main.js?v=7')).text()
const regions = JSON.parse(source.match(/regions:\s*(\[[\s\S]*?\]),\s*locations:/)[1].replace(/\/\/[^\n]*/g, ''))
const costs = JSON.parse(source.match(/costs:\s*(\[[\s\S]*?\]),\s*getTripCost:/)[1])
const locations = regions.flat()
const data = {
  source: 'https://whitehallmystery.com/main.js?v=7',
  easyUpperBound: Number(source.match(/easyUpperBound:\s*([\d.]+)/)[1]),
  regions,
  // Only white discovery locations participate in difficulty calculations.
  costs: locations.map(from => locations.map(to => costs[from.id][to.id])),
}
await writeFile(new URL('../src/data/whitehall/aiDiscovery.json', import.meta.url), JSON.stringify(data) + '\n')
