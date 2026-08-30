import './styles.css'
import analysis from './analysis/analysis.json'
import analysisScriptUrl from '../scripts/analyze_whitehall.py?url'
import strategyMemoUrl from './research/STRATEGY_SOURCES.md?url'
import circlesRaw from '../../src/data/whitehall/circles.jsonl?raw'
import crossingsRaw from '../../src/data/whitehall/squares.jsonl?raw'

const parseJsonLines = (raw) => raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
const circles = parseJsonLines(circlesRaw).map((circle) => ({
  ...circle,
  quadrant: `${circle.y < 600 ? 'N' : 'S'}${circle.x < 600 ? 'W' : 'E'}`,
}))
const crossings = parseJsonLines(crossingsRaw)
const circleById = new Map(circles.map((circle) => [circle.id, circle]))
const crossingById = new Map(crossings.map((crossing) => [crossing.id, crossing]))
const boardImageUrl = `${import.meta.env.BASE_URL}map_pptx_simplified.jpg`
const rulebookUrl = `${import.meta.env.BASE_URL}whitehall_mystery_rulebook_small_copy.pdf`

const scenarios = [
  { id: 'streetOnly', label: 'Street only', short: 'Street', detail: 'No special movement' },
  { id: 'upToTwoBoats', label: '≤2 Boats', short: 'Boat', detail: 'Two Boat tiles available' },
  { id: 'upToTwoAlleys', label: '≤2 Alleys', short: 'Alley', detail: 'Two Alley tiles available' },
  { id: 'upToTwoEachSpecial', label: '≤2 of each', short: 'All', detail: 'Coach, Alley, and Boat: two each' },
]

const defaultState = {
  scenario: 'streetOnly',
  costMetric: 'actionTurns',
  tourScenario: 'streetOnly',
  jackPair: 0,
  branchCircle: 33,
  specialKind: 'alleys',
  specialPair: 0,
  discoverySide: 'best',
  discoveryIndex: 0,
  investigatorStart: 0,
  blockadeQuadrant: 'NW',
  blockadeMode: 'robust',
  blockadeIndex: 0,
  pairSafetySide: 'bestForJack',
  pairSafetyIndex: 0,
  pursuitView: 'catchUpLocations',
  pursuitIndex: 0,
}

const storageKey = 'whitehall.initial-report.v1'
const loadState = () => {
  try {
    return { ...defaultState, ...JSON.parse(localStorage.getItem(storageKey) ?? '{}') }
  } catch {
    return { ...defaultState }
  }
}
let state = loadState()

const saveState = () => localStorage.setItem(storageKey, JSON.stringify(state))
const announce = (message) => {
  const live = document.querySelector('#report-live')
  if (live) live.textContent = message
}
const setState = (patch, message) => {
  state = { ...state, ...patch }
  saveState()
  renderAll()
  if (message) announce(message)
}

const formatNumber = (value, digits = 3) => {
  if (value === null || value === undefined) return '—'
  if (typeof value !== 'number') return String(value)
  return Number.isInteger(value) ? String(value) : value.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '')
}
const joinIds = (values) => values?.join(', ') || '—'
const routeText = (values) => values?.join(' → ') || '—'
const scenario = () => scenarios.find((item) => item.id === state.scenario) ?? scenarios[0]

const scenarioExtremes = () => {
  if (state.scenario === 'streetOnly') return analysis.jack.streetGraph
  const model = analysis.jack.resourceConstrainedGraphs[state.scenario]
  return model?.[state.costMetric] ?? model?.actionTurns
}

const scenarioQuadrants = () => {
  if (state.scenario === 'streetOnly') return analysis.jack.quadrants.streetOnly
  const suffix = state.costMetric === 'moveTrackSlots' ? 'MoveTrackSlots' : 'ActionTurns'
  return analysis.jack.quadrants[`${state.scenario}${suffix}`]
}

const circleMarks = ({ selected = [], secondary = [], path = [] }) => {
  const pathSet = new Set(path)
  const secondarySet = new Set(secondary)
  const selectedSet = new Set(selected)
  return circles
    .filter((circle) => selectedSet.has(circle.id) || secondarySet.has(circle.id) || pathSet.has(circle.id))
    .map((circle) => {
      const kind = selectedSet.has(circle.id) ? 'selected' : pathSet.has(circle.id) ? 'path' : 'secondary'
      return `<g class="map-node map-node--${kind}" transform="translate(${circle.x} ${circle.y})">
        <circle r="${kind === 'selected' ? 17 : 11}"></circle>
        <text y="4" text-anchor="middle">${circle.id}</text>
      </g>`
    })
    .join('')
}

const crossingMarks = (ids = []) => ids.map((id) => {
  const crossing = crossingById.get(id)
  if (!crossing) return ''
  return `<g class="map-crossing" transform="translate(${crossing.x} ${crossing.y})">
    <rect x="-12" y="-12" width="24" height="24" rx="3"></rect>
    <text y="-17" text-anchor="middle">${id}</text>
  </g>`
}).join('')

const pathPolyline = (path = []) => {
  const points = path.map((id) => circleById.get(id)).filter(Boolean).map((circle) => `${circle.x},${circle.y}`).join(' ')
  return points ? `<polyline class="map-route" points="${points}"></polyline>` : ''
}

const boardMap = ({ label, selected = [], secondary = [], path = [], crossingIds = [] }) => `
  <figure class="analysis-map">
    <svg viewBox="70 10 1100 1090" role="img" aria-label="${label}">
      <image href="${boardImageUrl}" x="0" y="0" width="1200" height="1200"></image>
      ${pathPolyline(path)}
      ${circleMarks({ selected, secondary, path })}
      ${crossingMarks(crossingIds)}
    </svg>
    <figcaption>${label}</figcaption>
  </figure>`

const stat = (label, value, note = '') => `<div class="stat-card"><span>${label}</span><strong>${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`
const disclosure = (summary, body) => `<details class="method-note"><summary>${summary}</summary><p>${body}</p></details>`
const buttonGroup = (items, active, action) => `<div class="button-group">${items.map((item) => `
  <button type="button" class="chip-button" aria-pressed="${item.id === active}" data-action="${action}" data-value="${item.id}">${item.label}</button>`).join('')}</div>`

const renderScenarioRail = () => {
  const root = document.querySelector('#scenario-controls')
  if (!root) return
  root.innerHTML = `
    <div class="scenario-rail__inner">
      <span class="scenario-rail__label">Movement model</span>
      ${buttonGroup(scenarios, state.scenario, 'scenario')}
      <div class="metric-toggle" aria-label="Cost unit">
        <button type="button" class="chip-button" aria-pressed="${state.costMetric === 'actionTurns'}" data-action="costMetric" data-value="actionTurns">Jack turns</button>
        <button type="button" class="chip-button" aria-pressed="${state.costMetric === 'moveTrackSlots'}" data-action="costMetric" data-value="moveTrackSlots">Track slots</button>
      </div>
      <button type="button" class="reset-button" data-action="reset">Reset view</button>
    </div>`
}

const renderJack = () => {
  const root = document.querySelector('#jack-content')
  if (!root) return
  const extremes = scenarioExtremes()
  const pairIndex = state.jackPair % extremes.diameterPairs.length
  const pair = extremes.diameterPairs[pairIndex]
  const branchRows = analysis.jack.discoveryStreetMoveOptions.all.slice().sort((a, b) => b.streetDestinationCount - a.streetDestinationCount || a.circle - b.circle)
  const branch = branchRows.find((row) => row.circle === state.branchCircle) ?? branchRows[0]
  const specialRows = analysis.jack.specialSavings[state.specialKind].topSavings
  const specialPair = specialRows[state.specialPair % specialRows.length]
  const centerColors = extremes.centers.reduce((counts, id) => {
    const color = circleById.get(id)?.color ?? 'unknown'
    counts[color] = (counts[color] ?? 0) + 1
    return counts
  }, {})
  root.innerHTML = `
    <div class="stats-grid">
      ${stat('Map radius', `${extremes.radius} ${state.costMetric === 'actionTurns' ? 'turns' : 'slots'}`, `${extremes.centers.length} tied centers`)}
      ${stat('Centers', joinIds(extremes.centers), state.scenario === 'streetOnly' ? 'Only 130 is a legal white Discovery Location' : `${centerColors.white ?? 0} white · ${centerColors.black ?? 0} black`)}
      ${stat('Diameter', `${extremes.diameter}`, `${extremes.diameterPairs.length} longest pairs`)}
    </div>
    <div class="analysis-layout">
      ${boardMap({ label: `Centers and selected diameter pair ${pair[0]}–${pair[1]}`, selected: pair, secondary: extremes.centers })}
      <div class="finding-panel">
        <span class="finding-label">${scenario().label} · ${state.costMetric === 'actionTurns' ? 'Jack turns' : 'move-track slots'}</span>
        <h3>${state.scenario === 'streetOnly' ? 'Nine locations minimize the worst trip.' : `${extremes.centers.length} locations minimize the worst trip.`}</h3>
        <p>${state.scenario === 'streetOnly' ? 'Among all 189 locations, 86–89, 105–108, and 130 can reach every other location within 7 street moves. Location 130 is the only legal white Discovery Location among them; 89 has the best mean distance.' : `The selected resource budget changes the radius to ${extremes.radius} and the diameter to ${extremes.diameter}.`}</p>
        <label class="select-label">Longest pair
          <select data-action="jackPairSelect">${extremes.diameterPairs.map((item, index) => `<option value="${index}" ${index === pairIndex ? 'selected' : ''}>${item[0]} ↔ ${item[1]} · ${extremes.diameter}</option>`).join('')}</select>
        </label>
        ${disclosure('What “center” means', 'Eccentricity is the largest shortest-path distance from a location to any of the other 188 locations. These are static routes with no occupied crossings. It is a map-centrality result, not a complete claim about safety.')}
      </div>
    </div>
    <div class="subsection">
      <div class="subsection-heading"><div><p class="mini-kicker">One normal move from a white circle</p><h3>Discovery-site branching</h3></div><p>High branching gives Jack more first moves; low branching makes the start easier to screen.</p></div>
      <div class="analysis-layout analysis-layout--compact">
        ${boardMap({ label: `Location ${branch.circle} and its ${branch.streetDestinationCount} normal destinations`, selected: [branch.circle], secondary: branch.destinations })}
        <div class="table-wrap"><table><thead><tr><th>White circle</th><th>Quadrant</th><th>Destinations</th></tr></thead><tbody>
          ${branchRows.slice(0, 12).map((row) => `<tr class="${row.circle === branch.circle ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="branchCircle" data-value="${row.circle}">${row.circle}</button></td><td>${row.quadrant}</td><td>${row.streetDestinationCount}</td></tr>`).join('')}
          <tr class="table-divider"><td colspan="3">Lowest branching</td></tr>
          ${branchRows.slice(-8).reverse().map((row) => `<tr class="${row.circle === branch.circle ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="branchCircle" data-value="${row.circle}">${row.circle}</button></td><td>${row.quadrant}</td><td>${row.streetDestinationCount}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
    </div>
    <div class="subsection">
      <div class="subsection-heading"><div><p class="mini-kicker">Token value</p><h3>Largest direct special-move savings</h3></div>${buttonGroup([{id:'alleys',label:'Alleys'},{id:'boats',label:'Boats'}], state.specialKind, 'specialKind')}</div>
      <div class="analysis-layout analysis-layout--compact">
        ${boardMap({ label: `${state.specialKind === 'alleys' ? 'Alley' : 'Boat'} ${specialPair.from}–${specialPair.to}: ${specialPair.turnsSaved} turns saved`, selected: [specialPair.from, specialPair.to] })}
        <div class="table-wrap"><table><thead><tr><th>Pair</th><th>Street</th><th>Special</th><th>Saved</th></tr></thead><tbody>${specialRows.slice(0, 12).map((row, index) => `<tr class="${index === state.specialPair ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="specialPair" data-value="${index}">${row.from} ↔ ${row.to}</button></td><td>${row.streetTurns}</td><td>1</td><td>${row.turnsSaved}</td></tr>`).join('')}</tbody></table></div>
      </div>
      ${disclosure('Interpret this saving carefully', 'This is a direct endpoint comparison. It does not price the public announcement, the scarcity of the token, clue exposure at the new endpoint, or investigator response. The four best Alley savings are three turns; the best white-to-white Alley savings are two turns.')}
    </div>`
}

const discoveryScenarioData = () => {
  const sets = analysis.jack.discoverySets
  if (!sets) return null
  if (state.tourScenario === 'streetOnly') return sets.streetOnly
  const scenarioSets = sets[state.tourScenario]
  return state.costMetric === 'moveTrackSlots'
    ? scenarioSets?.optimiseMoveTrackSlots
    : scenarioSets?.optimiseActionTurns
}

const discoveryTurns = (record) => record.bestStartTurns ?? (state.costMetric === 'moveTrackSlots' ? record.moveTrackSlots : record.actionTurns)
const discoveryOrder = (record) => record.bestOrder ?? record.order

const renderDiscoveries = () => {
  const root = document.querySelector('#discoveries-content')
  if (!root) return
  const scenarioData = discoveryScenarioData()
  const tourScenarios = [
    { id: 'streetOnly', label: 'Street' },
    { id: 'upToTwoCoaches', label: '≤2 Coach' },
    { id: 'upToTwoAlleys', label: '≤2 Alley' },
    { id: 'upToTwoBoats', label: '≤2 Boat' },
    { id: 'upToTwoEachSpecial', label: '≤2 each' },
  ]
  const tourScenarioLabel = tourScenarios.find((item) => item.id === state.tourScenario)?.label ?? 'Street'
  if (!scenarioData) {
    root.innerHTML = `<div class="subsection-heading"><div><p class="mini-kicker">Discovery tour budget</p><h3>Compare all five resource models</h3></div>${buttonGroup(tourScenarios, state.tourScenario, 'tourScenario')}</div><div class="empty-state"><h3>Tour enumeration is not present in this data file</h3><p>Regenerate the report data with the included analysis script. It computes all 444,360 legal sets for Street, Coach-only, Alley-only, Boat-only, and the combined budget.</p></div>${renderQuadrants()}`
    return
  }
  const rows = scenarioData[state.discoverySide]
  const record = rows[state.discoveryIndex % rows.length]
  const order = discoveryOrder(record)
  const setCount = analysis.jack.discoverySets?.legalSetCount ?? 444360
  root.innerHTML = `
    <div class="stats-grid">
      ${stat('Legal sets tested', setCount.toLocaleString(), 'One white circle per quadrant')}
      ${stat(state.discoverySide === 'best' ? 'Shortest tour shown' : 'Longest optimal tour shown', `${discoveryTurns(record)} ${state.costMetric === 'moveTrackSlots' ? 'slots' : 'turns'}`, `Start ${order?.[0]} · ${routeText(order)}`)}
      ${stat('Resource use', record.resources ? `C${record.resources.coach} · A${record.resources.alley} · B${record.resources.boat}` : 'Street only', record.moveTrackSlots ? `${record.actionTurns} turns · ${record.moveTrackSlots} slots` : `Worst forced start: ${record.worstForcedStartTurns} turns`)}
    </div>
    <div class="subsection-heading"><div><p class="mini-kicker">Discovery tour budget</p><h3>Fastest and slowest sets by minimum tour</h3></div><div class="stacked-controls">${buttonGroup(tourScenarios, state.tourScenario, 'tourScenario')}${buttonGroup([{id:'best',label:'Shortest'},{id:'worst',label:'Longest'}], state.discoverySide, 'discoverySide')}</div></div>
    <div class="analysis-layout">
      ${boardMap({ label: `Discovery set ${joinIds(record.locations)} in order ${routeText(order)}`, selected: record.locations, path: order })}
      <div>
        <div class="finding-panel"><span class="finding-label">${tourScenarioLabel}</span><h3>${joinIds(record.locations)}</h3><p>Best route: <strong>${routeText(order)}</strong>. It takes <strong>${discoveryTurns(record)}</strong> ${state.costMetric === 'moveTrackSlots' ? 'move-track slots' : 'Jack action-turns'} under this model.</p>${disclosure('“Best” and “worst” for whom?', 'Shortest means easiest travel logistics for Jack; longest means hardest travel logistics. Neither label includes investigators’ live positions, clues, arrests, bluffing, or forced target changes.')}</div>
        <div class="table-wrap"><table><thead><tr><th>Set</th><th>Order</th><th>${state.costMetric === 'moveTrackSlots' ? 'Slots' : 'Turns'}</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="${index === state.discoveryIndex ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="discoveryIndex" data-value="${index}">${joinIds(row.locations)}</button></td><td>${routeText(discoveryOrder(row))}</td><td>${discoveryTurns(row)}</td></tr>`).join('')}</tbody></table></div>
      </div>
    </div>
    ${renderQuadrants()}`
}

const renderQuadrants = () => {
  const quadrantData = scenarioQuadrants()
  if (!quadrantData) return ''
  const measures = [
    { id: 'adjacentAny', label: 'Either adjacent', read: (values) => values.adjacentQuadrants.nearestTargetFromEachSourceWhite },
    { id: 'adjacentEach', label: 'Both adjacent', read: (values) => values.coverEachAdjacentQuadrant.perSourceWorstNearestQuadrantDistance },
    { id: 'diagonal', label: 'Diagonal', read: (values) => values.diagonalQuadrant.nearestTargetFromEachSourceWhite },
    { id: 'allEach', label: 'All three others', read: (values) => values.coverEveryOtherQuadrant.perSourceWorstNearestQuadrantDistance },
  ]
  const best = Object.fromEntries(measures.map((measure) => [measure.id, Object.entries(quadrantData).sort((a, b) => measure.read(a[1]).mean - measure.read(b[1]).mean)[0][0]]))
  return `<div class="subsection quadrant-section"><div class="subsection-heading"><div><p class="mini-kicker">Normalized by source white circle</p><h3>Which quadrant reaches outward fastest?</h3></div><p>Mean of each source’s nearest qualifying white target; lower is faster.</p></div>
    <div class="table-wrap"><table><thead><tr><th>Origin</th>${measures.map((measure) => `<th>${measure.label}</th>`).join('')}</tr></thead><tbody>${Object.entries(quadrantData).map(([quadrant, values]) => `<tr><th>${quadrant}</th>${measures.map((measure) => { const summary = measure.read(values); return `<td class="${best[measure.id] === quadrant ? 'best-cell' : ''}"><strong>${formatNumber(summary.mean)}</strong><small>median ${formatNumber(summary.median)} · worst ${formatNumber(summary.max)}</small></td>` }).join('')}</tr>`).join('')}</tbody></table></div>
    ${disclosure('How the quadrant questions are scored', '“Either adjacent” finds the nearest white in either neighboring quadrant. “Both adjacent” uses the slower of the two nearest-quadrant entries for each source. “All three others” similarly uses the slowest nearest entry among every other quadrant. This avoids letting one easy border hide a difficult one.')}
  </div>`
}

const renderInvestigators = () => {
  const root = document.querySelector('#investigators-content')
  if (!root) return
  const ranks = analysis.investigators.startingSetRank
  const selected = ranks[state.investigatorStart % ranks.length]
  const crossingGraph = analysis.investigators.crossingGraph
  const best = ranks[0]
  const worst = ranks[ranks.length - 1]
  root.innerHTML = `
    <div class="stats-grid">
      ${stat('Best deployment', joinIds(best.crossings), `Worst white reached in ${best.worstTurnsToAnyWhite} movement turns`)}
      ${stat('Mean access', `${best.meanTurnsToWhite} turns`, `${best.whiteReachedWithin2Turns}/105 whites within 2 turns`)}
      ${stat('Crossing graph', `radius ${crossingGraph.radius} · diameter ${crossingGraph.diameter}`, `Centers ${joinIds(crossingGraph.centers)} · ${crossingGraph.diameterPairs.length} diameter pairs`)}
    </div>
    <div class="analysis-layout">
      ${boardMap({ label: `Investigator deployment ${joinIds(selected.crossings)}`, crossingIds: selected.crossings })}
      <div>
        <div class="finding-panel"><span class="finding-label">Deployment happens before Jack reveals his start</span><h3>${joinIds(best.crossings)} is the strongest robust start.</h3><p>Its worst movement distance to action-adjacency for any white starting Discovery is <strong>${best.worstTurnsToAnyWhite}</strong>; the mean is <strong>${best.meanTurnsToWhite}</strong>. Turn 0 means the investigator is already adjacent and can act in the first investigator phase.</p>${disclosure('What is optimized', 'All 20 legal 3-of-6 sets are compared by worst-case movement turns to any white circle, then mean turns. This is an exact single-investigator access lower bound. It does not schedule collisions or predict which start Jack chose.')}</div>
        <div class="table-wrap"><table><thead><tr><th>Starting crossings</th><th>Worst</th><th>Mean</th><th>≤2 turns</th></tr></thead><tbody>${ranks.map((row, index) => `<tr class="${index === state.investigatorStart ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="investigatorStart" data-value="${index}">${joinIds(row.crossings)}</button></td><td>${row.worstTurnsToAnyWhite}</td><td>${row.meanTurnsToWhite}</td><td>${row.whiteReachedWithin2Turns}</td></tr>`).join('')}</tbody></table></div>
        <p class="comparison-note"><strong>Weakest set:</strong> ${joinIds(worst.crossings)} · worst ${worst.worstTurnsToAnyWhite}, mean ${worst.meanTurnsToWhite}.</p>
      </div>
    </div>
    ${renderBlockades()}`
}

const renderBlockades = () => {
  const blockade = analysis.blockades
  const quadrant = blockade.quadrants[state.blockadeQuadrant]
  const isContainment = state.blockadeMode === 'containment'
  const isRobust = state.blockadeMode === 'robust'
  const rows = isContainment
    ? quadrant.bestThreeCrossingBlockades
    : isRobust
      ? (quadrant.bestRobustThreeCrossingCordons ?? quadrant.bestConnectedThreeCrossingDelays ?? quadrant.bestThreeCrossingBlockades)
      : (quadrant.bestConnectedThreeCrossingDelays ?? quadrant.bestThreeCrossingBlockades)
  const selected = rows[state.blockadeIndex % rows.length]
  const sourceMeans = Object.entries(selected.meanIncreaseBySourceQuadrant ?? {}).map(([source, value]) => `${source} +${value}`).join(' · ')
  const formation = selected.exampleAssignment?.map((item) => `${item.start}→${item.destination} (${item.movementTurns})`).join(' · ')
  const selectedFinding = isContainment && selected.unreachableOutsideWhites
    ? `<strong>${selected.unreachableOutsideWhites}</strong> of ${selected.outsideWhiteCount} outside white origins become unreachable. The same surviving origins are delayed by an average <strong>${selected.meanIncrease}</strong> turns (maximum ${selected.maxIncrease}); their post-block mean distance is ${selected.meanTurnsFromOutsideWhiteToNearestTargetWhite}.`
    : isRobust
      ? `Even the least-affected source quadrant is delayed by <strong>${selected.minimumSourceQuadrantMeanIncrease}</strong> street turns on average. Directional means: ${sourceMeans}; pooled mean: +${selected.meanIncrease}. Every outside white remains connected.`
      : `Mean nearest-entry distance rises by <strong>${selected.meanIncrease}</strong> street turns, from ${quadrant.baselineNearestEntry.mean} to ${selected.meanTurnsFromOutsideWhiteToNearestTargetWhite}, while every outside white remains connected.`
  return `<div class="subsection"><div class="subsection-heading"><div><p class="mini-kicker">Occupied crossings as vertex deletions</p><h3>Three-investigator quadrant blockades</h3></div><div class="stacked-controls">${buttonGroup([{id:'robust',label:'Robust cordon'},{id:'delay',label:'Largest average delay'},{id:'containment',label:'Contain / cut off'}], state.blockadeMode, 'blockadeMode')}${buttonGroup(['NW','NE','SW','SE'].map((id) => ({id,label:id})), state.blockadeQuadrant, 'blockadeQuadrant')}</div></div>
    <div class="analysis-layout analysis-layout--compact">
      ${boardMap({ label: `Blockading ${state.blockadeQuadrant} with ${joinIds(selected.crossings)}`, crossingIds: selected.crossings })}
      <div><div class="finding-panel"><span class="finding-label">Target quadrant ${state.blockadeQuadrant}</span><h3>${joinIds(selected.crossings)}</h3><p>${selectedFinding}</p><p class="comparison-note"><strong>Fastest legal formation:</strong> ${selected.minimumFormationTurns} investigator movement turns · ${formation}</p></div>
      <div class="table-wrap"><table><thead><tr><th>Crossings</th><th>Mean Δ</th><th>Weakest approach Δ</th><th>Delayed / cut off</th><th>Form</th></tr></thead><tbody>${rows.slice(0, 12).map((row, index) => `<tr class="${index === state.blockadeIndex ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="blockadeIndex" data-value="${index}">${joinIds(row.crossings)}</button></td><td>+${row.meanIncrease}</td><td>${row.minimumSourceQuadrantMeanIncrease === null ? '—' : `+${row.minimumSourceQuadrantMeanIncrease}`}</td><td>${row.delayedOutsideWhites} / ${row.unreachableOutsideWhites}</td><td>${row.minimumFormationTurns}</td></tr>`).join('')}</tbody></table></div></div>
    </div>${disclosure('Three different objectives and a Coach caveat', `${blockade.searchScope} “Robust cordon” maximizes the weakest mean delay among the three approach quadrants. “Largest average delay” pools all outside whites. Both require every origin to stay connected. “Contain / cut off” first maximizes unreachable origins, then uses matched per-origin delay among survivors; many winning cutoffs isolate a source pocket rather than cordoning the named target. Formation times are optimistic static makespans from three distinct legal starts. A street move is removed if every traced crossing route for it touches an occupied crossing. Coach bypasses occupation.`)}</div>`
}

const pursuitTabs = [
  { id: 'catchUpLocations', label: 'Catch-up' },
  { id: 'streetOutrunLocations', label: 'Street outrun' },
  { id: 'alleyEscapeLocations', label: 'Alley escape' },
  { id: 'boatEscapeLocations', label: 'Boat escape' },
  { id: 'backtrackingAndRouteAmbiguity', label: 'Backtracking' },
]

const renderPursuit = () => {
  const root = document.querySelector('#pursuit-content')
  if (!root) return
  const mobility = analysis.mobilityPursuitAndBacktracking
  const rows = mobility[state.pursuitView]
  const selected = rows[state.pursuitIndex % rows.length]
  const pairRows = analysis.discoveryPairSafetyProxies[state.pairSafetySide]
  const pair = pairRows[state.pairSafetyIndex % pairRows.length]
  root.innerHTML = `
    <div class="subsection-heading"><div><p class="mini-kicker">Local structure, not win-rate predictions</p><h3>Where the networks favor pursuit or escape</h3></div>${buttonGroup(pursuitTabs, state.pursuitView, 'pursuitView')}</div>
    <div class="analysis-layout">
      ${boardMap({ label: `Selected ${state.pursuitView} location ${selected.circle}`, selected: [selected.circle] })}
      <div><div class="finding-panel"><span class="finding-label">Location ${selected.circle} · ${selected.quadrant}</span><h3>${state.pursuitView === 'catchUpLocations' ? 'Constrictable area' : state.pursuitView === 'backtrackingAndRouteAmbiguity' ? 'Many two-step route stories' : 'Escape leverage'}</h3><p>Street degree <strong>${selected.streetDegree}</strong>; distinct two-step endpoints <strong>${selected.distinctTwoStepEndpoints}</strong>; minimum local exit blockers <strong>${selected.minimumOccupiedCrossingsToBlockAllCurrentStreetMoves ?? 'more than 5'}</strong>. Best single Alley saving: ${selected.maximumSingleAlleySaving}; Boat saving: ${selected.maximumSingleBoatSaving}.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Circle</th><th>Degree</th><th>2-step ends</th><th>Exit blockers</th><th>A / B save</th></tr></thead><tbody>${rows.slice(0, 15).map((row, index) => `<tr class="${index === state.pursuitIndex ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="pursuitIndex" data-value="${index}">${row.circle}</button></td><td>${row.streetDegree}</td><td>${row.distinctTwoStepEndpoints}</td><td>${row.minimumOccupiedCrossingsToBlockAllCurrentStreetMoves ?? '6+'}</td><td>${row.maximumSingleAlleySaving} / ${row.maximumSingleBoatSaving}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    ${disclosure('Why this goes beyond “few crossings per location”', 'The ranking combines Jack branching, two-step route diversity, the minimum occupied-crossing set that removes all immediate street exits, street betweenness, and direct special-move gains. It still omits hidden-information policies and therefore supports tactical scouting, not solved play.')}
    <div class="subsection"><div class="subsection-heading"><div><p class="mini-kicker">Ordered Discovery pairs</p><h3>Low-leverage investigator routes for Jack</h3></div>${buttonGroup([{id:'bestForJack',label:'Best proxy for Jack'},{id:'worstForJack',label:'Worst proxy for Jack'}], state.pairSafetySide, 'pairSafetySide')}</div>
      <div class="analysis-layout analysis-layout--compact">
        ${boardMap({ label: `Directed route ${pair.from} to ${pair.to}`, selected: [pair.from, pair.to], path: pair.exampleSafestShortestPath })}
        <div><div class="finding-panel"><span class="finding-label">Static, omniscient-investigator proxy</span><h3>${pair.from} → ${pair.to}</h3><p>Jack needs <strong>${pair.jackStreetTurns}</strong> street turns. From deployment ${joinIds(analysis.discoveryPairSafetyProxies.deploymentSetUsed)}, the nearest investigator has ${pair.investigatorTurnsToDestination} movement turns to the destination. Among shortest paths, this route minimizes immediately coverable steps to ${pair.minimumOmniscientlyCoverableStepsAmongShortestPaths}.</p></div>
        <div class="table-wrap"><table><thead><tr><th>From → to</th><th>Jack</th><th>Inv. destination</th><th>Coverable steps</th></tr></thead><tbody>${pairRows.slice(0, 12).map((row, index) => `<tr class="${index === state.pairSafetyIndex ? 'is-active' : ''}"><td><button type="button" class="row-button" data-action="pairSafetyIndex" data-value="${index}">${row.from} → ${row.to}</button></td><td>${row.jackStreetTurns}</td><td>${row.investigatorTurnsToDestination}</td><td>${row.minimumOmniscientlyCoverableStepsAmongShortestPaths}</td></tr>`).join('')}</tbody></table></div></div>
      </div>${disclosure('Do not read this as a solved “best pair”', analysis.discoveryPairSafetyProxies.interpretation + ' Direction matters because Jack’s public start and the investigators’ response horizon differ.')}</div>`
}

const renderStrategy = () => {
  const root = document.querySelector('#strategy-content')
  if (!root) return
  const comparison = analysis.jack.websiteDifficultyComparison
  const sources = [
    { title: 'Official rulebook', url: rulebookUrl, tag: 'Primary rules', claim: 'Authoritative for movement, setup, search, arrest, round timing, and special tiles.', check: 'Used as the movement-model contract.' },
    { title: 'Whitehall Mystery Randomizer', url: 'https://whitehallmystery.com/', tag: 'Quantitative heuristic', claim: 'Rates 444,360 Discovery sets as easier or harder for Jack.', check: 'Useful benchmark, but not validated against games or pursuit dynamics.' },
    { title: 'Randomizer source (v7)', url: 'https://whitehallmystery.com/main.js?v=7', tag: 'Inspectable source', claim: 'Combines local branching, adjacent crossings, shortest tour, and longest tour.', check: 'Confirms that its opinion is explicitly more than path length.' },
    { title: 'BoardGameGeek strategy forum', url: 'https://boardgamegeek.com/boardgame/190082/whitehall-mystery/forums/67', tag: 'Discussion index', claim: 'Dedicated threads cover Discovery choices, quirks, Jack wins, and lower-right balance.', check: 'Thread bodies were bot-blocked during research; titles are leads, not evidence.' },
    { title: '“I don’t know Jack” discussion', url: 'https://www.reddit.com/r/boardgames/comments/viphnp/whitehall_mystery_i_dont_know_jack/', tag: 'Player anecdotes', claim: 'Advocates feints, backtracking, circles, and exploiting areas where Jack moves faster.', check: 'Plausible hypotheses; small, self-selected sample with conflicting balance experiences.' },
    { title: 'Tekeli.li play-by-post', url: 'https://discussion.tekeli.li/t/anyone-for-a-whitehall-mystery/1995', tag: 'Worked game record', claim: 'Shows live belief-frontier, negative-search, bridge, and backtrack reasoning.', check: 'High qualitative value, but one informal game.' },
    { title: 'RPGnet comped playtest review', url: 'https://www.rpg.net/reviews/view-printable.phtml?reviewNumber=17769', tag: 'Review opinion', claim: 'Suggests mixing central and remote sites and avoiding adjacent final locations.', check: 'No supporting logs or analysis; target for simulation, not a rule.' },
  ]
  root.innerHTML = `
    <div class="formula-card"><p class="mini-kicker">What WhitehallMystery.com actually computes</p><div class="formula">[Σ branching<sup>−1</sup> × adjacent crossings<sup>−0.8</sup>] × shortest tour<sup>0.75</sup> × longest tour<sup>0.25</sup></div><p>Its “Hard” means hard for Jack. The formula heavily weights travel, but also makes low-branching, easy-to-block Discovery endpoints harder. Its undocumented fractional cost matrix, arbitrary exponents, and lack of pursuit state make it a benchmark—not ground truth.</p></div>
    <div class="stats-grid benchmark-stats">
      ${stat('Strongest correlate', formatNumber(comparison.correlationWithPublishedDifficulty.localMobilityPenalty.spearman, 5), 'Spearman correlation: local endpoint penalty')}
      ${stat('Shortest-tour correlate', formatNumber(comparison.correlationWithPublishedDifficulty.exactMinTour.spearman, 5), 'Spearman correlation with exact street tour')}
      ${stat('Cost-table mismatch', formatNumber(comparison.siteCostMatrixVsExactStreetDistance.meanAbsoluteDifference, 4), `${comparison.siteCostMatrixVsExactStreetDistance.halfStepPairCount} half-step pairs · max difference ${comparison.siteCostMatrixVsExactStreetDistance.maximumAbsoluteDifference}`)}
    </div>
    <div class="table-wrap benchmark-table"><table><thead><tr><th>Published tier</th><th>Sets selected</th><th>Exact minimum tour mean</th><th>Median</th><th>Range</th></tr></thead><tbody>${['easy','medium','hard','unselectedGap'].map((tier) => { const row = comparison.exactMinimumTourByPublishedTier[tier]; return `<tr><th>${tier === 'unselectedGap' ? 'Gap / fully random only' : tier}</th><td>${row.setCount.toLocaleString()}</td><td>${row.mean}</td><td>${row.median}</td><td>${row.min}–${row.max}</td></tr>` }).join('')}</tbody></table></div>
    ${disclosure('What the comparison says', 'The site’s local endpoint penalty correlates more strongly with its published score than exact minimum tour length does. That is decisive evidence that the site is not merely sorting by distance. It is not evidence that the weights predict win probability.')}
    <div class="source-grid">${sources.map((source) => `<article class="source-card"><span>${source.tag}</span><h3><a href="${source.url}" target="_blank" rel="noreferrer">${source.title}</a></h3><p>${source.claim}</p><p class="source-check"><strong>Our reading:</strong> ${source.check}</p></article>`).join('')}</div>
    <div class="conclusion-grid"><div><p class="mini-kicker">What survives scrutiny</p><h3>Backtracking is legal and can change inference.</h3><p>A trail clue has no timestamp, so a revisit or reversal can make a current-position frontier ambiguous. It never improves geometric distance and spends the 15-slot clock, so its value is conditional—strongest when investigators have passed a cut or abandoned rear coverage.</p></div><div><p class="mini-kicker">What remains open</p><h3>Shortest paths do not solve hidden pursuit.</h3><p>Win-rate claims require explicit investigator search/arrest policies, Jack bluffing policies, and carry-over positions between rounds. This report marks all static proxies accordingly.</p></div></div>`
}

const renderMethods = () => {
  const root = document.querySelector('#methods-content')
  if (!root) return
  const generated = new Date(analysis.meta.generatedAtUnix * 1000).toLocaleString()
  root.innerHTML = `<div class="methods-grid"><div><h3>Movement contract</h3><ul><li>${analysis.meta.semantics.street}</li><li>${analysis.meta.semantics.investigator}</li><li>${analysis.meta.semantics.coach}</li><li>${analysis.meta.semantics.alleyBoat}</li><li>${analysis.meta.semantics.discoverySpecialEntry}</li></ul></div><div><h3>Scope limits</h3><ul><li>${analysis.meta.semantics.blockedVsStatic}</li><li>Discovery special-tour results can be lower bounds if a route crosses a third, unreached Discovery circle early.</li><li>Pair safety and pursuit rankings are structural proxies, not optimal hidden-information strategies or win probabilities.</li><li>Investigators still receive their full final phase before Jack declares arrival at a Discovery Location.</li></ul></div></div>
    <div class="artifact-links"><a href="${analysisScriptUrl}">Analysis script</a><a href="${strategyMemoUrl}">Strategy-source memo</a><a href="${rulebookUrl}">Included rulebook</a><span>Generated ${generated}</span></div>`
}

const renderAll = () => {
  const image = document.querySelector('#board-image')
  if (image) image.src = boardImageUrl
  renderScenarioRail()
  renderJack()
  renderDiscoveries()
  renderInvestigators()
  renderPursuit()
  renderStrategy()
  renderMethods()
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]')
  if (!button) return
  const { action, value } = button.dataset
  if (action === 'reset') {
    localStorage.removeItem(storageKey)
    state = { ...defaultState }
    renderAll()
    announce('Report view reset')
    return
  }
  if (action === 'scenario') setState({ scenario: value, discoveryIndex: 0 }, `Movement model changed to ${scenarios.find((item) => item.id === value)?.label}`)
  else if (action === 'costMetric') setState({ costMetric: value, discoveryIndex: 0 }, `Cost unit changed to ${value === 'actionTurns' ? 'Jack turns' : 'move-track slots'}`)
  else if (action === 'specialKind') setState({ specialKind: value, specialPair: 0 })
  else if (action === 'tourScenario') setState({ tourScenario: value, discoveryIndex: 0 }, `Discovery tour budget changed to ${value}`)
  else if (['discoverySide', 'blockadeQuadrant', 'blockadeMode', 'pairSafetySide', 'pursuitView'].includes(action)) setState({ [action]: value, [`${action.replace(/(Side|Quadrant|Mode|View)$/, '')}Index`]: 0 })
  else if (['branchCircle', 'specialPair', 'discoveryIndex', 'investigatorStart', 'blockadeIndex', 'pairSafetyIndex', 'pursuitIndex'].includes(action)) setState({ [action]: Number(value) })
})

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-action="jackPairSelect"]')) setState({ jackPair: Number(event.target.value) }, 'Selected diameter pair updated')
})

renderAll()
