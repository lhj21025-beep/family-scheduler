import { auth, db } from "./firebase";
import { deleteField, doc, FieldPath, getDoc, writeBatch } from "firebase/firestore";

const OWNER_EMAIL = "lhj21025@gmail.com";
const FAMILY_ID = "family-main";
const STATE_REF = () => doc(db, "googleCalendarSync", "dad");
const KEYWORD = "[가족]";
const GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/calendar.readonly";
type GoogleEvent = {
  id: string; status?: string; summary?: string; visibility?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  location?: string; description?: string;
};
type IndexRow = { day: string; fingerprint: string };
type Index = Record<string, IndexRow>;
export type SyncResult = { added: number; updated: number; removed: number; unchanged: number; calendars: number };

function loadIdentityScript(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    const script = existing ?? document.createElement("script");
    const timer = window.setTimeout(() => reject(new Error("Google 로그인 로딩 시간이 초과되었습니다.")), 15000);
    script.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
    script.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Google 로그인 스크립트를 불러오지 못했습니다.")); }, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.googleIdentity = "true";
      document.head.appendChild(script);
    }
  });
}
async function requestToken(clientId: string): Promise<string> {
  await loadIdentityScript();
  return new Promise((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPE,
      callback: (result: { access_token?: string; error?: string }) => {
        if (result.error || !result.access_token) reject(new Error("Google 캘린더 권한을 승인하지 않았습니다."));
        else resolve(result.access_token);
      },
      error_callback: () => reject(new Error("Google 계정 연결이 취소되었거나 실패했습니다.")),
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}
async function googleGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/" + path, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!response.ok) throw new Error(`Google Calendar API 요청 실패 (${response.status})`);
  return response.json() as Promise<T>;
}
async function allPages<T>(path: string, token: string, itemKey: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | undefined;
  do {
    const next: { items?: T[]; nextPageToken?: string } = await googleGet(
      path + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), token,
    );
    items.push(...(next.items ?? []));
    pageToken = next.nextPageToken;
  } while (pageToken);
  void itemKey;
  return items;
}
function startOfDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function localTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Google 일정의 날짜 정보가 올바르지 않습니다.");
  return `${startOfDay(d)}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).slice(0, 20).map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function syncGoogleFamilyCalendar(): Promise<SyncResult> {
  if (auth.currentUser?.email?.toLowerCase() !== "dad@family-scheduler.app")
    throw new Error("가족 스케줄러의 아빠 계정으로 로그인해주세요.");
  const clientId = import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID?.trim();
  if (!clientId) throw new Error("Google OAuth 클라이언트 ID 설정이 필요합니다. VITE_GOOGLE_CALENDAR_CLIENT_ID를 설정해주세요.");
  const accessToken = await requestToken(clientId);
  const user = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!user.ok) throw new Error("Google 계정 정보를 확인할 수 없습니다.");
  const identity = await user.json() as { email?: string };
  if (identity.email?.toLowerCase() !== OWNER_EMAIL)
    throw new Error(`${OWNER_EMAIL} 계정으로 Google 접근을 승인해주세요.`);

  // Include default visibility (including omitted field) and public; exclude private.
  const from = new Date(); from.setFullYear(from.getFullYear() - 1);
  const to = new Date(); to.setFullYear(to.getFullYear() + 2);
  const min = from.toISOString(), max = to.toISOString();
  const calendars = await allPages<{ id: string; accessRole?: string }>(
    "users/me/calendarList?maxResults=250", accessToken, "items",
  );
  const fresh = new Map<string, { day: string; fingerprint: string; event: Record<string, unknown> }>();
  for (const cal of calendars) {
    const params = new URLSearchParams({
      singleEvents: "true", showDeleted: "false", maxResults: "2500",
      timeMin: min, timeMax: max,
    });
    const items = await allPages<GoogleEvent>(
      `calendars/${encodeURIComponent(cal.id)}/events?${params.toString()}`, accessToken, "items",
    );
    for (const e of items) {
      if (e.status === "cancelled" || e.visibility === "private" || !e.summary?.includes(KEYWORD) || !e.start) continue;
      const start = e.start.date ? `${e.start.date}T00:00` : localTime(e.start.dateTime!);
      const end = e.end?.date ? `${e.end.date}T00:00` : e.end?.dateTime ? localTime(e.end.dateTime) : undefined;
      const id = "gcal_" + await digest(cal.id + ":" + e.id);
      const value: Record<string, unknown> = {
        id, title: e.summary.replace(KEYWORD, "").trim(), start, allDay: !!e.start.date,
        memberIds: ["me"], kind: "event", repeat: "none", familyId: FAMILY_ID,
        googleImported: true, googleCalendarId: cal.id, googleEventId: e.id,
        createdBy: auth.currentUser.uid,
      };
      if (end) value.end = end;
      if (e.location) value.location = e.location;
      if (e.description) value.memo = e.description;
      const fingerprint = JSON.stringify(value);
      fresh.set(id, { day: start.slice(0, 10), fingerprint, event: value });
    }
  }

  const stateSnap = await getDoc(STATE_REF());
  const previous = (stateSnap.data()?.items ?? {}) as Index;
  const result: SyncResult = { added: 0, updated: 0, removed: 0, unchanged: 0, calendars: calendars.length };
  const actions: Array<{ day: string; id: string; value?: Record<string, unknown> }> = [];
  const nextIndex: Index = {};
  for (const [id, row] of fresh) {
    nextIndex[id] = { day: row.day, fingerprint: row.fingerprint };
    if (!previous[id]) result.added++;
    else if (previous[id].fingerprint !== row.fingerprint || previous[id].day !== row.day) result.updated++;
    else { result.unchanged++; continue; }
    if (previous[id] && previous[id].day !== row.day) actions.push({ id, day: previous[id].day });
    actions.push({ id, day: row.day, value: row.event });
  }
  for (const [id, row] of Object.entries(previous)) {
    if (!fresh.has(id)) {
      // Only delete events within the completely fetched time window.
      if (row.day >= min.slice(0,10) && row.day <= max.slice(0,10)) {
        actions.push({ id, day: row.day });
        result.removed++;
      } else nextIndex[id] = row;
    }
  }
  // Batches use field-path updates so other family events are never overwritten.
  // Index is saved only after all operations complete; reruns recover partial failures.
  for (let i = 0; i < actions.length; i += 300) {
    const batch = writeBatch(db);
    for (const a of actions.slice(i, i + 300)) {
      const ref = doc(db, "scheduleDays", a.day);
      const key = a.id.replace(/[^A-Za-z0-9_]/g, "_");
      if (a.value) batch.set(ref, { date: a.day, events: { [key]: a.value } }, { merge: true });
      else {
        const snap = await getDoc(ref);
        if (snap.exists()) batch.update(ref, new FieldPath("events", key), deleteField());
      }
    }
    await batch.commit();
  }
  await import("firebase/firestore").then(({setDoc}) => setDoc(STATE_REF(), {
    items: nextIndex, lastSyncedAt: new Date().toISOString(),
    ownerEmail: OWNER_EMAIL, keyword: KEYWORD, allowedVisibility: ["default", "public"],
  }));
  return result;
}
