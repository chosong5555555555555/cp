'use client';
// 로그인 페이지 (4.8) — 카드 자체는 LoginCard (v2.1: 비로그인 메인도 같은 카드를 쓴다)
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { LoginCard } from '@/components/shell/LoginCard';

export default function LoginPage() {
  const router = useRouter();
  const { user } = useAuth();

  // 이미 로그인 상태면 메인으로
  useEffect(() => { if (user) router.replace('/'); }, [user, router]);

  return (
    <section className="page">
      <LoginCard onLoggedIn={() => router.push('/')} />
    </section>
  );
}
