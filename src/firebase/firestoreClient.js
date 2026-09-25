import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { firebaseApp } from './app'

export const db = firebaseApp ? getFirestore(firebaseApp) : null

if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' && db) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
