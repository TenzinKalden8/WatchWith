import { useEffect, useRef, useState } from 'react'
import './App.css'
import './Media.css'
import AuthScreen from './components/AuthScreen'
import MediaVideo from './components/MediaVideo'
import { firebaseConfigured } from './firebase/config'
import { testVideoProvider } from './providers/videoProviders'
import { createAccount, getDisplayName, getInitials, signIn, signOutCurrentUser, watchAuth } from './services/auth'

const films = testVideoProvider.listContent()
const inviteCode = new URLSearchParams(location.search).get('room')?.toUpperCase() || ''

function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(firebaseConfigured)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [screen, setScreen] = useState(() => inviteCode ? 'join' : 'home')
  const [authMode, setAuthMode] = useState('signin')
  const [roomName, setRoomName] = useState('Friday Night Movie 🍿')
  const [film, setFilm] = useState(films[0])
  const [maxPeople, setMaxPeople] = useState(6)
  const [permission, setPermission] = useState('Host only')
  const [cam, setCam] = useState(true)
  const [mic, setMic] = useState(true)
  const [code, setCode] = useState('')
  const [joinCode, setJoinCode] = useState(inviteCode)
  const [mode, setMode] = useState('Cinema')
  const [playing, setPlaying] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [reaction, setReaction] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(540)
  const [room, setRoom] = useState(null)
  const [participants, setParticipants] = useState([])
  const [roomBusy, setRoomBusy] = useState(false)
  const [roomError, setRoomError] = useState('')
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [peerStates, setPeerStates] = useState({})
  const [mediaPreviewReady, setMediaPreviewReady] = useState(false)
  const videoRef = useRef(null)
  const toastTimer = useRef(null)
  const mediaSession = useRef(null)
  const participantsRef = useRef(participants)
  const preservePreview = useRef(false)

  const notify = (message) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2400)
  }

  useEffect(() => () => clearTimeout(toastTimer.current), [])
  useEffect(() => {
    if (!firebaseConfigured) return undefined
    return watchAuth((currentUser) => { setUser(currentUser); setAuthLoading(false) })
  }, [])

  useEffect(() => {
    if (!user || screen !== 'cinema' || !room?.code) return undefined
    let active = true
    let stopRoom = () => {}
    let markPresence = () => {}
    let heartbeat = null
    const onPageHide = () => markPresence(false)
    import('./services/rooms').then(({ friendlyError, setOnline, watchRoom }) => {
      if (!active) return
      markPresence = (online) => setOnline(room.code, user.uid, online).catch(() => {})
      stopRoom = watchRoom(room.code, (nextRoom) => {
        if (!active) return
        if (!nextRoom || nextRoom.status !== 'active') {
          setRoomError('The host has ended this cinema.')
          return
        }
        setRoom(nextRoom)
        setRoomName(nextRoom.name)
        setMaxPeople(nextRoom.maxParticipants)
        setPermission(nextRoom.playbackPermission)
        const selectedFilm = films.find((item) => item.id === nextRoom.content?.contentId)
        if (selectedFilm) setFilm(selectedFilm)
      }, (members) => { if (active) setParticipants(members) }, (error) => {
        if (active) setRoomError(friendlyError(error))
      })
      markPresence(true)
      heartbeat = window.setInterval(() => markPresence(true), 25000)
    }).catch(() => { if (active) setRoomError('Could not connect to this cinema. Check your Firebase setup and try again.') })
    window.addEventListener('pagehide', onPageHide)
    return () => {
      active = false
      if (heartbeat) clearInterval(heartbeat)
      window.removeEventListener('pagehide', onPageHide)
      stopRoom()
      markPresence(false)
    }
  }, [screen, room?.code, user?.uid])

  useEffect(() => {
    if (screen !== 'cinema' || !room?.code || !user || !localStream) return undefined
    let session
    let cancelled = false
    import('./services/roomMedia').then(({ RoomMediaSession }) => {
      if (cancelled) return
      session = new RoomMediaSession({
        roomCode: room.code,
        localUid: user.uid,
        localStream,
        onRemoteStreams: setRemoteStreams,
        onConnectionChange: (uid, state) => setPeerStates((previous) => ({ ...previous, [uid]: state })),
        onLocalStream: setLocalStream,
        onError: (message) => setRoomError(message),
      })
      mediaSession.current = session
      session.syncParticipants(participantsRef.current)
    }).catch((error) => setRoomError(error.message || 'Could not start room media.'))
    return () => {
      cancelled = true
      session?.close()
      if (mediaSession.current === session) mediaSession.current = null
      setRemoteStreams(new Map())
      setPeerStates({})
    }
  }, [screen, room?.code, user?.uid, localStream])

  useEffect(() => {
    participantsRef.current = participants
    mediaSession.current?.syncParticipants(participants)
  }, [participants])

  useEffect(() => {
    if (screen !== 'prejoin') return undefined
    let active = true
    let previewStream = null
    setMediaPreviewReady(false)
    import('./services/roomMedia').then(({ requestLocalMedia }) => requestLocalMedia({
      cameraEnabled: cam,
      microphoneEnabled: mic,
    })).then((stream) => {
      if (!active) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      previewStream = stream
      setLocalStream(stream)
      setMediaPreviewReady(true)
    }).catch((error) => {
      if (!active) return
      setRoomError(error.message || 'Could not start your camera or microphone.')
      setMediaPreviewReady(true)
    })
    return () => {
      active = false
      if (preservePreview.current) {
        preservePreview.current = false
        return
      }
      previewStream?.getTracks().forEach((track) => track.stop())
      setLocalStream((current) => current === previewStream ? null : current)
    }
  }, [screen, cam, mic])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { setChatOpen(false); setPeopleOpen(false); setSettingsOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const inviteUrl = () => `${location.origin}${import.meta.env.BASE_URL}?room=${code}`
  const formatTime = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return notify('The sample player is not ready yet.')
    if (video.paused) video.play().catch(() => notify('Video could not load. Check your connection.'))
    else video.pause()
  }

  const submitAuth = async ({ mode: requestedMode, displayName, email, password }) => {
    setAuthBusy(true)
    setAuthError('')
    try {
      const signedInUser = requestedMode === 'register'
        ? await createAccount({ displayName, email, password })
        : await signIn({ email, password })
      setUser(signedInUser)
    } catch (error) {
      const messages = {
        'auth/email-already-in-use': 'That email already has an account. Try signing in.',
        'auth/invalid-email': 'Enter a valid email address.',
        'auth/invalid-credential': 'Email or password did not match.',
        'auth/weak-password': 'Choose a password with at least 6 characters.',
        'auth/too-many-requests': 'Too many attempts. Wait a little and try again.',
        'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication settings.',
      }
      setAuthError(messages[error.code] || error.message || 'Could not sign in. Please try again.')
    } finally { setAuthBusy(false) }
  }

  const handleCreateRoom = async (event) => {
    event?.preventDefault()
    setRoomBusy(true)
    setRoomError('')
    try {
      const { createRoom } = await import('./services/rooms')
      const created = await createRoom({ user, name: roomName, film, maxParticipants: maxPeople, playbackPermission: permission })
      setRoom(created)
      setParticipants([{ uid: user.uid, displayName: getDisplayName(user), role: 'host', online: true }])
      setCode(created.code)
      setScreen('invite')
    } catch (error) { setRoomError(error.message || 'Could not create a cinema.') }
    finally { setRoomBusy(false) }
  }

  const handleFindRoom = async (event) => {
    event?.preventDefault()
    setRoomBusy(true)
    setRoomError('')
    try {
      const { previewRoom } = await import('./services/rooms')
      const found = await previewRoom(joinCode)
      setRoom(found)
      setCode(found.code)
      setRoomName(found.name)
      setMaxPeople(found.maxParticipants)
      setPermission(found.playbackPermission)
      const selectedFilm = films.find((item) => item.id === found.content?.contentId)
      if (selectedFilm) setFilm(selectedFilm)
      setScreen('prejoin')
    } catch (error) { setRoomError(error.message || 'Could not find that cinema.') }
    finally { setRoomBusy(false) }
  }

  const handleJoinRoom = async ({ cameraEnabled = cam, microphoneEnabled = mic } = {}) => {
    if (!room || !user) return
    setRoomBusy(true)
    setRoomError('')
    let stream
    try {
      const hasRequestedTracks = (!cameraEnabled || localStream?.getVideoTracks().some((track) => track.readyState === 'live'))
        && (!microphoneEnabled || localStream?.getAudioTracks().some((track) => track.readyState === 'live'))
      if (localStream && hasRequestedTracks) stream = localStream
      else {
        const { requestLocalMedia } = await import('./services/roomMedia')
        stream = await requestLocalMedia({ cameraEnabled, microphoneEnabled })
      }
      const { joinRoom } = await import('./services/rooms')
      const joined = await joinRoom({ room, user, cameraEnabled, microphoneEnabled })
      setRoom(joined)
      setLocalStream(stream)
      setCam(cameraEnabled)
      setMic(microphoneEnabled)
      preservePreview.current = true
      setScreen('cinema')
      setElapsed(0)
    } catch (error) {
      if (stream && stream !== localStream) stream.getTracks().forEach((track) => track.stop())
      setRoomError(error.message || 'Could not join that cinema.')
    }
    finally { setRoomBusy(false) }
  }

  const handleEnterHostCinema = async () => {
    if (!room?.code || !user) return
    setRoomBusy(true)
    setRoomError('')
    let stream
    try {
      const [{ requestLocalMedia }, { setParticipantMedia }] = await Promise.all([
        import('./services/roomMedia'),
        import('./services/rooms'),
      ])
      stream = await requestLocalMedia({ cameraEnabled: cam, microphoneEnabled: mic })
      await setParticipantMedia(room.code, user.uid, cam, mic)
      setLocalStream(stream)
      setScreen('cinema')
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      setRoomError(error.message || 'Could not open your camera or microphone.')
    } finally { setRoomBusy(false) }
  }

  const toggleRoomDevice = async (kind) => {
    const cameraEnabled = kind === 'video' ? !cam : cam
    const microphoneEnabled = kind === 'audio' ? !mic : mic
    try {
      if (!mediaSession.current) throw new Error('Your media connection is still starting. Try again in a moment.')
      await mediaSession.current.setDeviceEnabled(kind, kind === 'video' ? cameraEnabled : microphoneEnabled)
      setCam(cameraEnabled)
      setMic(microphoneEnabled)
      const { setParticipantMedia } = await import('./services/rooms')
      await setParticipantMedia(room.code, user.uid, cameraEnabled, microphoneEnabled)
    } catch (error) { notify(error.message || 'Could not change your camera or microphone.') }
  }

  const handleLeaveRoom = async () => {
    if (!room?.code || !user) { setScreen('home'); return }
    setRoomBusy(true)
    setRoomError('')
    try {
      const { leaveRoom } = await import('./services/rooms')
      await leaveRoom(room.code, user.uid)
      mediaSession.current?.close()
      if (!mediaSession.current) localStream?.getTracks().forEach((track) => track.stop())
      mediaSession.current = null
      videoRef.current?.pause()
      setPlaying(false)
      setScreen('home')
      setParticipants([])
      setRoom(null)
      setLocalStream(null)
      setRemoteStreams(new Map())
    } catch (error) { setRoomError(error.message || 'Could not leave the room. Please retry.') }
    finally { setRoomBusy(false) }
  }

  const sendMessage = (event) => {
    event.preventDefault()
    if (!draft.trim()) return
    setMessages((items) => [...items, { name: getDisplayName(user), text: draft.trim(), time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }])
    setDraft('')
  }
  const sendReaction = (emoji) => { setReaction(emoji); setTimeout(() => setReaction(''), 1600) }

  if (authLoading) return <main className="auth-page"><div className="auth-card"><span className="eyebrow">SOCIAL CINEMA</span><h1>Finding your seat…</h1></div></main>
  if (!firebaseConfigured) return <main className="auth-page"><section className="firebase-setup"><span className="eyebrow">PHASE 2 SETUP</span><h1>Connect your cinema.</h1><p>Authentication and rooms are ready to use once a Firebase web app is connected.</p><ol><li>Create a Firebase project for Social Cinema.</li><li>Register a web app, enable Email/Password Authentication, and create a Firestore database.</li><li>Add the Firebase web configuration to <code>.env.local</code> and GitHub Actions variables.</li></ol><p>Follow the Firebase setup section in the README. Never commit private credentials.</p></section></main>
  if (!user) return <AuthScreen onSubmit={submitAuth} error={authError} busy={authBusy}/>

  if (screen === 'cinema') {
    return <main className={`cinema-page mode-${mode.toLowerCase()}`}>
      <header className="cinema-top"><button className="back-button" disabled={roomBusy} onClick={handleLeaveRoom}>← <span>Leave cinema</span></button><div className="room-heading"><span className="live-dot"/><div><b>{room?.name || roomName}</b><small>Private cinema · <span>{room?.hostId === user.uid ? '👑 You’re hosting' : `Hosted by ${participants.find((participant) => participant.role === 'host')?.displayName || 'your friend'}`}</span></small></div></div><div className="top-actions"><button className="icon-button connection" title="Room connected">◉ <span>{participants.filter((participant) => participant.online).length} online</span></button><button className="invite-button" onClick={() => { navigator.clipboard?.writeText(inviteUrl()); notify('Invite link copied') }}>Invite friends <span>↗</span></button><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Room settings">⚙</button></div></header>
      <section className="cinema-stage"><div className="film-meta"><span className="provider-pill">TEST VIDEO</span><b>{film.title}</b><small>{film.detail}</small></div><div className="screen-wrap"><div className="movie-screen"><video ref={videoRef} src={film.src} playsInline preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 540)} onClick={togglePlayback}/>{!playing && <button className="big-play" onClick={togglePlayback} aria-label="Play movie">▶</button>}<div className="film-vignette"/></div></div>
        {mode !== 'Focus' && <div className="friend-rail" aria-label="Cinema participants">{participants.slice(0, mode === 'Social' ? 4 : 2).map((participant, index) => {
          const isLocal = participant.uid === user.uid
          const stream = isLocal ? localStream : remoteStreams.get(participant.uid)
          const cameraEnabled = isLocal ? cam : participant.cameraEnabled
          const microphoneEnabled = isLocal ? mic : participant.microphoneEnabled
          const hasVideo = cameraEnabled && stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled)
          return <div className={`camera-tile participant-tile participant-tile-${index}`} key={participant.uid}>
            {hasVideo ? <MediaVideo stream={stream} muted={isLocal}/> : <div className={`avatar ${['art-coral', 'art-blue', 'art-gold', 'art-violet'][index]}`}>{participant.displayName?.slice(0, 2).toUpperCase() || '👤'}</div>}
            <div className="tile-name"><span className={peerStates[participant.uid] === 'connected' ? 'voice-dot' : ''}/>{isLocal ? 'You' : participant.displayName}{participant.role === 'host' ? ' · HOST' : ''}</div>
            <span className="tile-status">{!cameraEnabled ? 'CAMERA OFF' : hasVideo ? (peerStates[participant.uid] === 'connected' || isLocal ? 'LIVE' : 'CONNECTING') : 'WAITING FOR VIDEO'}</span>
            {!microphoneEnabled && <span className="tile-mute">MIC OFF</span>}
          </div>
        })}</div>}
        {participants.length < 2 && <div className="empty-friends">The movie is ready. Invite a friend to take the other seat.</div>}
        <div className="reaction-float" aria-live="polite">{reaction}</div><div className="movie-caption"><span className="sound-bars"><i/><i/><i/><i/></span><span>Movie night, together</span></div>
      </section>
      <footer className="player-bar"><div className="playback"><button className="player-icon" onClick={togglePlayback} aria-label={playing ? 'Pause movie' : 'Play movie'}>{playing ? 'Ⅱ' : '▶'}</button><span className="timecode">{formatTime(elapsed)} <i>/</i> {formatTime(duration)}</span><input className="timeline" type="range" min="0" max={duration || 540} value={elapsed} onChange={(event) => { const time = Number(event.target.value); setElapsed(time); if (videoRef.current) videoRef.current.currentTime = time }} aria-label="Movie position"/><button className="player-icon volume" onClick={() => notify('Volume controls are on your device')} aria-label="Volume">◖))</button></div><div className="social-controls"><div className="emoji-row">{['❤️', '😂', '😭', '🔥', '😱'].map((emoji) => <button key={emoji} onClick={() => sendReaction(emoji)} aria-label={`React ${emoji}`}>{emoji}</button>)}</div><span className="control-divider"/><button className={`round-control ${mic ? '' : 'off'}`} onClick={() => toggleRoomDevice('audio')} aria-label="Toggle microphone">{mic ? '♩' : '♩̸'}</button><button className={`round-control ${cam ? '' : 'off'}`} onClick={() => toggleRoomDevice('video')} aria-label="Toggle camera">{cam ? '◉' : '⊘'}</button><button className={`round-control ${chatOpen ? 'selected' : ''}`} onClick={() => { setChatOpen(!chatOpen); setPeopleOpen(false) }} aria-label="Open chat">▱</button><button className={`round-control ${peopleOpen ? 'selected' : ''}`} onClick={() => { setPeopleOpen(!peopleOpen); setChatOpen(false) }} aria-label="Participants">♙<span className="people-count">{participants.length}</span></button><button className="round-control" onClick={() => setSettingsOpen(true)} aria-label="Settings">⚙</button></div></footer>
      {roomError && <div role="alert" className="room-error-banner">{roomError}<button onClick={() => setRoomError('')}>×</button></div>}
      {chatOpen && <aside className="floating-panel chat-panel"><div className="panel-heading"><div><span className="panel-kicker">THE LOBBY</span><h2>Room chat <small>{participants.length}</small></h2></div><button className="icon-button" onClick={() => setChatOpen(false)}>×</button></div><div className="message-list">{messages.length ? messages.map((message, index) => <div className="message" key={`${message.time}-${index}`}><div className="mini-avatar art-violet">{message.name.slice(0, 2).toUpperCase()}</div><div><div className="message-top"><b>{message.name}</b><time>{message.time}</time></div><p>{message.text}</p></div></div>) : <p className="empty-chat">Room chat becomes real in the Social Features phase. Send a quick note in this local preview.</p>}</div><form className="chat-compose" onSubmit={sendMessage}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Say something…" aria-label="Chat message"/><button type="submit" aria-label="Send message">↑</button></form></aside>}
      {peopleOpen && <aside className="floating-panel people-panel"><div className="panel-heading"><div><span className="panel-kicker">AROUND THE SCREEN</span><h2>In this cinema <small>{participants.length} / {room?.maxParticipants || maxPeople}</small></h2></div><button className="icon-button" onClick={() => setPeopleOpen(false)}>×</button></div>{participants.map((participant) => <div className="participant-row" key={participant.uid}><div className="mini-avatar art-violet">{participant.displayName?.slice(0, 2).toUpperCase() || '👤'}</div><div><b>{participant.displayName} {participant.role === 'host' && <span className="host-tag">HOST</span>}</b><small>{participant.uid === user.uid ? 'You' : participant.online ? 'Online' : 'Last seen recently'} · {participant.cameraEnabled ? 'Camera on' : 'Camera off'} · {participant.microphoneEnabled ? 'Mic on' : 'Muted'}</small></div><span className="participant-signal">{participant.online ? '●' : '○'}</span></div>)}<button className="panel-invite" onClick={() => { navigator.clipboard?.writeText(inviteUrl()); notify('Invite link copied') }}>＋ Copy invite link</button></aside>}
      {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><section className="settings-modal" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><span className="panel-kicker">MAKE IT YOURS</span><h2>Cinema settings</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}>×</button></div><label className="setting-label">Viewing mode</label><div className="mode-picker">{['Cinema', 'Social', 'Focus'].map((item) => <button className={mode === item ? 'active' : ''} key={item} onClick={() => setMode(item)}><b>{item === 'Cinema' ? '▣' : item === 'Social' ? '▦' : '◫'}</b><span>{item}</span><small>{item === 'Cinema' ? 'Movie takes the stage' : item === 'Social' ? 'Bring friends closer' : 'Just the movie'}</small></button>)}</div><label className="setting-label">Who can control playback?</label><select value={room?.playbackPermission || permission} disabled><option>Host only</option><option>Host + moderators</option><option>Everyone</option></select><div className="settings-note"><span>🔒</span><p>Your cinema is private. Only people with the invite link can join. Changes to settings are not available in this phase.</p></div><button className="danger-button" onClick={handleLeaveRoom}>{room?.hostId === user.uid ? 'End cinema and transfer host' : 'Leave cinema'}</button></section></div>}
      {toast && <div className="toast-note">{toast}</div>}
    </main>
  }

  if (screen === 'create') return <main className="setup-page"><header className="simple-top"><button className="brand-mark" onClick={() => setScreen('home')}>◉ <span>social cinema</span></button><span className="step-note">YOUR CINEMA, YOUR RULES</span></header><section className="setup-layout"><div className="setup-copy"><button className="text-back" onClick={() => setScreen('home')}>← Back to home</button><span className="eyebrow">MAKE IT A MOVIE NIGHT</span><h1>Set the scene.</h1><p>Pick a movie, gather your people, and make a little room for magic.</p><div className="setup-illustration"><span>✦</span><div className="illustration-window"><i/><i/><i/><b>▶</b></div><div className="seat seat-a">TN</div><div className="seat seat-b">MC</div><div className="seat seat-c">EB</div><small>YOUR PRIVATE CINEMA</small></div></div><form className="setup-form" onSubmit={handleCreateRoom}><label className="field-label">Give your cinema a name<input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={60}/></label><div className="field-label">Choose what to watch <span className="field-hint">More providers coming soon</span></div><div className="film-options">{films.map((item) => <button type="button" className={`film-option ${film.id === item.id ? 'active' : ''}`} key={item.id} onClick={() => setFilm(item)}><div className={`film-art ${item.art}`}><span>{item.id === 'bbb' ? 'BUNNY' : 'STEEL'}</span><b>▶</b></div><span className="film-option-copy"><b>{item.title}</b><small>{item.detail}</small><em>✓ Licensed test video</em></span><span className="radio-check">{film.id === item.id ? '●' : '○'}</span></button>)}</div><div className="form-columns"><label className="field-label">Maximum guests<select value={maxPeople} onChange={(event) => setMaxPeople(Number(event.target.value))}>{[2, 4, 6, 8].map((number) => <option key={number} value={number}>{number} people</option>)}</select></label><label className="field-label">Playback controls<select value={permission} onChange={(event) => setPermission(event.target.value)}><option>Host only</option><option>Host + moderators</option><option>Everyone</option></select></label></div>{roomError && <div className="form-error" role="alert">{roomError}</div>}<button className="create-submit" disabled={roomBusy}>{roomBusy ? 'Creating your cinema…' : 'Create your cinema'} <span>→</span></button><p className="form-legal">Private invite link · Hosted by {getDisplayName(user)}</p></form></section>{toast && <div className="toast-note">{toast}</div>}</main>

  if (screen === 'invite') return <main className="invite-page"><header className="simple-top"><button className="brand-mark" onClick={() => setScreen('home')}>◉ <span>social cinema</span></button><span className="step-note">CINEMA CREATED ✦</span></header><section className="invite-card"><div className="success-orbit">✦</div><span className="eyebrow">THE RED CARPET IS READY</span><h1>{room?.name || roomName}</h1><p>Your cinema is ready. Send the invite and save them a seat.</p><div className="invite-preview"><div className={`film-art ${film.art}`}><span>{film.id === 'bbb' ? 'BUNNY' : 'STEEL'}</span></div><div><b>{film.title}</b><small>{film.detail} · {maxPeople} seats</small><span>◉ Private cinema</span></div><span className="preview-popcorn">🍿</span></div><div className="code-label">YOUR ROOM CODE</div><div className="room-code">{code.split('').map((letter, index) => <b key={`${letter}-${index}`}>{letter}</b>)}</div><div className="invite-actions"><button className="share-primary" onClick={() => { navigator.clipboard?.writeText(inviteUrl()); notify('Invite link copied — send it to your friends!') }}>↗ <span>Copy invite link</span></button><button className="share-secondary" onClick={() => { navigator.clipboard?.writeText(code); notify('Room code copied') }}>▣ <span>Copy code</span></button></div><div className="prejoin-toggles"><button onClick={() => setCam(!cam)}>{cam ? '▣' : '▧'} Camera <b>{cam ? 'On' : 'Off'}</b></button><button onClick={() => setMic(!mic)}>{mic ? '♫' : '♩'} Microphone <b>{mic ? 'On' : 'Off'}</b></button></div>{roomError && <div className="form-error" role="alert">{roomError}</div>}<button className="enter-cinema" disabled={roomBusy} onClick={handleEnterHostCinema}>{roomBusy ? 'Connecting media…' : 'Enter your cinema'} <span>→</span></button><button className="skip-link" disabled={roomBusy} onClick={handleEnterHostCinema}>I’ll invite people later</button></section>{toast && <div className="toast-note">{toast}</div>}</main>

  if (screen === 'join') return <main className="invite-page"><header className="simple-top"><button className="brand-mark" onClick={() => setScreen('home')}>◉ <span>social cinema</span></button><span className="step-note">YOUR PEOPLE SAVED YOU A SEAT</span></header><section className="invite-card join-code-card"><div className="success-orbit">⌁</div><span className="eyebrow">COME ON IN</span><h1>Join a cinema.</h1><p>Enter the room code from your invite. Your friends are saving you the good seat.</p><form onSubmit={handleFindRoom}><label className="code-input-label">ROOM CODE<input autoFocus value={joinCode} maxLength={6} placeholder="E.G. AB7K92" onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}/></label>{roomError && <div className="form-error" role="alert">{roomError}</div>}<button className="enter-cinema" disabled={joinCode.length !== 6 || roomBusy}>{roomBusy ? 'Finding cinema…' : 'Find my cinema'} <span>→</span></button></form><button className="skip-link" onClick={() => setScreen('home')}>← Back to home</button></section>{toast && <div className="toast-note">{toast}</div>}</main>

  if (screen === 'prejoin') return <main className="prejoin-page">
    <header className="simple-top"><button className="brand-mark" onClick={() => setScreen('home')}>◉ <span>social cinema</span></button><span className="step-note">YOU’RE ON THE LIST</span></header>
    <section className="prejoin-card">
      <div className="preview-camera">
        {cam && localStream?.getVideoTracks().some((track) => track.readyState === 'live')
          ? <MediaVideo stream={localStream} muted/>
          : <div className="preview-person"><div className="avatar art-violet">{getInitials(user)}</div><span>{mediaPreviewReady ? 'Camera is off' : 'Starting your camera…'}</span></div>}
        <span className="preview-status">● CAMERA {cam ? 'ON' : 'OFF'} · MIC {mic ? 'ON' : 'OFF'}</span>
      </div>
      <div className="eyebrow">PULL UP A SEAT</div><h1>{room?.name || roomName}</h1>
      <p>Hosted by <b>{room?.hostName || participants.find((participant) => participant.role === 'host')?.displayName || 'your friend'}</b> <span>·</span> <b>{room?.participantCount || 1} / {room?.maxParticipants || maxPeople} seats filled</b></p>
      <div className="prejoin-toggles"><button onClick={() => { setRoomError(''); setCam(!cam) }}>{cam ? '▣' : '▧'} Camera <b>{cam ? 'On' : 'Off'}</b></button><button onClick={() => { setRoomError(''); setMic(!mic) }}>{mic ? '♫' : '♩'} Microphone <b>{mic ? 'On' : 'Off'}</b></button></div>
      {roomError && <div className="form-error" role="alert">{roomError}</div>}
      <button className="create-submit" disabled={roomBusy || !mediaPreviewReady} onClick={() => handleJoinRoom()}>{roomBusy ? 'Joining cinema…' : 'Join cinema'} <span>→</span></button>
      <button className="skip-link" disabled={roomBusy || !mediaPreviewReady} onClick={() => handleJoinRoom({ cameraEnabled: false, microphoneEnabled: false })}>Join without camera or mic</button>
    </section>{toast && <div className="toast-note">{toast}</div>}
  </main>

  return <main className="home-page"><header className="home-top"><button className="brand-mark"><span className="brand-symbol">◉</span><span>social cinema</span></button><div className="home-profile"><span className="signed-in-name">{getDisplayName(user)}</span><button className="avatar profile-avatar art-violet" title="Sign out" onClick={async () => { await signOutCurrentUser(); setRoom(null); setScreen('home') }}>{getInitials(user)}</button></div></header><section className="welcome-row"><div><span className="eyebrow">YOUR PRIVATE MOVIE CLUB</span><h1>Evenings are better <span>together.</span></h1><p>Your people, your movie, one little corner of the internet.</p></div><div className="welcome-popcorn">✦</div></section><section className="hero-actions"><button className="action-card create-card" onClick={() => { setRoomError(''); setScreen('create') }}><span className="card-icon">✳</span><span className="action-eyebrow">START A WATCH PARTY</span><b>Create a cinema</b><small>Pick a film and invite your favorite people.</small><span className="card-arrow">↗</span><span className="card-glow"/></button><button className="action-card join-card" onClick={() => { setRoomError(''); setJoinCode(''); setScreen('join') }}><span className="card-icon">⌁</span><span className="action-eyebrow">GOT AN INVITE?</span><b>Join a cinema</b><small>Grab your seat. The previews are on.</small><span className="card-arrow">↗</span></button></section><div className="section-heading"><div><span className="eyebrow">YOUR WATCH PARTY SPACE</span><h2>Recent cinemas</h2></div></div><section className="no-recent"><div>✦</div><b>Your next favorite movie night starts here.</b><span>Create a cinema or join a friend with their invite code.</span></section><footer className="home-footer"><span>◉ <b>SOCIAL CINEMA</b></span><span>Make room for a little togetherness.</span><button className="signout-link" onClick={async () => { await signOutCurrentUser(); setRoom(null) }}>Sign out</button></footer>{toast && <div className="toast-note">{toast}</div>}</main>
}

export default App
