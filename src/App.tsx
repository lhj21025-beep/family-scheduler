import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import koLocale from '@fullcalendar/core/locales/ko'
import type { DatesSetArg, DateSelectArg, EventClickArg, EventDropArg, EventResizeDoneArg } from '@fullcalendar/core'
import { collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { db, firebaseEnabled } from './firebase'

type MemberId = 'me' | 'wife' | 'son'
type ViewMode = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'

type FamilyEvent = { id: string; familyId: string; memberId: MemberId; title: string; start: string; end?: string; allDay?: boolean; location?: string; memo?: string; notification?: number; recurrence?: { type: string } }

const members = [
  { id: 'me' as MemberId, label: '나', icon: '👨', color: '#4285f4' },
  { id: 'wife' as MemberId, label: '아내', icon: '👩', color: '#9c6ade' },
  { id: 'son' as MemberId, label: '아들', icon: '👦', color: '#34a853' },
]

const demoEvents: FamilyEvent[] = [
  { id: 'demo-school', familyId: 'demo', memberId: 'son', title: '학교', start: '2026-09-10T08:50:00', end: '2026-09-10T15:10:00' },
  { id: 'demo-math', familyId: 'demo', memberId: 'son', title: '수학학원', start: '2026-09-10T16:00:00', end: '2026-09-10T17:30:00', location: 'OO수학학원' },
  { id: 'demo-exercise', familyId: 'demo', memberId: 'wife', title: '운동', start: '2026-09-10T18:30:00', end: '2026-09-10T19:30:00' },
  { id: 'demo-gym', familyId: 'demo', memberId: 'me', title: '헬스', start: '2026-09-10T20:00:00', end: '2026-09-10T21:30:00' },
]

function localDateTime(value: Date | string) {
  const d = typeof value === 'string' ? new Date(value) : value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function makeId() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `event-${Date.now()}` }

function App() {
  const calendarRef = useRef<FullCalendar>(null)
  const [view, setView] = useState<ViewMode>('timeGridWeek')
  const [selectedMembers, setSelectedMembers] = useState<MemberId[]>(['me', 'wife', 'son'])
  const [events, setEvents] = useState<FamilyEvent[]>(demoEvents)
  const [modal, setModal] = useState<FamilyEvent | null>(null)
  const [newEvent, setNewEvent] = useState<Partial<FamilyEvent> | null>(null)
  const [notice, setNotice] = useState('')
  const [calendarTitle, setCalendarTitle] = useState('')
  const [now, setNow] = useState(new Date())

  useEffect(() => { const saved = localStorage.getItem('family-scheduler-members'); if (saved) { try { setSelectedMembers(JSON.parse(saved)) } catch {} } }, [])
  useEffect(() => localStorage.setItem('family-scheduler-members', JSON.stringify(selectedMembers)), [selectedMembers])
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer) }, [])
  useEffect(() => { if (!firebaseEnabled || !db) return; return onSnapshot(collection(db, 'events'), snapshot => setEvents(snapshot.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FamilyEvent, 'id'>) })))) }, [])

  const visibleEvents = useMemo(() => events.filter(e => selectedMembers.includes(e.memberId)), [events, selectedMembers])
  const fcEvents = visibleEvents.map(e => { const member = members.find(m => m.id === e.memberId)!; return { id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, backgroundColor: member.color, borderColor: member.color, extendedProps: { memberId: e.memberId, location: e.location, memo: e.memo } } })
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(''), 1800) }

  const saveEvent = async (event: FamilyEvent) => {
    const data = { ...event, familyId: 'family-default', updatedAt: new Date().toISOString() }
    if (firebaseEnabled && db) await setDoc(doc(db, 'events', event.id), data)
    setEvents(prev => prev.some(e => e.id === event.id) ? prev.map(e => e.id === event.id ? event : e) : [...prev, event])
    setNewEvent(null); setModal(null); flash('일정을 저장했습니다.')
  }
  const removeEvent = async (event: FamilyEvent) => {
    if (!window.confirm(`'${event.title}' 일정을 삭제할까요?`)) return
    if (firebaseEnabled && db) await deleteDoc(doc(db, 'events', event.id))
    setEvents(prev => prev.filter(e => e.id !== event.id)); setModal(null); flash('일정을 삭제했습니다.')
  }
  const handleSelect = (info: DateSelectArg) => setNewEvent({ id: makeId(), familyId: 'family-default', memberId: selectedMembers[0] ?? 'son', title: '', start: localDateTime(info.start), end: localDateTime(info.end), allDay: info.allDay, notification: 0 })
  const moveEvent = async (info: EventDropArg | EventResizeDoneArg) => {
    const id = info.event.id; const old = events.find(e => e.id === id); if (!old || !info.event.start) return
    const next = { ...old, start: localDateTime(info.event.start), end: info.event.end ? localDateTime(info.event.end) : old.end }
    if (firebaseEnabled && db) await updateDoc(doc(db, 'events', id), next as Record<string, unknown>)
    setEvents(prev => prev.map(e => e.id === id ? next : e)); flash('일정 시간이 변경되었습니다.')
  }
  const openAdd = () => { const start = new Date(); start.setSeconds(0, 0); start.setMinutes(Math.ceil(start.getMinutes() / 30) * 30); const end = new Date(start.getTime() + 60 * 60 * 1000); setNewEvent({ id: makeId(), familyId: 'family-default', memberId: selectedMembers[0] ?? 'son', title: '', start: localDateTime(start), end: localDateTime(end), allDay: false, notification: 0 }) }
  const navigate = (action: 'prev' | 'next' | 'today') => { const api = calendarRef.current?.getApi(); if (api) api[action]() }
  const changeView = (nextView: ViewMode) => { setView(nextView); calendarRef.current?.getApi().changeView(nextView) }
  const onDatesSet = (arg: DatesSetArg) => { setView(arg.view.type as ViewMode); setCalendarTitle(arg.view.title); setNow(new Date()) }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-icon">📅</span><span>우리 가족 스케줄러</span></div>
      <div className="nav-controls"><button className="today-btn" onClick={() => navigate('today')}>오늘</button><button className="icon-btn" aria-label="이전" onClick={() => navigate('prev')}>‹</button><button className="icon-btn" aria-label="다음" onClick={() => navigate('next')}>›</button><span className="current-title">{calendarTitle}</span></div>
      <button className="add-btn" onClick={openAdd}>＋ 일정 추가</button>
    </header>
    <section className="toolbar">
      <div className="filters"><span className="filter-title">가족</span>{members.map(m => <label className="member-filter" key={m.id}><input type="checkbox" checked={selectedMembers.includes(m.id)} onChange={() => setSelectedMembers(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])}/><span className="check-dot" style={{ background: m.color }}>{m.icon}</span>{m.label}</label>)}</div>
      <div className="view-switcher">{([['dayGridMonth','월'],['timeGridWeek','주'],['timeGridDay','일']] as [ViewMode,string][]).map(([v,label]) => <button key={v} className={view === v ? 'active' : ''} onClick={() => changeView(v)}>{label}</button>)}</div>
    </section>
    <main className="calendar-wrap"><FullCalendar ref={calendarRef} plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]} locale={koLocale} initialView="timeGridWeek" headerToolbar={{left:'title',center:'',right:''}} nowIndicator selectable selectMirror editable eventResizableFromStart slotMinTime="07:00:00" slotMaxTime="23:00:00" scrollTime="08:00:00" slotDuration="00:30:00" allDaySlot dayMaxEvents={4} height="calc(100vh - 145px)" events={fcEvents} select={handleSelect} eventClick={(info: EventClickArg) => setModal(events.find(e => e.id === info.event.id) ?? null)} eventDrop={moveEvent} eventResize={moveEvent} datesSet={onDatesSet} now={now} buttonText={{today:'오늘',month:'월',week:'주',day:'일'}} eventContent={arg => { const member = members.find(m => m.id === arg.event.extendedProps.memberId); return <div className="event-content"><strong>{member?.icon} {arg.event.title}</strong>{arg.event.extendedProps.location && <small>📍 {arg.event.extendedProps.location}</small>}</div> }}/></main>
    <section className="today-summary"><div className="summary-head"><strong>오늘 일정</strong><span>{now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span></div><div className="summary-list">{events.filter(e => new Date(e.start).toDateString() === now.toDateString() && selectedMembers.includes(e.memberId)).sort((a,b) => a.start.localeCompare(b.start)).map(e => <button key={e.id} className="summary-item" onClick={() => setModal(e)}><span>{new Date(e.start).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</span><b>{members.find(m => m.id === e.memberId)?.icon} {e.title}</b><small>{members.find(m => m.id === e.memberId)?.label}</small></button>)}{events.filter(e => new Date(e.start).toDateString() === now.toDateString() && selectedMembers.includes(e.memberId)).length === 0 && <span className="empty">오늘 등록된 일정이 없습니다.</span>}</div></section>
    {notice && <div className="toast">✓ {notice}</div>}
    {(modal || newEvent) && <EventModal event={(modal ?? newEvent)!} isNew={!modal} onClose={() => {setModal(null);setNewEvent(null)}} onSave={saveEvent} onDelete={removeEvent} requestNotification={async () => {if ('Notification' in window) await Notification.requestPermission()}}/>}
  </div>
}

function EventModal({ event, isNew, onClose, onSave, onDelete, requestNotification }: { event: FamilyEvent | Partial<FamilyEvent>; isNew: boolean; onClose: () => void; onSave: (e: FamilyEvent) => void; onDelete: (e: FamilyEvent) => void; requestNotification: () => Promise<void> }) {
  const [form, setForm] = useState<FamilyEvent>({id:event.id ?? makeId(),familyId:event.familyId ?? 'family-default',memberId:event.memberId ?? 'son',title:event.title ?? '',start:event.start ?? '',end:event.end ?? '',allDay:event.allDay ?? false,location:event.location ?? '',memo:event.memo ?? '',notification:event.notification ?? 0,recurrence:event.recurrence})
  const set = (key: keyof FamilyEvent, value: unknown) => setForm(prev => ({...prev,[key]:value}))
  const save = () => {if (!form.title.trim()) return window.alert('일정 제목을 입력해주세요.'); onSave(form)}
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="modal">
    <div className="modal-header"><h2>{isNew ? '일정 추가' : '일정 수정'}</h2><button aria-label="닫기" onClick={onClose}>×</button></div>
    <label>누구<select value={form.memberId} onChange={e => set('memberId',e.target.value as MemberId)}>{members.map(m => <option key={m.id} value={m.id}>{m.icon} {m.label}</option>)}</select></label>
    <label>제목<input autoFocus value={form.title} onChange={e => set('title',e.target.value)} placeholder="예: 수학학원"/></label>
    <div className="form-grid"><label>시작<input type="datetime-local" value={form.start} onChange={e => set('start',e.target.value)}/></label><label>종료<input type="datetime-local" value={form.end ?? ''} onChange={e => set('end',e.target.value)}/></label></div>
    <label>반복<select value={form.recurrence?.type ?? 'none'} onChange={e => set('recurrence',e.target.value === 'none' ? undefined : {type:e.target.value})}><option value="none">반복 안 함</option><option value="daily">매일</option><option value="weekday">평일</option><option value="weekly">매주</option><option value="monthly">매월</option><option value="yearly">매년</option></select></label>
    <label>알림<select value={form.notification ?? 0} onChange={async e => {const n=Number(e.target.value);set('notification',n);if(n>0) await requestNotification()}}><option value="0">알림 없음</option><option value="1">정시</option><option value="5">5분 전</option><option value="10">10분 전</option><option value="30">30분 전</option><option value="60">1시간 전</option><option value="1440">1일 전</option></select></label>
    <label>장소<input value={form.location ?? ''} onChange={e => set('location',e.target.value)} placeholder="예: OO학원"/></label>
    <label>메모<textarea rows={3} value={form.memo ?? ''} onChange={e => set('memo',e.target.value)} placeholder="메모를 입력하세요"/></label>
    <div className="modal-actions">{!isNew && <button className="delete-btn" onClick={() => onDelete(form)}>삭제</button>}<span/><button onClick={onClose}>취소</button><button className="save-btn" onClick={save}>저장</button></div>
  </div></div>
}
export default App
