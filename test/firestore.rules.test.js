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
  return { uid, displayName: uid, avatarUrl: null, role, online: true, lastSeen: now, joinedAt: now }
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
    transaction.set(roomRef, { ...roomRecord('host-a'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
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
