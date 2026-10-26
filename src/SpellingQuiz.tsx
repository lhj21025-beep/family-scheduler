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

function weekStart(day: string): string {
  const date = new Date(day + "T12:00:00Z");
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftedDay(day, -mondayOffset);
}

export default function SpellingQuiz({
  member, close,
}: { member: SpellingMember; close: () => void }) {
  const today = kstDay();
  const [quiz, setQuiz] = useState<DailySpellingQuiz | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rankMode, setRankMode] = useState<"weekly" | "monthly">("weekly");
  const monthlyStart = today.slice(0, 7) + "-01";
  const weeklyStart = weekStart(today);
  const from = monthlyStart < weeklyStart ? monthlyStart : weeklyStart;
  const mySubmission = quiz?.submissions?.[member];

  useEffect(() => {
    const ref = doc(db, "scheduleDays", today);
    const stop = onSnapshot(ref, snap => {
      const item = snap.data() as DayRow | undefined;
      setQuiz(item?.spellingQuiz ?? null);
      if (item?.spellingQuiz) setLoading(false);
    }, err => { setError("오늘 시험을 불러오지 못했습니다: " + err.message); setLoading(false); });

    const q = query(collection(db, "scheduleDays"), where("date", ">=", from), where("date", "<=", today));
    const stopHistory = onSnapshot(q, snapshot => {
      setDays(snapshot.docs.map(s => s.data() as DayRow));
    }, err => setError("가족 순위 동기화에 실패했습니다: " + err.message));

    let cancelled = false;
    // A daily shared quiz is created once. The transaction prevents different
    // questions being assigned when parents and children open simultaneously.
    async function ensure() {
      try {
        const old = await getDocs(query(
          collection(db, "scheduleDays"),
          where("date", ">=", shiftedDay(today, -14)),
          where("date", "<", today),
        ));
        const previous = old.docs
          .map(s => (s.data() as DayRow).spellingQuiz)
          .filter((q): q is DailySpellingQuiz => !!q);
        const generated = fallbackQuiz(today, previous);
        await runTransaction(db, async tx => {
          const snap = await tx.get(ref);
          if (snap.data()?.spellingQuiz) return;
          // Merge keeps the existing calendar events, reminders and metadata intact.
          tx.set(ref, { date: today, spellingQuiz: generated }, { merge: true });
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
  }, [today, from]);

  const ranking = useMemo(() => {
    const start = rankMode === "weekly" ? weeklyStart : monthlyStart;
    return people.map(p => {
      const submissions = days
        .filter(d => d.date >= start && d.date <= today)
        .map(d => d.spellingQuiz?.submissions?.[p.id])
        .filter((s): s is NonNullable<typeof s> => !!s);
      return { ...p, score: submissions.reduce((n, s) => n + s.score, 0), played: submissions.length };
    }).sort((a, b) => b.score - a.score || b.played - a.played || people.findIndex(p => p.id === a.id) - people.findIndex(p => p.id === b.id));
  }, [days, rankMode, monthlyStart, weeklyStart, today]);

  async function submit() {
    if (!quiz || busy || mySubmission || answers.some(a => !a.trim()) || quiz.questions.some(q => spellingChoices(q).length !== 2)) return;
    setBusy(true);
    setError("");
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, "scheduleDays", today);
        const snap = await tx.get(ref);
        const current = (snap.data() as DayRow | undefined)?.spellingQuiz;
        if (!current || current.questions.length !== 3) throw new Error("시험 문제를 다시 불러와 주세요.");
        if (current.submissions?.[member]) throw new Error("오늘 시험은 이미 제출했습니다.");
        if (quiz.questions.some((q, i) => q.id !== current.questions[i]?.id)) throw new Error("시험 문제가 변경됐습니다. 새로고침해 주세요.");
        const score = current.questions.reduce((n, q, i) => n + Number(isCorrect(answers[i], q.answer)), 0);
        tx.update(ref, "spellingQuiz.submissions." + member, {
          answers: answers.map(a => a.trim()), score, submittedAt: new Date().toISOString(),
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "답안 제출에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="spelling-overlay" role="dialog" aria-modal="true" aria-label="가족 맞춤법 시험">
      <div className="spelling-panel">
        <header className="spelling-head">
          <div>
            <strong>매일 맞춤법 시험</strong>
            <small>{today} · {quiz?.grade ?? "초등"}학년 수준 · 하루 3문제</small>
          </div>
          <button type="button" onClick={close} aria-label="닫기">×</button>
        </header>

        {error && <div className="spelling-error" role="alert">{error}</div>}
        {loading && !quiz && <p>오늘의 문제를 준비하고 있습니다.</p>}
        {quiz && (
          <>
            <div className="spelling-progress">
              <span>{quiz.source === "ai" ? "AI 생성 문제" : "맞춤법 검증 문제 · 자동 복습"}</span>
              <strong>{mySubmission ? "완료 · " + mySubmission.score + "/3점" : "제출 전"}</strong>
            </div>
            <div className="spelling-questions">
              {quiz.questions.map((q, i) => {
                const chosen = mySubmission?.answers?.[i] ?? answers[i] ?? "";
                const correct = mySubmission ? isCorrect(chosen, q.answer) : null;
                return (
                  <section className="spelling-question" key={q.id}>
                    <div className="spelling-question-title">
                      <b>{i + 1}번</b>
                      <span>객관식</span>
                    </div>
                    <p>{spellingChoicePrompt(q)}</p>
                    <div className="spelling-options">
                      {spellingChoices(q).map(option => (
                        <label className={chosen === option ? "selected" : ""} key={option}>
                          <input
                            type="radio"
                            name={"spelling-" + i}
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
                        <b>{correct ? "정답" : "오답"} · {q.answer}</b>
                        <p>{q.explanation}</p>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
            {!mySubmission && (
              <button type="button" className="spelling-submit" disabled={busy || quiz.questions.length !== 3 || quiz.questions.some(q => spellingChoices(q).length !== 2) || answers.some(a => !a.trim())}
                onClick={() => void submit()}>
                {busy ? "제출 중…" : "3문제 채점하고 제출"}
              </button>
            )}
            {mySubmission && <p className="spelling-hint">오늘 시험은 1회만 응시할 수 있습니다. 가족에게는 점수와 순위만 표시됩니다.</p>}
          </>
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
          <p className="spelling-hint">동점은 참여일 수로 정합니다. 복습 문제는 이전 오답을 3·7·14일 간격으로 다시 출제합니다.</p>
        </section>
      </div>
    </div>
  );
}
