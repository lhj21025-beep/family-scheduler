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
