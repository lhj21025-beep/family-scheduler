import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const config = {
  apiKey: 'AIzaSyBWaY0U1FVizj2qKNxC2brHihGW6E2HMR8',
  authDomain: 'family-scheduler-44a8e.firebaseapp.com',
  projectId: 'family-scheduler-44a8e',
  storageBucket: 'family-scheduler-44a8e.firebasestorage.app',
  messagingSenderId: '875374000769',
  appId: '1:875374000769:web:1367592d03c5b7c8c8ab80',
}

export const firebaseEnabled = true
export const firebaseApp = initializeApp(config)

// IndexedDB local cache reduces unnecessary re-downloads when reopening or
// navigating around data that is already cached on this device.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
export const auth = getAuth(firebaseApp)
