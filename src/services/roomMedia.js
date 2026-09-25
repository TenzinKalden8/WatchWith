import {
  arrayUnion,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/firestoreClient'

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

function signalingError(error) {
  if (error?.code === 'permission-denied') {
    return 'Camera signaling was blocked by Firebase permissions. Refresh the app; if it continues, the deployed Firestore rules need updating.'
  }
  if (error?.code === 'unavailable' || error?.code === 'network-request-failed') {
    return 'Camera signaling lost its Firebase connection. Check the internet connection and wait for it to reconnect.'
  }
  return error?.message || 'Could not exchange camera connection details.'
}

function pairFor(firstId, secondId) {
  const [offererId, answererId] = [firstId, secondId].sort()
  return { offererId, answererId, signalId: `${offererId}__${answererId}` }
}

export async function requestLocalMedia({ cameraEnabled, microphoneEnabled }) {
  if (!cameraEnabled && !microphoneEnabled) return new MediaStream()
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera and microphone require a secure browser connection. Open WatchWith using its https link.')
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: cameraEnabled ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } } : false,
      audio: microphoneEnabled ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
    })
  } catch (error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      throw new Error('Camera or microphone permission was denied. Allow access in your browser, or turn them off before joining.')
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      throw new Error('No camera or microphone was found. Turn both off to join without media.')
    }
    throw new Error(error.message || 'Could not start your camera or microphone.')
  }
}

export class RoomMediaSession {
  constructor({ roomCode, localUid, localStream, onRemoteStreams, onConnectionChange, onLocalStream, onError }) {
    this.roomCode = roomCode
    this.localUid = localUid
    this.localStream = localStream
    this.onRemoteStreams = onRemoteStreams
    this.onConnectionChange = onConnectionChange
    this.onLocalStream = onLocalStream
    this.onError = onError
    this.peers = new Map()
    this.remoteStreams = new Map()
    this.closed = false
  }

  syncParticipants(participants) {
    if (this.closed) return
    if (participants.some((participant) => participant.uid !== this.localUid && participant.online)
      && typeof RTCPeerConnection === 'undefined') {
      this.onError('This browser does not support WebRTC audio and video.')
      return
    }
    const activeIds = new Set(participants
      .filter((participant) => participant.uid !== this.localUid && participant.online)
      .map((participant) => participant.uid))

    for (const [uid, entry] of this.peers) {
      if (!activeIds.has(uid)) this.closePeer(uid, entry)
    }

    for (const uid of activeIds) {
      if (this.peers.has(uid)) continue
      const pair = pairFor(this.localUid, uid)
      if (pair.offererId === this.localUid) this.startOffer(uid, pair)
      else this.watchOffer(uid, pair)
    }
  }

  createPeer(uid, pair, sessionId) {
    const pc = new RTCPeerConnection({ iceServers })
    const signalRef = doc(db, 'rooms', this.roomCode, 'signals', pair.signalId)
    const entry = {
      pc,
      pair,
      signalRef,
      sessionId,
      offerer: pair.offererId === this.localUid,
      stopSignal: null,
      remoteDescriptionReady: false,
      answerStarted: false,
      processing: Promise.resolve(),
      ready: Promise.resolve(),
      seenCandidates: new Set(),
      pendingCandidates: [],
      transceivers: new Map(),
    }

    for (const kind of ['audio', 'video']) {
      const transceiver = pc.addTransceiver(kind, { direction: 'sendrecv' })
      entry.transceivers.set(kind, transceiver)
      const track = this.localStream?.getTracks().find((item) => item.kind === kind)
      if (track) entry.ready = Promise.all([entry.ready, transceiver.sender.replaceTrack(track)])
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate || this.closed || this.peers.get(uid) !== entry) return
      const field = entry.offerer ? 'offerCandidates' : 'answerCandidates'
      updateDoc(signalRef, { [field]: arrayUnion(event.candidate.toJSON()), updatedAt: serverTimestamp() })
        .catch((error) => this.onError(error.message))
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0] || this.remoteStreams.get(uid) || new MediaStream()
      if (!event.streams[0] && !stream.getTracks().some((track) => track.id === event.track.id)) stream.addTrack(event.track)
      this.remoteStreams.set(uid, stream)
      this.onRemoteStreams(new Map(this.remoteStreams))
    }
    pc.onconnectionstatechange = () => {
      this.onConnectionChange(uid, pc.connectionState)
      if (pc.connectionState === 'failed') this.onError(`Could not connect to another camera. The network may require a TURN relay, which is not configured in this MVP.`)
    }
    pc.oniceconnectionstatechange = () => {
      // ICE is the useful diagnostic when a peer connection exists but media
      // cannot find a route through both participants' routers/firewalls.
      this.onConnectionChange(uid, pc.iceConnectionState)
      if (pc.iceConnectionState === 'failed') {
        this.onError('A direct camera connection could not cross one of the networks. This MVP has STUN only; some networks require a TURN relay.')
      }
    }
    return entry
  }

  startOffer(uid, pair) {
    const signalRef = doc(db, 'rooms', this.roomCode, 'signals', pair.signalId)
    const sessionId = crypto.randomUUID()
    const entry = this.createPeer(uid, pair, sessionId)
    this.peers.set(uid, entry)
    entry.processing = (async () => {
      await setDoc(signalRef, {
        ...pair,
        sessionId,
        offer: null,
        answer: null,
        offerCandidates: [],
        answerCandidates: [],
        updatedAt: serverTimestamp(),
      })
      if (this.closed || this.peers.get(uid) !== entry) return
      entry.stopSignal = onSnapshot(signalRef, (snapshot) => {
        if (!snapshot.exists()) return
        const data = snapshot.data()
        if (data.sessionId !== sessionId) return
        entry.processing = entry.processing.then(() => this.consumeOffererSnapshot(entry, data))
        .catch((error) => this.onError(signalingError(error)))
      }, (error) => this.onError(signalingError(error)))
      await entry.ready
      const offer = await entry.pc.createOffer()
      await entry.pc.setLocalDescription(offer)
      await updateDoc(signalRef, {
        offer: { type: offer.type, sdp: offer.sdp },
        updatedAt: serverTimestamp(),
      })
    })().catch((error) => this.onError(signalingError(error)))
  }

  watchOffer(uid, pair) {
    const entry = this.createPeer(uid, pair, null)
    this.peers.set(uid, entry)
    entry.stopSignal = onSnapshot(entry.signalRef, (snapshot) => {
      if (!snapshot.exists()) return
      const data = snapshot.data()
      if (data.offererId !== pair.offererId || data.answererId !== pair.answererId || !data.offer || !data.sessionId) return
      const currentEntry = this.peers.get(uid)
      if (!currentEntry) return
      if (currentEntry.sessionId !== data.sessionId) {
        currentEntry.processing = currentEntry.processing.then(() => this.acceptOffer(uid, currentEntry, data)).catch((error) => this.onError(error.message))
      } else {
        currentEntry.processing = currentEntry.processing.then(() => this.consumeAnswererSnapshot(currentEntry, data)).catch((error) => this.onError(signalingError(error)))
      }
    }, (error) => this.onError(signalingError(error)))
  }

  async acceptOffer(uid, oldEntry, data) {
    if (this.closed || this.peers.get(uid) !== oldEntry) return
    const pair = oldEntry.pair
    oldEntry.pc?.close()
    this.remoteStreams.delete(uid)
    this.onRemoteStreams(new Map(this.remoteStreams))
    const entry = this.createPeer(uid, pair, data.sessionId)
    entry.stopSignal = oldEntry.stopSignal
    this.peers.set(uid, entry)
    await entry.ready
    await entry.pc.setRemoteDescription(new RTCSessionDescription(data.offer))
    entry.remoteDescriptionReady = true
    await this.flushCandidates(entry, data.offerCandidates || [])
    const answer = await entry.pc.createAnswer()
    await entry.pc.setLocalDescription(answer)
    await updateDoc(entry.signalRef, {
      answer: { type: answer.type, sdp: answer.sdp },
      updatedAt: serverTimestamp(),
    })
  }

  async consumeOffererSnapshot(entry, data) {
    if (data.answer && !entry.remoteDescriptionReady) {
      await entry.pc.setRemoteDescription(new RTCSessionDescription(data.answer))
      entry.remoteDescriptionReady = true
    }
    await this.flushCandidates(entry, data.answerCandidates || [])
  }

  async consumeAnswererSnapshot(entry, data) {
    await this.flushCandidates(entry, data.offerCandidates || [])
  }

  async flushCandidates(entry, candidates) {
    for (const candidate of candidates) {
      const key = JSON.stringify(candidate)
      if (!entry.seenCandidates.has(key)) {
        entry.seenCandidates.add(key)
        entry.pendingCandidates.push(candidate)
      }
    }
    if (!entry.remoteDescriptionReady) return
    const pending = entry.pendingCandidates.splice(0)
    for (const candidate of pending) {
      try { await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)) }
      catch (error) { this.onError(error.message) }
    }
  }

  async setDeviceEnabled(kind, enabled) {
    if (this.closed) throw new Error('Your media connection has closed. Re-enter the cinema to reconnect.')
    let track = this.localStream?.getTracks().find((item) => item.kind === kind)
    if (enabled && !track) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: kind === 'audio' ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false,
        video: kind === 'video' ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } } : false,
      })
      track = stream.getTracks()[0]
      this.localStream ||= new MediaStream()
      this.localStream.addTrack(track)
      this.onLocalStream(this.localStream)
      await Promise.all([...this.peers.values()].map((entry) => entry.transceivers.get(kind).sender.replaceTrack(track)))
    }
    if (track && !enabled) {
      track.stop()
      this.localStream.removeTrack(track)
      await Promise.all([...this.peers.values()].map((entry) => entry.transceivers.get(kind).sender.replaceTrack(null)))
    }
  }

  closePeer(uid, entry) {
    entry.stopSignal?.()
    entry.pc?.close()
    this.peers.delete(uid)
    this.remoteStreams.delete(uid)
    this.onRemoteStreams(new Map(this.remoteStreams))
    this.onConnectionChange(uid, 'closed')
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const [uid, entry] of this.peers) this.closePeer(uid, entry)
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
  }
}
