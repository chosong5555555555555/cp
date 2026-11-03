'use client';
// 기본 사이트 설정: 개별 홈 설정과 별도로 루트에 저장한다.
import { useEffect, useReducer } from 'react';
import { backend } from './backend';

export interface PlatformSettings { title: string; favicon?: string }
export const PLATFORM_KEY = 'ohome.platform.v1';
const DEFAULT: PlatformSettings = { title: 'O.HOME' };
let saved: PlatformSettings = DEFAULT;
const EVT = 'ohome-platform';

export async function primePlatformSettings() {
  const be = backend();
  saved = DEFAULT;
  try {
    const value = be
      ? await be.fetchSetting<PlatformSettings>(PLATFORM_KEY)
      : JSON.parse(localStorage.getItem(PLATFORM_KEY) ?? 'null');
    if (value) saved = { title: value.title?.trim() || DEFAULT.title, favicon: value.favicon || undefined };
  } catch { /* 읽기에 실패하면 다른 홈의 설정이 아닌 기본값을 사용 */ }
}

export function usePlatformSettings(): [PlatformSettings, (value: PlatformSettings) => Promise<void>] {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener(EVT, force);
    return () => window.removeEventListener(EVT, force);
  }, []);
  return [saved, async value => {
    const next = { title: value.title.trim() || DEFAULT.title, favicon: value.favicon || '' };
    const be = backend();
    // 서버 저장이 성공한 뒤에만 화면을 바꾼다. 실패를 저장 성공처럼 보이지 않게 한다.
    if (be) await be.saveSetting(PLATFORM_KEY, next);
    else localStorage.setItem(PLATFORM_KEY, JSON.stringify(next));
    saved = next;
    window.dispatchEvent(new Event(EVT));
  }];
}
