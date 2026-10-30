import type { BackupPost } from './galleryStore';
import { galleryList } from './boardBrowsing';

/**
 * 저장된 목록 순서를 그대로 사용. 섹션·열람 권한이 같은 글만 반환한다.
 *
 * v2.3 사용자 요청 — 넘기는 범위는 **그림을 연 목록**을 따른다.
 * · cat === '' (ALL 탭에서 들어옴)  → 섹션의 모든 글 (분류 섞임)
 * · cat === '합작' 같은 분류         → 그 분류의 글만
 * 그래서 ALL에서 연 그림은 ALL 안에서만, 「그림」에서 연 그림은 「그림」 안에서만 넘어간다.
 */
export function galleryPeers(
  posts: BackupPost[], current: BackupPost, loggedIn: boolean, isAdmin: boolean,
  cat: string = '',
): BackupPost[] {
  return galleryList(posts, current.secId ?? 'main', { cat, q: '' }, loggedIn, isAdmin);
}

/** 상세 뷰어에서 연 사진부터, 같은 목록의 모든 실제 이미지를 이어 본다. */
export function gallerySlides(posts: BackupPost[]) {
  return posts.flatMap(post => post.images.map((src, imageIndex) => ({
    src, postId: post.id, imageIndex,
    caption: `${post.title}${post.images.length > 1 ? ` · ${imageIndex + 1}/${post.images.length}` : ''}`,
  })));
}
