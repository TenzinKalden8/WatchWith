import {
  arrayRemove,
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/firestoreClient'
import { getDisplayName } from './auth'

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function requireDb() {
  if (!db) throw new Error('Firebase is not configured yet. Add the app settings, then reload.')
}

function makeCode() {
  const random = crypto.getRandomValues(new Uint8Array(6))
  return [...random].map((value) => codeAlphabet[value % codeAlphabet.length]).join('')
}

function friendlyError(error) {
  const code = error?.code || ''
  if (code.includes('permission-denied')) return 'You do not have permission to do that in this cinema.'
  if (code.includes('unavailable')) return 'Could not reach the room service. Check your connection and retry.'
  if (code.includes('unauthenticated')) return 'Sign in before joining a cinema.'
  return error?.message || 'Something went wrong. Please try again.'
}

export { friendlyError }

export async function createRoom({ user, name, film, maxParticipants, playbackPermission }) {
  requireDb()
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roomCode = makeCode()
    const roomRef = doc(db, 'rooms', roomCode)
    const memberRef = doc(db, 'rooms', roomCode, 'participants', user.uid)
    try {
      await runTransaction(db, async (transaction) => {
        const existing = await transaction.get(roomRef)
        if (existing.exists()) throw Object.assign(new Error('Room code collision; retrying.'), { code: 'room-code-taken' })
        const now = serverTimestamp()
        transaction.set(roomRef, {
          name: name.trim().slice(0, 60) || 'Movie night',
          hostId: user.uid,
          hostName: getDisplayName(user),
          maxParticipants,
          participantCount: 1,
          participantIds: [user.uid],
          playbackPermission,
          content: {
            provider: 'test',
            contentId: film.id,
            title: film.title,
            detail: film.detail,
            sourceUrl: film.src,
            art: film.art,
          },
          status: 'active',
          privacy: 'private',
          createdAt: now,
          updatedAt: now,
        })
        transaction.set(memberRef, {
          uid: user.uid,
          displayName: getDisplayName(user),
          avatarUrl: user.photoURL || null,
          role: 'host',
          online: true,
          cameraEnabled: false,
          microphoneEnabled: false,
          lastSeen: now,
          joinedAt: now,
        })
      })
      return {
        code: roomCode,
        name: name.trim().slice(0, 60) || 'Movie night',
        hostId: user.uid,
        hostName: getDisplayName(user),
        maxParticipants,
        participantCount: 1,
        playbackPermission,
        content: {
          provider: 'test',
          contentId: film.id,
          title: film.title,
          detail: film.detail,
          sourceUrl: film.src,
          art: film.art,
        },
        status: 'active',
        privacy: 'private',
      }
    } catch (error) {
      if (error.code === 'room-code-taken') continue
      throw new Error(friendlyError(error), { cause: error })
    }
  }
  throw new Error('Could not reserve a room code. Please try again.')
}

export async function previewRoom(roomCode) {
  requireDb()
  const normalizedCode = roomCode.trim().toUpperCase()
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalizedCode)) throw new Error('Enter the six-character code from your invite.')
  try {
    const roomSnapshot = await getDoc(doc(db, 'rooms', normalizedCode))
    if (!roomSnapshot.exists() || roomSnapshot.data().status !== 'active') throw new Error('That cinema could not be found. Check the code with your friend.')
    return { code: normalizedCode, ...roomSnapshot.data() }
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error })
  }
}

export async function joinRoom({ room, user, cameraEnabled = false, microphoneEnabled = false }) {
  requireDb()
  const roomRef = doc(db, 'rooms', room.code)
  const memberRef = doc(db, 'rooms', room.code, 'participants', user.uid)
  try {
    return await runTransaction(db, async (transaction) => {
      const [roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
      ])
      if (!roomSnapshot.exists()) throw new Error('That cinema has ended or the invite is invalid.')
      const data = roomSnapshot.data()
      if (data.status !== 'active') throw new Error('The host has ended this cinema.')
      if (memberSnapshot.exists()) {
        transaction.update(memberRef, {
          online: true,
          cameraEnabled,
          microphoneEnabled,
          lastSeen: serverTimestamp(),
        })
        return { code: room.code, ...data }
      }
      if (data.locked) throw new Error('The host has locked this cinema.')
      if (data.participantCount >= data.maxParticipants) throw new Error('This cinema is full. Ask the host for another seat.')
      const now = serverTimestamp()
      transaction.update(roomRef, {
        participantCount: data.participantCount + 1,
        participantIds: [...new Set([...(data.participantIds || []), user.uid])],
        updatedAt: now,
      })
      transaction.set(memberRef, {
        uid: user.uid,
        displayName: getDisplayName(user),
        avatarUrl: user.photoURL || null,
        role: 'viewer',
        online: true,
        cameraEnabled,
        microphoneEnabled,
        lastSeen: now,
        joinedAt: now,
      })
      return { code: room.code, ...data, participantCount: data.participantCount + 1 }
    })
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error })
  }
}

export function watchRoom(roomCode, onRoom, onMembers, onError) {
  requireDb()
  const roomRef = doc(db, 'rooms', roomCode)
  const membersRef = collection(db, 'rooms', roomCode, 'participants')
  const stopRoom = onSnapshot(roomRef, (snapshot) => {
    if (snapshot.exists()) onRoom({ code: roomCode, ...snapshot.data() })
    else onRoom(null)
  }, onError)
  const stopMembers = onSnapshot(membersRef, (snapshot) => {
    const members = snapshot.docs.map((member) => ({ uid: member.id, ...member.data() }))
    members.sort((a, b) => (a.joinedAt?.toMillis?.() ?? 0) - (b.joinedAt?.toMillis?.() ?? 0))
    onMembers(members)
  }, onError)
  return () => { stopRoom(); stopMembers() }
}

export async function setOnline(roomCode, uid, online) {
  requireDb()
  await updateDoc(doc(db, 'rooms', roomCode, 'participants', uid), {
    online,
    lastSeen: serverTimestamp(),
  })
}

export async function setParticipantMedia(roomCode, uid, cameraEnabled, microphoneEnabled) {
  requireDb()
  await updateDoc(doc(db, 'rooms', roomCode, 'participants', uid), {
    cameraEnabled,
    microphoneEnabled,
    lastSeen: serverTimestamp(),
  })
}

export async function leaveRoom(roomCode, uid) {
  requireDb()
  const roomRef = doc(db, 'rooms', roomCode)
  const memberRef = doc(db, 'rooms', roomCode, 'participants', uid)
  try {
    await runTransaction(db, async (transaction) => {
      const [roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
      ])
      if (!roomSnapshot.exists() || !memberSnapshot.exists()) return
      const room = roomSnapshot.data()
      const member = memberSnapshot.data()
      if (member.role === 'host') {
        const successorSnapshots = await Promise.all((room.participantIds || [])
          .filter((participantId) => participantId !== uid)
          .map((participantId) => transaction.get(doc(db, 'rooms', roomCode, 'participants', participantId))))
        const successors = successorSnapshots
          .filter((candidate) => candidate.exists())
          .sort((a, b) => (a.data().joinedAt?.toMillis?.() ?? 0) - (b.data().joinedAt?.toMillis?.() ?? 0))
        const nextHost = successors[0]
        if (nextHost) transaction.update(doc(db, 'rooms', roomCode, 'participants', nextHost.id), { role: 'host' })
        transaction.update(roomRef, {
          hostId: nextHost?.id ?? null,
          status: nextHost ? room.status : 'closed',
          participantCount: Math.max(0, room.participantCount - 1),
          participantIds: arrayRemove(uid),
          updatedAt: serverTimestamp(),
        })
      } else {
        transaction.update(roomRef, {
          participantCount: Math.max(0, room.participantCount - 1),
          participantIds: arrayRemove(uid),
          updatedAt: serverTimestamp(),
        })
      }
      transaction.delete(memberRef)
    })
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error })
  }
}
