'use client';
// 알림 (4.13) — 사이트 내 뱃지(헤더 종 + 메뉴 점). 디스코드 봇 DM은 Supabase/봇 서버 연동 시.
// 같은 탭 안에서 발생 지점(각 페이지)과 표시 지점(TopBar)이 다르므로 커스텀 이벤트로 동기화.
//
// **서버 배달 (v2.0 포크 제보 — 「알림이 안 와요」)**: 여태 알림은 기기(localStorage)에만 쌓여서,
// 알림을 **발생시킨 브라우저**에서 계정을 오갈 때만 보였다(혼자 계정 전환으로 시험할 때는 되고,
// 손님·다른 기기의 회원이 남긴 것은 영영 안 옴). 이제 서버 mode면 notifications 컬렉션에도 적는다 —
// **행 주인(authorId)을 받는 사람으로** 적으므로 서버 규칙상 받는 사람과 관리자만 읽고 지울 수 있다.
// 받는 쪽은 접속·벨 열기·실시간 구독으로 받아 가고(TopBar), 기기 목록은 그대로 캐시로 쓴다.
import { newId } from './postStore';
import { isServerMode, backend } from './backend';
import { fetchList, fetchOne, syncList } from './db';
import { currentHomeId } from './home';
import { currentUserId } from './currentUser';
import { webPushTo } from './push';

export type NotifType = 'rp' | 'rpturn' | 'comment' | 'guest' | 'thread' | 'memo' | 'diary';   // memo·diary: 커플홈 (상대방에게)
// rpturn = 「상대의 대사가 전부 끝났습니다」 (v2.3 사용자 요청) — 역극 발화 알림('rp')과 따로 켜고 끌 수 있게 종류를 나눴다
export interface Notif {
  id: string;
  type: NotifType;
  toUserId: string;          // 수신 회원
  title: string;
  body?: string;
  href: string;              // 클릭 시 이동
  date: string;
  read: boolean;
  readAt?: string;           // 읽은 시각 — 하루 지나면 목록에서 정리 (v2.0 사용자 요청)
}

/** 읽고 하루가 지난 알림은 목록에서 치운다 (v2.0 사용자 요청).
 *  안 읽은 알림은 아무리 오래돼도 남는다 — 놓친 것을 임의로 지우면 안 되니까. */
const KEEP_READ_MS = 24 * 60 * 60 * 1000;
export function pruneNotifs(list: Notif[], now = Date.now()): Notif[] {
  return list.filter(n => {
    if (!n.read) return true;
    const t = Date.parse(n.readAt ?? '');
    return !Number.isFinite(t) || now - t < KEEP_READ_MS;
  });
}

const KEY = 'ohome.notif.v1';
const SET_KEY = 'ohome.notifset.v1'; // 회원별 알림 항목 on/off — { [userId]: { rp, comment, guest } }
export const NOTIF_EVENT = 'ohome-notif';

export const NOTIF_TYPE_LABEL: Record<NotifType, string> = {
  rp: '역극 새 메시지', rpturn: '역극 대사 종료', comment: '내 글 댓글', guest: '방명록 (관리자)',
  thread: '감상타래 새 글', memo: '메모장 새 메모', diary: '다이어리 새 일기',
};

export function readNotifs(): Notif[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Notif[];
    const kept = pruneNotifs(all);
    // 정리된 게 있으면 저장까지 (다음 번에 또 훑지 않게) — 여기서 이벤트를 쏘면 렌더 중 갱신이 되어 안 쏜다
    if (kept.length !== all.length) {
      try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* 무시 */ }
    }
    return kept;
  } catch { return []; }
}

function write(list: Notif[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 100))); } catch { /* 무시 */ }
  window.dispatchEvent(new Event(NOTIF_EVENT));
}

export interface NotifSettings { rp: boolean; rpturn: boolean; comment: boolean; guest: boolean; thread: boolean; memo: boolean; diary: boolean }
const DEFAULT_SET: NotifSettings = {
  rp: true, rpturn: true, comment: true, guest: true, thread: true, memo: true, diary: true,
};

export function notifSettings(userId: string): NotifSettings {
  try {
    const all = JSON.parse(localStorage.getItem(SET_KEY) ?? '{}');
    return { ...DEFAULT_SET, ...(all[userId] ?? {}) };
  } catch { return DEFAULT_SET; }
}

export function setNotifSetting(userId: string, key: NotifType, value: boolean) {
  try {
    const all = JSON.parse(localStorage.getItem(SET_KEY) ?? '{}');
    all[userId] = { ...DEFAULT_SET, ...(all[userId] ?? {}), [key]: value };
    localStorage.setItem(SET_KEY, JSON.stringify(all));
  } catch { /* 무시 */ }
  if (liveNotifs?.scope === notifScope(userId) && liveNotifs.rows) applyNotifs(userId, liveNotifs.rows);
  window.dispatchEvent(new Event(NOTIF_EVENT));
}

/** 알림 생성 — 수신자가 해당 항목을 꺼뒀으면 만들지 않음.
 *  dedupeKey: 같은 키의 안 읽은 알림이 있으면 새로 쌓지 않고 갱신 (역극 방 단위 묶음 등) */
export function pushNotif(n: {
  type: NotifType; toUserId: string; title: string; body?: string; href: string; dedupeKey?: string;
}) {
  if (!notifSettings(n.toUserId)[n.type]) return;
  // 원본과 동일: 알림 생성 시 수신자가 켜 둔 기기에도 웹푸시를 보낸다.
  void webPushTo([n.toUserId], { title: n.title, body: n.body, url: n.href, tag: n.dedupeKey ?? n.type, kind: n.type });
  const list = readNotifs();
  if (n.dedupeKey) {
    const i = list.findIndex(x => !x.read && x.toUserId === n.toUserId
      && x.type === n.type && x.href === n.href && x.title === n.title);
    if (i >= 0) {
      const [ex] = list.splice(i, 1);
      write([{ ...ex, body: n.body, date: new Date().toISOString() }, ...list]);
      // 서버에는 새 행으로 남긴다 — 남의 행(받는 사람 소유)은 고칠 수 없다.
      // 겹친 행은 받는 쪽이 받아 가면서 정리한다 (syncNotifs)
      sendToServer({ ...ex, id: newId(), body: n.body, date: new Date().toISOString() });
      return;
    }
  }
  const row: Notif = {
    id: newId(), type: n.type, toUserId: n.toUserId, title: n.title, body: n.body,
    href: n.href, date: new Date().toISOString(), read: false,
  };
  write([row, ...list]);
  sendToServer(row);
}

/**
 * 관리자(들)에게 알림 (v2.0 포크 제보 후 정비).
 *
 * 예전에는 받는 사람을 문자 그대로 'admin'으로 적었다 — 목업 관리자 id라서 **서버 모드에서는
 * 실제 관리자 uid와 절대 일치하지 않아** 방명록 알림이 관리자에게 영영 표시되지 않았다.
 * 회원 목록(공개 읽기)에서 role이 admin인 실제 id를 찾아 그 앞으로 보낸다. 여러 명이면 전원,
 * 지금 로그인한 사람 본인은 뺀다. 브라우저 저장 모드에서는 지금까지처럼 'admin'(목업 id).
 */
let adminIdsCache: string[] | null = null;
async function adminIds(): Promise<string[]> {
  if (!isServerMode()) return ['admin'];
  if (adminIdsCache) return adminIdsCache;
  try {
    const ms = await backend()!.listMembers();
    adminIdsCache = ms.filter(m => m.role === 'admin').map(m => m.id);
  } catch { return []; }   // 캐시하지 않는다 — 다음 알림 때 다시 시도
  return adminIdsCache;
}
export function notifyAdmins(n: { type: NotifType; title: string; body?: string; href: string; dedupeKey?: string }) {
  void adminIds().then(ids => {
    for (const id of ids) {
      if (id === currentUserId()) continue;   // 본인 행동은 본인에게 알리지 않는다
      pushNotif({ ...n, toUserId: id });
    }
  });
}

/**
 * 같이 쓰는 사람 모두에게 (커플홈 사용자 요청 — "자캐 메모를 남기거나 다이어리를 남긴 것도 상대방에게 알림이 가게").
 * 회원 목록(useMembers)의 전원 — 관리자든 상대 오너든 — 에게, 본인은 뺀다.
 * 목록이 아직 안 왔으면(서버 첫 화면·권한 문제) 관리자에게만이라도 (notifyAdmins).
 */
export function notifyMembers(
  n: { type: NotifType; title: string; body?: string; href: string; dedupeKey?: string },
  members: { id: string }[],
) {
  const me = currentUserId();
  const ids = [...new Set(members.map(m => m.id).filter(id => !!id && id !== me))];
  if (!ids.length) { notifyAdmins(n); return; }
  for (const id of ids) pushNotif({ ...n, toUserId: id });
}

/* ---------- 서버 배달 (v2.0) ---------- */
/** 서버 행 — 받는 사람을 주인으로, 나만보기로 적는다 (읽기·수정·삭제가 받는 사람·관리자로 잠긴다) */
const asRow = (n: Notif) => ({ ...n, authorId: n.toUserId, visibility: 'private' as const });

/** 알림 한 건을 서버에도 — 실패해도 조용히 (알림 때문에 댓글 자체가 막히면 안 된다) */
function sendToServer(n: Notif) {
  if (!isServerMode()) return;
  void syncList('notifications', [], [asRow(n)], currentUserId())
    .catch(e => console.warn('[ohome] 알림 서버 저장 실패', e));
}

/** 내 알림 행의 변경(읽음·삭제)을 서버에도 — 내 행이므로 서버 규칙이 허용한다 */
function mirrorToServer(prev: Notif[], next: Notif[]) {
  if (!isServerMode() || (!prev.length && !next.length)) return;
  void syncList('notifications', prev.map(asRow), next.map(asRow), currentUserId())
    .catch(() => { /* 규칙 미적용 포크 등 — 기기 목록은 이미 반영됨 */ });
}

/**
 * 알림 전달 자가진단 (v2.0 포크 제보 「여전히 안 와요」 대응) — 어디가 막혔는지 스스로 확인.
 * 내 앞으로 시험 알림을 **서버에** 적고, 서버에서 되읽어 본 뒤 지운다.
 * 결과 문구가 곧 안내다: 저장이 막히면 만들기 규칙, 읽기가 막히면 읽기 규칙 문제.
 */
export async function selfTestNotif(userId: string): Promise<string> {
  if (!isServerMode()) return '브라우저 저장 모드입니다 — 알림은 이 브라우저 안에서만 동작합니다';
  const now = new Date().toISOString();
  const row = asRow({
    id: newId(), type: 'comment', toUserId: userId, title: '알림 전달 확인',
    href: '/', date: now, read: true, readAt: now,
  });
  try {
    await syncList('notifications', [], [row], currentUserId());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `서버 저장 실패 — ${msg.slice(0, 80)} · 설치 SQL 재실행(수파베이스) 또는 Firestore 규칙 재부착(파이어베이스)이 필요합니다`;
  }
  try {
    const found = !!await fetchOne('notifications', row.id);
    try { await syncList('notifications', [row], [], currentUserId()); } catch { /* 시험 행 정리 실패는 무시 */ }
    return found
      ? '정상 — 알림이 서버에 저장되고 읽혔습니다. 남이 남긴 알림은 접속·벨 열기 때 도착합니다'
      : '저장은 됐지만 읽기에 안 보입니다 — 보안 규칙(읽기)을 최신으로 다시 적용해 주세요';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `서버 읽기 실패 — ${msg.slice(0, 80)} · 보안 규칙을 최신으로 다시 적용해 주세요`;
  }
}

/** Firebase는 주기 조회하지 않는다. 비실시간 백엔드만 60초 보조 확인. */
export const NOTIF_SYNC_MS = 60_000;
let lastSync = { scope: '', at: 0 };
let pendingSync: { scope: string; promise: Promise<void> } | null = null;
let liveNotifs: { scope: string; rows: Notif[] | null } | null = null;
const notifScope = (userId: string) => JSON.stringify([currentHomeId(), userId]);

/** 서버 목록을 권위 있는 상태로 반영: 다른 기기에서 삭제한 행도 이 기기에서 제거한다. */
function applyNotifs(userId: string, rows: Notif[]) {
  const now = Date.now();
  const settings = notifSettings(userId);
  const local = readNotifs();
  const locals = new Map(local.filter(n => n.toUserId === userId).map(n => [n.id, n]));
  const mine: Notif[] = [];
  const drop: Notif[] = [];
  const seen = new Set<string>();
  for (const r of rows.filter(r => r.toUserId === userId).sort((a, b) => b.date.localeCompare(a.date))) {
    const ex = locals.get(r.id);
    const merged: Notif = {
      id: r.id, type: r.type, toUserId: r.toUserId, title: r.title, body: r.body,
      href: r.href, date: r.date, read: !!r.read || !!ex?.read, readAt: r.readAt ?? ex?.readAt,
    };
    const expired = merged.read && Number.isFinite(Date.parse(merged.readAt ?? ''))
      && now - Date.parse(merged.readAt!) >= KEEP_READ_MS;
    const key = JSON.stringify([r.type, r.href, r.title]);
    if (expired || (!merged.read && seen.has(key))) { drop.push(r); continue; }
    if (!merged.read) seen.add(key);
    if (settings[r.type] !== false) mine.push(merged);
  }
  if (drop.length) mirrorToServer(drop, []);
  const next = [...local.filter(n => n.toUserId !== userId), ...mine]
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
  if (JSON.stringify(local) !== JSON.stringify(next)) write(next);
}

/** 한 수신자의 한 리스너: 데이터가 오면 그대로 병합하며 getDocs를 추가 호출하지 않는다. */
export function watchNotifs(userId: string): () => void {
  const be = backend();
  if (!isServerMode() || !userId) return () => {};
  const scope = notifScope(userId);
  const session = { scope, rows: null as Notif[] | null };
  let alive = true;
  if (be?.subscribeList) {
    liveNotifs = session;
    const off = be.subscribeList('notifications', rows => {
      if (!alive || notifScope(userId) !== scope) return;
      session.rows = rows as unknown as Notif[];
      applyNotifs(userId, session.rows);
    }, error => console.warn('[ohome] 알림 실시간 구독 실패', error), { authorId: userId });
    return () => { alive = false; off(); if (liveNotifs === session) liveNotifs = null; };
  }
  // Supabase Realtime 미설정 환경만 느린 보조 조회를 유지한다.
  void syncNotifs(userId, true);
  const off = be?.subscribe('notifications', () => void syncNotifs(userId));
  const onFocus = () => { if (document.visibilityState === 'visible') void syncNotifs(userId); };
  const tick = setInterval(onFocus, NOTIF_SYNC_MS);
  window.addEventListener('focus', onFocus);
  return () => { alive = false; off?.(); clearInterval(tick); window.removeEventListener('focus', onFocus); };
}

export async function syncNotifs(userId: string, force = false): Promise<void> {
  if (!isServerMode() || !userId) return;
  const scope = notifScope(userId);
  if (liveNotifs?.scope === scope) {
    if (liveNotifs.rows) applyNotifs(userId, liveNotifs.rows);
    return; // 리스너 시작 중에도 이중 초기 조회하지 않는다.
  }
  if (pendingSync?.scope === scope) return pendingSync.promise;
  if (!force && lastSync.scope === scope && Date.now() - lastSync.at < NOTIF_SYNC_MS) return;
  lastSync = { scope, at: Date.now() };
  const promise = (async () => {
    try {
      const rows = await fetchList('notifications', { authorId: userId }) as unknown as Notif[];
      if (notifScope(userId) === scope) applyNotifs(userId, rows);
    } catch (error) { console.warn('[ohome] 알림 조회 실패', error); }
  })();
  pendingSync = { scope, promise };
  try { await promise; } finally { if (pendingSync?.promise === promise) pendingSync = null; }
}

export function markRead(id: string) {
  const at = new Date().toISOString();
  const list = readNotifs();
  const before = list.find(n => n.id === id);
  const next = list.map(n => (n.id === id ? { ...n, read: true, readAt: n.readAt ?? at } : n));
  write(next);
  // 읽음도 서버에 — 다른 기기에서 안 읽음으로 되살아나지 않게 (v2.0)
  if (before && !before.read) mirrorToServer([before], [next.find(n => n.id === id)!]);
}

export function markAllRead(userId: string) {
  const at = new Date().toISOString();
  const list = readNotifs();
  const next = list.map(n => (n.toUserId === userId ? { ...n, read: true, readAt: n.readAt ?? at } : n));
  write(next);
  const before = list.filter(n => n.toUserId === userId && !n.read);
  mirrorToServer(before, before.map(n => next.find(x => x.id === n.id)!));
}

/** 읽은 알림 지금 바로 정리 (v2.0 사용자 요청 — 하루를 기다리지 않고 손으로) */
export function clearReadNotifs(userId: string) {
  const list = readNotifs();
  const gone = list.filter(n => n.toUserId === userId && n.read);
  write(list.filter(n => !(n.toUserId === userId && n.read)));
  mirrorToServer(gone, []);   // 서버에서도 지운다 — 안 지우면 다음 접속에 되살아난다
}

export function removeNotif(id: string) {
  const list = readNotifs();
  const removed = list.filter(n => n.id === id);
  write(list.filter(n => n.id !== id));
  mirrorToServer(removed, []);
}
