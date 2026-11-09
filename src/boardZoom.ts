import { activeInvestigatorColor, deploymentChoices, investigatorPreviewDestinations, legalInvestigatorDestinations, legalJackDestinations } from './game/gameEngine'
import { adjacentCirclesForCrossing, circles, circlesById, crossingsById } from './game/mapData'
import type { GameState, JackMoveType } from './game/types'

interface Point { x: number; y: number }
export interface BoardZoomRegion {
  locations: number[]
  crossings: string[]
  center?: Point
}
export interface ZoomBounds { left: number; top: number; right: number; bottom: number }
export const ZOOM_GUTTERS = { side: 3.2, top: 9.6, bottom: 24 }

export function boardZoomRegion(state: GameState): BoardZoomRegion | null {
  const locations = new Set<number>()
  const crossings = new Set<string>()
  let center: Point | undefined
  if (state.stage === 'jackMove') {
    if (state.currentJack === null) return null
    locations.add(state.currentJack)
    center = circlesById.get(state.currentJack)
    for (const type of ['normal', 'coach', 'alley', 'boat'] as JackMoveType[]) {
      const planning = { ...state, jackMoveSelection: { type, path: [] } }
      for (const first of legalJackDestinations(planning)) {
        locations.add(first)
        if (type === 'coach') {
          for (const second of legalJackDestinations({ ...planning, jackMoveSelection: { type, path: [first] } })) locations.add(second)
        }
      }
    }
  } else if (state.stage === 'investigatorMove' || state.stage === 'investigatorAction') {
    const color = activeInvestigatorColor(state)
    const start = state.investigatorPositions[color]
    if (!start) return null
    center = crossingsById.get(start)
    crossings.add(start)
    const reachable = state.stage === 'investigatorMove' ? legalInvestigatorDestinations(state) : investigatorPreviewDestinations(state, color)
    for (const crossing of reachable) {
      crossings.add(crossing)
      for (const location of adjacentCirclesForCrossing(crossing)) locations.add(location)
    }
  } else if (state.stage === 'investigatorSetup') {
    for (const crossing of deploymentChoices(state)) crossings.add(crossing)
  } else if (state.stage === 'jackChooseStart') {
    for (const location of state.discoveryLocations) locations.add(location)
  } else if (state.stage === 'jackDiscoverySetup') {
    const chosen = new Set(state.discoveryLocations.map(id => circlesById.get(id)?.quadrant))
    for (const circle of circles) if (circle.color === 'white' && !chosen.has(circle.quadrant)) locations.add(circle.id)
    // Once all four quadrants are filled, frame the choices for review.
    if (!locations.size) for (const location of state.discoveryLocations) locations.add(location)
  } else return null
  return locations.size || crossings.size ? { locations: [...locations], crossings: [...crossings], center } : null
}

const clamp = (value: number, low: number, high: number) => low <= high ? Math.max(low, Math.min(value, high)) : (low + high) / 2

export function boardZoomFrame(bounds: ZoomBounds, size: { width: number; height: number }, anchor?: Point, actualScale?: number) {
  const { side, top } = ZOOM_GUTTERS
  const bottom = Math.min(ZOOM_GUTTERS.bottom, size.height * 0.06)
  const middle = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
  const fit = Math.min(5, (size.width - side * 2) / Math.max(1, bounds.right - bounds.left),
    (size.height - top - bottom) / Math.max(1, bounds.bottom - bounds.top))
  const centered = anchor ? Math.min(
    (size.width / 2 - side) / Math.max(1, anchor.x - bounds.left, bounds.right - anchor.x),
    (size.height / 2 - top) / Math.max(1, anchor.y - bounds.top),
    (size.height / 2 - bottom) / Math.max(1, bounds.bottom - anchor.y),
  ) : fit
  // Prefer centering the active piece. When that would require zooming out,
  // fit the whole region and keep the piece as close to the center as possible.
  const scale = actualScale ?? Math.max(0.1, Math.min(fit, centered >= 1 ? centered : fit))
  const preferred = anchor ?? { x: middle.x, y: middle.y + (bottom - top) / (2 * scale) }
  return { scale, center: {
    x: clamp(preferred.x, bounds.right - (size.width / 2 - side) / scale, bounds.left + (size.width / 2 - side) / scale),
    y: clamp(preferred.y, bounds.bottom - (size.height / 2 - bottom) / scale, bounds.top + (size.height / 2 - top) / scale),
  } }
}

let requestId = 0
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

export interface SavedBoardViewport { scale: number; center: Point }

const setNativeScale = (meta: HTMLMetaElement, scale: number) => {
  const settings = meta.content.split(',').filter(part => !/^\s*initial-scale\s*=/i.test(part))
  meta.content = [...settings, `initial-scale=${scale}`].join(', ')
}

export async function centerNativeViewport(center: Point) {
  const target = document.createElement('span')
  target.setAttribute('aria-hidden', 'true')
  Object.assign(target.style, { position: 'absolute', left: `${center.x - 0.5}px`, top: `${center.y - 0.5}px`,
    width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' })
  document.body.append(target)
  try {
    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
    await nextFrame()
  } finally { target.remove() }
}

export async function restoreBoardViewport(panel: HTMLElement, view: SavedBoardViewport) {
  const request = ++requestId
  await document.fonts.ready
  if (!panel.isConnected || request !== requestId) return
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) return
  setNativeScale(meta, view.scale)
  for (let attempt = 0; attempt < 8; attempt++) {
    await nextFrame()
    if (!panel.isConnected || request !== requestId) return
    if (Math.abs((window.visualViewport?.scale ?? 1) - view.scale) < 0.01) break
  }
  await centerNativeViewport(view.center)
}

export async function zoomToBoardRegion(panel: HTMLElement, region: BoardZoomRegion) {
  const svg = panel.querySelector<SVGSVGElement>('.game-board')
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!svg || !meta) return
  const points = [...region.locations.map(id => circlesById.get(id)), ...region.crossings.map(id => crossingsById.get(id))]
    .filter(point => point !== undefined)
  if (!points.length) return
  const request = ++requestId
  const measure = () => {
    const matrix = svg.getScreenCTM()
    if (!matrix) return null
    const project = (point: Point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix)
      return { x: screen.x + window.scrollX, y: screen.y + window.scrollY }
    }
    // Include complete location outlines and investigator rings in the frame.
    const corners = points.flatMap(point => [project({ x: point.x - 28, y: point.y - 28 }), project({ x: point.x + 28, y: point.y + 28 })])
    return { bounds: { left: Math.min(...corners.map(point => point.x)), right: Math.max(...corners.map(point => point.x)),
      top: Math.min(...corners.map(point => point.y)), bottom: Math.max(...corners.map(point => point.y)) },
      anchor: region.center ? project(region.center) : undefined }
  }
  const viewport = window.visualViewport
  const size = { width: viewport ? viewport.width * viewport.scale : window.innerWidth,
    height: viewport ? viewport.height * viewport.scale : window.innerHeight }
  // Reapply the native scale even after the user pinches back out and asks to
  // frame the same area again. Leave native pinch-zoom limits unchanged.
  setNativeScale(meta, 1)
  await nextFrame()
  if (!svg.isConnected || request !== requestId) return
  // A landscape overview can require a scale below one. That can change the
  // responsive layout, so fit its newly rendered map before centering it.
  for (let layout = 0; layout < 4; layout++) {
    const measured = measure()
    if (!measured) return
    const frame = boardZoomFrame(measured.bounds, size, measured.anchor)
    setNativeScale(meta, frame.scale)
    for (let attempt = 0; attempt < 8; attempt++) {
      await nextFrame()
      if (!svg.isConnected || request !== requestId) return
      if (Math.abs((window.visualViewport?.scale ?? 1) - frame.scale) < 0.01) break
    }
    const settled = measure()
    if (!settled || Math.abs(boardZoomFrame(settled.bounds, size, settled.anchor).scale - frame.scale) < 0.01) break
  }
  const measured = measure()
  if (!measured) return
  const centered = boardZoomFrame(measured.bounds, size, measured.anchor, window.visualViewport?.scale ?? 1).center
  await centerNativeViewport(centered)
}
