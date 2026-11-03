'use client';
// 역극 (4.9) — 실시간 채팅형. 현재는 localStorage 단계(같은 브라우저 내 동작 확인용)이며
// 실시간 송수신·입력 중 표시·참여자 전원 동의 흐름은 Supabase Realtime 연동 시 활성화.
export interface RpMessage {
  id: string;
  // 캐릭터 발화 / 지문 / 회원 본인의 기본 상징 캐릭터로 보내는 OOC 발언.
  // 'player'(옛 회원 발화)는 없애고 읽을 때 지문으로 바꾼다.
  kind: 'char' | 'desc' | 'player' | 'ooc' | 'turn';
  charId?: string;                  // kind==='char' 또는 'ooc'일 때 표시할 캐릭터
  charOwn?: boolean;                // 발화 당시 내 캐릭터(자캐)였는지 — 삭제된 캐릭터 재연동 시 리스트 판별용
  oocName?: string;                 // OOC 발화 시점의 기본 상징 캐릭터 이름 — 선택한 자관 AU와 분리
  /** 대사 종료 시 체크를 붙일 마지막 본인 메시지. 기존 turn 행은 앞선 본인 메시지로 복원한다. */
  turnMessageId?: string;
  authorId: string;                 // 작성 회원 (수정/삭제 권한)
  text: string;
  date: string;                     // ISO
  /** 메신저 모양 방에서 「일반 RP」로 보낸 글 (커플홈 사용자 요청) — 말풍선 대신 원래 역극 모양으로 보인다 */
  rp?: boolean;
  /** 사진 메시지 (커플홈 — 메신저 방에서 상대에게 사진을 보냈다는 컨셉) — 파일 id. 글 없이 사진만도 된다 */
  imgId?: string;
}

export interface RpRoom {
  id: string;
  title: string;
  relId?: string;                   // 기반 자관 (선택 — 자유 개설 가능)
  /** 그 자관의 어느 AU로 노는지 (v2.0 사용자 요청) — 없으면 원래 설정.
   *  방 안에서 캐릭터를 그 AU 프로필(이름·색·이미지)로 바꿔 보여 준다. */
  auId?: string;
  memberIds: string[];              // 참여 회원 — 이 목록에 없으면 방의 존재 자체가 보이지 않음 (확정)
  status: 'ongoing' | 'done';       // 진행중 / 완결
  isPublic: boolean;                // 완결 후 공개 전환 (자관 역극 리스트로 열람)
  createdBy: string;
  created: string;
  lastRead: Record<string, string>; // 회원별 마지막 확인 시각 — N 뱃지
  /** 표시 방식 (커플홈 사용자 요청) — 'imsg'면 아이폰 문자(iMessage) 모양. 없으면 기본(대본형) */
  style?: 'script' | 'imsg';
  messages: RpMessage[];
}

/** 입력 중 표시 (v2.1 사용자 요청) — 「캐릭터이름 is typing...」. 방·사람당 문서 하나(id = roomId:userId).
 *  입력하는 동안 몇 초마다 at을 갱신하고, 보내거나 손을 떼면 지운다. 받는 쪽은 at이 최근인 것만 보여 준다 */
export interface RpTyping {
  id: string;
  roomId: string;
  authorId: string;
  name: string;          // 그때 고른 발화자 이름 (지문이면 닉네임)
  at: number;            // Date.now()
  visibility: 'member';  // 같은 홈 회원에게 보이게
}

/**
 * 이 방의 참여 회원 (v2.0 사용자 확정).
 *
 * 기반 자관이 있으면 **회원을 직접 고르지 않고** 그 자관 멤버 캐릭터에 권한이 있는 사람이
 * 자동으로 참여자가 된다. 저장된 목록이 아니라 볼 때마다 계산하므로, 캐릭터 권한을 다른
 * 사람에게 넘기면 그 자관 기반 역극들에 **따로 손대지 않아도 즉시 반영**된다
 * (방 문서를 고쳐 돌아다닐 필요가 없다 — 남의 방은 어차피 고칠 수도 없다).
 *
 * 자유 개설(자관 없음) 방은 예전처럼 저장된 memberIds를 쓴다. 개설자는 언제나 참여자.
 */
export function rpMemberIds(
  r: RpRoom,
  rels: { id: string; members: { charId: string }[] }[],
  chars: { id: string; grants?: { userId: string }[] }[],
): string[] {
  const ids = new Set<string>();
  if (r.createdBy) ids.add(r.createdBy);
  if (r.relId) {
    const rel = rels.find(x => x.id === r.relId);
    rel?.members.forEach(m => {
      chars.find(c => c.id === m.charId)?.grants?.forEach(g => ids.add(g.userId));
    });
    return [...ids];
  }
  (r.memberIds ?? []).forEach(id => ids.add(id));
  return [...ids];
}

/** hex → "r,g,b" (말풍선 저알파 배경용 — 6장 말풍선 색상 규칙) */
export function hexRgb(hex?: string): string {
  const h = (hex ?? '#5d636d').replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return `${parseInt(f.slice(0, 2), 16) || 93},${parseInt(f.slice(2, 4), 16) || 99},${parseInt(f.slice(4, 6), 16) || 109}`;
}

/**
 * 발화 한 줄 = 자기 문서 하나 (v2.0).
 *
 * 예전에는 발화가 방(RpRoom) 문서 안 배열에 있었다. 그래서 **말을 하려면 방을 UPDATE 해야 했고**,
 * 「수정은 작성자 또는 관리자만」 규칙에 걸려 남이 만든 방에서는 참여자가 발화할 수 없었다 —
 * 댓글·문답이 막히던 것과 똑같은 뿌리다 (v2.0 사용자 요청으로 함께 정리).
 */
export const RP_MSG_KEY = 'ohome.rpmsgs.v1';

export interface RpMessageRow extends RpMessage { roomId: string }

export const RP_MSG_SEED: RpMessageRow[] = [];

/** 방 하나의 발화 — 옛 방 안의 것 + 따로 저장된 것을 시간순으로.
 *  없앤 '플레이어' 발화는 **지우지 않고 지문으로 읽는다** — 남이 실제로 한 말이라 사라지면 안 된다 */
export function messagesFor(rows: RpMessageRow[], roomId: string, legacy: RpMessage[] = []): RpMessage[] {
  const mine = rows.filter(r => r.roomId === roomId);
  const seen = new Set(mine.map(r => r.id));
  return [...legacy.filter(m => !seen.has(m.id)), ...mine]
    .map(m => (m.kind === 'player' ? { ...m, kind: 'desc' as const, charId: undefined } : m))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- 읽음 표시 (v2.0) ----------
   예전에는 방 문서의 lastRead에 적었는데, 방을 열어 보기만 해도 남의 방을 UPDATE 하게 되어
   참여자에게는 규칙이 막았다(N 뱃지가 영영 안 없어짐). 읽음 시각은 원래 사람마다 다른 값이라
   서버에 공유할 이유가 없어 브라우저에만 둔다. */
const READ_KEY = 'ohome.rpread.v1';

function readMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
}

/** 내가 이 방을 마지막으로 본 시각 — 로컬 기록과 옛 방 기록 중 나중 것 */
export function rpSeenAt(r: RpRoom, userId: string): string {
  const local = readMap()[`${userId}:${r.id}`] ?? '';
  const legacy = r.lastRead?.[userId] ?? '';
  return local > legacy ? local : legacy;
}

export function rpMarkRead(roomId: string, userId: string, at = new Date().toISOString()): void {
  try {
    const m = readMap();
    m[`${userId}:${roomId}`] = at;
    localStorage.setItem(READ_KEY, JSON.stringify(m));
  } catch { /* 무시 */ }
}

/** 방의 마지막 메시지 시각 (없으면 개설 시각) */
export const rpLastDate = (r: RpRoom, msgs: RpMessage[]) =>
  msgs.length ? msgs[msgs.length - 1].date : r.created;

/** 안 읽은 새 메시지 여부 (내가 마지막으로 본 뒤에 남이 쓴 메시지) */
export function rpHasNew(r: RpRoom, userId: string, msgs: RpMessage[]): boolean {
  const seen = rpSeenAt(r, userId);
  return msgs.some(m => m.authorId !== userId && m.date > seen);
}


/* ---------- 대사 종료 (v2.3 사용자 요청) ----------
   "역극 대사 끝마치면 상대한테 알려줄 수 있는 기능" — 대사를 끝낸 사람이 직접 버튼을 누른다.
   방 문서에 적으면 남이 만든 방에서 참여자가 눌렀을 때 규칙에 막히므로(발화와 같은 뿌리),
   **발화 한 줄(kind: 'turn')로** 남긴다. 이미 있는 실시간 경로를 그대로 타서 즉시 도착하고,
   로그·전체보기에서는 이 줄을 그리지 않는다(rpLog).
   확인 여부는 사람마다 다른 값이라 브라우저에만 둔다 — 읽음 표시와 같은 방식이다. */
export const RP_TURN_ACK_KEY = 'ohome.rpturnack.v1';

/** 이 방에서 마지막으로 「대사 끝」을 누른 발화 (없으면 undefined) */
export function rpLastTurn(msgs: RpMessage[]): RpMessage | undefined {
  for (let i = msgs.length - 1; i >= 0; i -= 1) if (msgs[i].kind === 'turn') return msgs[i];
  return undefined;
}

/* ---------- 시드 (프로토타입 데모 계승 — admin·guest 참여) ---------- */
export const RP_SEED: RpRoom[] = [];

/** 대사 종료 이벤트를 마지막 본인 메시지에 연결한다.
 * 실제 메시지의 작성자가 바뀔 때만 새 대사 구간으로 본다(turn 이벤트는 구간을 나누지 않는다).
 * 같은 사람이 연속해서 쓰던 구간에서 다시 종료를 누르면 체크를 마지막 대상 한 곳으로 옮긴다.
 * 상대 메시지가 사이에 있으면 이전 구간의 체크는 기록으로 유지한다.
 * 삭제된 명시적 대상은 다른 메시지로 옮기지 않으며, 구버전 이벤트도 같은 규칙으로 복원한다. */
export function rpTurnMessageIds(msgs: RpMessage[]): Set<string> {
  const completed = new Set<string>();
  const previous = new Map<string, RpMessage>();
  const seen = new Map<string, { message: RpMessage; segment: number }>();
  const checkedBySegment = new Map<number, string>();
  let segment = 0, previousAuthor: string | undefined;
  for (const m of msgs) {
    if (m.kind !== 'turn') {
      if (m.authorId !== previousAuthor) { segment += 1; previousAuthor = m.authorId; }
      seen.set(m.id, { message: m, segment });
      previous.set(m.authorId, m);
      continue;
    }
    const targetId = m.turnMessageId ?? previous.get(m.authorId)?.id;
    const target = targetId ? seen.get(targetId) : undefined;
    if (!target || target.message.authorId !== m.authorId || target.message.date > m.date) continue;
    const oldCheck = checkedBySegment.get(target.segment);
    if (oldCheck) completed.delete(oldCheck);
    completed.add(target.message.id);
    checkedBySegment.set(target.segment, target.message.id);
  }
  return completed;
}
