'use client';
import { soundChoice, audibleKinds, TONE_PATTERNS, type SoundKind } from './notificationSounds';
// 메시지 알림음 (커플홈 사용자 요청 — "웹사이트 열고 있는 중에 메시지가 오면 아이폰 메시지 오는 듯한 간단한 알림음").
// 파일 없이 Web Audio로 두 음을 합성한다. 켜고 끄는 건 브라우저마다 (사람마다 취향이 달라 서버에 두지 않는다).
const KEY = 'ohome.msgsound.v1';   // 'off'면 끔
export const MSG_SOUND_EVT = 'ohome-msgsound';

export function isMsgSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setMsgSoundOn(on: boolean): void {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* 무시 */ }
  try { window.dispatchEvent(new Event(MSG_SOUND_EVT)); } catch { /* 무시 */ }
}

/** 브라우저가 지원하는 경우에만 사용자가 직접 알림을 켤 때 권한을 요청한다. */
export async function requestBgNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  } catch { return 'unsupported'; }
}

/**
 * 탭이 백그라운드에 있을 때 시스템 알림을 보조 수단으로 띄운다.
 * WebAudio만으로는 모바일 OS가 정지시킨 탭에서 알림을 보낼 수 없다.
 */
export function showBackgroundNotification(tag = 'ohome-message'): void {
  if (!isMsgSoundOn() || typeof document === 'undefined' || !document.hidden || typeof window === 'undefined'
    || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notice = new Notification('O.HOME', {
      body: '새 메시지가 도착했습니다.',
      tag,
    });
    window.setTimeout(() => notice.close(), 6000);
  } catch { /* 알림 API 미지원 또는 OS 차단 */ }
}

let ctx: AudioContext | null = null;
let armed = false;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (AC && (!ctx || ctx.state === 'closed')) ctx = new AC();
  return ctx;
}

/** 첫 클릭·키 입력으로 오디오를 준비한다. 일반 알림은 사용자 조작 없이 컨텍스트를 만들지 않는다. */
export function armMsgSound(): void {
  if (armed || typeof window === 'undefined') return;
  armed = true;
  const make = () => {
    try { const ac = context(); void ac?.resume().catch(() => undefined); } catch { /* 오디오 미지원 */ }
    window.removeEventListener('pointerdown', make, true);
    window.removeEventListener('keydown', make, true);
  };
  window.addEventListener('pointerdown', make, true);
  window.addEventListener('keydown', make, true);
}

/** 설정된 종류·음량으로 짧은 음을 합성한다. 미리듣기에서만 전체 음소거를 우회한다. */
function schedule(kind: SoundKind, delayMs: number, preview: boolean): boolean {
  if ((!preview && !isMsgSoundOn()) || !ctx || ctx.state !== 'running') return false;
  const choice = soundChoice(kind);
  if (choice.preset === 'none' || choice.volume <= 0) return false;
  const pattern = TONE_PATTERNS[choice.preset];
  const ac = ctx;
  const start = ac.currentTime + .01 + Math.max(0, delayMs) / 1000;
  for (const note of pattern) {
    const osc = ac.createOscillator(), gain = ac.createGain();
    const at = start + note.offset;
    osc.type = note.wave ?? 'sine'; osc.frequency.value = note.frequency;
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(.0002, note.gain * choice.volume / 70), at + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, at + note.duration);
    osc.connect(gain); gain.connect(ac.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at); osc.stop(at + note.duration + .02);
  }
  try { window.dispatchEvent(new CustomEvent('ohome-ding', { detail: { kind, preview } })); } catch { /* SSR */ }
  return true;
}

export function playMsgTone(kind: SoundKind = 'rp', delayMs = 0): void {
  if (!isMsgSoundOn() || !ctx) return;
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume().then(() => { schedule(kind, delayMs, false); }).catch(() => undefined);
    } else schedule(kind, delayMs, false);
  } catch { /* 브라우저·OS 정책상 오디오 재생이 차단될 수 있다. */ }
}

/** 같은 배치의 종류별로 한 번씩만, 서로 겹치지 않게 재생한다. */
export function playMsgTones(kinds: readonly SoundKind[]): void {
  if (!isMsgSoundOn()) return;
  audibleKinds(kinds).forEach((kind, i) => playMsgTone(kind, i * 650));
}

/** 클릭으로 직접 호출: 처음에도 재생 가능하며 실제 성공 여부를 반환한다. */
export async function previewMsgTone(kind: SoundKind): Promise<boolean> {
  try {
    const ac = context();
    if (!ac) return false;
    if (ac.state === 'suspended') await ac.resume();
    return schedule(kind, 0, true);
  } catch { return false; }
}
