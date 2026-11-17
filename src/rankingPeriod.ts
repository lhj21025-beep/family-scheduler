/** Months are independent of the rolling quiz-history window. */
export function rankingMonths(firstDay: string, today: string): string[] {
  const months: string[] = [];
  const first = firstDay.slice(0, 7);
  let year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7));
  while (`${year}-${String(month).padStart(2, "0")}` >= first) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    if (--month === 0) { year--; month = 12; }
  }
  return months;
}
export function rankingMonthRange(month: string, today: string): { start: string; end: string } {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { start: month + "-01", end: last < today ? last : today };
}

const shiftDay = (day: string, amount: number): string => {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

export function rankingWeekRange(anchor: string, today: string): { start: string; end: string } {
  const date = new Date(anchor + "T12:00:00Z");
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = shiftDay(anchor, -mondayOffset);
  const sunday = shiftDay(start, 6);
  return { start, end: sunday < today ? sunday : today };
}

export function rankingWeeks(firstDay: string, today: string): string[] {
  const first = rankingWeekRange(firstDay, today).start;
  const current = rankingWeekRange(today, today).start;
  const weeks: string[] = [];
  for (let day = current; day >= first; day = shiftDay(day, -7)) weeks.push(day);
  return weeks;
}
