import type { BackupPost } from './galleryStore';
import type { VideoPost } from './videoStore';
import type { Post } from './postStore';

/** The three post boards share one page size, query format and filtering contract. */
export const BOARD_PAGE_SIZE = 6;
export type PostBoardKind = 'gallery' | 'videos' | 'board';
export interface BrowseContext {
  cat: string; // empty = ALL; a literal category named "ALL" still remains a category
  q: string;
  page: number;
  view?: 'gal' | 'list';
}
export interface QueryReader { get: (name: string) => string | null }
export function positivePage(value: string | number | null): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}
export function readBrowseContext(params: QueryReader): BrowseContext {
  const view = params.get('view');
  return {
    cat: params.get('cat') ?? '', q: params.get('q') ?? '',
    page: positivePage(params.get('page')),
    ...(view === 'gal' || view === 'list' ? { view } : {}),
  };
}
export function browseQuery(kind: PostBoardKind, ownerId: string, context: BrowseContext): string {
  const p = new URLSearchParams();
  // The actual post owner overrides any untrusted/stale section query on a detail URL.
  if (ownerId !== 'main') p.set(kind === 'board' ? 'b' : 's', ownerId);
  p.set('cat', context.cat);
  if (context.q) p.set('q', context.q);
  p.set('page', String(positivePage(context.page)));
  if (context.view) p.set('view', context.view);
  return '?' + p.toString();
}
export function postHref(kind: PostBoardKind, id: string, ownerId: string, context: BrowseContext) {
  return `/${kind}/${encodeURIComponent(id)}` + browseQuery(kind, ownerId, context);
}
export function listHref(kind: PostBoardKind, ownerId: string, context: BrowseContext) {
  return `/${kind}` + browseQuery(kind, ownerId, context);
}
export function paginate<T>(items: T[], requested: number, size = BOARD_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(positivePage(requested), pages);
  const start = (page - 1) * size;
  return { pages, page, start, items: items.slice(start, start + size) };
}
export function stepPeer<T extends { id: string }>(peers: T[], id: string, direction: -1 | 1) {
  const i = peers.findIndex(p => p.id === id);
  if (i < 0 || peers.length < 2) return null;
  const index = (i + direction + peers.length) % peers.length;
  return { post: peers[index], page: Math.floor(index / BOARD_PAGE_SIZE) + 1 };
}
const contains = (value: string | undefined, q: string) => (value ?? '').toLowerCase().includes(q);
const tagged = (tags: string[] | undefined, q: string) => (tags ?? []).some(t => contains(t, q));

export function galleryList(posts: BackupPost[], secId: string, context: Pick<BrowseContext, 'cat' | 'q'>,
  loggedIn: boolean, isAdmin: boolean): BackupPost[] {
  const q = context.q.trim().toLowerCase();
  return posts.filter(p => (p.secId ?? 'main') === secId
    && (isAdmin || p.visibility === 'public' || (p.visibility === 'member' && loggedIn))
    && (!context.cat || p.category === context.cat)
    && (!q || contains(p.title, q) || contains(p.category, q) || tagged(p.tags, q)));
}
export function videoList(posts: VideoPost[], secId: string, context: Pick<BrowseContext, 'cat' | 'q'>,
  userId: string | undefined, isAdmin: boolean): VideoPost[] {
  const q = context.q.trim().toLowerCase();
  return posts.filter(p => (p.secId ?? 'main') === secId
    && (isAdmin || p.visibility === 'public' || (p.visibility === 'member' && !!userId)
      || (!!userId && p.authorId === userId))
    && (!context.cat || p.category === context.cat)
    && (!q || contains(p.title, q) || contains(p.category, q) || tagged(p.tags, q)))
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function canReadBoardPost(p: Post, userId: string | undefined, isAdmin: boolean) {
  return !p.secret || isAdmin || (!!p.authorId && p.authorId === userId);
}
/** Secret rows remain masked in a list; detail navigation uses only readable peers. */
export function boardList(posts: Post[], boardId: string, context: Pick<BrowseContext, 'cat' | 'q'>): Post[] {
  const q = context.q.trim().toLowerCase();
  return posts.filter(p => (p.boardId ?? 'main') === boardId
    && (!context.cat || (context.cat === '공지' ? p.notice : p.category === context.cat))
    && (!q || contains(p.title, q) || contains(p.author, q) || tagged(p.tags, q)
      || (!p.secret && contains(p.body, q))))
    .sort((a, b) => Number(!!b.notice) - Number(!!a.notice) || b.date.localeCompare(a.date));
}
