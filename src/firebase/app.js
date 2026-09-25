import { getApp, getApps, initializeApp } from 'firebase/app'
import { firebaseConfig, firebaseConfigured } from './config'

export const firebaseApp = firebaseConfigured
  ? getApps().length ? getApp() : initializeApp(firebaseConfig)
  : null
