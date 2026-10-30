'use client';
import { usePlatformSettings } from '@/lib/platformStore';
import { DocTitle } from './DocTitle';
import { DocIcon } from './DocIcon';

/** 로그인/전체 홈 목록 화면용. 홈 안의 로고·탭 아이콘은 바꾸지 않는다. */
export function PlatformBrand() {
  const [site] = usePlatformSettings();
  return <><DocTitle override={site} /><DocIcon override={site} /></>;
}
