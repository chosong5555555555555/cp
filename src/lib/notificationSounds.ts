'use client';

import { currentUserId } from './currentUser';

export const SOUND_SETTINGS_EVENT = 'ohome-msgsound';
const SOUND_KEY = 'ohome.soundprefs.v1';
export const SOUND_KINDS = ['rp', 'rpooc', 'rpturn', 'comment', 'thread', 'memo', 'diary', 'guest'] as const;
export type SoundKind = typeof SOUND_KINDS[number];
export const SOUND_LABELS: Record<SoundKind, string> = {
  rp: '역극 새 대사·지문', rpooc: 'OOC 채팅', rpturn: '역극 대사 끝',
  comment: '내 글 댓글', thread: '감상타래 새 글', memo: '새 메모', diary: '새 다이어리', guest: '방명록',
};
export const SOUND_PRESETS = [
  { id: 'chime', label: '기본 차임' },
  { id: 'soft', label: '부드러운 두 음' },
  { id: 'bell', label: '맑은 종' },
  { id: 'ping', label: '짧은 핑' },
  { id: 'wood', label: '낮은 톡' },
  { id: 'rise', label: '세 음 알림' },
  { id: 'none', label: '무음' },
] as const;
export type SoundPreset = typeof SOUND_PRESETS[number]['id'];
export interface SoundChoice { preset: SoundPreset; volume: number }
export type SoundSettings = Record<SoundKind, SoundChoice>;
export function isSoundKind(value: string): value is SoundKind {
  return (SOUND_KINDS as readonly string[]).includes(value);
}
function key() { return `${SOUND_KEY}:${currentUserId() ?? 'guest'}`; }
function preset(value: unknown): SoundPreset {
  return SOUND_PRESETS.some(p => p.id === value) ? value as SoundPreset : 'chime';
}
function volume(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 70;
}
export function readSoundSettings(): SoundSettings {
  let raw: Record<string, Partial<SoundChoice>> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key()) ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) raw = value as typeof raw;
  } catch { /* 기존 기본 차임을 유지한다. */ }
  return Object.fromEntries(SOUND_KINDS.map(kind => [kind, {
    preset: preset(raw[kind]?.preset), volume: volume(raw[kind]?.volume),
  }])) as SoundSettings;
}
export function soundChoice(kind: SoundKind): SoundChoice { return readSoundSettings()[kind]; }
export function setSoundChoice(kind: SoundKind, patch: Partial<SoundChoice>): boolean {
  const next = readSoundSettings();
  next[kind] = { preset: preset(patch.preset ?? next[kind].preset), volume: volume(patch.volume ?? next[kind].volume) };
  try { localStorage.setItem(key(), JSON.stringify(next)); }
  catch { return false; }
  try { window.dispatchEvent(new Event(SOUND_SETTINGS_EVENT)); } catch { /* SSR */ }
  return true;
}
export function resetSoundSettings(): boolean {
  try { localStorage.removeItem(key()); }
  catch { return false; }
  try { window.dispatchEvent(new Event(SOUND_SETTINGS_EVENT)); } catch { /* SSR */ }
  return true;
}
/** 알림 배치마다 종류를 한 번씩만, 무음 항목을 제외해서 재생한다. */
export function audibleKinds(kinds: readonly SoundKind[]): SoundKind[] {
  const settings = readSoundSettings();
  return [...new Set(kinds)].filter(kind => settings[kind].preset !== 'none' && settings[kind].volume > 0);
}
/** 파일 다운로드·외부 오디오 없이 WebAudio로 재생하는 짧은 음 패턴. */
export interface ToneNote { frequency: number; offset: number; duration: number; gain: number; wave?: OscillatorType }
export const TONE_PATTERNS: Record<Exclude<SoundPreset, 'none'>, readonly ToneNote[]> = {
  chime: [
    { frequency: 1318.5, offset: 0, duration: .16, gain: .12 },
    { frequency: 1760, offset: .11, duration: .42, gain: .14 },
  ],
  soft: [
    { frequency: 659.25, offset: 0, duration: .24, gain: .13 },
    { frequency: 523.25, offset: .18, duration: .35, gain: .10 },
  ],
  bell: [
    { frequency: 1046.5, offset: 0, duration: .48, gain: .10, wave: 'triangle' },
    { frequency: 2093, offset: 0, duration: .28, gain: .035 },
  ],
  ping: [{ frequency: 1568, offset: 0, duration: .17, gain: .14 }],
  wood: [
    { frequency: 440, offset: 0, duration: .08, gain: .18 },
    { frequency: 330, offset: .09, duration: .10, gain: .13 },
  ],
  rise: [
    { frequency: 523.25, offset: 0, duration: .16, gain: .10 },
    { frequency: 659.25, offset: .14, duration: .16, gain: .11 },
    { frequency: 783.99, offset: .28, duration: .25, gain: .12 },
  ],
};
