'use client';
// 그림백업 상세 (4.11) — 로그형: 세로 스크롤 뷰어 / 단일형: 큰 이미지 + 썸네일 스트립 + 좌우 넘김
import { TagPreview } from '@/components/ui/TagPreview';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useHrefBlock } from '@/components/shell/MenuGuard';
import { sectionHref, secKeyOf, MAIN_SEC, useSectionTitle } from '@/lib/sectionStore';
import { useAuth, isVisiting } from '@/lib/auth';
import { useLocalList, fmtDate } from '@/lib/postStore';
import { BackupPost, BACKUP_SEED } from '@/lib/galleryStore';
import { gallerySlides } from '@/lib/galleryNavigation';
import { PostNavigation } from '@/components/ui/BoardBrowsing';
import { galleryList, readBrowseContext, postHref, listHref, stepPeer, positivePage, BOARD_PAGE_SIZE } from '@/lib/boardBrowsing';
import { ConfirmModal } from '@/components/ui/Modal';
import { useBlobUrl } from '@/lib/blobStore';
import { sanitizeHtml } from '@/lib/sanitize';
import { PageTitle } from '@/components/ui/PageText';
import { Lightbox } from '@/components/ui/Lightbox';
import { useBoardSettings, boardBadgeStyle, galleryCatsOf } from '@/lib/boardStore';

export default function BackupDetailPage() {
  const { id } = useParams<{ id: string }>();
  // 게시물을 넘길 때 사진 순번·삭제창·라이트박스 상태를 새 글 기준으로 초기화한다.
  // useSearchParams(?cat=)를 읽으므로 Suspense 경계가 필요하다 (Next App Router).
  return (
    <Suspense fallback={<section className="page" />}>
      <BackupDetail id={id} key={id} />
    </Suspense>
  );
}

function BackupDetail({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const context = readBrowseContext(params);
  const { user, isAdmin } = useAuth();
  const [posts, setPosts, loaded] = useLocalList<BackupPost>('ohome.backup.v1', BACKUP_SEED);
  const [cur, setCur] = useState(() => positivePage(params.get('image')) - 1);
  const [delAsk, setDelAsk] = useState(false);
  const [lbOpen, setLbOpen] = useState(false); // 단일형 — 클릭 확대 보기
  const { st: boardSet } = useBoardSettings(); // 유형 뱃지 색 (환경설정 > 게시판 관리)

  const p = posts.find(x => x.id === id);
  const imageNodes = useRef<Map<number, HTMLDivElement>>(new Map());
  const [scrollImage, setScrollImage] = useState<number | null>(() =>
    params.has('image') ? positivePage(params.get('image')) - 1 : null);
  useEffect(() => {
    if (!loaded || !p || scrollImage === null) return;
    const target = imageNodes.current.get(Math.min(scrollImage, Math.max(0, p.images.length - 1)));
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      setScrollImage(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [loaded, p, scrollImage]);
  /* 이 글이 속한 곳이 비공개면 주소로 들어와도 열리지 않게 (v2.0 사용자 요청).
     글 주소에는 섹션이 없어 MenuGuard가 못 막는다 — 글을 읽어 소속을 알아낸 여기서 판정한다.
     **다른 early return보다 먼저 불러야 한다**(훅이므로 렌더마다 개수가 같아야 한다) */
  const blocked = useHrefBlock(p && sectionHref('gallery', p.secId ?? MAIN_SEC));
  // 큰 글씨 — 추가 섹션이면 그 이름, 눌렀을 때도 그 목록으로 (v2.0 사용자 제보)
  const tt = useSectionTitle('gallery', p?.secId, 'GALLERY');
  if (blocked) return blocked;
  if (!loaded) return <section className="page" />;
  if (!p || (p.visibility === 'private' && !isAdmin) || (p.visibility === 'member' && !user)) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle href={tt.href}>{tt.title}</PageTitle><p>게시물을 찾을 수 없거나 열람 권한이 없습니다</p></div>
      </section>
    );
  }

  const ownerId = p.secId ?? MAIN_SEC;
  const peers = galleryList(posts, ownerId, context, !!user, isAdmin);
  const position = peers.findIndex(post => post.id === p.id);
  const backHref = listHref('gallery', secKeyOf('gallery', ownerId), context);
  const goPost = (direction: -1 | 1) => {
    const next = stepPeer(peers, p.id, direction);
    if (next) router.push(postHref('gallery', next.post.id, secKeyOf('gallery', ownerId), { ...context, page: next.page }));
  };
  const slides = gallerySlides(peers);
  const slideIndex = slides.findIndex(slide => slide.postId === p.id &&
    slide.imageIndex === Math.min(cur, Math.max(0, p.images.length - 1)));
  const closeLightbox = (lastIndex: number) => {
    const last = slides[lastIndex];
    setLbOpen(false);
    if (!last) return;
    if (last.postId === p.id) {
      setCur(last.imageIndex);
      if (p.type === 'log' || p.type === 'vlist') setScrollImage(last.imageIndex);
      return;
    }
    const peerIndex = peers.findIndex(post => post.id === last.postId);
    const href = postHref('gallery', last.postId, secKeyOf('gallery', ownerId), {
      ...context, page: Math.floor(peerIndex / BOARD_PAGE_SIZE) + 1,
    });
    // Replace only the detail URL: browser Back still returns to the original list.
    router.replace(`${href}&image=${last.imageIndex + 1}`, { scroll: false });
  };
  const imgs: { url?: string; ph?: string }[] = p.images.length
    ? p.images.map(u => ({ url: u }))
    : (p.phList.length ? p.phList : ['cool']).map(c => ({ ph: c }));
  // 실시간 수정으로 사진이 줄어들어도 빈 순번을 참조하지 않는다.
  const imageIndex = Math.min(cur, imgs.length - 1);
  /* 글쓴이 확인 (v2.0 발견) — **둘 다 없을 때 같다고 보면 안 된다.**
     예전 글이나 손님이 쓴 글은 authorId가 없는데, 비로그인 방문자도 user?.id가 없어
     `undefined === undefined`로 통과했다 — 아무나 남의 글을 고치고 지울 수 있었다 */
  const canManage = !!user && !isVisiting();   // (v2.2) 회원은 누구나

  // 파일 id/URL 모두 지원 — blobStore에서 로드 (새로고침에도 유지)
  // natural: 고정 프레임 안에서 확대 없이 원본 크기 그대로 가운데 (단일형 — 프레임보다 크면 축소만)
  const Img = ({ im, ratio, natural }: { im: { url?: string; ph?: string }; ratio?: string; natural?: boolean }) => {
    const u = useBlobUrl(im.url);
    if (u) {
      // eslint-disable-next-line @next/next/no-img-element
      // 원본보다 크게 늘리지 않는다 — 폭이 모자랄 때만 줄이고, 작은 그림은 작은 그대로 (v2.0 사용자 확정)
      return <img src={u} alt="" style={natural
        ? { maxWidth: '100%', maxHeight: '100%', display: 'block' }
        : { maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }} />;
    }
    return <div className={`ph ${im.ph ?? ''}`}
      style={natural ? { width: '100%', height: '100%' } : { aspectRatio: ratio ?? '16/10' }}><span>IMAGE</span></div>;
  };

  // 말머리 뱃지 — 이 갤러리(섹션)의 말머리 색으로. 말머리는 이름(label)으로 저장돼 있다
  const cat = galleryCatsOf(boardSet, p.secId ?? MAIN_SEC).find(c => c.label === p.category);

  return (
    <section className="page">
      {/* 큰 제목 아래의 「말머리 · 작성자 · 날짜」 줄은 뺐다 (커플홈 사용자 요청) — 전부 카드 안으로 */}
      <div className="page-head">
        <PageTitle href={backHref} lookupHref={tt.href}>{tt.title}</PageTitle>
        <div className="head-actions">
          {canManage && <button className="btn btn-dark" onClick={() => router.push(`/gallery/${p.id}/edit`)}>EDIT</button>}
          {canManage && <button className="btn btn-dark" onClick={() => setDelAsk(true)}>DELETE</button>}
        </div>
      </div>

      <PostNavigation label={context.cat || 'ALL'} index={position} total={peers.length}
        href={backHref} onGo={goPost} />

      {/* 본문만 폭 제한 — 헤더는 풀폭 위치 유지 */}
      <div className="panel" style={{ padding: 20, maxWidth: 960, margin: '0 auto' }}>
        {/* 제목 + 말머리 뱃지 (유형 「단일」 대신 — 커플홈 사용자 요청) */}
        <h2 style={{ fontSize: 18, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {p.title}
          {p.category && <span style={boardBadgeStyle(cat)}>{p.category}</span>}
          {/* 작성자 · 날짜 · 태그 — 제목 줄의 오른쪽 끝에 (커플홈 사용자 요청) */}
          <span style={{
            marginLeft: 'auto', fontSize: 'calc(11.5px*var(--fs,1))', fontWeight: 400, letterSpacing: 0,
            color: 'var(--faint)', whiteSpace: 'normal', maxWidth: '100%', minWidth: 0,
          }}>
            {p.author} · {fmtDate(p.date)}{p.madeDate ? ` · 제작 ${p.madeDate}` : ''}
            <TagPreview tags={p.tags} />
          </span>
        </h2>

        {p.type === 'log' ? (
          /* 로그형 — 웹툰식 세로 스크롤 · 이미지 사이 틈 없이 이어 붙임 (만화 연결) */
          <div style={{ borderRadius: 10, overflow: 'hidden' }}>
            {imgs.map((im, i) => (
              <div key={i} ref={node => { if (node) imageNodes.current.set(i, node); else imageNodes.current.delete(i); }} style={{ cursor: im.url ? 'zoom-in' : undefined }}
                onClick={() => {
                  if (im.url) { setCur(i); setLbOpen(true); }
                }}>
                <Img im={im} />
              </div>
            ))}
          </div>
        ) : p.type === 'vlist' ? (
          /* 단일(세로정렬) (v1.9) — 로그와 달리 이미지 사이 갭을 두고 세로로 나열, 클릭 확대 */
          <div style={{ display: 'grid', gap: 14 }}>
            {imgs.map((im, i) => (
              <div key={i} ref={node => { if (node) imageNodes.current.set(i, node); else imageNodes.current.delete(i); }} style={{ borderRadius: 10, overflow: 'hidden', cursor: im.url ? 'zoom-in' : undefined }}
                onClick={() => { if (im.url) { setCur(i); setLbOpen(true); } }}>
                <Img im={im} />
              </div>
            ))}
          </div>
        ) : (
          /* 단일형 — 큰 이미지 + 좌우 넘김 + 썸네일 스트립 */
          <>
            <div className="single-viewer">
              {/* 고정 16:10 프레임 안 가운데 배치 — 실제 이미지일 때만 클릭 확대.
                  grid는 암시적 row가 콘텐츠 높이로 늘어나 max-height:100%가 무력화됨(세로 긴 그림 잘림) → flex (v1.9) */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: imgs[imageIndex].url ? 'zoom-in' : undefined,
              }}
                onClick={() => { if (imgs[imageIndex].url) { setCur(imageIndex); setLbOpen(true); } }}>
                <Img im={imgs[imageIndex]} natural />
              </div>
              {imgs.length > 1 && (
                <>
                  <button className="nav" style={{ left: 10 }}
                    onClick={() => setCur(c => (c - 1 + imgs.length) % imgs.length)}>◁</button>
                  <button className="nav" style={{ right: 10 }}
                    onClick={() => setCur(c => (c + 1) % imgs.length)}>▷</button>
                </>
              )}
            </div>
            {imgs.length > 1 && (
              <div className="thumb-strip">
                {imgs.map((im, i) => (
                  <div key={i} className={`t ${i === cur ? 'on' : ''}`} onClick={() => setCur(i)}>
                    <Img im={im} ratio="4/3" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {/* 적어 둔 글은 이미지 아래에 (커플홈 사용자 요청) */}
        {p.desc && (
          <div className="post-body" style={{ fontSize: 12.5, margin: '16px 0 0' }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.desc) }} />
        )}
      </div>

      {/* 로그·단일·세로정렬 모두 같은 목록의 이미지로 이어 넘긴다. 다른 섹션/분류는 섞지 않는다. */}
      {lbOpen && slideIndex >= 0 && slides.length > 0 && (
        <Lightbox srcs={slides.map(slide => slide.src)} captions={slides.map(slide => slide.caption)}
          index={slideIndex} onClose={closeLightbox} />
      )}

      <ConfirmModal open={delAsk} title="게시물을 삭제하시겠습니까?" body="삭제한 게시물은 복구할 수 없습니다."
        onClose={() => setDelAsk(false)}
        buttons={[
          { label: 'DELETE', kind: 'accent', onClick: () => { setPosts(posts.filter(x => x.id !== p.id)); router.push(backHref); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setDelAsk(false) },
        ]} />
    </section>
  );
}
