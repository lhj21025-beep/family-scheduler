import { useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import koLocale from '@fullcalendar/core/locales/ko'
import type { EventClickArg } from '@fullcalendar/core'

type MemberId = 'me' | 'wife' | 'son'
type EventItem = { id:string; title:string; start:string; end?:string; allDay?:boolean; memberIds:MemberId[]; kind?:'event'|'homework'|'homework-complete'; homeworkId?:string; completed?:boolean; completedAt?:string; location?:string; memo?:string }
type Homework = { id:string; name:string }

const members = [
  {id:'me' as MemberId,label:'아빠',icon:'👨',color:'#4285f4'},
  {id:'wife' as MemberId,label:'엄마',icon:'👩',color:'#9c6ade'},
  {id:'son' as MemberId,label:'강천',icon:'👦',color:'#34a853'},
]
const defaultHomework:Homework[] = [
  {id:'eli-english',name:'엘리하이(영어)'},{id:'eli-math',name:'엘리하이(수학)'},{id:'eli-science',name:'엘리하이(과학)'},
  {id:'eli-social',name:'엘리하이(사회)'},{id:'eli-korean',name:'엘리하이(국어)'},{id:'hanja',name:'한자'},
  {id:'math-calc',name:'수학 연산'},{id:'pretty-writing',name:'예쁜 글씨 쓰기'},{id:'art',name:'미술학원 숙제'},
]
const pad=(n:number)=>String(n).padStart(2,'0')
const dateKey=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const dateTime=(d:Date)=>`${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const uid=()=>crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`

const demo:EventItem[] = [
  {id:'school',title:'학교',start:'2026-09-10T08:50:00',end:'2026-09-10T15:10:00',memberIds:['son']},
  {id:'math',title:'수학학원',start:'2026-09-10T16:00:00',end:'2026-09-10T17:30:00',memberIds:['son']},
  {id:'exercise',title:'운동',start:'2026-09-10T18:30:00',end:'2026-09-10T19:30:00',memberIds:['wife']},
  {id:'gym',title:'헬스',start:'2026-09-10T20:00:00',end:'2026-09-10T21:30:00',memberIds:['me']},
]

export default function App(){
  const [events,setEvents]=useState<EventItem[]>(()=>{try{const x=localStorage.getItem('family-scheduler-events');return x?JSON.parse(x):demo}catch{return demo}})
  const [selected,setSelected]=useState<MemberId[]>(()=>{try{const x=localStorage.getItem('family-scheduler-members');return x?JSON.parse(x):['me','wife','son']}catch{return ['me','wife','son']}})
  const [homeworks,setHomeworks]=useState<Homework[]>(()=>{try{const x=localStorage.getItem('family-scheduler-homeworks');return x?JSON.parse(x):defaultHomework}catch{return defaultHomework}})
  const [homeworkOpen,setHomeworkOpen]=useState(false)
  const [manageOpen,setManageOpen]=useState(false)
  const [homeworkDate,setHomeworkDate]=useState(dateKey(new Date()))
  const [homeworkIds,setHomeworkIds]=useState<string[]>([])
  const [homeworkName,setHomeworkName]=useState('')
  const [editing,setEditing]=useState<Homework|null>(null)
  const [modal,setModal]=useState<EventItem|null>(null)
  const [notice,setNotice]=useState('')

  useEffect(()=>localStorage.setItem('family-scheduler-events',JSON.stringify(events)),[events])
  useEffect(()=>localStorage.setItem('family-scheduler-members',JSON.stringify(selected)),[selected])
  useEffect(()=>localStorage.setItem('family-scheduler-homeworks',JSON.stringify(homeworks)),[homeworks])
  const flash=(s:string)=>{setNotice(s);setTimeout(()=>setNotice(''),1800)}
  const visible=useMemo(()=>events.filter(e=>e.memberIds.some(m=>selected.includes(m))),[events,selected])
  const calendarEvents=visible.map(e=>{
    const m=members.find(x=>x.id===e.memberIds[0])??members[0]
    const gray=e.kind==='homework-complete'||(e.kind==='homework'&&e.completed)
    const color=gray?'#9aa0a6':m.color
    return {...e,backgroundColor:color,borderColor:color}
  })

  const addSchedule=(arg:any)=>{
    const start=new Date(arg.date); const end=new Date(start.getTime()+60*60000)
    setModal({id:uid(),title:'',start:dateTime(start),end:dateTime(end),memberIds:[],allDay:false,kind:'event'})
  }
  const clickEvent=(arg:EventClickArg)=>{const e=events.find(x=>x.id===arg.event.id);if(e)setModal(e)}
  const saveEvent=(e:EventItem)=>{if(!e.title.trim())return alert('일정 제목을 입력해주세요.');if(!e.memberIds.length)return alert('최소 한 명을 선택해주세요.');setEvents(p=>p.some(x=>x.id===e.id)?p.map(x=>x.id===e.id?e:x):[...p,e]);setModal(null);flash('일정을 저장했습니다.')}
  const deleteEvent=(e:EventItem)=>{if(!confirm(`'${e.title}' 일정을 삭제할까요?`))return;setEvents(p=>p.filter(x=>x.id!==e.id));setModal(null);flash('일정을 삭제했습니다.')}
  const registerHomework=()=>{
    if(!homeworkIds.length)return
    const chosen=homeworks.filter(h=>homeworkIds.includes(h.id))
    const fresh=chosen.filter(h=>!events.some(e=>e.kind==='homework'&&e.homeworkId===h.id&&e.start.slice(0,10)===homeworkDate&&!e.completed))
    const created=fresh.map(h=>({id:uid(),title:`📝 ${h.name}`,start:`${homeworkDate}T00:00:00`,end:`${homeworkDate}T23:59:59`,allDay:true,memberIds:['son'] as MemberId[],kind:'homework' as const,homeworkId:h.id,completed:false}))
    if(!created.length)return alert('선택한 숙제는 해당 날짜에 모두 이미 등록되어 있습니다.')
    setEvents(p=>[...p,...created]);setHomeworkOpen(false);setHomeworkIds([]);flash(`${created.length}개 숙제를 등록했습니다.`)
  }
  const completeHomework=(e:EventItem)=>{
    if(e.completed)return
    const now=new Date()
    const next={...e,title:`✅ ${e.title.replace(/^📝\s*/,'')}`,completed:true,completedAt:now.toISOString()}
    const record:EventItem={id:uid(),title:`✅ 숙제 완료 · ${e.title.replace(/^📝\s*/,'')}`,start:dateTime(now),end:dateTime(new Date(now.getTime()+15*60000)),memberIds:['son'],kind:'homework-complete',homeworkId:e.homeworkId}
    setEvents(p=>[...p.map(x=>x.id===e.id?next:x),record]);setModal(null);flash('숙제를 완료했습니다.')
  }
  const addHomework=()=>{const n=homeworkName.trim();if(!n)return;if(homeworks.some(h=>h.name===n))return alert('이미 등록된 숙제입니다.');setHomeworks(p=>[...p,{id:uid(),name:n}].sort((a,b)=>a.name.localeCompare(b.name,'ko')));setHomeworkName('')}
  const updateHomework=()=>{if(!editing)return;const n=homeworkName.trim();if(!n)return;setHomeworks(p=>p.map(h=>h.id===editing.id?{...h,name:n}:h).sort((a,b)=>a.name.localeCompare(b.name,'ko')));setEditing(null);setHomeworkName('')}
  const deleteHomework=(h:Homework)=>{if(!confirm(`'${h.name}' 숙제 항목을 삭제할까요?`))return;setHomeworks(p=>p.filter(x=>x.id!==h.id));setHomeworkIds(p=>p.filter(x=>x!==h.id))}

  return <div className="app-shell">
    <header className="topbar"><div className="brand"><span>📅</span><strong>우리 가족 스케줄러</strong></div><div className="top-actions"><button className="homework-btn" onClick={()=>{setHomeworkDate(dateKey(new Date()));setHomeworkIds([]);setManageOpen(false);setHomeworkOpen(true)}}>📝 숙제 체크</button><button className="add-btn" onClick={()=>setModal({id:uid(),title:'',start:dateTime(new Date()),end:dateTime(new Date(Date.now()+3600000)),memberIds:[],kind:'event'})}>＋ 일정 추가</button></div></header>
    <div className="member-filter">{members.map(m=><label key={m.id}><input type="checkbox" checked={selected.includes(m.id)} onChange={()=>setSelected(p=>p.includes(m.id)?p.filter(x=>x!==m.id):[...p,m.id])}/><span style={{color:m.color}}>{m.icon} {m.label}</span></label>)}</div>
    <main className="calendar-wrap"><FullCalendar plugins={[dayGridPlugin,timeGridPlugin,interactionPlugin]} initialView="timeGridWeek" locale={koLocale} height="calc(100vh - 125px)" headerToolbar={{left:'prev,next today',center:'title',right:'dayGridMonth,timeGridWeek,timeGridDay'}} buttonText={{today:'오늘',month:'월',week:'주',day:'일'}} events={calendarEvents} editable selectable dateClick={addSchedule} eventClick={clickEvent} nowIndicator allDaySlot weekends={true}/></main>
    {notice&&<div className="toast">✓ {notice}</div>}
    {homeworkOpen&&<div className="modal-backdrop"><div className="modal homework-modal"><div className="modal-header"><h2>📝 숙제 체크</h2><button onClick={()=>setHomeworkOpen(false)}>×</button></div><h3>숙제 등록 <span className="field-hint">여러 개 선택 가능</span></h3><div className="homework-card-grid">{homeworks.map(h=><button type="button" key={h.id} className={homeworkIds.includes(h.id)?'homework-card selected':'homework-card'} onClick={()=>setHomeworkIds(p=>p.includes(h.id)?p.filter(x=>x!==h.id):[...p,h.id])}><span>{homeworkIds.includes(h.id)?'✓':'□'}</span> {h.name}</button>)}</div><label>날짜<input type="date" value={homeworkDate} onChange={e=>setHomeworkDate(e.target.value)}/></label><div className="homework-modal-actions"><button className="save-btn" disabled={!homeworkIds.length} onClick={registerHomework}>＋ 선택한 숙제 {homeworkIds.length?`${homeworkIds.length}개`:''} 등록</button><button className="manage-btn" onClick={()=>setManageOpen(p=>!p)}>{manageOpen?'▲ 수정 닫기':'⚙ 숙제 수정'}</button></div>{manageOpen&&<div className="homework-manage"><h3>숙제 항목 관리</h3><div className="homework-add-row"><input value={homeworkName} onChange={e=>setHomeworkName(e.target.value)} placeholder={editing?'수정할 숙제 이름':'새 숙제 이름'}/>{editing?<><button onClick={updateHomework}>수정</button><button onClick={()=>{setEditing(null);setHomeworkName('')}}>취소</button></>:<button onClick={addHomework}>＋ 추가</button>}</div>{homeworks.map(h=><div className="homework-row" key={h.id}><span>{h.name}</span><span><button onClick={()=>{setEditing(h);setHomeworkName(h.name)}}>수정</button><button onClick={()=>deleteHomework(h)}>삭제</button></span></div>)}</div>}</div></div>}
    {modal&&<ScheduleModal event={modal} onClose={()=>setModal(null)} onSave={saveEvent} onDelete={deleteEvent} onComplete={completeHomework}/>} 
  </div>
}

function ScheduleModal({event,onClose,onSave,onDelete,onComplete}:{event:EventItem;onClose:()=>void;onSave:(e:EventItem)=>void;onDelete:(e:EventItem)=>void;onComplete:(e:EventItem)=>void}){
  const [e,setE]=useState(event)
  if(e.kind==='homework')return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><h2>📝 숙제 확인</h2><button onClick={onClose}>×</button></div><div className="homework-detail"><div>{e.completed?'✓ 숙제 완료':'□ 숙제 미완료'}</div><h3>{e.title.replace(/^📝\s*/,'').replace(/^✅\s*/,'')}</h3><p>숙제 날짜: {e.start.slice(0,10)}</p>{e.completed&&e.completedAt&&<p>완료 시간: {new Date(e.completedAt).toLocaleString('ko-KR')}</p>}</div><div className="modal-actions">{!e.completed&&<button className="complete-btn" onClick={()=>onComplete(e)}>✓ 완료</button>}<span/><button onClick={onClose}>닫기</button></div></div></div>
  return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><h2>일정 {event.title?'수정':'추가'}</h2><button onClick={onClose}>×</button></div><label>누구<div className="member-picker">{members.map(m=><button type="button" key={m.id} className={e.memberIds.includes(m.id)?'member-chip selected':'member-chip'} onClick={()=>setE(p=>({...p,memberIds:p.memberIds.includes(m.id)?p.memberIds.filter(x=>x!==m.id):[...p.memberIds,m.id]}))}>{m.icon} {m.label}</button>)}</div></label><label>제목<input autoFocus value={e.title} onChange={x=>setE(p=>({...p,title:x.target.value}))}/></label><label>시작<input type="datetime-local" value={e.start} onChange={x=>setE(p=>({...p,start:x.target.value}))}/></label><label>종료<input type="datetime-local" value={e.end??''} onChange={x=>setE(p=>({...p,end:x.target.value}))}/></label><label>장소<input value={e.location??''} onChange={x=>setE(p=>({...p,location:x.target.value}))}/></label><label>메모<textarea value={e.memo??''} onChange={x=>setE(p=>({...p,memo:x.target.value}))}/></label><div className="modal-actions">{event.title&&<button className="delete-btn" onClick={()=>onDelete(e)}>삭제</button>}<span/><button onClick={onClose}>취소</button><button className="save-btn" onClick={()=>onSave(e)}>저장</button></div></div></div>
}
