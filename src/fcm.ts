import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging'
import { doc, setDoc } from 'firebase/firestore'
import { db, firebaseApp } from './firebase'

const FAMILY_ID = 'family-main'
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? ''

export async function registerPushForMember(memberId: 'me' | 'wife' | 'son') {
  if (!VAPID_KEY) throw new Error('VITE_FIREBASE_VAPID_KEY가 설정되지 않았습니다.')
  if (!('Notification' in window) || !('serviceWorker' in navigator)) throw new Error('이 기기는 웹 푸시를 지원하지 않습니다.')
  if (!(await isSupported())) throw new Error('이 브라우저에서는 Firebase 웹 푸시를 지원하지 않습니다.')

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('알림 권한이 허용되지 않았습니다.')

  const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  const messaging = getMessaging(firebaseApp)
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  })
  if (!token) throw new Error('FCM 등록 토큰을 받지 못했습니다.')

  const deviceKey = await tokenKey(token)
  await setDoc(doc(db, 'familyData', FAMILY_ID), {
    [`pushTokens.${deviceKey}`]: {
      token,
      memberId,
      updatedAt: new Date().toISOString(),
    },
  }, { merge: true })

  return token
}

async function tokenKey(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function listenForegroundPush(onPush: (title: string, body: string) => void) {
  if (!('Notification' in window) || !(await isSupported())) return () => undefined
  try {
    const messaging = getMessaging(firebaseApp)
    return onMessage(messaging, payload => {
      const title = payload.notification?.title ?? payload.data?.title ?? '우리 가족 스케줄러'
      const body = payload.notification?.body ?? payload.data?.body ?? '새로운 가족 알림이 있습니다.'
      onPush(title, body)
    })
  } catch (error) {
    console.error('FCM foreground listener failed', error)
    return () => undefined
  }
}

export const pushConfigured = Boolean(VAPID_KEY)
