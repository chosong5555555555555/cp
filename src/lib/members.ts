'use client';
// 회원 목록 (v2.0) — 서버 모드면 DB의 회원 프로필, 아니면 브라우저 계정
// 홈(자관) 분리 (v2.1) — 서버 모드에서는 **지금 홈의 회원만** 돌려준다. 총관리자는 어느 홈에도
// 속하지 않으므로 목록에 없다 (권한 부여·역극 참여자 선택은 홈 회원끼리의 일이다).
import { useEffect, useState } from 'react';
import { backend, isServerMode } from './backend';
import { currentHomeId } from './home';

export interface MemberLite { id: string; nickname: string; role?: 'admin' | 'member' }

/** 로컬(브라우저) 계정 목록 — 서버 없이 개발할 때 */
export function memberPool(): MemberLite[] {
  const base: MemberLite[] = [
    { id: 'admin', nickname: '관리자' },
    { id: 'guest', nickname: '지인회원' },
  ];
  try {
    const reg = JSON.parse(localStorage.getItem('ohome.mockreg.v1') ?? '{}') as
      Record<string, { user?: MemberLite }>;
    for (const k of Object.keys(reg)) {
      const u = reg[k]?.user;
      if (u && !base.some(b => b.id === u.id)) base.push({ id: u.id, nickname: u.nickname });
    }
  } catch { /* 무시 */ }
  return base;
}

/** 화면에서 쓰는 회원 목록 — 서버 모드에서는 지금 홈의 가입 회원을 DB에서 가져온다 */
export function useMembers(): MemberLite[] {
  const [list, setList] = useState<MemberLite[]>(() => (isServerMode() ? [] : memberPool()));
  useEffect(() => {
    const be = backend();
    if (!isServerMode() || !be) { setList(memberPool()); return; }
    let alive = true;
    const home = currentHomeId();
    be.listMembers()
      .then(rows => {
        if (!alive) return;
        setList(rows
          .filter(r => !home || r.homeId === home)
          .map(r => ({ id: r.id, nickname: r.nickname, role: r.role })));
      })
      .catch(() => { /* 권한·네트워크 문제면 빈 목록 */ });
    return () => { alive = false; };
  }, []);
  return list;
}
