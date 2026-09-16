import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AuthGate from './AuthGate'
import { auth } from './firebase'
import { registerPushForMember, pushConfigured } from './fcm'
import './styles.css'

type MemberId='me'|'wife'|'son'
const accountMemberByEmail:Record<string,MemberId>={'dad@family-scheduler.app':'me','mom@family-scheduler.app':'wife','son@family-scheduler.app':'son'}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(console.error))
}

function PushBootstrap(){
  useEffect(()=>{
    if(!pushConfigured||!('Notification' in window)||Notification.permission!=='granted')return
    const register=()=>{const member=accountMemberByEmail[auth.currentUser?.email??''];if(member)void registerPushForMember(member).catch(e=>console.warn('FCM registration skipped:',e))}
    register()
    window.addEventListener('focus',register)
    return()=>window.removeEventListener('focus',register)
  },[])
  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate>
      <PushBootstrap />
      <App />
    </AuthGate>
  </React.StrictMode>,
)
