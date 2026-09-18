import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { auth } from './firebase'

export type FamilyMember = 'me' | 'wife' | 'son'

const accounts: Record<FamilyMember, { label: string; email: string }> = {
  me: { label: '아빠', email: 'dad@family-scheduler.app' },
  wife: { label: '엄마', email: 'mom@family-scheduler.app' },
  son: { label: '강천', email: 'son@family-scheduler.app' },
}

const initialPassword = '111111'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [member, setMember] = useState<FamilyMember>('me')
  const [password, setPassword] = useState(initialPassword)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const selectAllText = (e: React.FocusEvent<HTMLInputElement>) => { const el=e.currentTarget; setTimeout(()=>el.select(),0) }

  useEffect(() => {
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser)
      setLoading(false)
    })
  }, [])

  const login = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSigningIn(true)
    try {
      await signInWithEmailAndPassword(auth, accounts[member].email, password)
    } catch (err: any) {
      const code = err?.code ?? ''
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        setError('아직 이 가족 계정이 만들어지지 않았습니다. Firebase에서 계정을 먼저 만들어 주세요.')
      } else if (code === 'auth/wrong-password') {
        setError('비밀번호가 맞지 않습니다.')
      } else {
        setError(`로그인할 수 없습니다. (${code || '알 수 없는 오류'})`)
      }
    } finally {
      setSigningIn(false)
    }
  }

  if (loading) return <div style={styles.center}>Firebase 인증 확인 중...</div>

  if (user) {
    const signedMember = Object.entries(accounts).find(([, account]) => account.email === user.email)?.[0] as FamilyMember | undefined
    return (
      <>
        <div style={styles.userBar}>
          <span>🔐 {signedMember ? accounts[signedMember].label : '가족'} 로그인</span>
          <button style={styles.logoutButton} onClick={() => signOut(auth)}>로그아웃</button>
        </div>
        {children}
      </>
    )
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={login}>
        <div style={styles.icon}>📅</div>
        <h1 style={styles.title}>우리 가족 스케줄러</h1>
        <p style={styles.subtitle}>가족 구성원을 선택하고 로그인하세요.</p>

        <label style={styles.label}>
          가족 구성원
          <select value={member} onChange={e => setMember(e.target.value as FamilyMember)} style={styles.input}>
            <option value="me">👨 아빠</option>
            <option value="wife">👩 엄마</option>
            <option value="son">👦 강천</option>
          </select>
        </label>

        <label style={styles.label}>
          비밀번호
          <input type="password" value={password} onFocus={selectAllText} onClick={selectAllText} onChange={e => setPassword(e.target.value)} style={styles.input} autoComplete="current-password" placeholder="비밀번호" />
        </label>

        {error && <div style={styles.error}>{error}</div>}

        <button type="submit" disabled={signingIn} style={styles.loginButton}>
          {signingIn ? '로그인 중...' : '로그인'}
        </button>

        <p style={styles.note}>※ 초기 비밀번호는 111111로 설정합니다.</p>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fb', padding: 20, boxSizing: 'border-box' },
  card: { width: '100%', maxWidth: 390, background: '#fff', borderRadius: 18, padding: 30, boxSizing: 'border-box', boxShadow: '0 10px 35px rgba(0,0,0,.08)' },
  icon: { fontSize: 44, textAlign: 'center', marginBottom: 8 },
  title: { textAlign: 'center', margin: '0 0 8px', fontSize: 25 },
  subtitle: { textAlign: 'center', color: '#6b7280', margin: '0 0 25px' },
  label: { display: 'block', fontWeight: 700, marginBottom: 15 },
  input: { width: '100%', marginTop: 7, padding: '12px 13px', border: '1px solid #d8dce5', borderRadius: 10, fontSize: 16, boxSizing: 'border-box', background: '#fff' },
  loginButton: { width: '100%', padding: '13px 16px', border: 0, borderRadius: 10, background: '#4285f4', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  error: { background: '#fff1f1', color: '#c62828', borderRadius: 10, padding: 11, marginBottom: 14, fontSize: 14, lineHeight: 1.45 },
  note: { color: '#8a8f98', fontSize: 12, textAlign: 'center', margin: '15px 0 0' },
  center: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' },
  userBar: { height: 42, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: '#fff', borderBottom: '1px solid #e5e7eb', boxSizing: 'border-box', fontSize: 13 },
  logoutButton: { border: '1px solid #d8dce5', background: '#fff', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' },
}
