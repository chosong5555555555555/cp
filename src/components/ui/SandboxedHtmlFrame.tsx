'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sandboxHtmlDocument } from '@/lib/sandboxHtml';

const MIN_FRAME_HEIGHT = 160;
const MAX_FRAME_HEIGHT = 1800;

/**
 * HTML 문서는 별도 browsing context에 둔다. 스크립트 권한은 주지 않고
 * same-origin만 열어 부모가 문서 높이와 웹폰트 로딩을 측정할 수 있게 한다.
 */
export function SandboxedHtmlFrame({ html, title, className }: {
  html: string;
  title: string;
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(240);

  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const root = doc?.documentElement;
    if (!root) return;
    const body = doc?.body;
    const contentHeight = Math.ceil(Math.max(
      root.scrollHeight,
      root.offsetHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      MIN_FRAME_HEIGHT,
    ));
    const next = Math.min(MAX_FRAME_HEIGHT, contentHeight);
    setHeight(current => Math.abs(current - next) > 1 ? next : current);
  }, []);

  const onLoad = useCallback((event: React.SyntheticEvent<HTMLIFrameElement>) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    measure();

    const doc = event.currentTarget.contentDocument;
    if (!doc) return;
    if (typeof ResizeObserver !== 'undefined' && doc.documentElement) {
      const observer = new ResizeObserver(measure);
      observer.observe(doc.documentElement);
      if (doc.body) observer.observe(doc.body);
      observerRef.current = observer;
    }
    void doc.fonts.ready.then(measure).catch(() => {});
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const srcDoc = useMemo(() => sandboxHtmlDocument(html, {
    allowScripts: false,
    allowRemoteImages: true,
    allowRemoteMedia: true,
  }), [html]);

  return (
    <iframe
      ref={frameRef}
      className={className}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={onLoad}
      style={{ height }}
    />
  );
}
