import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase/firestoreClient'
import { friendlyError } from './rooms'

const allowedReactions = ['❤️', '😂', '😭', '🔥', '😱', '👏', '💀']

export function watchMessages(roomCode, onMessages, onError) {
  const messages = query(
    collection(db, 'rooms', roomCode, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(100),
  )
  return onSnapshot(messages, (snapshot) => {
    onMessages(snapshot.docs.map((item) => {
      const message = item.data()
      return {
        id: item.id,
        ...message,
        time: message.createdAt?.toDate?.().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '',
      }
    }).reverse())
  }, onError)
}

export async function sendRoomMessage({ roomCode, user, displayName, text }) {
  const normalized = text.trim()
  if (!normalized || normalized.length > 500) throw new Error('Messages must be between 1 and 500 characters.')
  try {
    await addDoc(collection(db, 'rooms', roomCode, 'messages'), {
      uid: user.uid,
      displayName,
      avatarUrl: user.photoURL || null,
      text: normalized,
      createdAt: serverTimestamp(),
    })
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error })
  }
}

export async function sendRoomReaction(roomCode, uid, emoji) {
  if (!allowedReactions.includes(emoji)) throw new Error('That reaction is not supported.')
  try {
    await updateDoc(doc(db, 'rooms', roomCode, 'participants', uid), {
      lastReaction: emoji,
      reactionAt: serverTimestamp(),
    })
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error })
  }
}

export { allowedReactions }
