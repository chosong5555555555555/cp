'use client';
// 사이트 내 알림음. RP는 발화 스트림, 나머지는 알림함 스트림에서 종류별로 한 번씩만 재생한다.
import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { RpRoom, RP_SEED, RpMessageRow, RP_MSG_KEY, RP_MSG_SEED, rpMemberIds } from '@/lib/rpStore';
import { Character, CHAR_SEED, Relation, REL_SEED } from '@/lib/charStore';
import { armMsgSound, playMsgTones } from '@/lib/msgSound';
import { isSoundKind, type SoundKind } from '@/lib/notificationSounds';
import { readNotifs, NOTIF_EVENT, notifSettings } from '@/lib/notifStore';
import { currentHomeId } from '@/lib/home';

const QUIET_AFTER_MOUNT_MS = 8000;

export function MsgSound() {
  const { user } = useAuth();
  const [rows, , loaded] = useLocalList<RpMessageRow>(RP_MSG_KEY, RP_MSG_SEED);
  const [rooms, , roomsLoaded] = useLocalList<RpRoom>('ohome.rp.v1', RP_SEED);
  const [rels, , relsLoaded] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars, , charsLoaded] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const seen = useRef<Set<string> | null>(null);
  const scope = `${user?.id ?? ''}:${currentHomeId() ?? ''}`;
  useEffect(() => { armMsgSound(); }, []);
  useEffect(() => { seen.current = null; }, [scope]);

  useEffect(() => {
    if (!user || !loaded || !roomsLoaded || !relsLoaded || !charsLoaded) return;
    if (!seen.current) { seen.current = new Set(rows.map(r => r.id)); return; }
    const fresh = rows.filter(r => !seen.current!.has(r.id));
    fresh.forEach(r => seen.current!.add(r.id));
    const settings = notifSettings(user.id);
    const kinds: SoundKind[] = [];
    for (const row of fresh) {
      if (row.authorId === user.id) continue;
      const room = rooms.find(r => r.id === row.roomId);
      if (!room || !rpMemberIds(room, rels, chars).includes(user.id)) continue;
      const kind = row.kind === 'turn' ? 'rpturn' : row.kind === 'ooc' ? 'rpooc' : 'rp';
      if (settings[kind === 'rpooc' ? 'rp' : kind] === false) continue;
      kinds.push(kind);
    }
    // 종류가 섞여 와도 첫 발화의 소리 하나로 뭉개지지 않게 한다.
    playMsgTones(kinds);
  }, [rows, loaded, user, rooms, roomsLoaded, rels, relsLoaded, chars, charsLoaded, scope]);

  useEffect(() => {
    let seenNotif: Set<string> | null = null;
    const mountedAt = Date.now();
    const check = () => {
      const mine = user ? readNotifs().filter(n => n.toUserId === user.id) : [];
      // 같은 알림 ID가 갱신된 경우에도 새 알림음이 필요하므로 날짜까지 비교한다.
      const signature = (n: typeof mine[number]) => `${n.id}:${n.date}`;
      if (!seenNotif) { seenNotif = new Set(mine.map(signature)); return; }
      const fresh = mine.filter(n => !seenNotif!.has(signature(n)));
      fresh.forEach(n => seenNotif!.add(signature(n)));
      if (!user || Date.now() - mountedAt < QUIET_AFTER_MOUNT_MS) return;
      const settings = notifSettings(user.id);
      const kinds: SoundKind[] = [];
      for (const n of fresh) {
        // RP/대사 끝은 메시지 스트림에서 처리하므로 알림함에서 다시 울리지 않는다.
        if (n.read || n.type === 'rp' || n.type === 'rpturn' || settings[n.type] === false) continue;
        if (isSoundKind(n.type)) kinds.push(n.type);
      }
      playMsgTones(kinds);
    };
    check();
    window.addEventListener(NOTIF_EVENT, check);
    window.addEventListener('storage', check);
    return () => { window.removeEventListener(NOTIF_EVENT, check); window.removeEventListener('storage', check); };
  }, [user, scope]);
  return null;
}
