'use client';
// Stored tags remain untouched; previews share the board's existing tag and pill styles.
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export const TAG_PREVIEW_LIMIT = 3;

export function TagPreview({ tags = [], variant = 'inline' }: {
  tags?: string[];
  variant?: 'inline' | 'pill';
}) {
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        moreRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!tags.length) return null;
  const shown = tags.slice(0, TAG_PREVIEW_LIMIT);
  const remaining = tags.length - shown.length;
  const close = () => { setOpen(false); moreRef.current?.focus(); };
  return (
    <span className={`tag-preview tag-preview-${variant}`}>
      {shown.map((tag, index) => (
        <span key={`${index}:${tag}`} className={variant === 'pill' ? 'pill' : 'tag-in'} data-tip={`#${tag}`}>
          {variant === 'pill' ? tag : `#${tag}`}
        </span>
      ))}
      {remaining > 0 && <button ref={moreRef} type="button" className="tag-more"
        aria-label={`태그 ${remaining}개 더 보기`} aria-expanded={open} aria-haspopup="dialog"
        data-tip={`태그 ${remaining}개 더 보기`}
        onClick={event => { event.stopPropagation(); setOpen(true); }}>+{remaining}</button>}
      {/* React portal events bubble through the originating card: stop them here too. */}
      {open && <span onClick={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
        <Modal open small title="태그" desc={`전체 ${tags.length}개`} onClose={close}
          actions={<button type="button" className="btn btn-ghost" autoFocus onClick={close}>CLOSE</button>}>
          <div className="tag-preview-all" role="list">
            {tags.map((tag, index) => <span role="listitem" className={variant === 'pill' ? 'pill' : 'tag-in'} key={`${index}:${tag}`}>#{tag}</span>)}
          </div>
        </Modal>
      </span>}
    </span>
  );
}
