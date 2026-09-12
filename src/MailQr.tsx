import { Component, createRef, useState, type ReactNode } from 'react'
import './MailQr.css'

function stored(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function remember(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* Private browsing. */ } }
const expandedKey = 'whitehall-mystery.mail-qr-expanded'
const formatKey = 'whitehall-mystery.mail-qr-format'

class QrImage extends Component<{ text: string; binary: boolean }, { src: string; error: string }> {
  state = { src: '', error: '' }
  active = false
  componentDidMount() {
    this.active = true
    void import('./mailQrCodec').then(qr => qr.createMailQr(this.props.text, this.props.binary)).then(src => {
      if (this.active) this.setState({ src })
    }).catch(error => { if (this.active) this.setState({ error: String(error.message ?? error) }) })
  }
  componentWillUnmount() { this.active = false }
  render() {
    return this.state.src ? <img className="mail-qr-image" src={this.state.src} alt="Game QR code" />
      : <p role="status">{this.state.error || 'Generating QR code…'}</p>
  }
}

export function MailQrShare({ text, children, feedback }: { text: string; children: ReactNode; feedback?: ReactNode }) {
  const [expanded, setExpanded] = useState(() => stored(expandedKey) === 'true')
  const [binary, setBinary] = useState(() => stored(formatKey) === 'binary')
  return <section className="mail-qr">
    <div className="button-row"><button type="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); remember(expandedKey, String(!expanded)) }}>{expanded ? 'Hide QR code' : 'Show QR code'}</button>{children}</div>
    {feedback}
    {expanded && <>
      <label>QR code contains <select value={binary ? 'binary' : 'link'} onChange={event => {
        const value = event.target.value
        setBinary(value === 'binary'); remember(formatKey, value)
      }}><option value="link">App link</option><option value="binary">Compact binary game state</option></select></label>
      <p>{binary ? 'Smaller code. Your partner must scan it inside By Mail.' : 'Your partner can scan with their camera app to open the game, or scan inside By Mail.'}</p>
      <QrImage key={`${binary}:${text}`} text={text} binary={binary} />
    </>}
  </section>
}

export class MailQrReader extends Component<{ onRead: (text: string) => void; children?: ReactNode }, { scanning: boolean; status: string }> {
  state = { scanning: false, status: '' }
  video = createRef<HTMLVideoElement>()
  stream: MediaStream | null = null
  timer: ReturnType<typeof setTimeout> | undefined
  active = true
  attempt = 0
  componentDidMount() { this.active = true }
  componentWillUnmount() { this.active = false; this.stop() }
  stop = () => {
    this.attempt++
    clearTimeout(this.timer)
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    if (this.video.current) this.video.current.srcObject = null
    if (this.active) this.setState({ scanning: false })
  }
  found = (text: string) => {
    this.stop()
    this.props.onRead(text)
    this.setState({ status: 'QR code read. Use the load button below to apply it.' })
  }
  start = async () => {
    const attempt = ++this.attempt
    this.setState({ scanning: true, status: 'Starting camera…' })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false })
      if (!this.active || attempt !== this.attempt) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      const video = this.video.current!
      video.srcObject = stream
      await video.play()
      if (!this.active || attempt !== this.attempt) return
      this.setState({ status: 'Point the camera at your partner’s QR code.' })
      const qr = await import('./mailQrCodec')
      const canvas = document.createElement('canvas')
      const scan = async () => {
        if (!this.active || attempt !== this.attempt) return
        try {
          if (video.readyState >= 2 && video.videoWidth) {
            const scale = Math.min(1, 1280 / video.videoWidth)
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
            const context = canvas.getContext('2d', { willReadFrequently: true })!
            context.drawImage(video, 0, 0, canvas.width, canvas.height)
            const text = await qr.readMailQr(context.getImageData(0, 0, canvas.width, canvas.height))
            if (!this.active || attempt !== this.attempt) return
            if (text) { this.found(text); return }
          }
          this.timer = setTimeout(() => void scan(), 200)
        } catch (error) { if (this.active && attempt === this.attempt) { this.stop(); this.setState({ status: String(error) }) } }
      }
      void scan()
    } catch {
      if (this.active && attempt === this.attempt) { this.stop(); this.setState({ status: 'Camera unavailable. Allow camera access over HTTPS and try again, or paste your partner’s game text.' }) }
    }
  }
  render() {
    return <section className="mail-qr" aria-label="Read partner QR code">
      <div className="button-row"><button type="button" onClick={this.state.scanning ? this.stop : () => void this.start()}>{this.state.scanning ? 'Stop camera' : 'Scan QR code'}</button>{this.props.children}</div>
      {this.state.scanning && <video className="mail-qr-video" ref={this.video} muted playsInline />}
      {this.state.status && <p role="status">{this.state.status}</p>}
    </section>
  }
}
