import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, query, runTransaction, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  DailySpellingQuiz, SpellingMember, fallbackQuiz, isCorrect, kstDay, shiftedDay, spellingChoices, spellingChoicePrompt,
} from "./spellingQuiz";
import "./spelling.css";

const people: { id: SpellingMember; label: string }[] = [
  { id: "me", label: "아빠" },
  { id: "wife", label: "엄마" },
  { id: "son", label: "강천" },
];

type DayRow = { date: string; spellingQuiz?: DailySpellingQuiz };
type QuizView = "today" | "missed" | "history";
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
  const [days, setDays] = useState<DayRow[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rankMode, setRankMode] = useState<"weekly" | "monthly">("weekly");
  const [view, setView] = useState<QuizView>("today");
  const [selectedDate, setSelectedDate] = useState(today);

  const monthlyStart = today.slice(0, 7) + "-01";
  const weeklyStart = weekStart(today);
  const historyFrom = SPELLING_START_DAY > shiftedDay(today, -365)
    ? SPELLING_START_DAY
    : shiftedDay(today, -365);

  useEffect(() => {
    const ref = doc(db, "scheduleDays", today);
    const stop = onSnapshot(ref, snap => {
      const item = snap.data() as DayRow | undefined;
      setTodayQuiz(item?.spellingQuiz ?? null);
      if (item?.spellingQuiz) setLoading(false);
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
      setDays(
        snapshot.docs
          .map(s => s.data() as DayRow)
          .filter(row => !!row.spellingQuiz)
          .sort((a, b) => b.date.localeCompare(a.date)),
      );
    }, err => setError("맞춤법 기록 동기화에 실패했습니다: " + err.message));

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
            return [s.id, row.spellingQuiz] as const;
          }),
        );
        const previous: DailySpellingQuiz[] = [];
        let day = historyFrom;

        while (day < today) {
          const dayRef = doc(db, "scheduleDays", day);
          const saved = existing.get(day);
          const live = saved ?? await runTransaction(db, async tx => {
            const snap = await tx.get(dayRef);
            const current = (snap.data() as DayRow | undefined)?.spellingQuiz;
            if (current) return current;
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
          if (current) return current;
          const generated = fallbackQuiz(today, previous);
          tx.set(ref, { date: today, spellingQuiz: generated }, { merge: true });
          return generated;
        });
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
    return historyToday ?? (todayQuiz ? { date: today, spellingQuiz: todayQuiz } : undefined);
  }, [days, today, todayQuiz]);

  const allQuizDays = useMemo(() => {
    const map = new Map<string, DayRow>();
    days.forEach(day => map.set(day.date, day));
    if (todayRow) map.set(today, todayRow);
    return [...map.values()].filter(day => !!day.spellingQuiz).sort((a, b) => b.date.localeCompare(a.date));
  }, [days, todayRow, today]);

  const missedDays = useMemo(
    () => allQuizDays.filter(day => day.date < today && !day.spellingQuiz?.submissions?.[member]),
    [allQuizDays, today, member],
  );

  const activeRow = selectedDate === today
    ? todayRow
    : allQuizDays.find(day => day.date === selectedDate);
  const activeQuiz = activeRow?.spellingQuiz ?? null;
  const mySubmission = activeQuiz?.submissions?.[member];

  useEffect(() => {
    setAnswers(["", "", ""]);
  }, [selectedDate, member]);

  const ranking = useMemo(() => {
    const start = rankMode === "weekly" ? weeklyStart : monthlyStart;
    return people.map(p => {
      const submissions = allQuizDays
        .filter(d => d.date >= start && d.date <= today)
        .map(d => d.spellingQuiz?.submissions?.[p.id])
        .filter((s): s is NonNullable<typeof s> => !!s);
      return { ...p, score: submissions.reduce((n, s) => n + s.score, 0), played: submissions.length };
    }).sort((a, b) =>
      b.score - a.score ||
      b.played - a.played ||
      people.findIndex(p => p.id === a.id) - people.findIndex(p => p.id === b.id)
    );
  }, [allQuizDays, rankMode, monthlyStart, weeklyStart, today]);

  function selectView(next: QuizView) {
    setView(next);
    setError("");
    setAnswers(["", "", ""]);
    if (next === "today") setSelectedDate(today);
    else if (next === "missed" && missedDays.length) setSelectedDate(missedDays[0].date);
    else if (next === "history" && allQuizDays.length) setSelectedDate(allQuizDays[0].date);
  }

  async function submit() {
    if (!activeQuiz || busy || mySubmission || answers.some(a => !a.trim()) ||
        activeQuiz.questions.some(q => spellingChoices(q).length !== 2)) return;
    setBusy(true);
    setError("");
    try {
      const targetDate = selectedDate;
      await runTransaction(db, async tx => {
        const ref = doc(db, "scheduleDays", targetDate);
        const snap = await tx.get(ref);
        const current = (snap.data() as DayRow | undefined)?.spellingQuiz;
        if (!current || current.questions.length !== 3) throw new Error("시험 문제를 다시 불러와 주세요.");
        if (current.submissions?.[member]) throw new Error("이미 제출한 시험입니다.");
        if (activeQuiz.questions.some((q, i) => q.id !== current.questions[i]?.id))
          throw new Error("시험 문제가 변경됐습니다. 새로고침해 주세요.");
        const score = current.questions.reduce(
          (n, q, i) => n + Number(isCorrect(answers[i], q.answer)), 0,
        );
        tx.update(ref, "spellingQuiz.submissions." + member, {
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
  const selectableDays = view === "missed" ? missedDays : view === "history" ? allQuizDays : [];

  return (
    <div className="spelling-overlay" role="dialog" aria-modal="true" aria-label="가족 맞춤법 시험">
      <div className="spelling-panel">
        <header className="spelling-head">
          <div>
            <strong>매일 맞춤법 시험</strong>
            <small>하루 3문제 · 못 푼 날은 나중에 이어서 응시 가능</small>
          </div>
          <button type="button" onClick={close} aria-label="닫기">×</button>
        </header>

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
              const submission = day.spellingQuiz?.submissions?.[member];
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
            <div className="spelling-progress">
              <span>{viewTitle} · 초등 {activeQuiz.grade}학년 · {activeQuiz.source === "ai" ? "AI 생성" : "검증 문제"}</span>
              <strong>{mySubmission ? "완료 · " + mySubmission.score + "/3점" : "제출 전"}</strong>
            </div>
            <div className="spelling-questions">
              {activeQuiz.questions.map((q, i) => {
                const chosen = mySubmission?.answers?.[i] ?? answers[i] ?? "";
                const correct = mySubmission ? isCorrect(chosen, q.answer) : null;
                return (
                  <section className="spelling-question" key={q.id}>
                    <div className="spelling-question-title">
                      <b>{i + 1}번</b>
                      <span>객관식</span>
                    </div>
                    <p>
                      <span className="spelling-context-help">빈칸에 들어갈 알맞은 단어를 고르세요.</span>
                      {spellingChoicePrompt(q)}
                    </p>
                    <div className="spelling-options">
                      {spellingChoices(q).map(option => (
                        <label className={chosen === option ? "selected" : ""} key={option}>
                          <input
                            type="radio"
                            name={`spelling-${selectedDate}-${i}`}
                            checked={chosen === option}
                            disabled={!!mySubmission}
                            onChange={() => setAnswers(old => old.map((v, j) => j === i ? option : v))}
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                    {mySubmission && (
                      <div className={"spelling-explanation " + (correct ? "correct" : "incorrect")}>
                        <b>{correct ? "정답" : "오답"} · 내가 고른 답: {chosen || "-"} · 정답: {q.answer}</b>
                        <p>{q.explanation}</p>
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
                disabled={busy || activeQuiz.questions.length !== 3 ||
                  activeQuiz.questions.some(q => spellingChoices(q).length !== 2) ||
                  answers.some(a => !a.trim())}
                onClick={() => void submit()}
              >
                {busy ? "제출 중…" : selectedDate === today ? "오늘 3문제 채점하고 제출" : selectedDate + " 밀린 3문제 채점하고 제출"}
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

        <section className="spelling-leaderboard">
          <div className="spelling-leaderboard-head">
            <h3>가족 맞춤법 순위</h3>
            <div className="spelling-rank-toggle">
              <button className={rankMode === "weekly" ? "active" : ""} onClick={() => setRankMode("weekly")}>주간</button>
              <button className={rankMode === "monthly" ? "active" : ""} onClick={() => setRankMode("monthly")}>월간</button>
            </div>
          </div>
          <small>{rankMode === "weekly" ? weeklyStart + " ~ " + today : monthlyStart + " ~ " + today} · 정답 1개당 1점</small>
          {ranking.map((p, i) => (
            <div className="spelling-rank-row" key={p.id}>
              <span>{i + 1}위 · {p.label}</span>
              <b>{p.score}점</b>
              <small>{p.played}일 참여</small>
            </div>
          ))}
          <p className="spelling-hint">
            밀린 문제를 나중에 제출해도 해당 날짜의 응시 기록으로 저장됩니다. 복습 문제는 이전 오답을 3·7·14일 간격으로 다시 출제합니다.
          </p>
        </section>
      </div>
    </div>
  );
}
