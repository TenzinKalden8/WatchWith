import { useEffect, useRef } from 'react'

export default function MediaVideo({ stream, muted = false }) {
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  useEffect(() => {
    if (!videoRef.current || !stream) return undefined
    videoRef.current.srcObject = stream
    videoRef.current.play().catch(() => {})
    return () => { if (videoRef.current) videoRef.current.srcObject = null }
  }, [stream])

  useEffect(() => {
    if (!audioRef.current || !stream) return undefined
    audioRef.current.srcObject = stream
    audioRef.current.play().catch(() => {})
    return () => { if (audioRef.current) audioRef.current.srcObject = null }
  }, [stream])

  return <>
    <video className="participant-video" ref={videoRef} autoPlay playsInline muted/>
    {!muted && <audio ref={audioRef} autoPlay playsInline/>}
  </>
}
