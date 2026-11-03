import type { Viewport } from 'next';
import { RpZoomLock } from '@/components/rp/RpZoomLock';

// 역극에서만 확대를 잠근다. 다른 메뉴로 이동하면 기본 viewport로 돌아간다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RpLayout({ children }: { children: React.ReactNode }) {
  return <><RpZoomLock />{children}</>;
}
