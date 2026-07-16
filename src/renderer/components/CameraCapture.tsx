import React, { useEffect, useRef, useState } from 'react'
import { Modal, Spinner } from './ui'

/**
 * Captura de foto con la cámara del dispositivo (getUserMedia):
 * vista previa en vivo → "Tomar foto" congela el cuadro (recorte cuadrado centrado)
 * → "Usar foto" entrega un data URL JPEG. Si no hay cámara o el permiso se niega,
 * muestra el error para que el usuario use la subida de archivo como respaldo.
 */
export function CameraCapture({
  title = 'Tomar foto',
  onCapture,
  onClose
}: {
  title?: string
  onCapture: (dataUrl: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [shot, setShot] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (!navigator.mediaDevices?.getUserMedia) {
      setErr('Este equipo/navegador no permite acceder a la cámara.')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setReady(true)
      })
      .catch((e: any) => {
        if (!alive) return
        setErr(
          e?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Habilítalo en la configuración del sistema o sube un archivo.'
            : e?.name === 'NotFoundError'
              ? 'No se encontró ninguna cámara en este equipo.'
              : 'No se pudo abrir la cámara: ' + (e?.message ?? e)
        )
      })
    return () => {
      alive = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  function take() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    // Recorte cuadrado centrado (foto de perfil), máx. 640px
    const side = Math.min(v.videoWidth, v.videoHeight)
    const out = Math.min(side, 640)
    const canvas = document.createElement('canvas')
    canvas.width = out
    canvas.height = out
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, out, out)
    setShot(canvas.toDataURL('image/jpeg', 0.9))
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          {shot ? (
            <>
              <button className="btn" onClick={() => setShot(null)}>↺ Repetir</button>
              <button className="btn primary" onClick={() => onCapture(shot)}>Usar esta foto</button>
            </>
          ) : (
            <button className="btn primary" onClick={take} disabled={!ready}>📷 Tomar foto</button>
          )}
        </>
      }
    >
      {err ? (
        <div className="err" style={{ margin: 0 }}>{err}</div>
      ) : shot ? (
        <img src={shot} alt="Foto capturada" style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto', borderRadius: 12 }} />
      ) : (
        <div style={{ position: 'relative' }}>
          {!ready && (
            <div style={{ textAlign: 'center', padding: 30 }}>
              <Spinner /> <span className="muted">Abriendo cámara…</span>
            </div>
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', borderRadius: 12, display: ready ? 'block' : 'none', transform: 'scaleX(-1)' }}
          />
          {ready && <p className="muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>Cuando estés listo, pulsa “Tomar foto”.</p>}
        </div>
      )}
    </Modal>
  )
}
