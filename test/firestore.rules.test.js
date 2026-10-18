import { after, before, beforeEach, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-social-cinema'
let testEnv

const content = {
  provider: 'test',
  contentId: 'bbb',
  title: 'Big Buck Bunny',
  detail: 'Blender · 2008 · 9 min',
  sourceUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  art: 'bunny',
}

function roomRecord(hostId, maxParticipants = 6, participantIds = [hostId]) {
  return {
    name: 'Test cinema',
    hostId,
    hostName: hostId,
    maxParticipants,
    participantCount: participantIds.length,
    participantIds,
    playbackPermission: 'Host only',
    content,
    status: 'active',
    privacy: 'private',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function memberRecord(uid, role) {
  const now = new Date()
  return {
    uid,
    displayName: uid,
    avatarUrl: null,
    role,
    online: true,
    cameraEnabled: false,
    microphoneEnabled: false,
    lastReaction: null,
    reactionAt: null,
    lastSeen: now,
    joinedAt: now,
  }
}

async function seedRoom(code, hostId, maxParticipants = 6, participantIds = [hostId]) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'rooms', code), roomRecord(hostId, maxParticipants, participantIds))
    for (const uid of participantIds) {
      await setDoc(doc(db, 'rooms', code, 'participants', uid), memberRecord(uid, uid === hostId ? 'host' : 'viewer'))
    }
  })
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => testEnv.clearFirestore())
after(async () => testEnv.cleanup())

test('authenticated host can atomically create a room and host membership', async () => {
  const db = testEnv.authenticatedContext('host-a').firestore()
  const roomRef = doc(db, 'rooms', 'ABC234')
  const memberRef = doc(db, 'rooms', 'ABC234', 'participants', 'host-a')
  await assertSucceeds(runTransaction(db, async (transaction) => {
    const existing = await transaction.get(roomRef)
    assert.equal(existing.exists(), false)
    transaction.set(roomRef, {
      ...roomRecord('host-a'),
      playback: { state: 'paused', position: 0, updatedAt: serverTimestamp(), controllerId: 'host-a' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    transaction.set(memberRef, { ...memberRecord('host-a', 'host'), joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })
  }))
})

test('room code opens a private preview, but non-members cannot list its participants', async () => {
  await seedRoom('ABC234', 'host-a')
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore()
  await assertSucceeds(getDoc(doc(outsiderDb, 'rooms', 'ABC234')))
  await assertFails(getDocs(collection(outsiderDb, 'rooms', 'ABC234', 'participants')))
})

test('joining atomically increments capacity and adds only the caller', async () => {
  await seedRoom('ABC234', 'host-a', 2)
  const guestDb = testEnv.authenticatedContext('guest-b').firestore()
  const roomRef = doc(guestDb, 'rooms', 'ABC234')
  const memberRef = doc(guestDb, 'rooms', 'ABC234', 'participants', 'guest-b')
  await assertSucceeds(runTransaction(guestDb, async (transaction) => {
    const snapshot = await transaction.get(roomRef)
    const room = snapshot.data()
    transaction.update(roomRef, {
      participantCount: room.participantCount + 1,
      participantIds: [...room.participantIds, 'guest-b'],
      updatedAt: serverTimestamp(),
    })
    transaction.set(memberRef, { ...memberRecord('guest-b', 'viewer'), joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })
  }))
  await assertSucceeds(getDoc(doc(guestDb, 'rooms', 'ABC234', 'participants', 'guest-b')))
})

test('room members can exchange signaling with their direct peer only', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const hostDb = testEnv.authenticatedContext('host-a').firestore()
  const guestDb = testEnv.authenticatedContext('guest-b').firestore()
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore()
  const signalRef = doc(guestDb, 'rooms', 'ABC234', 'signals', 'guest-b__host-a')

  await assertSucceeds(getDoc(signalRef))
  await assertSucceeds(setDoc(signalRef, {
    offererId: 'guest-b',
    answererId: 'host-a',
    sessionId: 'session-1',
    offer: null,
    answer: null,
    offerCandidates: [],
    answerCandidates: [],
    updatedAt: serverTimestamp(),
  }))
  await assertFails(getDoc(doc(outsiderDb, 'rooms', 'ABC234', 'signals', 'guest-b__host-a')))
  await assertSucceeds(updateDoc(doc(hostDb, 'rooms', 'ABC234', 'signals', 'guest-b__host-a'), {
    answer: { type: 'answer', sdp: 'test-sdp' },
    updatedAt: serverTimestamp(),
  }))
})

test('room capacity cannot be exceeded, and a viewer cannot change host permissions', async () => {
  await seedRoom('ABC234', 'host-a', 2, ['host-a', 'guest-b'])
  const guestDb = testEnv.authenticatedContext('guest-c').firestore()
  const roomRef = doc(guestDb, 'rooms', 'ABC234')
  const memberRef = doc(guestDb, 'rooms', 'ABC234', 'participants', 'guest-c')
  await assertFails(runTransaction(guestDb, async (transaction) => {
    const snapshot = await transaction.get(roomRef)
    const room = snapshot.data()
    transaction.update(roomRef, {
      participantCount: room.participantCount + 1,
      participantIds: [...room.participantIds, 'guest-c'],
      updatedAt: serverTimestamp(),
    })
    transaction.set(memberRef, { ...memberRecord('guest-c', 'viewer'), joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })
  }))
  const viewerDb = testEnv.authenticatedContext('guest-b').firestore()
  await assertFails(updateDoc(doc(viewerDb, 'rooms', 'ABC234'), { playbackPermission: 'Everyone' }))
})

test('host can update the authoritative playback state', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const hostDb = testEnv.authenticatedContext('host-a').firestore()
  await assertSucceeds(updateDoc(doc(hostDb, 'rooms', 'ABC234'), {
    playback: { state: 'playing', position: 42.5, updatedAt: serverTimestamp(), controllerId: 'host-a' },
    updatedAt: serverTimestamp(),
  }))
})

test('viewer cannot control host-only playback or claim another controller identity', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const viewerDb = testEnv.authenticatedContext('guest-b').firestore()
  await assertFails(updateDoc(doc(viewerDb, 'rooms', 'ABC234'), {
    playback: { state: 'paused', position: 42.5, updatedAt: serverTimestamp(), controllerId: 'host-a' },
    updatedAt: serverTimestamp(),
  }))
})

test('everyone playback permission allows a member to control playback', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'rooms', 'ABC234'), { playbackPermission: 'Everyone' })
  })
  const viewerDb = testEnv.authenticatedContext('guest-b').firestore()
  await assertSucceeds(updateDoc(doc(viewerDb, 'rooms', 'ABC234'), {
    playback: { state: 'playing', position: 18, updatedAt: serverTimestamp(), controllerId: 'guest-b' },
    updatedAt: serverTimestamp(),
  }))
})

test('room members can exchange chat messages, but cannot impersonate another sender', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const guestDb = testEnv.authenticatedContext('guest-b').firestore()
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore()
  const messageRef = doc(guestDb, 'rooms', 'ABC234', 'messages', 'message-1')
  await assertSucceeds(setDoc(messageRef, {
    uid: 'guest-b',
    displayName: 'Guest B',
    avatarUrl: null,
    text: 'Hello from the back row',
    createdAt: serverTimestamp(),
  }))
  await assertFails(setDoc(doc(guestDb, 'rooms', 'ABC234', 'messages', 'spoofed'), {
    uid: 'host-a',
    displayName: 'Host',
    avatarUrl: null,
    text: 'Impersonated message',
    createdAt: serverTimestamp(),
  }))
  await assertFails(getDoc(doc(outsiderDb, 'rooms', 'ABC234', 'messages', 'message-1')))
})

test('host can promote and demote moderators, and moderators control playback only when enabled', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const hostDb = testEnv.authenticatedContext('host-a').firestore()
  const viewerDb = testEnv.authenticatedContext('guest-b').firestore()
  const participantRef = doc(hostDb, 'rooms', 'ABC234', 'participants', 'guest-b')
  await assertSucceeds(updateDoc(participantRef, { role: 'moderator' }))
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'rooms', 'ABC234'), { playbackPermission: 'Host + moderators' })
  })
  await assertSucceeds(updateDoc(doc(viewerDb, 'rooms', 'ABC234'), {
    playback: { state: 'playing', position: 22, updatedAt: serverTimestamp(), controllerId: 'guest-b' },
    updatedAt: serverTimestamp(),
  }))
  await assertSucceeds(updateDoc(participantRef, { role: 'viewer' }))
  await assertFails(updateDoc(doc(viewerDb, 'rooms', 'ABC234'), {
    playback: { state: 'paused', position: 24, updatedAt: serverTimestamp(), controllerId: 'guest-b' },
    updatedAt: serverTimestamp(),
  }))
})

test('participants can publish only supported reactions to their own records', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const guestDb = testEnv.authenticatedContext('guest-b').firestore()
  const hostDb = testEnv.authenticatedContext('host-a').firestore()
  await assertSucceeds(updateDoc(doc(guestDb, 'rooms', 'ABC234', 'participants', 'guest-b'), {
    lastReaction: '😂',
    reactionAt: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(guestDb, 'rooms', 'ABC234', 'participants', 'host-a'), {
    lastReaction: '🔥',
    reactionAt: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(hostDb, 'rooms', 'ABC234', 'participants', 'host-a'), {
    lastReaction: 'not an emoji',
    reactionAt: serverTimestamp(),
  }))
})

test('only the current member can write their own presence heartbeat', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const guestDb = testEnv.authenticatedContext('guest-b').firestore()
  const otherDb = testEnv.authenticatedContext('host-a').firestore()
  await assertSucceeds(updateDoc(doc(guestDb, 'rooms', 'ABC234', 'participants', 'guest-b'), { online: false, lastSeen: serverTimestamp() }))
  await assertFails(updateDoc(doc(otherDb, 'rooms', 'ABC234', 'participants', 'guest-b'), { online: false, lastSeen: serverTimestamp() }))
  await assertFails(deleteDoc(doc(guestDb, 'rooms', 'ABC234', 'participants', 'host-a')))
})

test('host departure promotes an existing participant and removes the old membership', async () => {
  await seedRoom('ABC234', 'host-a', 4, ['host-a', 'guest-b'])
  const hostDb = testEnv.authenticatedContext('host-a').firestore()
  const roomRef = doc(hostDb, 'rooms', 'ABC234')
  const hostRef = doc(hostDb, 'rooms', 'ABC234', 'participants', 'host-a')
  const successorRef = doc(hostDb, 'rooms', 'ABC234', 'participants', 'guest-b')
  await assertSucceeds(runTransaction(hostDb, async (transaction) => {
    const [roomSnapshot, hostSnapshot, successorSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(hostRef),
      transaction.get(successorRef),
    ])
    assert.equal(hostSnapshot.exists(), true)
    assert.equal(successorSnapshot.exists(), true)
    const room = roomSnapshot.data()
    transaction.update(successorRef, { role: 'host' })
    transaction.update(roomRef, {
      hostId: 'guest-b',
      participantCount: room.participantCount - 1,
      participantIds: room.participantIds.filter((uid) => uid !== 'host-a'),
      updatedAt: serverTimestamp(),
    })
    transaction.delete(hostRef)
  }))
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('guest-b').firestore(), 'rooms', 'ABC234')))
})
