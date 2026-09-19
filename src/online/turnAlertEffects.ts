import { playerViewForState, type PlayerView } from '../game/history'
import type { OnlineSnapshot } from '../game/onlineProtocol'

export const TURN_ALERT_KEYS = {
  flash: 'whitehall-mystery.turn-alert.flash',
  chime: 'whitehall-mystery.turn-alert.chime',
  notification: 'whitehall-mystery.turn-alert.notification',
} as const

// Only compare verified snapshots, never UI waiting/saving/connection state.
export const becameLocalTurn = (before: OnlineSnapshot | null, after: OnlineSnapshot | null, role: PlayerView): boolean =>
  !!before && !!after && before.roomId === after.roomId && after.revision > before.revision &&
  playerViewForState(before.history.state) !== role && playerViewForState(after.history.state) === role

export type ChimeStatus = 'ready' | 'needs-gesture' | 'unavailable'
export type NotificationStatus = NotificationPermission | 'unsupported'

export const notificationStatus = (): NotificationStatus =>
  typeof Notification === 'function' && window.isSecureContext ? Notification.permission : 'unsupported'

export class TurnChime {
  private context: AudioContext | null = null

  // Called directly from a click, key press or pointer event to satisfy autoplay rules.
  async unlock(): Promise<ChimeStatus> {
    if (typeof AudioContext !== 'function') return 'unavailable'
    try {
      const context = this.context ??= new AudioContext()
      if (context.state === 'suspended') await context.resume()
      return context.state === 'running' ? 'ready' : 'needs-gesture'
    } catch {
      return 'unavailable'
    }
  }

  play(): ChimeStatus {
    const context = this.context
    // Never queue a sound behind a blocked resume(): it could ring on an unrelated later click.
    if (!context || context.state !== 'running') return 'needs-gesture'
    try {
      const start = context.currentTime
      for (const [offset, frequency] of [[0, 660], [0.16, 880]]) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0, start + offset)
        gain.gain.linearRampToValueAtTime(0.12, start + offset + 0.015)
        gain.gain.exponentialRampToValueAtTime(0.001, start + offset + 0.28)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
        oscillator.start(start + offset)
        oscillator.stop(start + offset + 0.3)
      }
      return 'ready'
    } catch {
      return 'unavailable'
    }
  }

  dispose() {
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') void context.close().catch(() => {})
  }
}
