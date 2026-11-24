import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  DailySpellingQuiz, SpellingMember, fallbackQuiz, isCorrect, kstDay, shiftedDay, spellingChoices, spellingChoicePrompt, needsQuizUpgrade, detailedExplanation,
} from "./spellingQuiz";
import { ENGLISH_START_DAY, fallbackEnglishQuiz, needsEnglishQuiz } from "./englishQuiz";
import { rankingMonths, rankingMonthRange, rankingWeeks, rankingWeekRange } from "./rankingPeriod";
import "./spelling.css";
import { analyzeLearning, type WrongQuestion } from "./quizAnalytics";

const people: { id: SpellingMember; label: string }[] = [
  { id: "me", label: "아빠" },
  { id: "wife", label: "엄마" },
  { id: "son", label: "강천" },
];

type DayRow = { date: string; spellingQuiz?: DailySpellingQuiz; englishQuiz?: DailySpellingQuiz };
type QuizView = "today" | "missed" | "history";
type QuizSubject = "spelling" | "english";
type RankSubject = "total" | QuizSubject;
const SPELLING_START_DAY = "2026-10-22";

function weekStart(day: string): string {
  const date = new Date(day + "T12:00:00Z");
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftedDay(day, -mondayOffset);
}

export default function SpellingQuiz({
  member, close,
}: { member: SpellingMember; close: () => void }) {
  const today = kstDay();
  const [todayQuiz, setTodayQuiz] = useState<DailySpellingQuiz | null>(null);
  const [todayEnglishQuiz, setTodayEnglishQuiz] = useState<DailySpellingQuiz | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rankMode, setRankMode] = useState<"weekly" | "monthly">("weekly");
  const [rankSubject, setRankSubject] = useState<RankSubject>("total");
  const [rankWeek, setRankWeek] = useState(weekStart(today));
  const [rankMonth, setRankMonth] = useState(today.slice(0, 7));
  const [rankDays, setRankDays] = useState<DayRow[]>([]);
  const [rankLoading, setRankLoading] = useState(true);
  const [rankError, setRankError] = useState("");
  const [rankLoadedKey, setRankLoadedKey] = useState("");
  const [view, setView] = useState<QuizView>("today");
  const [selectedDate, setSelectedDate] = useState(today);
  const [subject, setSubject] = useState<QuizSubject>("spelling");
  const [page, setPage] = useState<'overview' | 'study' | 'review' | 'ranking'>('overview');
  const [reviewMember, setReviewMember] = useState<SpellingMember>(member);
  const [reviewSubject, setReviewSubject] = useState<RankSubject>('total');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);

  const months = rankingMonths(SPELLING_START_DAY, today);
  const weeks = rankingWeeks(SPELLING_START_DAY, today);
  const monthRange = rankingMonthRange(rankMonth, today);
  const weekRange = rankingWeekRange(rankWeek, today);
  const historyFrom = SPELLING_START_DAY > shiftedDay(today, -365)
    ? SPELLING_START_DAY
    : shiftedDay(today, -365);

  useEffect(() => {
    const ref = doc(db, "scheduleDays", today);
    const stop = onSnapshot(ref, snap => {
      const item = snap.data() as DayRow | undefined;
      setTodayQuiz(item?.spellingQuiz ?? null);
      setTodayEnglishQuiz(item?.englishQuiz ?? null);
      if (item?.spellingQuiz && !needsQuizUpgrade(item.spellingQuiz) &&
          item?.englishQuiz && !needsEnglishQuiz(item.englishQuiz)) setLoading(false);
    }, err => {
      setError("오늘 시험을 불러오지 못했습니다: " + err.message);
      setLoading(false);
    });

    const historyQuery = query(
      collection(db, "scheduleDays"),
      where("date", ">=", historyFrom),
      where("date", "<=", today),
    );
    const stopHistory = onSnapshot(historyQuery, snapshot => {
      setHistoryLoading(false); setHistoryError('');
      setDays(
        snapshot.docs
          .map(s => s.data() as DayRow)
          .filter(row => !!row.spellingQuiz || !!row.englishQuiz)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    }, err => { setHistoryLoading(false); setHistoryError("학습 기록을 불러오지 못했습니다: " + err.message); });

    let cancelled = false;
    async function ensure() {
      try {
        const existingSnap = await getDocs(query(
          collection(db, "scheduleDays"),
          where("date", ">=", historyFrom),
          where("date", "<=", today),
        ));
        const existing = new Map(
          existingSnap.docs.map(s => {
            const row = s.data() as DayRow;
            return [s.id, row] as const;
          }),
        );
        const previous: DailySpellingQuiz[] = [];
        let day = historyFrom;

        while (day < today) {
          const dayRef = doc(db, "scheduleDays", day);
          const saved = existing.get(day)?.spellingQuiz;
          const live = !needsQuizUpgrade(saved) ? saved! : await runTransaction(db, async tx => {
            const snap = await tx.get(dayRef);
            const current = (snap.data() as DayRow | undefined)?.spellingQuiz;
            if (current && !needsQuizUpgrade(current)) return current;
            const generated = fallbackQuiz(day, previous);
            tx.set(dayRef, { date: day, spellingQuiz: generated }, { merge: true });
            return generated;
          });
          previous.push(live);
          day = shiftedDay(day, 1);
        }

        await runTransaction(db, async tx => {
          const snap = await tx.get(ref);
          const current = (snap.data() as DayRow | undefined)?.spellingQuiz;
          if (current && !needsQuizUpgrade(current)) return current;
          const generated = fallbackQuiz(today, previous);
          tx.set(ref, { date: today, spellingQuiz: generated }, { merge: true });
          return generated;
        });
        if (today >= ENGLISH_START_DAY) {
          const englishPrevious: DailySpellingQuiz[] = [];
          let englishDay = ENGLISH_START_DAY;
          while (englishDay <= today) {
            const englishRef = doc(db, "scheduleDays", englishDay);
            const saved = existing.get(englishDay)?.englishQuiz;
            const live = !needsEnglishQuiz(saved) ? saved! : await runTransaction(db, async tx => {
              const snap = await tx.get(englishRef);
              const current = (snap.data() as DayRow | undefined)?.englishQuiz;
              if (current && !needsEnglishQuiz(current)) return current;
              const generated = fallbackEnglishQuiz(englishDay, englishPrevious);
              tx.set(englishRef, { date: englishDay, englishQuiz: generated }, { merge: true });
              return generated;
            });
            englishPrevious.push(live);
            englishDay = shiftedDay(englishDay, 1);
          }
        }
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "시험 문제 준비에 실패했습니다.");
          setLoading(false);
        }
      }
    }
    void ensure();
    return () => { cancelled = true; stop(); stopHistory(); };
  }, [today, historyFrom]);

  const todayRow = useMemo<DayRow | undefined>(() => {
    const historyToday = days.find(d => d.date === today);
    return historyToday ?? (todayQuiz || todayEnglishQuiz ? {
      date: today,
      spellingQuiz: todayQuiz ?? undefined,
      englishQuiz: todayEnglishQuiz ?? undefined,
    } : undefined);
  }, [days, today, todayQuiz, todayEnglishQuiz]);

  const allQuizDays = useMemo(() => {
    const map = new Map<string, DayRow>();
    days.forEach(day => map.set(day.date, day));
    if (todayRow) map.set(today, todayRow);
    return [...map.values()].filter(day => !!day.spellingQuiz || !!day.englishQuiz).sort((a, b) => b.date.localeCompare(a.date));
  }, [days, todayRow, today]);

  const missedDays = useMemo(
    () => allQuizDays.filter(day => {
      const quiz = subject === "spelling" ? day.spellingQuiz : day.englishQuiz;
      return day.date < today && !!quiz && !quiz.submissions?.[member];
    }),
    [allQuizDays, today, member, subject],
  );

  const activeRow = selectedDate === today
    ? todayRow
    : allQuizDays.find(day => day.date === selectedDate);
  const activeQuiz = (subject === "spelling" ? activeRow?.spellingQuiz : activeRow?.englishQuiz) ?? null;
  const mySubmission = activeQuiz?.submissions?.[member];

  useEffect(() => {
    setAnswers(["", "", ""]);
  }, [selectedDate, member, subject, activeQuiz?.questions.map(q => q.id).join(",")]);

  const rankStart = rankMode === "weekly" ? weekRange.start : monthRange.start;
  const rankEnd = rankMode === "weekly" ? weekRange.end : monthRange.end;
  const rankKey = rankStart + "/" + rankEnd;
  useEffect(() => {
    setRankLoading(true);
    setRankError("");
    setRankDays([]);
    // Fetch the selected period directly: rankings are not limited to the
    // one-year quiz-history/backfill window and never create old quizzes.
    return onSnapshot(query(collection(db, "scheduleDays"),
      where("date", ">=", rankStart), where("date", "<=", rankEnd)), snapshot => {
      setRankDays(snapshot.docs.map(s => s.data() as DayRow));
      setRankLoadedKey(rankKey);
      setRankLoading(false);
    }, err => {
      setRankLoadedKey(rankKey);
      setRankLoading(false);
      setRankError("순위를 불러오지 못했습니다: " + err.message);
    });
  }, [rankStart, rankEnd, rankKey]);

  const ranking = useMemo(() => {
    return people.map(p => {
      const spellingSubmissions = rankDays
        .map(d => d.spellingQuiz?.submissions?.[p.id])
        .filter((s): s is NonNullable<typeof s> => !!s);
      const englishSubmissions = rankDays
        .map(d => d.englishQuiz?.submissions?.[p.id])
        .filter((s): s is NonNullable<typeof s> => !!s);
      const spellingScore = spellingSubmissions.reduce((n, s) => n + s.score, 0);
      const englishScore = englishSubmissions.reduce((n, s) => n + s.score, 0);
      const score = rankSubject === "spelling" ? spellingScore : rankSubject === "english" ? englishScore : spellingScore + englishScore;
      const played = rankSubject === "spelling" ? spellingSubmissions.length : rankSubject === "english" ? englishSubmissions.length : spellingSubmissions.length + englishSubmissions.length;
      return { ...p, score, played, spellingScore, englishScore,
        spellingPlayed: spellingSubmissions.length, englishPlayed: englishSubmissions.length };
    }).sort((a, b) =>
      b.score - a.score || b.played - a.played ||
      people.findIndex(p => p.id === a.id) - people.findIndex(p => p.id === b.id)
    );
  }, [rankDays, rankSubject]);

  function selectView(next: QuizView) {
    setView(next);
    setError("");
    setAnswers(["", "", ""]);
    if (next === "today") setSelectedDate(today);
    else if (next === "missed" && missedDays.length) setSelectedDate(missedDays[0].date);
    else if (next === "history" && allQuizDays.length) setSelectedDate(allQuizDays[0].date);
  }

  const questionChoices = (question: DailySpellingQuiz["questions"][number]) =>
    subject === "spelling" ? spellingChoices(question) : question.options ?? [];
  const questionPrompt = (question: DailySpellingQuiz["questions"][number]) =>
    subject === "spelling" ? spellingChoicePrompt(question) : question.prompt;
  const questionExplanation = (question: DailySpellingQuiz["questions"][number]) =>
    subject === "spelling" ? detailedExplanation(question) : question.explanation;
  const quizField = subject === "spelling" ? "spellingQuiz" : "englishQuiz";

  async function submit() {
    if (!activeQuiz || busy || mySubmission || answers.some(a => !a.trim()) ||
        activeQuiz.questions.some(q => questionChoices(q).length < 2)) return;
    setBusy(true);
    setError("");
    try {
      const targetDate = selectedDate;
      await runTransaction(db, async tx => {
        const ref = doc(db, "scheduleDays", targetDate);
        const snap = await tx.get(ref);
        const current = (snap.data() as DayRow | undefined)?.[quizField];
        if (!current || current.questions.length !== 3) throw new Error("시험 문제를 다시 불러와 주세요.");
        if (current.submissions?.[member]) throw new Error("이미 제출한 시험입니다.");
        if (activeQuiz.questions.some((q, i) => q.id !== current.questions[i]?.id))
          throw new Error("시험 문제가 변경됐습니다. 새로고침해 주세요.");
        const score = current.questions.reduce(
          (n, q, i) => n + Number(isCorrect(answers[i], q.answer)), 0,
        );
        tx.update(ref, quizField + ".submissions." + member, {
          answers: answers.map(a => a.trim()),
          score,
          submittedAt: new Date().toISOString(),
        });
      });
      setAnswers(["", "", ""]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "답안 제출에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const viewTitle = selectedDate === today ? "오늘" : selectedDate;
  const familyStats = people.map(p => ({ ...p, stats: analyzeLearning(allQuizDays, p.id) }));
  const review = analyzeLearning(allQuizDays, reviewMember, reviewSubject === 'total' ? undefined : reviewSubject);
  const completed = Number(!!todayQuiz?.submissions?.[member]) + Number(!!todayEnglishQuiz?.submissions?.[member]);
  const wrongCard = (q: WrongQuestion, index: number) => <details className="learning-wrong-card" key={q.key}>
    <summary><span className="learning-number">{index + 1}</span><span><small>{q.subject === 'spelling' ? '맞춤법' : '영어'} · 최근 오답 {q.lastWrongDate}</small><b>{q.prompt}</b></span><span className="learning-wrong-count">{q.wrong}회 틀림<small>{q.attempts}회 응시 · 오답률 {Math.round(q.wrong / q.attempts * 100)}%</small><em>해설 보기 ⌄</em></span></summary>
    <div className="learning-answer"><p className="wrong-answer">최근 고른 답 · {q.lastWrongAnswer}</p><p className="right-answer">정답 · {q.question.answer}</p><h4>왜 정답일까요?</h4><p>{q.explanation || '저장된 해설이 없습니다.'}</p></div>
  </details>;
  const selectableDays = view === "missed" ? missedDays : view === "history"
    ? allQuizDays.filter(day => subject === "spelling" ? !!day.spellingQuiz : !!day.englishQuiz)
    : [];

  return (
    <div className="spelling-overlay" role="dialog" aria-modal="true" aria-label="가족 매일 학습">
      <div className="spelling-panel">
        <header className="spelling-head">
          <div>
            <strong>📚 매일 학습 대시보드</strong>
            <small>{today} · {people.find(p => p.id === member)?.label}의 작은 공부 습관</small>
          </div>
          <button type="button" onClick={close} aria-label="닫기">×</button>
        </header>

        <nav className="learning-navigation" aria-label="학습 메뉴">
          {(['overview', 'study', 'review', 'ranking'] as const).map((key, i) => <button key={key} className={page === key ? 'active' : ''} aria-pressed={page === key} onClick={() => setPage(key)}>{['요약', '문제 풀기', '오답 분석', '순위'][i]}</button>)}
        </nav>

        {(page === 'overview' || page === 'study') && <>
        <div className="spelling-summary-grid">
          <div><small>오늘 맞춤법</small><strong>{todayQuiz?.submissions?.[member] ? `${todayQuiz.submissions[member]?.score}/3` : "미응시"}</strong></div>
          <div><small>오늘 영어</small><strong>{todayEnglishQuiz?.submissions?.[member] ? `${todayEnglishQuiz.submissions[member]?.score}/3` : "미응시"}</strong></div>
          <div><small>오늘 합계</small><strong>{(todayQuiz?.submissions?.[member]?.score ?? 0) + (todayEnglishQuiz?.submissions?.[member]?.score ?? 0)}/6</strong></div>
        </div>
        </>}

        {page === 'overview' && <>
          <section className="learning-hero"><div><small>DAILY LEARNING</small><h2>매일 6문제, 차곡차곡.</h2><p>오늘 {completed}/2과목 완료 · 맞춤법과 영어를 함께 공부해요.</p><progress max={2} value={completed} aria-label="오늘 과목 완료율" /></div><button onClick={() => { setSubject(todayQuiz?.submissions?.[member] ? 'english' : 'spelling'); selectView('today'); setPage('study'); }}>{completed === 2 ? '오늘 결과 보기' : '오늘 문제 풀기'} →</button></section>
          <div className="learning-section-head"><h3>우리 가족 학습 현황</h3><small>최근 1년 · 제출한 답안 기준</small></div>
          {historyLoading ? <p role="status">학습 기록을 불러오는 중…</p> : historyError ? <p role="alert">{historyError}</p> : <div className="learning-family-grid">{familyStats.map(p => <button className="learning-family-card" key={p.id} onClick={() => { setReviewMember(p.id); setReviewSubject('total'); setPage('review'); }}><span className="learning-avatar">{p.label.slice(0, 1)}</span><h3>{p.label}</h3><strong>{p.stats.accuracy === null ? '—' : `${p.stats.accuracy}%`}</strong><small>정답률 · {p.stats.answered}문제 응시</small><div className="learning-mini-bar"><i style={{ width: `${p.stats.accuracy ?? 0}%` }} /></div><p>{p.stats.wrong}회 오답 · {p.stats.questions.length}개 복습 문제</p><span className="learning-top-topic">{p.stats.questions[0] ? `많이 틀린 문제: ${p.stats.questions[0].prompt}` : p.stats.answered ? '틀린 문제가 없어요.' : '아직 응시 기록이 없어요.'}</span><b className="learning-link">오답과 해설 보기 →</b></button>)}</div>}
        </>}

        {page === 'review' && <section className="learning-review">
          <div className="learning-section-head"><h3>자주 틀린 문제</h3><small>최근 1년 · 틀린 횟수 높은 순</small></div>
          <div className="learning-filter-row" aria-label="오답 분석 가족 선택">{people.map(p => <button key={p.id} className={reviewMember === p.id ? 'active' : ''} aria-pressed={reviewMember === p.id} onClick={() => setReviewMember(p.id)}>{p.label}</button>)}</div>
          <div className="learning-filter-row" aria-label="오답 분석 과목 선택">{(['total', 'spelling', 'english'] as const).map((s, i) => <button key={s} className={reviewSubject === s ? 'active' : ''} aria-pressed={reviewSubject === s} onClick={() => setReviewSubject(s)}>{['전체', '맞춤법', '영어'][i]}</button>)}</div>
          {historyLoading ? <p role="status">학습 기록을 불러오는 중…</p> : historyError ? <p role="alert">{historyError}</p> : <>
          <div className="learning-review-metrics"><div><small>응시 문항</small><b>{review.answered}</b></div><div><small>정답률</small><b>{review.accuracy === null ? '—' : `${review.accuracy}%`}</b></div><div><small>오답 횟수</small><b>{review.wrong}</b></div></div>
          <p className="spelling-hint">문제를 누르면 최근 고른 답과 정답·해설이 펼쳐집니다. 미응시는 오답에 포함하지 않습니다.</p>
          {review.questions.length ? review.questions.map(wrongCard) : <div className="learning-empty">{review.answered ? '틀린 문제가 없어요. 잘하고 있어요!' : '아직 제출한 답안이 없어요.'}</div>}
          </>}
        </section>}

        <div hidden={page !== 'study'}>
        <nav className="spelling-subject-tabs" aria-label="과목 선택">
          <button className={subject === "spelling" ? "active" : ""} onClick={() => { setSubject("spelling"); setAnswers(["", "", ""]); }}>✍️ 맞춤법 3문제</button>
          <button className={subject === "english" ? "active" : ""} onClick={() => { setSubject("english"); setAnswers(["", "", ""]); }}>🔤 영어 3문제</button>
        </nav>

        <nav className="spelling-view-tabs" aria-label="맞춤법 시험 보기">
          <button className={view === "today" ? "active" : ""} onClick={() => selectView("today")}>오늘</button>
          <button className={view === "missed" ? "active" : ""} onClick={() => selectView("missed")}>
            밀린 문제{missedDays.length ? ` (${missedDays.length})` : ""}
          </button>
          <button className={view === "history" ? "active" : ""} onClick={() => selectView("history")}>지난 문제</button>
        </nav>

        {view !== "today" && (
          <div className="spelling-day-list">
            {selectableDays.length === 0 ? (
              <span>{view === "missed" ? "밀린 문제가 없습니다." : "저장된 지난 문제가 없습니다."}</span>
            ) : selectableDays.map(day => {
              const quiz = subject === "spelling" ? day.spellingQuiz : day.englishQuiz;
              const submission = quiz?.submissions?.[member];
              return (
                <button
                  key={day.date}
                  className={selectedDate === day.date ? "active" : ""}
                  onClick={() => { setSelectedDate(day.date); setAnswers(["", "", ""]); }}
                >
                  <b>{day.date}</b>
                  <small>{submission ? `${submission.score}/3점` : "미응시"}</small>
                </button>
              );
            })}
          </div>
        )}

        {error && <div className="spelling-error" role="alert">{error}</div>}
        {loading && !activeQuiz && view === "today" && <p>오늘의 문제를 준비하고 있습니다.</p>}

        {activeQuiz && (
          <>
            <div className="spelling-progress-card">
              <div><small>{subject === "spelling" ? "맞춤법" : "영어"}</small><strong>{viewTitle} 학습</strong></div>
              <div><small>난이도</small><strong>초등 {activeQuiz.grade}학년</strong></div>
              <div><small>상태</small><strong className={mySubmission ? "done" : "pending"}>{mySubmission ? "완료 · " + mySubmission.score + "/3" : "제출 전"}</strong></div>
            </div>
            <div className="spelling-questions">
              {activeQuiz.questions.map((q, i) => {
                const chosen = mySubmission?.answers?.[i] ?? answers[i] ?? "";
                const correct = mySubmission ? isCorrect(chosen, q.answer) : null;
                return (
                  <section className={`spelling-question ${mySubmission ? (correct ? "result-correct" : "result-wrong") : ""}`} key={q.id}>
                    <div className="spelling-question-title">
                      <b>{i + 1}번</b>
                      <span>{subject === "spelling" ? "맞춤법" : "영어"} · 객관식</span>
                    </div>
                    <p>
                      <span className="spelling-context-help">{subject === "spelling" ? "빈칸에 들어갈 알맞은 단어를 고르세요." : "가장 알맞은 영어 표현을 고르세요."}</span>
                      {questionPrompt(q)}
                    </p>
                    <div className="spelling-options">
                      {questionChoices(q).map(option => {
                        const optionState = mySubmission
                          ? option === q.answer ? "correct-option" : chosen === option ? "wrong-option" : ""
                          : chosen === option ? "selected" : "";
                        return <label className={optionState} key={option}>
                          <input
                            type="radio"
                            name={`spelling-${selectedDate}-${i}`}
                            checked={chosen === option}
                            disabled={!!mySubmission || loading}
                            onChange={() => setAnswers(old => old.map((v, j) => j === i ? option : v))}
                          />
                          {option}
                        </label>;
                      })}
                    </div>
                    {mySubmission && (
                      <div className={"spelling-explanation " + (correct ? "correct" : "incorrect")}>
                        <b>{correct ? "정답" : "오답"} · 내가 고른 답: {chosen || "-"} · 정답: {q.answer}</b>
                        <p style={{ whiteSpace: "pre-line" }}>{questionExplanation(q)}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>

            {!mySubmission && (
              <button
                type="button"
                className="spelling-submit"
                disabled={busy || loading || activeQuiz.questions.length !== 3 ||
                  activeQuiz.questions.some(q => questionChoices(q).length < 2) ||
                  answers.some(a => !a.trim())}
                onClick={() => void submit()}
              >
                {busy ? "제출 중…" : selectedDate === today ? `오늘 ${subject === "spelling" ? "맞춤법" : "영어"} 3문제 제출` : `${selectedDate} ${subject === "spelling" ? "맞춤법" : "영어"} 제출`}
              </button>
            )}

            {mySubmission && (
              <p className="spelling-hint">
                제출한 문제는 언제든 다시 확인할 수 있습니다. 내가 고른 답·정답·해설이 함께 표시됩니다.
              </p>
            )}
          </>
        )}

        {view === "missed" && missedDays.length === 0 && (
          <p className="spelling-hint">최근 1년 안에 만들어진 시험 중 미응시 문제가 없습니다.</p>
        )}

        </div>
        <section hidden={page !== 'ranking'} className="spelling-leaderboard dashboard-card">
          <div className="spelling-leaderboard-head">
            <div><h3>🏆 가족 학습 순위</h3><small>기간과 과목을 선택해 비교할 수 있어요.</small></div>
            <div className="spelling-rank-toggle">
              <button className={rankMode === "weekly" ? "active" : ""} onClick={() => setRankMode("weekly")}>주간</button>
              <button className={rankMode === "monthly" ? "active" : ""} onClick={() => setRankMode("monthly")}>월간</button>
            </div>
          </div>
          <div className="spelling-rank-subjects">
            {(["total", "spelling", "english"] as RankSubject[]).map(item => (
              <button key={item} className={rankSubject === item ? "active" : ""} onClick={() => setRankSubject(item)}>
                {item === "total" ? "전체" : item === "spelling" ? "맞춤법" : "영어"}
              </button>
            ))}
          </div>
          {rankMode === "weekly" && (
            <div className="spelling-period-controls">
              <button type="button" disabled={rankWeek === weeks[weeks.length - 1]}
                onClick={() => setRankWeek(weeks[weeks.indexOf(rankWeek) + 1])}>← 이전 주</button>
              <label>조회 주 <select aria-label="순위 조회 주" value={rankWeek} onChange={e => setRankWeek(e.target.value)}>
                {weeks.map((week, index) => {
                  const range = rankingWeekRange(week, today);
                  return <option key={week} value={week}>{index === 0 ? "이번 주" : `${range.start.slice(5)} ~ ${range.end.slice(5)}`}</option>;
                })}
              </select></label>
              <button type="button" disabled={rankWeek === weeks[0]}
                onClick={() => setRankWeek(weeks[weeks.indexOf(rankWeek) - 1])}>다음 주 →</button>
            </div>
          )}
          {rankMode === "monthly" && (
            <div className="spelling-period-controls">
              <button type="button" disabled={rankMonth === months[months.length - 1]}
                onClick={() => setRankMonth(months[months.indexOf(rankMonth) + 1])}>이전 달</button>
              <label>조회 월 <select aria-label="순위 조회 월" value={rankMonth}
                onChange={e => setRankMonth(e.target.value)}>
                {months.map(month => <option key={month} value={month}>{month.slice(0, 4)}년 {Number(month.slice(5))}월</option>)}
              </select></label>
              <button type="button" disabled={rankMonth === months[0]}
                onClick={() => setRankMonth(months[months.indexOf(rankMonth) - 1])}>다음 달</button>
            </div>
          )}
          <div className="spelling-rank-period">{rankStart} ~ {rankEnd}<span>정답 1개당 1점</span></div>
          {(rankLoading || rankLoadedKey !== rankKey) ? <p role="status">순위를 불러오는 중…</p> : rankError ?
            <p role="alert">{rankError}</p> : ranking.every(p => p.played === 0) ?
            <p>이 기간에는 응시 기록이 없습니다.</p> : ranking.map((p, i) => (
            <div className="spelling-rank-row" key={p.id}>
              <span className={`rank-medal rank-${i + 1}`}>{i + 1}</span>
              <div><b>{p.label}</b><small>{rankSubject === "total" ? `맞춤법 ${p.spellingScore} · 영어 ${p.englishScore}` : `${p.played}회 참여`}</small></div>
              <strong>{p.score}<small>점</small></strong>
              <div className="rank-bar"><i style={{ width: `${Math.min(100, p.score / Math.max(1, ranking[0]?.score) * 100)}%` }} /></div>
            </div>
          ))}
          <p className="spelling-hint">
            밀린 문제를 제출해도 해당 날짜 점수로 기록됩니다. 맞춤법 128문항과 영어 96문항에서 최근 30일 문제를 피해서 출제합니다.
          </p>
        </section>
      </div>
    </div>
  );
}


