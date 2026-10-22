// Shared spelling-quiz model for the family scheduler.
export type SpellingMember = "me" | "wife" | "son";
export type SpellingQuestion = {
  id: string;
  grade: number;
  kind: "choice" | "write";
  prompt: string;
  options?: string[];
  answer: string;
  explanation: string;
};
export type SpellingSubmission = {
  answers: string[];
  score: number;
  submittedAt: string;
};
export type DailySpellingQuiz = {
  date: string;
  grade: number;
  source: "curated" | "ai";
  questions: SpellingQuestion[];
  submissions: Partial<Record<SpellingMember, SpellingSubmission>>;
};

const choice = (id: string, grade: number, prompt: string, a: string, b: string, explanation: string): SpellingQuestion =>
  ({ id, grade, kind: "choice", prompt, options: [a, b], answer: a, explanation });
const write = (id: string, grade: number, prompt: string, answer: string, explanation: string): SpellingQuestion =>
  ({ id, grade, kind: "write", prompt, answer, explanation });

// Reviewed, unambiguous questions. The AI service may add to the pool,
// but a verified offline fallback must always exist.
export const spellingBank: SpellingQuestion[] = [
  choice("4-01", 4, "‘이게 무슨 ___이야?’에 알맞은 말은?", "웬일", "왠일", "‘웬일’은 뜻밖의 일을 말할 때 쓰는 말이에요."),
  choice("4-02", 4, "‘___ 동안 못 만났니?’에 알맞은 말은?", "며칠", "몇일", "날짜의 수를 물을 때는 ‘며칠’이라고 써요."),
  choice("4-03", 4, "‘이제 집에 가도 ___.’의 바른 표현은?", "돼", "되", "‘돼’는 ‘되어’의 준말이에요."),
  choice("4-04", 4, "‘오늘은 학교에 ___ 가.’의 바른 표현은?", "안", "않", "‘안’은 부정을 나타내는 부사예요."),
  choice("4-05", 4, "‘감기가 빨리 ___.’의 바른 표현은?", "낫다", "낮다", "병이 좋아지는 것은 ‘낫다’예요."),
  choice("4-06", 4, "‘정말 ___ 일이네.’의 바른 표현은?", "어이없는", "어의없는", "황당하다는 뜻의 말은 ‘어이없다’예요."),
  choice("4-07", 4, "‘숙제를 ___ 끝냈다.’에 알맞은 말은?", "금세", "금새", "‘금세’는 ‘금시에’가 줄어든 말이에요."),
  choice("4-08", 4, "‘우리는 ___ 놀았다.’의 바른 표현은?", "함께", "함깨", "‘함께’가 표준어예요."),
  choice("4-09", 4, "음식 이름을 바르게 쓴 것은?", "떡볶이", "떡복이", "‘떡볶이’의 ‘볶’에는 받침 ㄲ이 들어가요."),
  choice("4-10", 4, "‘밥을 먹고 ___를 했다.’에 알맞은 말은?", "설거지", "설겆이", "‘설거지’가 표준어예요."),
  choice("4-11", 4, "‘___를 베고 잤다.’에 알맞은 말은?", "베개", "배게", "머리를 받치는 물건은 ‘베개’예요."),
  choice("4-12", 4, "‘___ 친구를 만났다.’에 알맞은 말은?", "오랜만에", "오랫만에", "‘오랜만’은 ‘오래간만’의 준말이에요."),
  write("4-13", 4, "‘오늘은 숙제를 다 해도 되.’에서 틀린 낱말을 바로 쓰세요.", "돼", "‘되어’로 바꿔 말할 수 있으면 ‘돼’예요."),
  write("4-14", 4, "‘이게 왠일이야?’에서 틀린 낱말을 바로 쓰세요.", "웬일", "‘웬일’이 올바른 표현이에요."),
  write("4-15", 4, "‘떡복이를 먹었다.’에서 틀린 낱말을 바로 쓰세요.", "떡볶이", "‘떡볶이’가 표준어예요."),
  write("4-16", 4, "‘오랫만에 만났다.’에서 틀린 낱말을 바로 쓰세요.", "오랜만에", "‘오랜만에’라고 써요."),
  write("4-17", 4, "‘베게가 푹신하다.’에서 틀린 낱말을 바로 쓰세요.", "베개", "‘베개’가 표준어예요."),
  write("4-18", 4, "‘몇일 동안 여행했어?’에서 틀린 낱말을 바로 쓰세요.", "며칠", "‘며칠’이 올바른 표현이에요."),
  choice("5-01", 5, "‘지금 어떻게 해야 할지 모르겠어. 이제 ___.’", "어떡해", "어떻게", "‘어떡해’는 ‘어떻게 해’의 준말이에요."),
  choice("5-02", 5, "‘내가 내일 전화___.’의 바른 표현은?", "할게", "할께", "약속하는 말의 어미는 ‘-ㄹ게’예요."),
  choice("5-03", 5, "‘선생님, 내일 ___.’의 바른 표현은?", "뵙겠습니다", "봽겠습니다", "‘뵙다’에 ‘-겠습니다’가 붙어요."),
  choice("5-04", 5, "‘친구와 공에 ___ 다쳤다.’에 알맞은 말은?", "부딪쳐", "부딫쳐", "‘부딪치다’가 올바른 표기예요."),
  choice("5-05", 5, "‘___ 생각이 났다.’에 알맞은 말은?", "문득", "문뜩", "갑자기 떠올랐을 때 ‘문득’이에요."),
  choice("5-06", 5, "‘책상을 ___ 닦았다.’에 알맞은 말은?", "깨끗이", "깨끗히", "‘깨끗이’가 맞는 표기예요."),
  choice("5-07", 5, "‘동생에게 글씨를 ___.’에 알맞은 말은?", "가르쳤다", "가리켰다", "지식이나 방법을 알려 주는 것은 ‘가르치다’예요."),
  choice("5-08", 5, "‘손가락으로 시계를 ___.’에 알맞은 말은?", "가리켰다", "가르쳤다", "방향이나 대상을 짚어 보이는 것은 ‘가리키다’예요."),
  choice("5-09", 5, "‘열쇠를 ___ 찾지 못했다.’에 알맞은 말은?", "잃어버려", "잊어버려", "물건이 없어지는 것은 ‘잃어버리다’예요."),
  choice("5-10", 5, "‘약속을 ___ 미안해.’에 알맞은 말은?", "잊어버려서", "잃어버려서", "기억하지 못한 것은 ‘잊어버리다’예요."),
  write("5-11", 5, "‘내일 꼭 갈께.’에서 틀린 낱말을 바로 쓰세요.", "갈게", "약속의 어미는 ‘-ㄹ게’예요."),
  write("5-12", 5, "‘문뜩 좋은 생각이 떠올랐다.’에서 틀린 낱말을 바로 쓰세요.", "문득", "‘문득’이 올바른 표기예요."),
  write("5-13", 5, "‘방을 깨끗히 청소했다.’에서 틀린 낱말을 바로 쓰세요.", "깨끗이", "‘깨끗이’가 맞아요."),
  write("5-14", 5, "‘선생님을 내일 봽겠습니다.’에서 틀린 낱말을 바로 쓰세요.", "뵙겠습니다", "‘뵙다’를 활용한 말이에요."),
  write("5-15", 5, "‘공에 부딫쳐 넘어졌다.’에서 틀린 낱말을 바로 쓰세요.", "부딪쳐", "‘부딪치다’에서 나온 말이에요."),
  write("5-16", 5, "‘친구에게 수학을 가리켰다.’에서 뜻에 맞게 틀린 낱말을 고쳐 쓰세요.", "가르쳤다", "공부를 알려 주는 것은 ‘가르치다’예요."),
  choice("6-01", 6, "‘집 ___을 깨끗하게 쓸었다.’에 알맞은 말은?", "안팎", "않팎", "안과 밖을 아울러 ‘안팎’이라 해요."),
  choice("6-02", 6, "‘노력의 ___를 받았다.’에 알맞은 말은?", "대가", "댓가", "‘대가’가 표준어예요."),
  choice("6-03", 6, "‘문제를 ___ 생각했다.’에 알맞은 말은?", "곰곰이", "곰곰히", "‘곰곰이’가 올바른 표기예요."),
  choice("6-04", 6, "‘공부를 ___ 했다.’에 알맞은 말은?", "빈틈없이", "빈틈업이", "‘빈틈없이’가 바른 말이에요."),
  choice("6-05", 6, "‘엄마가 숙제를 안 한다고 ___.’에 알맞은 말은?", "닦달했다", "닥달했다", "‘닦달하다’가 표준어예요."),
  choice("6-06", 6, "‘친구들보다 ___ 않으려고 노력했다.’에 알맞은 말은?", "뒤처지지", "뒤쳐지지", "남보다 늦어지는 것은 ‘뒤처지다’예요."),
  choice("6-07", 6, "‘___ 멋진 사람이 될 거야.’에 알맞은 말은?", "훗날", "후날", "먼 미래를 뜻하는 말은 ‘훗날’이에요."),
  choice("6-08", 6, "‘눈에 ___이 끼었다.’에 알맞은 말은?", "눈곱", "눈꼽", "‘눈곱’이 바른 표기예요."),
  choice("6-09", 6, "‘위험을 ___ 사람들을 구했다.’에 알맞은 말은?", "무릅쓰고", "무릎쓰고", "어려움을 감수한다는 뜻은 ‘무릅쓰다’예요."),
  choice("6-10", 6, "‘길을 잃지 않도록 ___ 살폈다.’에 알맞은 말은?", "꼼꼼히", "꼼꼼이", "‘꼼꼼하다’는 ‘꼼꼼히’로 써요."),
  write("6-11", 6, "‘눈꼽이 눈에 끼었다.’에서 틀린 낱말을 바로 쓰세요.", "눈곱", "‘눈곱’이 표준어예요."),
  write("6-12", 6, "‘댓가를 바라고 도운 게 아니다.’에서 틀린 낱말을 바로 쓰세요.", "대가", "‘대가’가 맞는 표기예요."),
  write("6-13", 6, "‘훗날이 아닌 후날에 만나요.’에서 틀린 낱말을 바로 쓰세요.", "훗날", "먼 앞날을 가리킬 때 ‘훗날’이라고 해요."),
  write("6-14", 6, "‘곰곰히 생각해 봤어.’에서 틀린 낱말을 바로 쓰세요.", "곰곰이", "‘곰곰이’가 올바른 표기예요."),
  write("6-15", 6, "‘위험을 무릎쓰고 도전했다.’에서 틀린 낱말을 바로 쓰세요.", "무릅쓰고", "‘무릅쓰다’를 활용해서 ‘무릅쓰고’라고 써요."),
  write("6-16", 6, "‘친구보다 뒤쳐지지 않도록 노력했다.’에서 틀린 낱말을 바로 쓰세요.", "뒤처지지", "‘뒤처지다’를 활용한 표현이에요."),
];

export const kstDay = (): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const spellingGrade = (day: string): number => {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return Math.max(1, Math.min(6, 4 + year - 2026 - (month < 3 ? 1 : 0)));
};

export const shiftedDay = (day: string, delta: number): string => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export const isCorrect = (answer: string, expected: string): boolean =>
  answer.normalize("NFC").replace(/[\s.,!?'"‘’“”]/g, "").toLocaleLowerCase("ko-KR")
  === expected.normalize("NFC").replace(/[\s.,!?'"‘’“”]/g, "").toLocaleLowerCase("ko-KR");

const hashCode = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export const fallbackQuiz = (date: string, history: DailySpellingQuiz[]): DailySpellingQuiz => {
  const grade = spellingGrade(date);
  const previous = history.filter(q => q.date < date);
  const eligible = spellingBank.filter(q => q.grade === grade);
  const used = new Set(previous.flatMap(q => q.questions.map(p => p.id)));
  const ordered = eligible.slice().sort((a, b) => hashCode(date + a.id) - hashCode(date + b.id));
  const fresh = ordered.filter(q => !used.has(q.id)).concat(ordered.filter(q => used.has(q.id)));
  const overdue = previous
    .filter(q => [3, 7, 14].includes(Math.round((Date.parse(date) - Date.parse(q.date)) / 86400000)))
    .flatMap(q => q.questions.filter((item, i) =>
      Object.values(q.submissions ?? {}).some(s => s && !isCorrect(s.answers?.[i] ?? "", item.answer))
    ))
    .sort((a, b) => hashCode(date + a.id) - hashCode(date + b.id));
  const review = overdue[0];
  const pick: SpellingQuestion[] = [];
  for (const q of fresh) {
    if (pick.length === (review ? 2 : 3)) break;
    if (q.kind === "choice" && pick.filter(v => v.kind === "choice").length >= (review?.kind === "write" ? 2 : 2)) continue;
    if (!pick.some(v => v.id === q.id) && q.id !== review?.id) pick.push(q);
  }
  // At least one direct-writing question every day, unless the review already supplies one.
  if (!pick.some(q => q.kind === "write") && review?.kind !== "write") {
    const w = fresh.find(q => q.kind === "write" && q.id !== review?.id);
    if (w) pick[pick.length - 1] = w;
  }
  if (review) pick.push(review);
  while (pick.length < 3) {
    const q = fresh.find(p => !pick.some(x => x.id === p.id));
    if (!q) break;
    pick.push(q);
  }
  return { date, grade, source: "curated", questions: pick.slice(0, 3), submissions: {} };
};
