import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import koLocale from '@fullcalendar/core/locales/ko'
import type { DatesSetArg, EventClickArg } from '@fullcalendar/core'
import { collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { auth, db } from './firebase'

type MemberId = 'me' | 'wife' | 'son'
type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
type Alarm = 5 | 10 | 30 | 60
type EventItem = { id: string; title: string; start: string; end?: string; allDay?: boolean; memberIds: MemberId[]; kind?: 'event' | 'homework' | 'homework-complete'; homeworkId?: string; completed?: boolean; completedAt?: string; location?: string; memo?: string; repeat?: Repeat; alarmMinutes?: Alarm[]; familyId?: string; createdBy?: string }
type Homework = { id: string; name: string; familyId?: string }
type Notice = { id: string; title: string; body: string; createdAt: string; createdBy?: string; familyId?: string }

const FAMILY_ID = 'family-main'
const members = [
  { id: 'me' as MemberId, label: '아빠', icon: '👨', color: '#4285f4' },
  { id: 'wife' as MemberId, label: '엄마', icon: '👩', color: '#9c6ade' },
  { id: 'son' as MemberId, label: '강천', icon: '👦', color: '#34a853' },
]
const accountMemberByEmail: Record<string, MemberId> = {
  'dad@family-scheduler.app': 'me',
  'mom@family-scheduler.app': 'wife',
  'son@family-scheduler.app': 'son',
}
const homeworkDefaults: Homework[] = [
  { id: 'eli-english', name: '엘리하이(영어)' }, { id: 'eli-math', name: '엘리하이(수학)' },
  { id: 'eli-science', name: '엘리하이(과학)' }, { id: 'eli-social', name: '엘리하이(사회)' },
  { id: 'eli-korean', name: '엘리하이(국어)' }, { id: 'hanja', name: '한자' },
  { id: 'math-calc', name: '수학 연산' }, { id: 'pretty-writing', name: '예쁜 글씨 쓰기' },
  { id: 'art', name: '미술학원 숙제' },
]
const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateTime = (d: Date) => `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const uid = () => crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`
const isoRange = (d: Date) => d.toISOString()
const repeatDates = (start: string, repeat: Repeat) => {
  if (repeat === 'none') return [start]
  const out = [start]
  for (let i = 1; i <= 60; i++) {
    const d = new Date(`${start.slice(0, 10)}T12:00:00`)
    if (repeat === 'daily') d.setDate(d.getDate() + i)
    else if (repeat === 'weekdays') { d.setDate(d.getDate() + i); if (d.getDay() === 0 || d.getDay() === 6) continue }
    else if (repeat === 'weekly') d.setDate(d.getDate() + i * 7)
    else d.setMonth(d.getMonth() + i)
    out.push(`${dateKey(d)}${start.slice(10)}`)
  }
  return out
}

export default function App() {
  const currentMember = accountMemberByEmail[auth.currentUser?.email ?? '']
  const [events, setEvents] = useState<EventItem[]>([])
  const [homeworks, setHomeworks] = useState<Homework[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [selected, setSelected] = useState<MemberId[]>(() => { try { const x = localStorage.getItem('family-scheduler-members'); return x ? JSON.parse(x) : ['me', 'wife', 'son'] } catch { return ['me', 'wife', 'son'] } })
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => { const now = new Date(); const start = new Date(now); start.setDate(start.getDate() - start.getDay()); const end = new Date(start); end.setDate(end.getDate() + 7); return { start, end } })
  const [dataLoading, setDataLoading] = useState(true)
  const [syncError, setSyncError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<EventItem | null>(null)
  const [homeworkOpen, setHomeworkOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [homeworkDate, setHomeworkDate] = useState(dateKey(new Date()))
  const [homeworkIds, setHomeworkIds] = useState<string[]>([])
  const [homeworkName, setHomeworkName] = useState('')
  const [editingHomework, setEditingHomework] = useState<Homework | null>(null)
  const [todayOpen, setTodayOpen] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memoTitle, setMemoTitle] = useState('')
  const [memoBody, setMemoBody] = useState('')
  const eventsListenerRef = useRef<(() => void) | null>(null)
  const smallDataLoadedRef = useRef(false)
  const smallDataRefreshRef = useRef(0)

  useEffect(() => localStorage.setItem('family-scheduler-members', JSON.stringify(selected)), [selected])

  const refreshSmallData = useCallback(async (force = false) => {
    if (!auth.currentUser) return
    const now = Date.now()
    if (!force && smallDataLoadedRef.current && now - smallDataRefreshRef.current < 5 * 60 * 1000) return
    try {
      const [homeworkSnap, noticeSnap] = await Promise.all([
        getDocs(query(collection(db, 'homeworks'), where('familyId', '==', FAMILY_ID), orderBy('name'))),
        getDocs(query(collection(db, 'notices'), where('familyId', '==', FAMILY_ID), orderBy('createdAt', 'desc'))),
      ])
      const hs = homeworkSnap.docs.map(d => d.data() as Homework)
      if (hs.length === 0) {
        const b = writeBatch(db)
        homeworkDefaults.forEach(h => b.set(doc(db, 'homeworks', h.id), { ...h, familyId: FAMILY_ID }))
        await b.commit()
        setHomeworks(homeworkDefaults.map(h => ({ ...h, familyId: FAMILY_ID })))
      } else setHomeworks(hs)
      setNotices(noticeSnap.docs.map(d => d.data() as Notice))
      smallDataLoadedRef.current = true
      smallDataRefreshRef.current = now
    } catch (e) {
      console.error(e)
      setSyncError('Firebase 가족 데이터 동기화에 실패했습니다.')
    }
  }, [])

  useEffect(() => { void refreshSmallData(true); const onFocus = () => void refreshSmallData(); window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus) }, [refreshSmallData])

  const loadEventRange = useCallback((nextRange: { start: Date; end: Date }) => {
    eventsListenerRef.current?.()
    setRange(nextRange)
    if (!auth.currentUser) return () => undefined
    setDataLoading(true)
    setSyncError('')
    const start = isoRange(nextRange.start)
    const end = isoRange(nextRange.end)
    const q = query(
      collection(db, 'events'),
      where('familyId', '==', FAMILY_ID),
      where('start', '>=', start),
      where('start', '<', end),
      orderBy('start', 'asc'),
    )
    const unsubscribe = onSnapshot(q, snapshot => {
      const rows = snapshot.docs.map(d => ({ ...(d.data() as EventItem), id: d.id }))
      setEvents(rows)
      setDataLoading(false)
    }, error => {
      console.error(error)
      setSyncError('Firebase 일정 동기화에 실패했습니다. 필요한 Firestore 색인을 확인해주세요.')
      setDataLoading(false)
    })
    eventsListenerRef.current = unsubscribe
    return unsubscribe
  }, [])

  useEffect(() => { const cleanup = loadEventRange(range); return () => { cleanup?.(); eventsListenerRef.current = null } }, [range.start.getTime(), range.end.getTime(), loadEventRange])

  const handleDatesSet = (arg: DatesSetArg) => {
    const start = new Date(arg.start)
    const end = new Date(arg.end)
    if (start.getTime() !== range.start.getTime() || end.getTime() !== range.end.getTime()) setRange({ start, end })
  }

  const flash = (s: string) => { setNotice(s); window.setTimeout(() => setNotice(''), 2200) }
  const visible = useMemo(() => events.filter(e => e.memberIds?.some(m => selected.includes(m)) && (!search.trim() || `${e.title} ${e.location ?? ''} ${e.memo ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))), [events, selected, search])
  const calendarEvents = visible.map(e => { const m = members.find(x => x.id === e.memberIds?.[0]) ?? members[0]; const done = e.kind === 'homework-complete' || (e.kind === 'homework' && e.completed); return { ...e, backgroundColor: done ? '#9aa0a6' : m.color, borderColor: done ? '#9aa0a6' : m.color } })
  const today = dateKey(new Date())
  const todayEvents = events.filter(e => e.start.slice(0, 10) === today && e.kind !== 'homework-complete' && e.memberIds?.some(m => selected.includes(m))).sort((a, b) => a.start.localeCompare(b.start))
  const todayHomework = events.filter(e => e.start.slice(0, 10) === today && e.kind === 'homework')
  const completedHomework = events.filter(e => e.kind === 'homework' && e.completed).length
  const last30 = events.filter(e => e.start >= `${dateKey(new Date(Date.now() - 30 * 86400000))}T00:00:00` && e.kind === 'event')
  const memberCounts = members.map(m => ({ m, count: events.filter(e => e.kind === 'event' && e.memberIds?.includes(m.id)).length }))

  const addSchedule = (arg: any) => { const start = new Date(arg.date); setModal({ id: uid(), title: '', start: dateTime(start), end: dateTime(new Date(start.getTime() + 3600000)), memberIds: currentMember ? [currentMember] : ['me'], allDay: Boolean(arg.allDay), kind: 'event', repeat: 'none', alarmMinutes: [10] }) }
  const clickEvent = (arg: EventClickArg) => { const e = events.find(x => x.id === arg.event.id); if (e) setModal({ ...e, alarmMinutes: e.alarmMinutes ?? [10] }) }
  const saveEvent = async (e: EventItem) => {
    if (!e.title.trim()) return alert('일정 제목을 입력해주세요.')
    if (!e.memberIds.length) return alert('최소 한 명을 선택해주세요.')
    try {
      const dates = repeatDates(e.start, e.repeat ?? 'none')
      const duration = e.end ? new Date(e.end).getTime() - new Date(e.start).getTime() : 3600000
      const rows = dates.map((d, i) => ({ ...e, id: i === 0 ? e.id : uid(), start: d, end: e.end ? dateTime(new Date(new Date(d).getTime() + duration)) : undefined, repeat: i === 0 ? (e.repeat ?? 'none') : 'none' as Repeat, familyId: FAMILY_ID, createdBy: e.createdBy ?? auth.currentUser?.uid ?? '' }))
      const b = writeBatch(db)
      rows.forEach(row => b.set(doc(db, 'events', row.id), row))
      await b.commit()
      setEvents(prev => [...prev.filter(x => !rows.some(r => r.id === x.id)), ...rows].sort((a, b) => a.start.localeCompare(b.start)))
      setModal(null)
      flash(rows.length === 1 ? '일정을 저장했습니다.' : `${rows.length}개의 반복 일정을 저장했습니다.`)
    } catch (e) { console.error(e); alert('일정 저장에 실패했습니다.') }
  }
  const changeEvent = async (id: string, start: string, end?: string) => { const old = events.find(x => x.id === id); if (!old) return; const next = { ...old, start, end }; try { await setDoc(doc(db, 'events', id), next); setEvents(p => p.map(x => x.id === id ? next : x)) } catch (e) { console.error(e); alert('일정 변경에 실패했습니다.') } }
  const deleteEvent = async (e: EventItem) => { if (!confirm(`'${e.title}' 일정을 삭제할까요?`)) return; try { await deleteDoc(doc(db, 'events', e.id)); setEvents(p => p.filter(x => x.id !== e.id)); setModal(null); flash('일정을 삭제했습니다.') } catch (err) { console.error(err); alert('삭제에 실패했습니다.') } }
  const registerHomework = async () => {
    const chosen = homeworks.filter(h => homeworkIds.includes(h.id))
    const created = chosen.filter(h => !events.some(e => e.kind === 'homework' && e.homeworkId === h.id && e.start.slice(0, 10) === homeworkDate && !e.completed)).map(h => ({ id: uid(), title: `📝 ${h.name}`, start: `${homeworkDate}T00:00:00`, end: `${homeworkDate}T23:59:59`, allDay: true, memberIds: ['son'] as MemberId[], kind: 'homework' as const, homeworkId: h.id, completed: false, alarmMinutes: [10] as Alarm[], familyId: FAMILY_ID, createdBy: auth.currentUser?.uid ?? '' }))
    if (!created.length) return alert('선택한 숙제는 이미 등록되어 있습니다.')
    try { const b = writeBatch(db); created.forEach(e => b.set(doc(db, 'events', e.id), e)); await b.commit(); setEvents(p => [...p, ...created].sort((a, b) => a.start.localeCompare(b.start))); setHomeworkOpen(false); setHomeworkIds([]); flash(`${created.length}개 숙제를 등록했습니다.`) } catch (e) { console.error(e); alert('숙제 등록에 실패했습니다.') }
  }
  const completeHomework = async (e: EventItem) => {
    if (e.completed) return
    const now = new Date(); const next = { ...e, title: `✅ ${e.title.replace(/^📝\s*/, '')}`, completed: true, completedAt: now.toISOString() }
    try { await setDoc(doc(db, 'events', e.id), next); setEvents(p => p.map(x => x.id === e.id ? next : x)); setModal(null); flash('숙제를 완료했습니다.') } catch (err) { console.error(err); alert('숙제 완료 저장에 실패했습니다.') }
  }
  const addHomework = async () => { const n = homeworkName.trim(); if (!n) return; if (homeworks.some(h => h.name === n)) return alert('이미 등록된 숙제입니다.'); const id = uid(); try { await setDoc(doc(db, 'homeworks', id), { id, name: n, familyId: FAMILY_ID }); setHomeworks(p => [...p, { id, name: n, familyId: FAMILY_ID }].sort((a, b) => a.name.localeCompare(b.name, 'ko'))); setHomeworkName('') } catch (e) { console.error(e) } }
  const updateHomework = async () => { if (!editingHomework) return; const n = homeworkName.trim(); if (!n) return; try { await setDoc(doc(db, 'homeworks', editingHomework.id), { ...editingHomework, name: n, familyId: FAMILY_ID }); setHomeworks(p => p.map(h => h.id === editingHomework.id ? { ...h, name: n } : h)); setEditingHomework(null); setHomeworkName('') } catch (e) { console.error(e) } }
  const deleteHomework = async (h: Homework) => { if (!confirm(`'${h.name}' 숙제 항목을 삭제할까요?`)) return; try { await deleteDoc(doc(db, 'homeworks', h.id)); setHomeworks(p => p.filter(x => x.id !== h.id)); setHomeworkIds(p => p.filter(x => x !== h.id)) } catch (e) { console.error(e) } }
  const saveNotice = async () => { if (!memoTitle.trim() && !memoBody.trim()) return; const id = uid(); const row = { id, title: memoTitle.trim() || '가족 메모', body: memoBody.trim(), createdAt: new Date().toISOString(), createdBy: currentMember, familyId: FAMILY_ID }; try { await setDoc(doc(db, 'notices', id), row); setNotices(p => [row, ...p]); setMemoTitle(''); setMemoBody(''); flash('가족 메모를 저장했습니다.') } catch (e) { console.error(e) } }
  const requestNotifications = async () => { if (!('Notification' in window)) return alert('이 브라우저는 알림을 지원하지 않습니다.'); const p = await Notification.requestPermission(); flash(p === 'granted' ? '알림 권한이 허용되었습니다.' : '알림 권한이 허용되지 않았습니다.') }
  const testNotification = () => { if (!('Notification' in window) || Notification.permission !== 'granted') return alert('먼저 알림 권한을 허용해주세요.'); new Notification('우리 가족 스케줄러', { body: '알림 테스트입니다.' }) }

  useEffect(() => {
    if (!currentMember || Notification.permission !== 'granted') return
    const tick = () => { const now = Date.now(); events.forEach(e => { if (e.kind === 'homework-complete' || !e.alarmMinutes?.length || !e.memberIds?.includes(currentMember)) return; const diff = Math.round((new Date(e.start).getTime() - now) / 60000); e.alarmMinutes.forEach(min => { const key = `family-alarm-${e.id}-${min}-${e.start}`; if (diff >= min && diff < min + 1 && !localStorage.getItem(key)) { localStorage.setItem(key, '1'); new Notification(`📅 ${e.title}`, { body: `${min}분 후 일정이 시작됩니다.${e.location ? ` 장소: ${e.location}` : ''}` }) } }) }) }
    tick(); const timer = window.setInterval(tick, 30000); return () => window.clearInterval(timer)
  }, [events, currentMember])

  return <div className="app-shell">
    <header className="topbar"><div className="brand">📅 <strong>우리 가족 스케줄러</strong></div><div className="top-actions">
      <button onClick={() => setTodayOpen(p => !p)}>📌 오늘</button><button onClick={() => setNoticeOpen(p => !p)}>📣 가족 메모</button><button onClick={() => setStatsOpen(p => !p)}>📊 통계</button>
      <button onClick={() => { setHomeworkDate(today); setHomeworkIds([]); setManageOpen(false); setHomeworkOpen(true) }}>📝 숙제 체크</button>
      <button className="add-btn" onClick={() => setModal({ id: uid(), title: '', start: dateTime(new Date()), end: dateTime(new Date(Date.now() + 3600000)), memberIds: currentMember ? [currentMember] : ['me'], kind: 'event', repeat: 'none', alarmMinutes: [10] })}>＋ 일정 추가</button>
      <button onClick={() => setSettingsOpen(true)}>⚙️</button>
    </div></header>
    <div className="toolbar"><div className="filters"><strong>가족</strong>{members.map(m => <label className="member-filter" key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected(p => p.includes(m.id) ? p.filter(x => x !== m.id) : [...p, m.id])}/><span style={{ color: m.color }}>{m.icon} {m.label}</span></label>)}</div><div className="search-box">🔍<input value={search} onChange={e => setSearch(e.target.value)} placeholder="일정·장소·메모 검색"/><button onClick={() => setSearch('')}>×</button></div></div>
    {(dataLoading || syncError) && <div className={syncError ? 'status error' : 'status'}>{dataLoading ? '☁️ 현재 화면의 일정만 불러오는 중...' : `⚠️ ${syncError}`}</div>}
    <main className="calendar-wrap"><FullCalendar plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} initialView="timeGridWeek" locale={koLocale} height="auto" nowIndicator editable selectable select={addSchedule} eventClick={clickEvent} datesSet={handleDatesSet} events={calendarEvents} headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }} eventDrop={info => changeEvent(info.event.id, dateTime(info.event.start ?? new Date()), info.event.end ? dateTime(info.event.end) : undefined)} eventResize={info => changeEvent(info.event.id, dateTime(info.event.start ?? new Date()), info.event.end ? dateTime(info.event.end) : undefined)} eventContent={arg => <div className="fc-custom-event"><strong>{arg.event.title}</strong></div>} /></main>

    {todayOpen && <section className="panel"><h3>📌 오늘</h3>{todayEvents.length ? todayEvents.map(e => <div className="panel-row" key={e.id}>{e.start.slice(11, 16)} · {e.title}</div>) : <div>오늘 일정이 없습니다.</div>}<div className="panel-sub">오늘 숙제 {todayHomework.filter(e => !e.completed).length}개 / 완료 {todayHomework.filter(e => e.completed).length}개</div></section>}
    {noticeOpen && <section className="panel"><h3>📣 가족 메모</h3><div className="form-grid"><input value={memoTitle} onChange={e => setMemoTitle(e.target.value)} placeholder="제목"/><textarea value={memoBody} onChange={e => setMemoBody(e.target.value)} placeholder="가족에게 남길 메모"/><button onClick={saveNotice}>저장</button></div>{notices.slice(0, 20).map(n => <div className="panel-row" key={n.id}><strong>{n.title}</strong><br/>{n.body}<small>{n.createdAt.slice(0, 16).replace('T', ' ')}</small></div>)}</section>}
    {statsOpen && <section className="panel"><h3>📊 현재 불러온 일정 통계</h3><div>최근 30일 일정: {last30.length}개 · 완료 숙제: {completedHomework}개</div>{memberCounts.map(x => <div className="panel-row" key={x.m.id}>{x.m.icon} {x.m.label}: {x.count}개</div>)}<small>통계는 현재 화면 범위에 로드된 일정만 사용합니다. 전체 과거 데이터를 다시 읽지 않습니다.</small></section>}

    {homeworkOpen && <div className="modal-backdrop"><div className="modal-card"><h2>📝 숙제 체크</h2><label>날짜 <input type="date" value={homeworkDate} onChange={e => setHomeworkDate(e.target.value)}/></label><div className="homework-list">{homeworks.map(h => <label key={h.id}><input type="checkbox" checked={homeworkIds.includes(h.id)} onChange={() => setHomeworkIds(p => p.includes(h.id) ? p.filter(x => x !== h.id) : [...p, h.id])}/>{h.name}</label>)}</div><div className="modal-actions"><button onClick={registerHomework}>선택 숙제 등록</button><button onClick={() => setManageOpen(p => !p)}>숙제 관리</button><button onClick={() => setHomeworkOpen(false)}>닫기</button></div>{manageOpen && <div className="manage-box"><div className="form-inline"><input value={homeworkName} onChange={e => setHomeworkName(e.target.value)} placeholder="새 숙제 이름"/><button onClick={editingHomework ? updateHomework : addHomework}>{editingHomework ? '수정' : '추가'}</button></div>{homeworks.map(h => <div className="panel-row" key={h.id}>{h.name}<span><button onClick={() => { setEditingHomework(h); setHomeworkName(h.name) }}>수정</button><button onClick={() => deleteHomework(h)}>삭제</button></span></div>)}</div>}</div></div>}

    {modal && <div className="modal-backdrop"><div className="modal-card"><h2>{modal.kind === 'homework' ? '📝 숙제' : '📅 일정'}</h2><div className="form-grid"><input value={modal.title} onChange={e => setModal({ ...modal, title: e.target.value })} placeholder="일정 제목"/><div className="form-inline"><input type="datetime-local" value={modal.start} onChange={e => setModal({ ...modal, start: e.target.value })}/><input type="datetime-local" value={modal.end ?? ''} onChange={e => setModal({ ...modal, end: e.target.value })}/></div><div><strong>대상 가족</strong>{members.map(m => <label key={m.id} className="member-filter"><input type="checkbox" checked={modal.memberIds.includes(m.id)} onChange={() => setModal({ ...modal, memberIds: modal.memberIds.includes(m.id) ? modal.memberIds.filter(x => x !== m.id) : [...modal.memberIds, m.id] })}/>{m.icon} {m.label}</label>)}</div><input value={modal.location ?? ''} onChange={e => setModal({ ...modal, location: e.target.value })} placeholder="장소(선택)"/><textarea value={modal.memo ?? ''} onChange={e => setModal({ ...modal, memo: e.target.value })} placeholder="메모(선택)"/><label>반복 <select value={modal.repeat ?? 'none'} onChange={e => setModal({ ...modal, repeat: e.target.value as Repeat })}><option value="none">반복 없음</option><option value="daily">매일</option><option value="weekdays">평일</option><option value="weekly">매주</option><option value="monthly">매월</option></select></label><label>알림 <select value={(modal.alarmMinutes?.[0] ?? 10)} onChange={e => setModal({ ...modal, alarmMinutes: [Number(e.target.value) as Alarm] })}><option value="5">5분 전</option><option value="10">10분 전</option><option value="30">30분 전</option><option value="60">1시간 전</option></select></label></div><div className="modal-actions"><button onClick={() => saveEvent(modal)}>저장</button>{modal.id && events.some(e => e.id === modal.id) && <><button onClick={() => deleteEvent(modal)}>삭제</button>{modal.kind === 'homework' && !modal.completed && <button onClick={() => completeHomework(modal)}>숙제 완료</button>}</>}<button onClick={() => setModal(null)}>닫기</button></div></div></div>}

    {settingsOpen && <div className="modal-backdrop"><div className="modal-card"><h2>⚙️ 설정</h2><p>로그인 계정: {auth.currentUser?.email ?? '-'}</p><p>현재 일정 조회 범위: {dateKey(range.start)} ~ {dateKey(range.end)}</p><p>Firebase는 전체 일정 컬렉션을 계속 감시하지 않고, 현재 캘린더 범위만 조회합니다.</p><div className="modal-actions"><button onClick={requestNotifications}>알림 권한 요청</button><button onClick={testNotification}>알림 테스트</button><button onClick={() => { smallDataLoadedRef.current = false; void refreshSmallData(true) }}>가족 데이터 새로고침</button><button onClick={() => setSettingsOpen(false)}>닫기</button></div></div></div>}
    {notice && <div className="toast">{notice}</div>}
  </div>
}
