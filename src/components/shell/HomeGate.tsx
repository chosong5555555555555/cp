'use client';
// 홈(자관) 게이트 (v2.1) — 누가 어느 홈을 보는지 정하는 한 곳.
//
//   비로그인            → 로그인 카드만 (홈은 전부 로그인 뒤에만)
//   총관리자 · 홈 미선택 → 자관 리스트 (들어갈 홈을 고른다)
//   회원 · 홈 없음       → 안내 (가입코드 없이 만들어진 계정 — 보통은 없다)
//   방문 중 (v2.2)      → 홈 화면 + 얇은 「방문자」 배너 (읽기 전용 — 쓰기 버튼은 각 페이지가
//                         작성자·관리자에게만 그리므로 방문자에게는 자연스럽게 안 보인다)
//   그 외               → 홈 화면 (상단바·본문)
//
// 홈 자체는 부팅(ServerBoot)에서 이미 정해져 있다 — 여기서는 그 결과에 맞는 화면만 고른다.
// 로컬 모드(백엔드 없음)는 홈 개념이 없으니 그대로 통과.
import React from 'react';
import { useAuth, visitingHomeId, leaveVisit } from '@/lib/auth';
import { isServerMode } from '@/lib/backend';
import { currentHomeId } from '@/lib/home';
import { LoginCard } from './LoginCard';
import { HomeList } from './HomeList';
import { PlatformBrand } from './PlatformBrand';

export function HomeGate({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, ready, logout } = useAuth();
  if (!isServerMode()) return <>{children}</>;
  if (!ready) return null;
  const home = currentHomeId();

  if (!user) {
    return (
      <div className="setup-wrap">
        <div style={{ width: 'min(480px, 100%)', margin: 'auto' }}>
          <PlatformBrand />
          <LoginCard />
        </div>
      </div>
    );
  }
  if (isAdmin && !home) return <><PlatformBrand /><HomeList /></>;
  if (!home) {
    return (
      <div className="setup-wrap">
        <PlatformBrand />
        <div className="panel setup-box">
          <h1 style={{ fontFamily: 'var(--serif-base)', fontSize: 20, letterSpacing: '.2em', textAlign: 'center', margin: '0 0 10px' }}>NO HOME</h1>
          <p className="d" style={{ textAlign: 'center' }}>
            이 계정은 아직 어느 자관에도 속해 있지 않습니다.<br />
            총관리자에게 가입코드를 받아 새로 가입하거나, 계정을 연결해 달라고 요청해 주세요.
          </p>
          <button className="btn btn-ghost" style={{ margin: '16px auto 0', display: 'block' }} onClick={() => logout()}>로그아웃</button>
        </div>
      </div>
    );
  }
  // 방문 중 (v2.2) — 홈 화면 맨 위에 가로 꽉 차는 얇은 한 줄 띠를 얹는다.
  // 흔들림 없이 공간을 차지하고, 글자는 좌측·버튼은 우측 끝으로 몰아 깔끔하게.
  const visiting = visitingHomeId();
  if (visiting && visiting === home) {
    return (
      <>
        <div className="panel" style={{
          position: 'sticky', top: 0, zIndex: 60,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '4px 16px', borderRadius: 0, margin: 0,
          borderTop: 'none', borderLeft: 'none', borderRight: 'none',
          fontSize: 11.5, lineHeight: 1.4,
        }}>
          <span style={{ color: 'var(--sub)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            초대코드로 <b>방문자</b>로 둘러보는 중 — 읽기만 가능합니다
          </span>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', flexShrink: 0, padding: '2px 12px', fontSize: 10.5, height: 24 }}
            onClick={() => leaveVisit()}>방문 종료</button>
        </div>
        {children}
      </>
    );
  }
  return <>{children}</>;
}
