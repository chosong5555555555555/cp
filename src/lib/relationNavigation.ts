/** 자관 목록·상세·더보기에서 같은 연결 판정을 사용한다. AU 미지정은 자관 전체다. */
export function matchesRelation(
  item: { relId?: string; auId?: string }, relId?: string | null, auId?: string | null,
): boolean {
  if (!relId) return true;
  if (item.relId !== relId) return false;
  return !auId || (item.auId || 'base') === auId;
}

export function relationListHref(kind: 'rp' | 'log', relId: string, auId?: string | null): string {
  const params = new URLSearchParams({ rel: relId });
  if (auId) params.set('au', auId);
  return `/${kind}?${params}`;
}

export function rpRoomHref(room: { id: string; relId?: string; auId?: string }): string {
  const params = new URLSearchParams({ room: room.id });
  if (room.relId) params.set('rel', room.relId);
  if (room.auId && room.auId !== 'base') params.set('au', room.auId);
  return `/rp?${params}`;
}
