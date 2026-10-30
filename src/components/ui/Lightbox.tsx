'use client';
/* 이미지 라이트박스 — 클릭 확대 보기 (배경 클릭/✕/ESC 닫기, 여러 장이면 ‹ › · 방향키 · 스와이프)
   v2.3 사용자 요청: 넘기는 화살표를 **사진 위가 아니라 사진 아래 막대**에 둔다 —
   흰 사진 위에서도 화살표가 묻히지 않고, 사진이 주인공으로 보인다 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBlobUrl } from '@/lib/blobStore';

export function Lightbox({ srcs, index, onClose, captions }: {
  srcs: string[];              // IndexedDB 파일 id 또는 URL 혼용 가능
  index: number;
  captions?: string[];        // 갤러리 목록을 이어 볼 때 현재 게시물 제목
  onClose: (index: number) => void;
}) {
  const [i, setI] = useState(index);
  const touchX = useRef<number | null>(null);
  useEffect(() => setI(index), [index]);
  // 등록 폼에서 방금 고른 파일은 이번 세션에서 만든 blob: 주소다.
  // useBlobUrl은 blob:을 (새로고침으로 죽은) 옛 참조로 보고 거부하므로 여기서는 그대로 쓴다.
  const raw = srcs[i] ?? '';
  const live = raw.startsWith('blob:');
  const loaded = useBlobUrl(live ? undefined : raw);
  const url = live ? raw : loaded;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(i);
      if (e.key === 'ArrowLeft' && srcs.length > 1) setI(x => (x - 1 + srcs.length) % srcs.length);
      if (e.key === 'ArrowRight' && srcs.length > 1) setI(x => (x + 1) % srcs.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [srcs.length, onClose, i]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="이미지 확대 보기" onClick={() => onClose(i)}>
      {/* 사진 무대 — 남는 높이를 전부 사진에 준다 (아래 막대가 자리를 차지해도 사진이 작아지지 않게 flex) */}
      <div className="lb-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt="" onClick={e => e.stopPropagation()}
          onTouchStart={e => { touchX.current = e.touches[0]?.clientX ?? null; }}
          onTouchEnd={e => {
            const start = touchX.current;
            const end = e.changedTouches[0]?.clientX;
            touchX.current = null;
            if (start == null || end == null || srcs.length < 2) return;
            const dx = end - start;
            if (Math.abs(dx) < 48) return;
            setI(x => (dx < 0 ? x + 1 : x - 1 + srcs.length) % srcs.length);
          }} />}
      </div>
      {captions?.[i] && <div className="lightbox-caption" aria-live="polite"
        onClick={e => e.stopPropagation()}>{captions[i]}</div>}
      {/* 넘기기 막대 — 사진 아래. 사진을 가리지 않는다 */}
      {srcs.length > 1 && (
        <div className="lb-bar" onClick={e => e.stopPropagation()}>
          <button type="button" className="lb-nav" aria-label="이전 사진"
            onClick={() => setI(x => (x - 1 + srcs.length) % srcs.length)}>‹</button>
          <span className="lb-count" aria-live="polite">{i + 1} / {srcs.length}</span>
          <button type="button" className="lb-nav" aria-label="다음 사진"
            onClick={() => setI(x => (x + 1) % srcs.length)}>›</button>
        </div>
      )}
      <button type="button" className="x" aria-label="사진 닫기" onClick={e => { e.stopPropagation(); onClose(i); }}>✕</button>
    </div>,
    document.body,
  );
}
