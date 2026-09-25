import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { firebaseApp } from './app'

export const auth = firebaseApp ? getAuth(firebaseApp) : null

if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true' && auth) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}
