'use client';
// 웹푸시 (커플홈 사용자 요청 — "웹푸시 기능을 넣고 싶은데" / "정보수정에서 PC·모바일 체크해야만 알림이 가게")
//
// 구조
//  · 기기별 구독(endpoint+keys)은 콘텐츠 컬렉션 push_subs에 둔다 — 주인(authorId)은 그 회원, 공개범위 member.
//    알림을 만드는 쪽(보내는 회원)이 받는 사람의 구독을 읽어야 하므로 회원끼리는 읽힌다. 구독만으로는 아무도
//    푸시를 보낼 수 없다 — 푸시 서비스는 구독 때 쓴 공개키의 짝(개인키)으로 서명한 요청만 받는다.
//  · 개인키는 서버(Vercel 환경변수 PUSH_VAPID_PRIVATE_KEY)에만 있고 /api/push 라우트가 서명해 보낸다.
//    라우트는 호출한 사람이 이 홈의 로그인 계정인지 각 서비스의 공개 API로 확인한다.
//  · PC/모바일 구분은 기기에서 허용하는 순간 판별해 구독에 적어 둔다 (userAgentData.mobile → UA → 아이패드는 터치 여부).
//  · 켜기는 그 기기에서만(브라우저 권한 창), 끄기는 어디서든 (구독의 on만 내린다 — 서버가 건너뛴다).
//  · 손님(비로그인)이 남긴 댓글·방명록은 푸시가 안 간다 — 손님은 구독을 읽을 수 없고 라우트도 거부한다. 종 알림은 그대로.
import { backend, isServerMode } from './backend';
import { fetchList, syncList } from './db';
import { currentUserId } from './currentUser';
import { getSetting } from './settingStore';
import { currentHomeId } from './home';

export const PUSH_KEY = 'ohome.pushsubs.v1';
export type PushKind = 'pc' | 'mobile';
export interface PushSub {
  id: string;
  userId: string;
  kind: PushKind;
  label: string;                       // "Android · Chrome" 같은 기기 이름
  endpoint: string;
  keys: { p256dh: string; auth: string };
  on: boolean;                         // 체크 상태 — 꺼져 있으면 서버가 건너뛴다
  /** 알림에 내용을 숨긴다 (잠금 화면 등에 글 내용이 보이지 않게) — 종류만 적은 일반 문구로 보낸다. 받는 사람이 정하고 자기 구독 전부에 적는다 */
  hide?: boolean;
  createdAt: string;
  authorId: string;                    // = userId (서버 규칙: 주인만 고치고 지운다)
  visibility: 'member';                // 회원끼리 읽힌다 (보내는 쪽이 받는 사람 구독을 읽어야 한다)
  [k: string]: unknown;                // O.home의 ListItem 제약 (fetchList/syncList) 충족
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext !== false && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // 아이패드는 맥인 척한다
}

/** 홈 화면에 추가해 연 상태인지 — 아이폰은 이때만 웹푸시가 된다 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function deviceKind(): PushKind {
  if (typeof navigator === 'undefined') return 'pc';
  const uad = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uad && typeof uad.mobile === 'boolean') return uad.mobile ? 'mobile' : 'pc';
  if (isIos()) return 'mobile';
  return /Android|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent) ? 'mobile' : 'pc';
}

export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return '';
  const ua = navigator.userAgent;
  const os = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone|iPod/.test(ua) ? 'iPhone'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux' : '기기';
  const br = /Whale\//.test(ua) ? 'Whale'
    : /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '브라우저';
  return `${os} · ${br}${isStandalone() ? ' · 홈 화면' : ''}`;
}

export type ServerPushKey = { enabled: boolean; publicKey?: string };
/** 서버에 푸시 키가 등록돼 있는지 + 구독에 쓸 공개키 */
export async function serverPushKey(): Promise<ServerPushKey> {
  try {
    const r = await fetch('/api/push', { cache: 'no-store' });
    if (!r.ok) return { enabled: false };
    return await r.json() as ServerPushKey;
  } catch { return { enabled: false }; }
}

const toKey = (b64u: string) => {
  const s = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export async function currentBrowserSub(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch { return null; }
}

/** 앱 안에 든 브라우저(카카오톡·디스코드·인스타그램·네이버·라인 등의 링크 화면) — 푸시를 지원하지 않는다.
 *  모바일에서 "지원하지 않는다"가 뜨는 가장 흔한 이유 → 진짜 크롬(사파리)으로 열어야 한다 */
export function inAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /KAKAOTALK|Discord|Instagram|FBAN|FBAV|FB_IAB|NAVER\(inapp|Line\/|; wv\)|Twitter|DaumApps/i.test(navigator.userAgent);
}

/** 서비스 워커는 캐시를 우회해 갱신하고 실제 활성화까지 기다린다. 무한 대기를 막는다. */
export async function readyPushWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
  void reg.update().catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('서비스 워커를 시작하지 못했습니다. 새로고침 후 다시 시도해 주세요')), 12000);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** 기존 구독이 이전 배포의 VAPID 키에 묶였으면 새 키로 다시 만든다. */
export function subscriptionNeedsRenewal(sub: PushSubscription, publicKey: string): boolean {
  if (sub.expirationTime != null && sub.expirationTime <= Date.now()) return true;
  const key = sub.options?.applicationServerKey;
  if (!key) return false; // 키를 노출하지 않는 브라우저는 서버 테스트로 확인한다.
  const actual = ArrayBuffer.isView(key)
    ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength)
    : new Uint8Array(key);
  const wanted = toKey(publicKey);
  return actual.length !== wanted.length || actual.some((v, i) => v !== wanted[i]);
}

/** 권한 요청은 클릭 직후 실행한다. 키 변경·만료 구독도 다시 등록할 수 있다. */
export async function subscribeBrowser(publicKey: string): Promise<PushSubscription> {
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('permission-' + perm);
  const reg = await readyPushWorker();
  const existing = await reg.pushManager.getSubscription();
  if (existing && !subscriptionNeedsRenewal(existing, publicKey)) return existing;
  if (existing && !(await existing.unsubscribe())) throw new Error('기존 구독을 해제하지 못했습니다. 사이트 권한을 확인해 주세요');
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
}

/** 서버 발송과 별도로, 이 PC의 브라우저/OS가 팝업을 표시할 수 있는지 확인한다. */
export async function localPushTest(): Promise<void> {
  if (!pushSupported()) throw new Error('HTTPS 및 웹푸시 지원 브라우저가 필요합니다');
  if (Notification.permission !== 'granted') throw new Error('브라우저의 사이트 알림 권한을 허용해 주세요');
  const reg = await readyPushWorker();
  await reg.showNotification('이 기기 팝업 확인', {
    body: '브라우저 표시 요청을 보냈습니다. 보이지 않으면 OS 알림·방해 금지 설정을 확인해 주세요.',
    icon: '/icon-192.png', tag: `ohome-local-push-test-${Date.now()}`,
    requireInteraction: deviceKind() === 'pc', data: { url: '/mypage' },
  });
}

export async function unsubscribeBrowser(): Promise<void> {
  const s = await currentBrowserSub();
  if (s) await s.unsubscribe().catch(() => undefined);
}

export function subJson(s: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const j = s.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return null;
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}

export interface PushPayload {
  title: string; body?: string; url: string; tag?: string;
  /** 알림 아이콘 주소 — 보낼 때 환경설정의 탭 아이콘(파비콘)으로 채운다 (커플홈 사용자 요청: PC 알림 아이콘이 예쁘지 않았다) */
  icon?: string;
  /** 알림 종류 (rp·comment·guest·thread·memo·diary) — 내용을 숨길 때 종류만 적은 문구를 만드는 데 쓴다 */
  kind?: string;
}

/** 이 기기에서 「내용 숨기기」를 정해 둔 값 — 아직 등록한 기기가 없을 때 첫 등록에 그대로 쓴다 */
export const PUSH_HIDE_KEY = 'ohome.pushhide.v1';

const HIDE_TITLE: Record<string, string> = {
  rp: '역극 새 메시지', rpturn: '역극 대사 종료', comment: '새 댓글', guest: '방명록 새 글',
  thread: '타래 새 글', memo: '새 메모', diary: '새 다이어리',
};
/** 내용을 숨긴 문구 — 종류와 「홈에서 확인」만 (아이콘은 그대로) */
export function hiddenPayload(p: PushPayload): PushPayload {
  return { title: HIDE_TITLE[p.kind ?? ''] ?? '새 알림', body: '내용은 홈에서 확인해 주세요', url: p.url, tag: p.tag, kind: p.kind, icon: p.icon };
}

/** 환경설정의 탭 아이콘(파비콘) — 저장소 주소일 때만 (브라우저 저장 모드의 파일 id는 서비스 워커가 읽을 수 없다) */
function siteIcon(): string | undefined {
  const site = getSetting<{ favicon?: string }>('ohome.site.v1', {});
  const f = (site?.favicon ?? '').trim();
  return f.startsWith('https://') || f.startsWith('http://') ? f : undefined;
}

// 수신자별 조회 + 진행 중 Promise 공유. 빈 구독도 캐시하여 미등록 상대에게 반복 조회하지 않는다.
const SUBS_CACHE_MS = 60_000;
let subsScope = '';
let subsGeneration = 0;
const subsCache = new Map<string, { at: number; list: PushSub[] }>();
const subsPending = new Map<string, Promise<PushSub[]>>();
export function dropSubsCache() {
  ++subsGeneration; subsCache.clear(); subsPending.clear();
}
async function recipientSubs(userId: string): Promise<PushSub[]> {
  const scope = JSON.stringify([currentHomeId(), currentUserId()]);
  if (scope !== subsScope) { dropSubsCache(); subsScope = scope; }
  const hit = subsCache.get(userId);
  if (hit && Date.now() - hit.at < SUBS_CACHE_MS) return hit.list;
  const pending = subsPending.get(userId);
  if (pending) return pending;
  const generation = subsGeneration;
  const request = fetchList<PushSub>('push_subs', { authorId: userId }).then(rows => {
    const list = rows.filter(s => s.userId === userId);
    if (generation === subsGeneration) subsCache.set(userId, { at: Date.now(), list });
    return list;
  }).finally(() => {
    if (subsPending.get(userId) === request) subsPending.delete(userId);
  });
  subsPending.set(userId, request);
  return request;
}
async function targetSubs(userIds: string[]): Promise<PushSub[]> {
  return (await Promise.all([...new Set(userIds.filter(Boolean))].map(recipientSubs))).flat();
}

export interface PushResult { sent: number; dead: string[]; failed: number; errors: string[] }
export function pushErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    'no-key': '서버 푸시 키가 없습니다. 환경변수 등록 후 재배포해 주세요',
    unauthorized: '서버 인증에 실패했습니다. 다시 로그인하고 서버 연결 설정을 확인해 주세요',
    'no-targets': '이 브라우저의 켜진 구독을 서버에서 찾지 못했습니다. 이 기기 등록 복구를 눌러 주세요',
    'network': '푸시 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요',
    'push-401': '푸시 서비스가 인증을 거부했습니다. 이 기기 등록 복구로 구독 키를 갱신해 주세요',
    'push-403': '푸시 서비스가 구독 키를 거부했습니다. 이 기기 등록 복구를 눌러 주세요',
    'push-404': '기기 구독이 만료되거나 삭제됐습니다. 이 기기 등록 복구를 눌러 주세요',
    'push-410': '기기 구독이 만료되거나 삭제됐습니다. 이 기기 등록 복구를 눌러 주세요',
    'push-429': '푸시 서비스의 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요',
  };
  return messages[code] ?? `푸시 발송 오류 (${code})`;
}

/** 켜진 구독에만 전송한다. 테스트는 현재 endpoint 하나를 지정해 다른 PC의 성공과 혼동하지 않는다.
 * 서버/네트워크 오류는 결과로 반환하며 글·채팅 자체는 막지 않는다. */
export async function webPushTo(
  userIds: string[], payload: PushPayload, options: { endpoint?: string; fresh?: boolean } = {},
): Promise<PushResult | null> {
  const out: PushResult = { sent: 0, dead: [], failed: 0, errors: [] };
  try {
    if (typeof window === 'undefined' || !userIds.length) return null;
    const scope = JSON.stringify([currentHomeId(), currentUserId()]);
    if (options.fresh) dropSubsCache();
    const list = await targetSubs(userIds);
    if (scope !== JSON.stringify([currentHomeId(), currentUserId()])) return null;
    const select = (rows: PushSub[]) => rows.filter(s => s.on && userIds.includes(s.userId)
      && (!options.endpoint || s.endpoint === options.endpoint) && !!s.endpoint && !!s.keys?.p256dh && !!s.keys?.auth);
    const targets = select(list);
    // 빈 결과도 유효한 캐시다. 등록·설정 저장에서는 dropSubsCache(), 기기 시험은 fresh로 갱신한다.
    if (!targets.length) return options.endpoint ? { ...out, errors: ['no-targets'] } : null;
    const token = isServerMode() ? await backend()?.authToken() : null;
    const url = new URL(payload.url, location.origin).href;
    const icon = payload.icon ?? siteIcon();
    const groups = [
      { subs: targets.filter(s => !s.hide), payload: { ...payload, url, icon } },
      { subs: targets.filter(s => !!s.hide), payload: { ...hiddenPayload(payload), url, icon } },
    ].filter(g => g.subs.length);
    await Promise.all(groups.flatMap(g => {
      const batches: PushSub[][] = [];
      for (let i = 0; i < g.subs.length; i += 30) batches.push(g.subs.slice(i, i + 30));
      return batches.map(async subs => {
        try {
          const res = await fetch('/api/push', {
            method: 'POST', keepalive: true,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify({ subs: subs.map(s => ({ endpoint: s.endpoint, keys: s.keys })), payload: g.payload }),
          });
          const result = await res.json() as { sent?: number; failed?: number; dead?: string[]; error?: string; codes?: number[] };
          if (!res.ok) { out.failed += subs.length; out.errors.push(result.error ?? `http-${res.status}`); return; }
          out.sent += result.sent ?? 0; out.failed += result.failed ?? 0;
          out.dead.push(...(result.dead ?? []));
          if (result.failed) out.errors.push(...(result.codes?.length ? result.codes.map(c => `push-${c}`) : ['push-failed']));
        } catch { out.failed += subs.length; out.errors.push('network'); }
      });
    }));
    const me = currentUserId();
    const deadMine = list.filter(s => s.userId === me && out.dead.includes(s.endpoint));
    if (deadMine.length) {
      try { await syncList('push_subs', list, list.filter(s => !deadMine.includes(s)), me); }
      catch { /* 만료 구독 정리 실패로 발송 결과를 잃지 않는다. */ }
      dropSubsCache();
    }
    return out;
  } catch { return { ...out, errors: [...out.errors, 'network'] }; }
}
