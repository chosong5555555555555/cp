'use client';
// 인증 컨텍스트 (v2.0) — 백엔드 어댑터(Supabase / Firebase)에 위임한다.
// 백엔드 설정이 없으면(개발·오프라인) 브라우저 안의 로컬 계정으로 동작한다.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { backend, isServerMode } from './backend';
import { setCurrentUserId } from './currentUser';
import { getSetting, setSetting } from './settingStore';

export type Role = 'admin' | 'member' | 'guest';

export interface User {
  id: string;
  nickname: string;
  role: Role;
  avatarUrl?: string;    // 프로필 이미지 (파일 참조 또는 URL)
  avatarColor?: string;  // 단색 아바타 (이미지 없을 때)
  ownCharId?: string;    // 역극에서 OOC로 쓸 기본 상징 캐릭터
  email?: string;
}

type Result = { ok: boolean; error?: string };

interface AuthCtx {
  user: User | null;          // null = 비로그인
  isAdmin: boolean;
  login: (id: string, password: string) => Promise<Result>;
  signup: (id: string, password: string, nickname: string, inviteCode: string, email?: string) => Promise<Result>;
  findId: (email: string) => Promise<Result & { foundId?: string }>;
  resetPassword: (email: string) => Promise<Result & { tempPassword?: string }>;
  logout: () => Promise<void>;
  updateProfile: (patch: { nickname?: string; avatarUrl?: string | null; avatarColor?: string | null; ownCharId?: string | null; currentPassword?: string; newPassword?: string }) => Promise<Result>;
  /** 초대코드 방문 (v2.2) — 가입 없이 읽기 전용으로. 다른 홈 소속 회원도 가능 */
  visit: (code: string) => Promise<Result>;
  /** 서버(DB) 연결 없이 브라우저 계정으로 도는 중인지 — 개발·오프라인 */
  mock: boolean;
  /** 누가 보고 있는지 확인이 끝났는지 (v2.0) — 처음 한 박자는 늘 「비로그인」으로 보인다.
   *  그 사이에 권한을 판정하면 관리자에게도 「비공개」 화면이 번쩍인다. */
  ready: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);
const MOCK_KEY = 'ohome.mockuser.v1';
const MOCK_REG_KEY = 'ohome.mockreg.v1';
const INVITE_KEY = 'ohome.invite.v1';    // 가입코드 — 환경설정 > 회원/보안
const SETUP_KEY = 'ohome.setup.v1';      // 설치 화면을 마쳤는지
const VISIT_KEY = 'ohome.visit.v1';      // 초대코드로 방문 중인 홈 (v2.2 — 기기 보관)

/** 현재 가입코드 — 관리자가 정한 값(서버 공유), 없으면 기본 WELCOME */
export function inviteCode(): string {
  return getSetting<string>(INVITE_KEY, 'WELCOME') || 'WELCOME';
}
export function setInviteCode(code: string) {
  setSetting(INVITE_KEY, code.trim());
}

export function isSetupDone(): boolean {
  try { return !!localStorage.getItem(SETUP_KEY); } catch { return false; }
}
export function markSetupDone() {
  try { localStorage.setItem(SETUP_KEY, JSON.stringify({ done: true, at: new Date().toISOString() })); } catch { /* 무시 */ }
}

/* ---------- 초대코드 방문 (v2.2) ---------- */

/** 지금 방문 중인 홈 — 없으면 null. 부팅(ServerBoot)이 회원의 홈보다 먼저 본다 */
export function visitingHomeId(): string | null {
  try { return localStorage.getItem(VISIT_KEY); } catch { return null; }
}

/** 「방문 종료」 — 표시를 지우고 원래 화면(내 홈 또는 로그인)부터 다시 연다 */
export function leaveVisit() {
  try { localStorage.removeItem(VISIT_KEY); } catch { /* 무시 */ }
  window.location.href = '/';
}

/** 지금 이 홈을 방문자로 보고 있는가 — 방문자에게는 쓰기 버튼을 그리지 않는다 (v2.2) */
export function isVisiting(): boolean { return !!visitingHomeId(); }

/* ---------- 방문 기록 (v2.3) — 회원 계정별로 이 브라우저에 남는다.
   와이파이 목록처럼 초대코드를 기억해 두고, 그 홈의 코드가 바뀌면 입장이 거부된다 ---------- */
export interface VisitEntry { homeId: string; name: string; code: string; at: number }
const VISITS_KEY = (uid: string) => `ohome.visits.v1.${uid}`;

export function visitHistory(uid: string): VisitEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(VISITS_KEY(uid)) ?? '[]');
    return Array.isArray(v) ? (v as VisitEntry[]) : [];
  } catch { return []; }
}

export function rememberVisit(uid: string, e: VisitEntry) {
  try {
    const list = visitHistory(uid).filter(x => x.homeId !== e.homeId);
    list.unshift(e);
    localStorage.setItem(VISITS_KEY(uid), JSON.stringify(list.slice(0, 20)));
  } catch { /* 무시 */ }
}

/* ---------- 로컬 계정 (백엔드 없이 개발할 때) ---------- */

const MOCK_ACCOUNTS: Record<string, { password: string; user: User }> = {
  admin: { password: '0000', user: { id: 'admin', nickname: '관리자', role: 'admin' } },
  guest: { password: '0000', user: { id: 'guest', nickname: '지인회원', role: 'member' } },
};

function mockRegistry(): Record<string, { password: string; user: User }> {
  try { return JSON.parse(localStorage.getItem(MOCK_REG_KEY) ?? '{}'); } catch { return {}; }
}

/** 회원 프로필 조회 (관리자 회원 상세) — 로컬 모드에서만 의미가 있다 */
export function mockMemberInfo(id: string): User | null {
  const hit = mockRegistry()[id]?.user ?? (isSetupDone() ? undefined : MOCK_ACCOUNTS[id]?.user);
  return hit ? { ...hit } : null;
}

export interface SetupInput {
  adminId: string; adminPw: string; adminNick?: string;
  guestPw?: string;
}

/** 로컬 계정 설치 (백엔드 없이 쓸 때) */
export function completeSetup(v: SetupInput): { ok: boolean; error?: string } {
  const id = v.adminId.trim();
  if (!id || !v.adminPw) return { ok: false, error: '관리자 아이디와 비밀번호를 입력해 주세요.' };
  try {
    const reg = mockRegistry();
    reg[id] = { password: v.adminPw, user: { id, nickname: v.adminNick?.trim() || '관리자', role: 'admin' } };
    if (v.guestPw?.trim()) {
      reg.guest = { password: v.guestPw.trim(), user: { id: 'guest', nickname: '게스트', role: 'member' } };
    }
    localStorage.setItem(MOCK_REG_KEY, JSON.stringify(reg));
    markSetupDone();
    return { ok: true };
  } catch { return { ok: false, error: '설정을 저장하지 못했습니다.' }; }
}

/* ---------- 컨텍스트 ---------- */

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const server = isServerMode();
  const be = backend();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);   // 확인이 끝났는지 (v2.0)

  useEffect(() => {
    if (!server || !be) {
      try {
        const raw = localStorage.getItem(MOCK_KEY);
        if (raw) setUser(JSON.parse(raw));
      } catch { /* 무시 */ }
      setReady(true);
      return;
    }
    let alive = true;
    void be.currentUser().then(u => { if (alive) { setUser(u as User | null); setReady(true); } });
    const off = be.onAuthChange(u => { if (alive) { setUser(u as User | null); setReady(true); } });
    return () => { alive = false; off(); };
  }, [server, be]);

  const login = useCallback(async (id: string, password: string): Promise<Result> => {
    if (server && be) {
      const r = await be.signIn(id.trim(), password);
      if (!r.ok) return { ok: false, error: r.error ?? '로그인에 실패했습니다.' };
      // 홈(자관)은 부팅 때 사용자를 보고 정해진다 (v2.1) — 로그인했으니 처음부터 다시 연다
      window.location.href = '/';
      return { ok: true };
    }
    const acc = mockRegistry()[id] ?? (isSetupDone() ? undefined : MOCK_ACCOUNTS[id]);
    if (!acc || acc.password !== password) return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' };
    setUser(acc.user);
    try { localStorage.setItem(MOCK_KEY, JSON.stringify(acc.user)); } catch { /* 무시 */ }
    return { ok: true };
  }, [server, be]);

  // 회원가입 — 가입코드(초대코드) 방식
  const signup = useCallback(async (id: string, password: string, nickname: string, code: string): Promise<Result> => {
    if (!id || !password || !nickname) return { ok: false, error: '아이디·비밀번호·닉네임을 모두 입력해 주세요.' };
    if (server && be) {
      // 가입코드는 서버가 홈(자관)과 대조한다 (v2.1) — 코드가 곧 어느 홈의 회원이 되는지를 정한다
      if (!code.trim()) return { ok: false, error: '가입코드를 입력해 주세요.' };
      const r = await be.signUp(id.trim(), password, nickname.trim(), code.trim());
      if (!r.ok) return { ok: false, error: r.error ?? '가입에 실패했습니다.' };
      // 계정이 만들어지는 순간 로그인 상태가 된다 — 홈은 부팅 때 정해지므로 처음부터 다시 연다
      window.location.href = '/';
      return { ok: true };
    }
    if (code !== inviteCode()) return { ok: false, error: '가입코드가 올바르지 않습니다.' };
    if (MOCK_ACCOUNTS[id] || mockRegistry()[id]) return { ok: false, error: '이미 사용 중인 아이디입니다.' };
    const reg = mockRegistry();
    reg[id] = { password, user: { id, nickname, role: 'member' } };
    try { localStorage.setItem(MOCK_REG_KEY, JSON.stringify(reg)); } catch { /* 무시 */ }
    return { ok: true };
  }, [server, be]);

  // 초대코드 방문 (v2.2) — 회원가입 없이 읽기 전용으로. 이미 다른 홈의 회원이어도 그대로 둔다
  const visit = useCallback(async (code: string): Promise<Result> => {
    if (!code.trim()) return { ok: false, error: '초대코드를 입력해 주세요.' };
    if (server && be) {
      if (!be.visitHome) return { ok: false, error: '이 서버(Supabase)는 방문 기능을 아직 지원하지 않습니다.' };
      const r = await be.visitHome(code.trim());
      if (!r.ok || !r.homeId) return { ok: false, error: r.error ?? '방문에 실패했습니다.' };
      try { localStorage.setItem(VISIT_KEY, r.homeId); } catch { /* 무시 */ }
      // 방문 기록 (v2.3) — 아이디·비밀번호가 있는 회원 계정만. 익명 방문자는 남기지 않는다
      if (user) rememberVisit(user.id, { homeId: r.homeId, name: r.name ?? r.homeId, code: code.trim(), at: Date.now() });
      // 방문 홈은 부팅 때 정해진다 — 처음부터 다시 연다
      window.location.href = '/';
      return { ok: true };
    }
    return { ok: false, error: '로컬 모드(개발용)에서는 방문 기능이 없습니다.' };
  }, [server, be, user]);

  const findId = useCallback(async (email: string): Promise<Result & { foundId?: string }> => {
    if (!email.trim()) return { ok: false, error: '이메일을 입력해 주세요.' };
    if (server) return { ok: false, error: '이메일이 곧 아이디입니다 — 그대로 로그인해 주세요.' };
    const hit = Object.values(mockRegistry()).find(a => a.user.email?.toLowerCase() === email.trim().toLowerCase());
    return hit ? { ok: true, foundId: hit.user.id } : { ok: false, error: '이 이메일로 가입된 계정이 없습니다.' };
  }, [server]);

  const resetPassword = useCallback(async (email: string): Promise<Result & { tempPassword?: string }> => {
    if (!email.trim()) return { ok: false, error: '이메일을 입력해 주세요.' };
    if (server && be) {
      const r = await be.resetPassword(email.trim());
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    const reg = mockRegistry();
    const hit = Object.entries(reg).find(([, a]) => a.user.email?.toLowerCase() === email.trim().toLowerCase());
    if (!hit) return { ok: false, error: '이 이메일로 가입된 계정이 없습니다.' };
    const temp = Math.random().toString(36).slice(2, 8);
    reg[hit[0]] = { ...hit[1], password: temp };
    try { localStorage.setItem(MOCK_REG_KEY, JSON.stringify(reg)); } catch { /* 무시 */ }
    return { ok: true, tempPassword: temp };
  }, [server, be]);

  const updateProfile = useCallback(async (patch: {
    nickname?: string; avatarUrl?: string | null; avatarColor?: string | null; ownCharId?: string | null;
    currentPassword?: string; newPassword?: string;
  }): Promise<Result> => {
    if (!user) return { ok: false, error: '로그인이 필요합니다.' };
    if (server && be) {
      const r = await be.updateProfile(patch);
      if (!r.ok) return r;
      setUser(u => (u ? {
        ...u,
        nickname: patch.nickname?.trim() || u.nickname,
        avatarUrl: patch.avatarUrl === null ? undefined : (patch.avatarUrl ?? u.avatarUrl),
        avatarColor: patch.avatarColor === null ? undefined : (patch.avatarColor ?? u.avatarColor),
        ownCharId: patch.ownCharId === null ? undefined : (patch.ownCharId ?? u.ownCharId),
      } : u));
      return { ok: true };
    }
    const reg = mockRegistry();
    const cur = reg[user.id] ?? (isSetupDone() ? undefined : MOCK_ACCOUNTS[user.id]);
    if (!cur) return { ok: false, error: '계정을 찾을 수 없습니다.' };
    if (patch.newPassword && patch.currentPassword !== cur.password) {
      return { ok: false, error: '현재 비밀번호가 올바르지 않습니다.' };
    }
    const nextUser: User = {
      ...cur.user,
      nickname: patch.nickname?.trim() || cur.user.nickname,
      avatarUrl: patch.avatarUrl === null ? undefined : (patch.avatarUrl ?? cur.user.avatarUrl),
      avatarColor: patch.avatarColor === null ? undefined : (patch.avatarColor ?? cur.user.avatarColor),
      ownCharId: patch.ownCharId === null ? undefined : (patch.ownCharId ?? cur.user.ownCharId),
    };
    reg[user.id] = { password: patch.newPassword || cur.password, user: nextUser };
    try {
      localStorage.setItem(MOCK_REG_KEY, JSON.stringify(reg));
      localStorage.setItem(MOCK_KEY, JSON.stringify(nextUser));
    } catch { /* 무시 */ }
    setUser(nextUser);
    return { ok: true };
  }, [server, be, user]);

  const logout = useCallback(async () => {
    // 방문 표시는 함께 지운다 (v2.2) — 남겨 두면 다음 익명 로그인이 옛 방문 홈으로 떨어진다
    try { localStorage.removeItem(VISIT_KEY); } catch { /* 무시 */ }
    if (server && be) {
      await be.signOut(); setUser(null);
      // 홈 선택·설정 캐시는 사람에 묶인 것 — 처음부터 다시 연다 (v2.1)
      window.location.href = '/';
      return;
    }
    setUser(null);
    try { localStorage.removeItem(MOCK_KEY); } catch { /* 무시 */ }
  }, [server, be]);

  // 관리자면 body.admin — 페이지 설명 편집 연필 등
  // 저장 계층이 훅 밖에서 작성자 id를 알 수 있게 함께 기록
  useEffect(() => {
    document.body.classList.toggle('admin', user?.role === 'admin');
    setCurrentUserId(user?.id ?? null);
  }, [user]);

  return (
    <Ctx.Provider value={{
      user, isAdmin: user?.role === 'admin', ready,
      login, signup, findId, resetPassword, logout, updateProfile, visit, mock: !server,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
