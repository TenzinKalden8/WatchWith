import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth'
import { auth } from '../firebase/authClient'

function requireFirebase() {
  if (!auth) throw new Error('Firebase is not configured yet. Add the app settings, then reload.')
}

export function watchAuth(callback) {
  if (!auth) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function createAccount({ displayName, email, password }) {
  requireFirebase()
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
  const name = displayName.trim()
  await updateProfile(credential.user, { displayName: name })
  return credential.user
}

export async function signIn({ email, password }) {
  requireFirebase()
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password)
  return credential.user
}

export async function signOutCurrentUser() {
  requireFirebase()
  await signOut(auth)
}

export function getDisplayName(user) {
  return user?.displayName || user?.email?.split('@')[0] || 'Cinema guest'
}

export function getInitials(user) {
  return getDisplayName(user).split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
}
