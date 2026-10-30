export type RegistrationEvent = {
  id: string;
  title: string;
  start: string;
  allDay?: boolean;
  memberIds: string[];
  kind?: string;
  homeworkId?: string;
};

const normalized = (text: string) => text.trim().replace(/\s+/g, " ");
const homeworkTitle = (text: string) => normalized(text
  .replace(/^(?:(?:📝|✅|☑️|☑|✔️|✔)\s*)+/u, "")
  .replace(/^숙제 완료\s*·\s*/, ""));
const isHomework = (e: RegistrationEvent) => e.kind === "homework" || e.kind === "homework-complete";

export function sameRegistration(a: RegistrationEvent, b: RegistrationEvent): boolean {
  if (a.start.slice(0, 10) !== b.start.slice(0, 10)) return false;
  if ([...new Set(a.memberIds)].sort().join(",") !== [...new Set(b.memberIds)].sort().join(",")) return false;
  if (isHomework(a) && isHomework(b)) {
    const first = homeworkTitle(a.title), second = homeworkTitle(b.title);
    const detailed = a.homeworkId === "school-other" || b.homeworkId === "school-other" ||
      first.startsWith("학교숙제 ·") || second.startsWith("학교숙제 ·");
    return first === second || (!detailed && !!a.homeworkId && a.homeworkId === b.homeworkId);
  }
  return (a.kind ?? "event") === "event" && (b.kind ?? "event") === "event" &&
    normalized(a.title) === normalized(b.title) && !!a.allDay === !!b.allDay &&
    (!!a.allDay || a.start.slice(0, 16) === b.start.slice(0, 16));
}

export function uniqueRegistrations<T extends RegistrationEvent>(proposed: T[], existing: RegistrationEvent[], editingId?: string): T[] {
  const byDay = new Map<string, RegistrationEvent[]>();
  for (const row of existing) {
    const key = row.start.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }
  const accepted: T[] = [];
  for (const row of proposed) {
    const key = row.start.slice(0, 10), peers = byDay.get(key) ?? [];
    if (peers.some(old => !(old.id === editingId && row.id === editingId) && sameRegistration(row, old))) continue;
    accepted.push(row);
    byDay.set(key, [...peers.filter(old => old.id !== row.id), row]);
  }
  return accepted;
}

export function registrationSummary(total: number, saved: number): string {
  const skipped = total - saved;
  return skipped > 0
    ? `${total}건 중 ${skipped}건은 중복으로 제외하고 ${saved}건 등록했습니다.`
    : `${saved}건 등록했습니다.`;
}
