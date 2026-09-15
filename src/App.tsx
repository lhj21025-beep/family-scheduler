import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import koLocale from '@fullcalendar/core/locales/ko'
import type { DatesSetArg, DateSelectArg, EventClickArg, EventDropArg, EventResizeDoneArg } from '@fullcalendar/core'
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { onAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth'
import { auth, db, firebaseEnabled } from './firebase'

type MemberId = 'me' | 'wife' | 'son'
type ViewMode = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay'
type FamilyEvent = { id:string; familyId:string; memberIds:MemberId[]; title:string; start:string; end?:string; allDay?:boolean; location?:string; memo?:string; notification?:number; recurrence?:{type:string}; kind?:'event'|'homework'|'homework-complete'; homeworkId?:string; completed?:boolean; completedAt?:string }
type Profile = { familyId:string; memberId:MemberId; name:string }
type Homework = { id:string; name:string }

const members = [
  { id:'me' as MemberId, label:'아빠', icon:'👨', color:'#4285f4' },
  { id:'wife' as MemberId, label:'엄마', icon:'👩', color:'#9c6ade' },
  { id:'son' as MemberId, label:'강천', icon:'👦', color:'#34a853' },
]
const defaultHomework:Homework[] = [
  {id:'eli-english',name:'엘리하이(영어)'}, {id:'eli-math',name:'엘리하이(수학)'},
  {id:'eli-science',name:'엘리하이(과학)'}, {id:'eli-social',name:'엘리하이(사회)'},
  {id:'eli-korean',name:'엘리하이(국어)'}, {id:'hanja',name:'한자'},
  {id:'math-calc',name:'수학 연산'}, {id:'pretty-writing',name:'예쁜 글씨 쓰기'},
  {id:'art',name:'미술학원 숙제'},
]
const demoEvents:FamilyEvent[] = [
  {id:'demo-school',familyId:'demo',memberIds:['son'],title:'학교',start:'2026-09-10T08:50:00',end:'2026-09-10T15:10:00'},
  {id:'demo-math',familyId:'demo',memberIds:['son'],title:'수학학원',start:'2026-09-10T16:00:00',end:'2026-09-10T17:30:00',location:'OO수학학원'},
  {id:'demo-exercise',familyId:'demo',memberIds:['wife'],title:'운동',start:'2026-09-10T18:30:00',end:'2026-09-10T19:30:00'},
  {id:'demo-gym',familyId:'demo',memberIds:['me'],title:'헬스',start:'2026-09-10T20:00:00',end:'2026-09-10T21:30:00'},
  {id:'demo-family',familyId:'demo',memberIds:['me','wife','son'],title:'가족 외식',start:'2026-09-10T19:00:00',end:'2026-09-10T20:00:00'},
]
const localDT = (v:Date|string) => { const d=typeof v==='string'?new Date(v):v; const p=(n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
const localDate = (v:Date|string) => { const d=typeof v==='string'?new Date(v):v; const p=(n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}` }
const makeId = () => typeof crypto!=='undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `event-${Date.now()}-${Math.random().toString(36).slice(2)}`
const normalize = (id:string,d:any):FamilyEvent => ({id,familyId:d.familyId??'family-default',memberIds:Array.isArray(d.memberIds)&&d.memberIds.length?d.memberIds:d.memberId?[d.memberId]:[],title:d.title??'',start:d.start??'',end:d.end,allDay:d.allDay??false,location:d.location??'',memo:d.memo??'',notification:d.notification??0,recurrence:d.recurrence,kind:d.kind??'event',homeworkId:d.homeworkId,completed:d.completed??false,completedAt:d.completedAt})
const sortHomework = (list:Homework[]) => [...list].sort((a,b)=>a.name.localeCompare(b.name,'ko'))

function App(){
  const cal=useRef<FullCalendar>(null)
  const [view,setView]=useState<ViewMode>('timeGridWeek')
  const [selected,setSelected]=useState<MemberId[]>(['me','wife','son'])
  const [events,setEvents]=useState<FamilyEvent[]>(demoEvents)
  const [modal,setModal]=useState<FamilyEvent|null>(null)
  const [newEvent,setNewEvent]=useState<Partial<FamilyEvent>|null>(null)
  const [notice,setNotice]=useState('')
  const [title,setTitle]=useState('')
  const [now,setNow]=useState(new Date())
  const [user,setUser]=useState<User|null>(null)
  const [profile,setProfile]=useState<Profile|null>(()=>{try{const v=localStorage.getItem('family-scheduler-profile');return v?JSON.parse(v):null}catch{return null}})
  const [authLoading,setAuthLoading]=useState(firebaseEnabled)
  const [loginFamily,setLoginFamily]=useState('')
  const [loginName,setLoginName]=useState('')
  const [loginMember,setLoginMember]=useState<MemberId>('me')
  const [loginBusy,setLoginBusy]=useState(false)
  const [homeworks,setHomeworks]=useState<Homework[]>(()=>{try{const v=localStorage.getItem('family-scheduler-homeworks');return v?sortHomework(JSON.parse(v)):sortHomework(defaultHomework)}catch{return sortHomework(defaultHomework)}})
  const [homeworkOpen,setHomeworkOpen]=useState(false)
  const [homeworkDate,setHomeworkDate]=useState(localDate(new Date()))
  const [homeworkIds,setHomeworkIds]=useState<string[]>([])
  const [editingHomework,setEditingHomework]=useState<Homework|null>(null)
  const [homeworkName,setHomeworkName]=useState('')

  useEffect(()=>{const s=localStorage.getItem('family-scheduler-members');if(s)try{setSelected(JSON.parse(s))}catch{}},[])
  useEffect(()=>localStorage.setItem('family-scheduler-members',JSON.stringify(selected)),[selected])
  useEffect(()=>localStorage.setItem('family-scheduler-homeworks',JSON.stringify(homeworks)),[homeworks])
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(t)},[])
  useEffect(()=>{if(!firebaseEnabled||!auth){setAuthLoading(false);return}return onAuthStateChanged(auth,u=>{setUser(u);setAuthLoading(false)})},[])
  useEffect(()=>{if(!firebaseEnabled||!db||!user||!profile)return;const firestore=db;const q=query(collection(firestore,'events'),where('familyId','==',profile.familyId));return onSnapshot(q,s=>setEvents(s.docs.map(d=>normalize(d.id,d.data()))))},[user,profile])

  const flash=(s:string)=>{setNotice(s);setTimeout(()=>setNotice(''),1800)}
  const visible=useMemo(()=>events.filter(e=>e.memberIds.some(x=>selected.includes(x))),[events,selected])
  const fc=visible.map(e=>{const m=members.find(x=>x.id===e.memberIds[0])??members[0];const color=e.kind==='homework-complete'?'#5f6368':m.color;return{id:e.id,title:e.title,start:e.start,end:e.end,allDay:e.allDay,backgroundColor:color,borderColor:color,extendedProps:{icons:e.kind?.startsWith('homework')?'📝':e.memberIds.map(x=>members.find(m=>m.id===x)?.icon).join(''),location:e.location,kind:e.kind,completed:e.completed}}})

  const save=async(e:FamilyEvent)=>{const d={...e,familyId:profile?.familyId??'family-default',updatedAt:new Date().toISOString()};if(firebaseEnabled&&db&&user){const firestore=db;await setDoc(doc(firestore,'events',e.id),d)}setEvents(p=>p.some(x=>x.id===e.id)?p.map(x=>x.id===e.id?{...e,familyId:d.familyId}:x):[...p,{...e,familyId:d.familyId}]);setModal(null);setNewEvent(null);flash('일정을 저장했습니다.')}
  const remove=async(e:FamilyEvent)=>{if(!confirm(`'${e.title}' 일정을 삭제할까요?`))return;if(firebaseEnabled&&db&&user){const firestore=db;await deleteDoc(doc(firestore,'events',e.id))}setEvents(p=>p.filter(x=>x.id!==e.id));setModal(null);flash('일정을 삭제했습니다.')}
  const openAdd=()=>{const s=new Date();s.setSeconds(0,0);s.setMinutes(Math.ceil(s.getMinutes()/30)*30);setNewEvent({id:makeId(),familyId:profile?.familyId??'family-default',memberIds:[],title:'',start:localDT(s),end:localDT(new Date(s.getTime()+3600000)),allDay:false,notification:0})}
  const selectDate=(i:DateSelectArg)=>setNewEvent({id:makeId(),familyId:profile?.familyId??'family-default',memberIds:[],title:'',start:localDT(i.start),end:localDT(i.end),allDay:i.allDay,notification:0})
  const move=async(i:EventDropArg|EventResizeDoneArg)=>{const old=events.find(e=>e.id===i.event.id);if(!old||!i.event.start)return;const next={...old,start:localDT(i.event.start),end:i.event.end?localDT(i.event.end):old.end};if(firebaseEnabled&&db&&user){const firestore=db;await updateDoc(doc(firestore,'events',old.id),next as any)}setEvents(p=>p.map(e=>e.id===old.id?next:e));flash('일정 시간이 변경되었습니다.')}
  const navigate=(a:'prev'|'next'|'today')=>cal.current?.getApi()[a]()
  const changeView=(v:ViewMode)=>{setView(v);cal.current?.getApi().changeView(v)}
  const dates=(a:DatesSetArg)=>{setView(a.view.type as ViewMode);setTitle(a.view.title);setNow(new Date())}
  const simpleLogin=async()=>{const family=loginFamily.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]/g,'');const name=loginName.trim();if(family.length<2)return alert('가족 코드를 2자 이상 입력해주세요.');if(!name)return alert('이름을 입력해주세요.');setLoginBusy(true);try{let u=user;if(firebaseEnabled&&auth&&!u){const r=await signInAnonymously(auth);u=r.user}const p:Profile={familyId:family,memberId:loginMember,name};if(firebaseEnabled&&db&&u){const firestore=db;await setDoc(doc(firestore,'members',u.uid),{...p,uid:u.uid,updatedAt:new Date().toISOString()},{merge:true})}setProfile(p);localStorage.setItem('family-scheduler-profile',JSON.stringify(p));setSelected([loginMember]);flash('로그인되었습니다.')}catch(e){console.error(e);alert('로그인에 실패했습니다. Firebase에서 익명 로그인을 활성화했는지 확인해주세요.')}finally{setLoginBusy(false)}}
  const logout=async()=>{localStorage.removeItem('family-scheduler-profile');setProfile(null);if(firebaseEnabled&&auth)await signOut(auth);setEvents(demoEvents)}

  const registerHomework=async()=>{
    if(!homeworkIds.length||!homeworkDate)return
    const selectedHomework=homeworks.filter(h=>homeworkIds.includes(h.id))
    const newHomework=selectedHomework.filter(h=>!events.some(e=>e.kind==='homework'&&e.homeworkId===h.id&&localDate(e.start)===homeworkDate&&!e.completed))
    if(!newHomework.length)return alert('선택한 숙제는 해당 날짜에 모두 이미 등록되어 있습니다.')
    if(newHomework.length<selectedHomework.length)alert('이미 등록된 숙제는 제외하고 등록합니다.')
    const created:FamilyEvent[]=newHomework.map(h=>({id:makeId(),familyId:profile?.familyId??'family-default',memberIds:['son'],title:`📝 ${h.name}`,start:`${homeworkDate}T00:00:00`,end:`${homeworkDate}T23:59:59`,allDay:true,kind:'homework',homeworkId:h.id,completed:false}))
    if(firebaseEnabled&&db&&user){const firestore=db;await Promise.all(created.map(e=>setDoc(doc(firestore,'events',e.id),e)))}
    setEvents(p=>[...p,...created]);setHomeworkOpen(false);setHomeworkIds([]);flash(`${created.length}개 숙제를 등록했습니다.`)
  }
  const toggleHomework=(id:string)=>setHomeworkIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])
  const completeHomework=async(e:FamilyEvent)=>{if(e.completed)return;const completedAt=new Date();const completedEvent:FamilyEvent={id:makeId(),familyId:profile?.familyId??e.familyId,memberIds:['son'],title:`✅ 숙제 완료 · ${e.title.replace(/^📝\s*/,'')}`,start:localDT(completedAt),end:localDT(new Date(completedAt.getTime()+15*60000)),allDay:false,kind:'homework-complete',homeworkId:e.homeworkId};const next={...e,title:`✅ ${e.title.replace(/^📝\s*/,'')}`,completed:true,completedAt:completedAt.toISOString()};if(firebaseEnabled&&db&&user){const firestore=db;await updateDoc(doc(firestore,'events',e.id),next as any);await setDoc(doc(firestore,'events',completedEvent.id),completedEvent)}setEvents(p=>[...p.map(x=>x.id===e.id?next:x),completedEvent]);setModal(null);flash('숙제를 완료했습니다. 완료 시간이 기록되었습니다.')}
  const addHomework=()=>{const name=homeworkName.trim();if(!name)return;if(homeworks.some(h=>h.name===name))return alert('이미 등록된 숙제입니다.');setHomeworks(p=>sortHomework([...p,{id:makeId(),name}]));setHomeworkName('');flash('숙제 항목을 추가했습니다.')}
  const updateHomework=()=>{if(!editingHomework)return;const name=homeworkName.trim();if(!name)return;if(homeworks.some(h=>h.id!==editingHomework.id&&h.name===name))return alert('이미 등록된 숙제입니다.');setHomeworks(p=>sortHomework(p.map(h=>h.id===editingHomework.id?{...h,name}:h)));setEditingHomework(null);setHomeworkName('');flash('숙제 항목을 수정했습니다.')}
  const deleteHomework=(h:Homework)=>{if(!confirm(`'${h.name}' 숙제 항목을 삭제할까요?`))return;setHomeworks(p=>p.filter(x=>x.id!==h.id));setHomeworkIds(p=>p.filter(id=>id!==h.id));if(editingHomework?.id===h.id){setEditingHomework(null);setHomeworkName('')}flash('숙제 항목을 삭제했습니다.')}

  if(authLoading)return <div className="auth-screen"><div className="auth-card"><div className="brand-icon">📅</div><h1>우리 가족 스케줄러</h1><p>로그인 정보를 확인하고 있습니다...</p></div></div>
  if(firebaseEnabled&&(!user||!profile))return <div className="auth-screen"><div className="auth-card"><div className="brand-icon">📅</div><h1>우리 가족 스케줄러</h1><p>가족 코드만 입력하면 간단하게 사용할 수 있습니다.</p><label>가족 코드<input value={loginFamily} onChange={e=>setLoginFamily(e.target.value)} placeholder="예: 우리집2026" autoFocus/></label><label>내 이름<input value={loginName} onChange={e=>setLoginName(e.target.value)} placeholder="예: 아빠"/></label><label>나는 누구<select value={loginMember} onChange={e=>setLoginMember(e.target.value as MemberId)}><option value="me">👨 아빠</option><option value="wife">👩 엄마</option><option value="son">👦 강천</option></select></label><button className="login-btn" disabled={loginBusy} onClick={simpleLogin}>{loginBusy?'로그인 중...':'로그인'}</button><small>가족 모두 같은 가족 코드를 사용하면 같은 일정을 함께 볼 수 있습니다.</small></div></div>

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-icon">📅</span><span>우리 가족 스케줄러</span></div>
      <div className="nav-controls"><button className="today-btn" onClick={()=>navigate('today')}>오늘</button><button className="icon-btn" onClick={()=>navigate('prev')}>‹</button><button className="icon-btn" onClick={()=>navigate('next')}>›</button><span className="current-title">{title}</span></div>
      <div className="account"><span>{profile?`${members.find(m=>m.id===profile.memberId)?.icon??''} ${profile.name}`:''}</span><button onClick={logout}>로그아웃</button></div>
      <button className="homework-btn" onClick={()=>{setHomeworkDate(localDate(new Date()));setHomeworkIds([]);setHomeworkOpen(true)}}>📝 숙제 체크</button>
      <button className="add-btn" onClick={openAdd}>＋ 일정 추가</button>
    </header>
    <section className="toolbar"><div className="filters"><span className="filter-title">가족</span>{members.map(m=><label className="member-filter" key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={()=>setSelected(p=>p.includes(m.id)?p.filter(x=>x!==m.id):[...p,m.id])}/><span className="check-dot" style={{background:m.color}}>{m.icon}</span>{m.label}</label>)}</div><div className="view-switcher">{([['dayGridMonth','월'],['timeGridWeek','주'],['timeGridDay','일']]as [ViewMode,string][]).map(([v,l])=><button key={v} className={view===v?'active':''} onClick={()=>changeView(v)}>{l}</button>)}</div></section>
    <main className="calendar-wrap"><FullCalendar ref={cal} plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]} locale={koLocale} initialView="timeGridWeek" headerToolbar={{left:'title',center:'',right:''}} nowIndicator selectable selectMirror editable eventResizableFromStart slotMinTime="07:00:00" slotMaxTime="23:00:00" scrollTime="08:00:00" slotDuration="00:30:00" allDaySlot dayMaxEvents={4} height="calc(100vh - 145px)" events={fc} select={selectDate} eventClick={(i:EventClickArg)=>setModal(events.find(e=>e.id===i.event.id)??null)} eventDrop={move} eventResize={move} datesSet={dates} now={now} eventContent={a=><div className="event-content"><strong>{a.event.extendedProps.icons} {a.event.title.replace(/^[📝✅]\s*/,'')}</strong>{a.event.extendedProps.location&&<small>📍 {a.event.extendedProps.location}</small>}{a.event.extendedProps.kind==='homework'&&<small>{a.event.extendedProps.completed?'완료':'클릭하여 완료'}</small>}</div>}/></main>
    <section className="today-summary"><div className="summary-head"><strong>오늘 일정</strong><span>{now.toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}</span></div><div className="summary-list">{events.filter(e=>new Date(e.start).toDateString()===now.toDateString()&&e.memberIds.some(x=>selected.includes(x))).sort((a,b)=>a.start.localeCompare(b.start)).map(e=><button key={e.id} className="summary-item" onClick={()=>setModal(e)}><span>{e.allDay?'종일':new Date(e.start).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}</span><b>{e.kind?.startsWith('homework')?'📝':e.memberIds.map(x=>members.find(m=>m.id===x)?.icon).join('')} {e.title.replace(/^[📝✅]\s*/,'')}</b><small>{e.kind==='homework'?(e.completed?'숙제 완료':'숙제 미완료'):e.memberIds.map(x=>members.find(m=>m.id===x)?.label).join(' · ')}</small></button>)}</div></section>
    {notice&&<div className="toast">✓ {notice}</div>}
    {(modal||newEvent)&&<EventModal event={(modal??newEvent)!} isNew={!modal} onClose={()=>{setModal(null);setNewEvent(null)}} onSave={save} onDelete={remove} requestNotification={async()=>{if('Notification'in window)await Notification.requestPermission()}} onCompleteHomework={completeHomework}/>} 
    {homeworkOpen&&<HomeworkModal homeworks={homeworks} homeworkIds={homeworkIds} toggleHomework={toggleHomework} homeworkDate={homeworkDate} setHomeworkDate={setHomeworkDate} onRegister={registerHomework} editingHomework={editingHomework} setEditingHomework={setEditingHomework} homeworkName={homeworkName} setHomeworkName={setHomeworkName} onAdd={addHomework} onUpdate={updateHomework} onDelete={deleteHomework} onClose={()=>{setHomeworkOpen(false);setEditingHomework(null);setHomeworkName('')}}/>}
  </div>
}

function EventModal({event,isNew,onClose,onSave,onDelete,requestNotification,onCompleteHomework}:{event:FamilyEvent|Partial<FamilyEvent>;isNew:boolean;onClose:()=>void;onSave:(e:FamilyEvent)=>void;onDelete:(e:FamilyEvent)=>void;requestNotification:()=>Promise<void>;onCompleteHomework:(e:FamilyEvent)=>void}){
  const [form,setForm]=useState<FamilyEvent>({id:event.id??makeId(),familyId:event.familyId??'family-default',memberIds:Array.isArray(event.memberIds)?event.memberIds:[],title:event.title??'',start:event.start??'',end:event.end??'',allDay:event.allDay??false,location:event.location??'',memo:event.memo??'',notification:event.notification??0,recurrence:event.recurrence,kind:event.kind??'event',homeworkId:event.homeworkId,completed:event.completed??false,completedAt:event.completedAt})
  const set=(k:keyof FamilyEvent,v:any)=>setForm(p=>({...p,[k]:v}))
  const toggle=(id:MemberId)=>setForm(p=>({...p,memberIds:p.memberIds.includes(id)?p.memberIds.filter(x=>x!==id):[...p.memberIds,id]}))
  if(form.kind==='homework')return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal homework-complete-modal"><div className="modal-header"><h2>📝 숙제 확인</h2><button onClick={onClose}>×</button></div><div className="homework-detail"><div className={form.completed?'homework-status done':'homework-status'}>{form.completed?'✓ 숙제 완료':'□ 숙제 미완료'}</div><h3>{form.title.replace(/^📝\s*/,'').replace(/^✅\s*/,'')}</h3><p>숙제 날짜: {form.start.slice(0,10)}</p>{form.completed&&form.completedAt&&<p>완료 시간: {new Date(form.completedAt).toLocaleString('ko-KR')}</p>}</div><div className="modal-actions">{!form.completed&&<button className="complete-btn" onClick={()=>onCompleteHomework(form)}>✓ 완료</button>}<span/>{!isNew&&<button className="delete-btn" onClick={()=>onDelete(form)}>삭제</button>}<button onClick={onClose}>닫기</button></div></div></div>
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal"><div className="modal-header"><h2>{isNew?'일정 추가':'일정 수정'}</h2><button onClick={onClose}>×</button></div><label>누구 <span className="field-hint">복수 선택 가능</span><div className="member-picker">{members.map(m=><button type="button" key={m.id} className={form.memberIds.includes(m.id)?'member-chip selected':'member-chip'} onClick={()=>toggle(m.id)}><span style={{background:m.color}}>{m.icon}</span>{m.label}</button>)}</div></label><label>제목<input autoFocus value={form.title} onChange={e=>set('title',e.target.value)} placeholder="예: 수학학원"/></label><div className="form-grid"><label>시작<input type="datetime-local" value={form.start} onChange={e=>set('start',e.target.value)}/></label><label>종료<input type="datetime-local" value={form.end??''} onChange={e=>set('end',e.target.value)}/></label></div><label>반복<select value={form.recurrence?.type??'none'} onChange={e=>set('recurrence',e.target.value==='none'?undefined:{type:e.target.value})}><option value="none">반복 안 함</option><option value="daily">매일</option><option value="weekday">평일</option><option value="weekly">매주</option><option value="monthly">매월</option><option value="yearly">매년</option></select></label><label>알림<select value={form.notification??0} onChange={async e=>{const n=Number(e.target.value);set('notification',n);if(n)await requestNotification()}}><option value="0">알림 없음</option><option value="1">정시</option><option value="5">5분 전</option><option value="10">10분 전</option><option value="30">30분 전</option><option value="60">1시간 전</option><option value="1440">1일 전</option></select></label><label>장소<input value={form.location??''} onChange={e=>set('location',e.target.value)} placeholder="예: OO학원"/></label><label>메모<textarea rows={3} value={form.memo??''} onChange={e=>set('memo',e.target.value)} placeholder="메모를 입력하세요"/></label><div className="modal-actions">{!isNew&&<button className="delete-btn" onClick={()=>onDelete(form)}>삭제</button>}<span/><button onClick={onClose}>취소</button><button className="save-btn" onClick={()=>{if(!form.title.trim())return alert('일정 제목을 입력해주세요.');if(!form.memberIds.length)return alert('최소 한 명을 선택해주세요.');onSave(form)}}>저장</button></div></div></div>
}

function HomeworkModal({homeworks,homeworkIds,toggleHomework,homeworkDate,setHomeworkDate,onRegister,editingHomework,setEditingHomework,homeworkName,setHomeworkName,onAdd,onUpdate,onDelete,onClose}:{homeworks:Homework[];homeworkIds:string[];toggleHomework:(id:string)=>void;homeworkDate:string;setHomeworkDate:(v:string)=>void;onRegister:()=>void;editingHomework:Homework|null;setEditingHomework:(v:Homework|null)=>void;homeworkName:string;setHomeworkName:(v:string)=>void;onAdd:()=>void;onUpdate:()=>void;onDelete:(h:Homework)=>void;onClose:()=>void}){
  return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className="modal homework-modal"><div className="modal-header"><h2>📝 숙제 체크</h2><button onClick={onClose}>×</button></div>
    <div className="homework-register"><h3>숙제 등록 <span className="field-hint">여러 개 선택 가능</span></h3><div className="homework-card-grid">{homeworks.map(h=><button type="button" key={h.id} className={homeworkIds.includes(h.id)?'homework-card selected':'homework-card'} onClick={()=>toggleHomework(h.id)}><span className="homework-card-check">{homeworkIds.includes(h.id)?'✓':'□'}</span><span>{h.name}</span></button>)}</div><label>날짜<input type="date" value={homeworkDate} onChange={e=>setHomeworkDate(e.target.value)}/></label><button className="save-btn full-btn" disabled={!homeworkIds.length} onClick={onRegister}>＋ 선택한 숙제 {homeworkIds.length?`${homeworkIds.length}개`:''} 등록</button></div>
    <div className="homework-manage"><h3>숙제 항목 관리 <span>오름차순</span></h3><div className="homework-add-row"><input value={homeworkName} onChange={e=>setHomeworkName(e.target.value)} placeholder={editingHomework?'수정할 숙제 이름':'새 숙제 이름'}/>{editingHomework?<><button onClick={onUpdate}>수정</button><button onClick={()=>{setEditingHomework(null);setHomeworkName('')}}>취소</button></>:<button onClick={onAdd}>＋ 추가</button>}</div><div className="homework-list">{homeworks.map(h=><div className="homework-row" key={h.id}><span>📝 {h.name}</span><div><button onClick={()=>{setEditingHomework(h);setHomeworkName(h.name)}}>수정</button><button className="delete-btn" onClick={()=>onDelete(h)}>삭제</button></div></div>)}</div></div>
    <div className="modal-actions"><span/><button onClick={onClose}>닫기</button></div>
  </div></div>
}

export default App
