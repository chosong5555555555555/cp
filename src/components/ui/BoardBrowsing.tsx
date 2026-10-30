'use client';
import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BoardView, useBoardView } from './ViewMode';
import { readBrowseContext, BrowseContext, positivePage } from '@/lib/boardBrowsing';

/** URL-backed filters work on reload, browser Back, and returning from a detail. */
export function useBoardBrowsing(scope: string, defaultView: BoardView = 'gal') {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [rememberedView, rememberView] = useBoardView(scope, defaultView);
  const context = readBrowseContext(params);
  const view = context.view ?? rememberedView;
  const patch = (values: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(values)) next.set(key, value);
    router.replace(pathname + '?' + next.toString(), { scroll: false });
  };
  return {
    ...context, view,
    setCat: (cat: string) => patch({ cat, page: '1' }),
    setQ: (q: string) => patch({ q, page: '1' }),
    setPage: (page: number) => patch({ page: String(positivePage(page)) }),
    setView: (next: BoardView) => {
      rememberView(next);
      patch({ view: next, page: '1' });
    },
    context: { ...context, view } as BrowseContext,
  };
}

/** Compact, accessible post navigation used by gallery, videos and all list-board skins. */
export function PostNavigation({ label, index, total, href, onGo }: {
  label: string; index: number; total: number; href: string; onGo: (direction: -1 | 1) => void;
}) {
  const enabled = index >= 0 && total > 1;
  return (
    <nav className="gallery-post-nav" aria-label="현재 목록 게시물 탐색">
      <button type="button" className="gallery-post-arrow" aria-label="현재 목록의 이전 게시물"
        disabled={!enabled} onClick={() => onGo(-1)}>
        <span className="arrow" aria-hidden="true">‹</span><span className="label">이전</span>
      </button>
      <div className="gallery-post-count" aria-live="polite">
        <b>{label || 'ALL'}</b><small>{index >= 0 ? `${index + 1} / ${total}` : '현재 목록에 없는 글'}</small>
        <a className="post-list-return" href={href}>목록으로</a>
      </div>
      <button type="button" className="gallery-post-arrow" aria-label="현재 목록의 다음 게시물"
        disabled={!enabled} onClick={() => onGo(1)}>
        <span className="label">다음</span><span className="arrow" aria-hidden="true">›</span>
      </button>
    </nav>
  );
}
