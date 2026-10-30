import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
// Helpers have type-only imports: compile them without loading React/database modules.
const source = readFileSync(new URL('../src/lib/boardBrowsing.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const api = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const { readBrowseContext, postHref, listHref, galleryList, videoList, boardList,
  canReadBoardPost, paginate, positivePage, stepPeer, BOARD_PAGE_SIZE } = api;
const ctx = { cat: '', q: '', page: 1, view: 'gal' };
const p = (id, patch = {}) => ({id, title: id, secId: 'main', boardId: 'main', category: '그림 & 스케치',
  date: '2026-10-29', tags: [], visibility: 'public', author: 'writer', authorId: 'owner', body: '', secret: false, ...patch});

test('ALL retains mixed categories, never other sections', () => {
  const posts = [p('a'), p('b', {category:'낙서'}), p('x', {secId:'extra'})];
  assert.deepEqual(galleryList(posts, 'main', ctx, false, false).map(p=>p.id), ['a','b']);
  assert.deepEqual(galleryList(posts, 'main', {...ctx,cat:'낙서'}, false, false).map(p=>p.id), ['b']);
});
test('gallery query matches title, category and tags case-insensitively', () => {
  const posts = [p('title NEEDLE'), p('tagged',{tags:['Needle']}), p('no')];
  assert.equal(galleryList(posts, 'main', {...ctx,q:'needle'}, false, false).length, 2);
});
test('gallery permissions stay identical for list and detail peers', () => {
  const posts=[p('a'),p('member',{visibility:'member'}),p('private',{visibility:'private'})];
  assert.deepEqual(galleryList(posts,'main',ctx,false,false).map(p=>p.id),['a']);
  assert.deepEqual(galleryList(posts,'main',ctx,true,false).map(p=>p.id),['a','member']);
  assert.equal(galleryList(posts,'main',ctx,false,true).length,3);
});
test('video owner visibility and descending date are shared in both views', () => {
  const posts=[p('old',{date:'2026-01-01'}),p('new'),p('mine',{visibility:'private',authorId:'me'}),p('no',{visibility:'private'})];
  assert.deepEqual(videoList(posts,'main',ctx,'me',false).map(p=>p.id),['new','mine','old']);
  assert.deepEqual(videoList(posts,'main',ctx,undefined,false).map(p=>p.id),['new','old']);
});
test('board notices sort first and preserve category/search filter order', () => {
  const posts=[p('a'),p('n',{notice:true}),p('b',{category:'낙서'}),p('x',{boardId:'extra'})];
  assert.deepEqual(boardList(posts,'main',ctx).map(p=>p.id),['n','a','b']);
  assert.deepEqual(boardList(posts,'main',{cat:'공지',q:''}).map(p=>p.id),['n']);
});
test('board private bodies are never searched, and undefined authors are not readable', () => {
  const secret=p('masked',{secret:true,body:'needle',authorId:undefined});
  assert.equal(boardList([secret],'main',{cat:'',q:'needle'}).length,0);
  assert.equal(canReadBoardPost(secret,undefined,false),false);
  assert.equal(canReadBoardPost(p('mine',{secret:true,authorId:'me'}),'me',false),true);
  assert.equal(canReadBoardPost(secret,undefined,true),true);
});
test('query encoding round-trips ALL/category, page, search, view and section', () => {
  for(const kind of ['gallery','videos','board']) for(const cat of ['', '그림 & 스케치 / ALL']){
    const input={cat,q:'a & b? 한글',page:2,view:'list'};
    const href=postHref(kind,'id/한글','section & 1',input);
    const url=new URL(href,'https://example.test');
    assert.equal(decodeURIComponent(url.pathname.split('/')[2]),'id/한글');
    assert.deepEqual(readBrowseContext(url.searchParams),input);
    assert.equal(url.searchParams.get(kind==='board'?'b':'s'),'section & 1');
    assert.equal(new URL(listHref(kind,'section & 1',input),'https://example.test').pathname,`/${kind}`);
  }
});
test('page size is six for all views; empty and oversized pages clamp safely', () => {
  assert.equal(BOARD_PAGE_SIZE,6);
  const posts=Array.from({length:15},(_,i)=>p(String(i+1)));
  assert.equal(paginate(posts,1).items.length,6);
  assert.equal(paginate(posts,2).items[0].id,'7');
  assert.equal(paginate(posts,999).page,3);
  assert.deepEqual(paginate([],99).items,[]);
  assert.equal(paginate([],99).page,1);
  for(const bad of ['no','0','-1','2.5','Infinity',null]) assert.equal(positivePage(bad),1);
});
test('next/previous crosses pages, wraps and never jumps when current post is absent', () => {
  const posts=Array.from({length:15},(_,i)=>p(String(i+1)));
  assert.deepEqual(stepPeer(posts,'6',1),{post:posts[6],page:2});
  assert.deepEqual(stepPeer(posts,'1',-1),{post:posts[14],page:3});
  assert.equal(stepPeer(posts,'missing',1),null);
  assert.equal(stepPeer([p('only')],'only',1),null);
});
