'use client';
/* 보기 방식 (v2.3 사용자 요청) — 갤러리에만 있던 「갤러리 / 리스트」 전환을 **모든 게시판이 같은 방식**으로 쓴다.
   · 게시판마다 고른 보기를 기억한다 (localStorage · 게시판/섹션 단위)
   · 리스트 한 줄 모양도 공통 부품(BoardListRow)으로 통일 — 게시판마다 따로 만들지 않는다 */
import React, { useCallback, useEffect, useState } from 'react';

export type BoardView = 'gal' | 'list';
const KEY = 'ohome.viewmode.v1';

function readMap(): Record<string, BoardView> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, BoardView> : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

/** 저장만 (훅 밖에서 쓰는 화면 — 갤러리는 환경설정 기본값을 먼저 따른다) */
export function saveBoardView(scope: string, v: BoardView) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readMap(), [scope]: v }));
  } catch { /* 무시 */ }
}

/** 게시판 보기 방식 — scope 예: `videos:main`, `board:main`, `tchars` */
export function useBoardView(scope: string, def: BoardView = 'gal'): [BoardView, (v: BoardView) => void] {
  const [v, setV] = useState<BoardView>(def);
  // 저장된 값이 있으면 그것으로 (없으면 게시판 기본값)
  useEffect(() => {
    const saved = readMap()[scope];
    setV(saved === 'gal' || saved === 'list' ? saved : def);
  }, [scope, def]);
  const set = useCallback((next: BoardView) => {
    setV(next);
    saveBoardView(scope, next);
  }, [scope]);
  return [v, set];
}

/** 「갤러리 / 리스트」 전환 버튼 — 모든 게시판 공통 모양 */
export function ViewModeToggle({ view, onChange, style }: {
  view: BoardView; onChange: (v: BoardView) => void; style?: React.CSSProperties;
}) {
  return (
    <div className="seg" style={style}>
      <button type="button" className={view === 'gal' ? 'on' : ''} onClick={() => onChange('gal')}>갤러리</button>
      <button type="button" className={view === 'list' ? 'on' : ''} onClick={() => onChange('list')}>리스트</button>
    </div>
  );
}

/** 리스트 보기 한 줄 — 썸네일 · 제목(+태그) · 보조줄 · 오른쪽(작성자 등) */
export function BoardListRow({ thumb, title, sub, right, onClick, onContextMenu }: {
  thumb?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="list-item" onClick={onClick} onContextMenu={onContextMenu}>
      {thumb !== undefined && (
        <div className="th" style={{ position: 'relative' }}>{thumb}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </div>
      {right ? <small>{right}</small> : null}
    </div>
  );
}
