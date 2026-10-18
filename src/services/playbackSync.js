export function playbackPositionAt(playback, now = Date.now()) {
  if (!playback) return 0
  const changedAt = playback.updatedAt?.toMillis?.()
  const elapsed = playback.state === 'playing' && Number.isFinite(changedAt)
    ? Math.max(0, (now - changedAt) / 1000)
    : 0
  return Math.max(0, playback.position + elapsed)
}

export function synchronizeVideo(video, playback, now = Date.now()) {
  if (!video || !playback) return { drift: 0, playRequest: null }
  const target = playbackPositionAt(playback, now)
  let playRequest = null

  if (playback.state === 'paused') {
    video.playbackRate = 1
    if (!video.paused) video.pause()
  } else if (video.paused) {
    playRequest = video.play()
    playRequest?.catch?.(() => {})
  }

  if (video.readyState < 1 || video.seeking) return { drift: 0, target, playRequest }
  const drift = target - video.currentTime
  const absoluteDrift = Math.abs(drift)

  if (absoluteDrift > 0.5) {
    video.currentTime = target
    video.playbackRate = 1
  } else if (playback.state === 'playing' && absoluteDrift >= 0.1) {
    const adjustment = Math.min(0.05, absoluteDrift * 0.1)
    video.playbackRate = 1 + Math.sign(drift) * adjustment
  } else {
    video.playbackRate = 1
  }

  return { drift, target, playRequest }
}
