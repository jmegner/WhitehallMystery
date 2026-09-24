import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadBooleanPreference, saveBooleanPreference } from '../game/persistence'
import type { OnlineSessionStore } from './onlineSession'
import { onlineUpdateAlert, turnAlert, notificationStatus, TurnChime, TURN_ALERT_KEYS, type ChimeStatus, type OnlineAlert } from './turnAlertEffects'
import './TurnAlerts.css'

function loadPreference(key: string, fallback: boolean) {
  try { return loadBooleanPreference(localStorage, key, fallback) } catch { return fallback }
}

function savePreference(key: string, enabled: boolean) {
  try { saveBooleanPreference(localStorage, key, enabled) } catch { /* Storage may be unavailable. */ }
}

export default function TurnAlerts({ store }: { store: OnlineSessionStore }) {
  const [flashEnabled, setFlashEnabled] = useState(() => loadPreference(TURN_ALERT_KEYS.flash, true))
  const [chimeEnabled, setChimeEnabled] = useState(() => loadPreference(TURN_ALERT_KEYS.chime, true))
  const [notificationEnabled, setNotificationEnabled] = useState(() => loadPreference(TURN_ALERT_KEYS.notification, false))
  const [permission, setPermission] = useState(notificationStatus)
  const [requestingPermission, setRequestingPermission] = useState(false)
  const [notificationIssue, setNotificationIssue] = useState('')
  const [soundStatus, setSoundStatus] = useState<ChimeStatus>('needs-gesture')
  const [flashText, setFlashText] = useState('Your turn')
  const [chime] = useState(() => new TurnChime())
  const flashElement = useRef<HTMLDivElement>(null)
  const flashAnimation = useRef<Animation | null>(null)
  const activeNotification = useRef<Notification | null>(null)

  useEffect(() => {
    if (!chimeEnabled) return
    let disposed = false
    const unlock = () => {
      void chime.unlock().then(status => { if (!disposed) setSoundStatus(status) })
    }
    // Wait for the completed click: removing the sound hint on pointerdown can
    // move a button before mouseup and swallow its first click (e.g. Copy link).
    window.addEventListener('click', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      disposed = true
      window.removeEventListener('click', unlock)
      window.removeEventListener('keydown', unlock)
      chime.dispose()
    }
  }, [chime, chimeEnabled])

  useEffect(() => {
    const refreshPermission = () => setPermission(notificationStatus())
    window.addEventListener('focus', refreshPermission)
    document.addEventListener('visibilitychange', refreshPermission)
    return () => {
      window.removeEventListener('focus', refreshPermission)
      document.removeEventListener('visibilitychange', refreshPermission)
    }
  }, [])

  const flash = (title: string) => {
    setFlashText(title)
    flashAnimation.current?.cancel()
    flashAnimation.current = flashElement.current?.animate(
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }],
      { duration: 500, easing: 'ease-out' },
    ) ?? null
  }

  const notify = (alert: OnlineAlert) => {
    const status = notificationStatus()
    setPermission(status)
    if (status !== 'granted') return
    try {
      activeNotification.current?.close()
      const notification = new Notification(`Whitehall Mystery — ${alert.title}`, {
        body: alert.body,
        tag: `whitehall-turn-${store.session.roomId}-${store.session.role}`,
        icon: new URL(`${import.meta.env.BASE_URL}favicon.svg`, window.location.href).href,
        silent: true,
      })
      notification.onclick = () => { window.focus(); notification.close() }
      activeNotification.current = notification
      setNotificationIssue('')
    } catch {
      setNotificationIssue('This browser could not show a system notification. Try a desktop browser and check its notification settings.')
    }
  }

  const alertForUpdate = useEffectEvent((alert: OnlineAlert) => {
    if (flashEnabled) flash(alert.title)
    if (chimeEnabled) setSoundStatus(chime.play())
    if (notificationEnabled) notify(alert)
  })

  // The subscription is to the external WebSocket store. Keep the last verified
  // snapshot across disconnects; initial loads and same-revision retries are silent.
  useEffect(() => {
    let previous = store.getSnapshot()
    const unsubscribe = store.subscribe(() => {
      const next = store.getSnapshot()
      const alert = onlineUpdateAlert(previous.snapshot, next.snapshot, store.session.role, previous.undo, next.undo, previous.seats, next.seats)
      previous = next
      if (alert) alertForUpdate(alert)
    })
    return () => { unsubscribe() }
  }, [store])

  useEffect(() => () => {
    flashAnimation.current?.cancel()
    activeNotification.current?.close()
  }, [])

  const enableNotifications = async (enabled: boolean) => {
    setNotificationIssue('')
    if (!enabled) {
      setNotificationEnabled(false)
      savePreference(TURN_ALERT_KEYS.notification, false)
      activeNotification.current?.close()
      return
    }
    if (notificationStatus() === 'unsupported') return
    setRequestingPermission(true)
    try {
      // This call stays in the checkbox's user gesture, never in an effect.
      const result = await Notification.requestPermission()
      setPermission(result)
      const granted = result === 'granted'
      setNotificationEnabled(granted)
      savePreference(TURN_ALERT_KEYS.notification, granted)
      if (result === 'default') setNotificationIssue('Notifications were not enabled. Check System notification again when you want to allow them.')
    } catch {
      setNotificationIssue('Notification permission could not be requested. Check this site’s browser permissions.')
    } finally {
      setRequestingPermission(false)
    }
  }

  const testAlerts = () => {
    const alert = turnAlert(store.session.role)
    if (flashEnabled) flash(alert.title)
    if (chimeEnabled) {
      void chime.unlock().then(status => setSoundStatus(status === 'ready' ? chime.play() : status))
    }
    if (notificationEnabled) notify(alert)
  }

  return <>
    <fieldset className="turn-alert-settings">
      <legend>When it’s your turn</legend>
      <div className="turn-alert-options">
        <label><input type="checkbox" checked={flashEnabled} onChange={event => {
          setFlashEnabled(event.target.checked)
          savePreference(TURN_ALERT_KEYS.flash, event.target.checked)
          if (!event.target.checked) flashAnimation.current?.cancel()
        }} />Flash screen</label>
        <label><input type="checkbox" checked={chimeEnabled} onChange={event => {
          setChimeEnabled(event.target.checked)
          savePreference(TURN_ALERT_KEYS.chime, event.target.checked)
          if (event.target.checked) void chime.unlock().then(setSoundStatus)
        }} />Chime</label>
        <label><input type="checkbox" checked={notificationEnabled}
          disabled={requestingPermission || (permission === 'unsupported' && !notificationEnabled)}
          onChange={event => void enableNotifications(event.target.checked)} />System notification</label>
        <button type="button" onClick={testAlerts} disabled={!flashEnabled && !chimeEnabled && !notificationEnabled}>Test alerts</button>
      </div>
      <p className="turn-alert-help">Also used for undo requests, decisions, and an opponent leaving. Alerts work while this game page is open, including in a background tab.</p>
      {chimeEnabled && soundStatus !== 'ready' && <p className="turn-alert-help" role="status">
        {soundStatus === 'unavailable' ? 'Sound is unavailable in this browser.' : 'Click Test alerts or interact with the page to enable sound after opening or refreshing it.'}
      </p>}
      {permission === 'unsupported' && <p className="turn-alert-help">System notifications are unavailable in this browser.</p>}
      {permission === 'denied' && <p className="turn-alert-help" role="status">Notifications are blocked. Allow them in this site’s browser permissions, then enable System notification.</p>}
      {permission === 'default' && notificationEnabled && <p className="turn-alert-help">Notification permission is needed. Uncheck and recheck System notification to allow it.</p>}
      {notificationIssue && <p className="turn-alert-help" role="status">{notificationIssue}</p>}
    </fieldset>
    {createPortal(<div ref={flashElement} className="turn-alert-flash" aria-hidden="true"><span>{flashText}</span></div>, document.body)}
  </>
}
