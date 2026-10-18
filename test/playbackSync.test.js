import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playbackPositionAt, synchronizeVideo } from '../src/services/playbackSync.js'

const playback = (state, position, updatedAt = 100_000) => ({
  state,
  position,
  updatedAt: { toMillis: () => updatedAt },
})

function fakeVideo({ currentTime = 0, paused = false, readyState = 4 } = {}) {
  return {
    currentTime,
    paused,
    readyState,
    seeking: false,
    playbackRate: 1,
    play() { this.paused = false; return Promise.resolve() },
    pause() { this.paused = true },
  }
}

test('playing position advances from the authoritative timestamp', () => {
  assert.equal(playbackPositionAt(playback('playing', 12, 100_000), 102_500), 14.5)
  assert.equal(playbackPositionAt(playback('paused', 12, 100_000), 102_500), 12)
})

test('drift below 100 ms is ignored', () => {
  const video = fakeVideo({ currentTime: 12 })
  const result = synchronizeVideo(video, playback('playing', 12.05), 100_000)
  assert.ok(Math.abs(result.drift - 0.05) < 0.000001)
  assert.equal(video.currentTime, 12)
  assert.equal(video.playbackRate, 1)
})

test('moderate drift is corrected gradually with playback rate', () => {
  const video = fakeVideo({ currentTime: 12 })
  synchronizeVideo(video, playback('playing', 12.25), 100_000)
  assert.equal(video.currentTime, 12)
  assert.equal(video.playbackRate, 1.025)
})

test('drift above 500 ms seeks to the authoritative position', () => {
  const video = fakeVideo({ currentTime: 12 })
  synchronizeVideo(video, playback('playing', 12.75), 100_000)
  assert.equal(video.currentTime, 12.75)
  assert.equal(video.playbackRate, 1)
})

test('paused state pauses the client and resets playback rate', () => {
  const video = fakeVideo({ currentTime: 8, paused: false, playbackRate: 1.04 })
  synchronizeVideo(video, playback('paused', 10), 100_000)
  assert.equal(video.paused, true)
  assert.equal(video.currentTime, 10)
  assert.equal(video.playbackRate, 1)
})
