'use client';
// 서버 연결 부팅 (v2.0) — 앱이 그려지기 전에 런타임 설정(ohome.config.json → localStorage → env)을
// 한 번 읽어 백엔드를 확정한다. 확정 전에는 자식을 그리지 않아
// "로컬 모드로 한 번 그렸다가 서버 모드로 다시 그리는" 깜빡임을 막는다.
//
// 홈(자관) 확정 (v2.1) — 설정을 받기 전에 **누구인지**를 먼저 알아야 한다.
//   · 회원: 프로필의 homeId 홈
//   · 총관리자: 리스트에서 골라 둔 홈(ohome.home.v1). 없으면 홈 없음 → 리스트 화면
//   · 비로그인: 홈 없음 → 로그인 화면
// 홈이 있을 때만 그 홈의 설정(테마·메뉴·폰트…)을 받아 캐시한다.
import React, { useEffect, useState } from 'react';
import { initSupabase } from '@/lib/supabase';
import { primeSettings } from '@/lib/settingStore';
import { pickedHomeId, setCurrentHomeId } from '@/lib/home';

export function ServerBoot({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  // 대기가 길어질 때만 표시 — 빠르게 끝나는 경우 스피너가 깜빡이는 게 더 거슬린다
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { if (alive) setSlow(true); }, 400);
    // 백엔드 확정 → 사용자·홈 확정 → 그 홈의 사이트 설정을 한 번에 받아 캐시 → 그 다음에 화면을 그린다.
    // 각 스토어가 렌더 중 동기적으로 설정을 읽기 때문에 순서가 중요하다.
    (async () => {
      const be = await initSupabase();
      if (be) {
        let home: string | null = null;
        try {
          const u = await be.currentUser();
          if (u) home = u.role === 'admin' ? pickedHomeId() : (u.homeId ?? null);
        } catch { /* 네트워크·규칙 문제면 홈 없음으로 */ }
        be.setHome(home);
        setCurrentHomeId(home);
        if (home) await primeSettings();
      } else {
        await primeSettings();   // 로컬 모드 — 홈 개념 없이 예전처럼
      }
    })().finally(() => { if (alive) { clearTimeout(t); setReady(true); } });
    return () => { alive = false; clearTimeout(t); };
  }, []);
  // 배경(테마 그라데이션)은 body가 첫 페인트 전에 이미 칠하므로 여기서는 표시만 얹는다
  if (!ready) return slow ? <div className="boot-wait"><i /></div> : null;
  return <>{children}</>;
}
