'use client';

import { useEffect } from 'react';

/** Safari의 viewport 확대 제한 무시까지 보완. 역극을 나가면 모두 해제한다. */
export function RpZoomLock() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.rpZoomLock = 'true';
    const preventGesture = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const preventPinch = (e: TouchEvent) => {
      if (e.touches.length > 1 && e.cancelable) e.preventDefault();
    };
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey && e.cancelable) e.preventDefault();
    };
    const options = { passive: false };
    document.addEventListener('gesturestart', preventGesture, options);
    document.addEventListener('gesturechange', preventGesture, options);
    document.addEventListener('gestureend', preventGesture, options);
    document.addEventListener('touchstart', preventPinch, options);
    document.addEventListener('touchmove', preventPinch, options);
    document.addEventListener('wheel', preventWheelZoom, options);
    return () => {
      delete root.dataset.rpZoomLock;
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      document.removeEventListener('touchstart', preventPinch);
      document.removeEventListener('touchmove', preventPinch);
      document.removeEventListener('wheel', preventWheelZoom);
    };
  }, []);
  return null;
}
