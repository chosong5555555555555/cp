import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/rpStore.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { rpTurnMessageIds } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const msg = (id, authorId, kind = 'char', extra = {}) => ({
  id, authorId, kind, text: kind === 'turn' ? '' : id,
  date: '2026-11-02T10:00:00.000Z', ...extra,
});

test('explicit turn targets the last message of its author, not the other participant', () => {
  const rows = [msg('a1','a'), msg('b1','b'), msg('a2','a'), msg('b2','b'), msg('t','a','turn',{turnMessageId:'a2'})];
  assert.deepEqual([...rpTurnMessageIds(rows)], ['a2']);
});
test('legacy turn events map to the preceding message by the same author', () => {
  assert.deepEqual([...rpTurnMessageIds([msg('a1','a'), msg('b1','b'), msg('t','a','turn')])], ['a1']);
});
test('new messages do not inherit completion and can end their own turn', () => {
  const rows = [msg('a1','a'),msg('t1','a','turn'),msg('a2','a')];
  assert.deepEqual([...rpTurnMessageIds(rows)], ['a1']);
  assert.deepEqual([...rpTurnMessageIds([...rows,msg('t2','a','turn',{turnMessageId:'a2'})])], ['a2']);
});
test('an intervening partner message preserves the earlier completed segment', () => {
  const rows = [msg('a1','a'),msg('t1','a','turn'),msg('b1','b'),msg('a2','a'),msg('t2','a','turn')];
  assert.deepEqual([...rpTurnMessageIds(rows)], ['a1','a2']);
});
test('partner OOC or description separates segments, but a hidden turn event does not', () => {
  for (const kind of ['ooc','desc']) {
    const rows = [msg('a1','a'),msg('t1','a','turn'),msg('b1','b',kind),msg('a2','a'),msg('t2','a','turn')];
    assert.deepEqual([...rpTurnMessageIds(rows)], ['a1','a2']);
  }
  const noReply = [msg('a1','a'),msg('t1','a','turn'),msg('other-turn','b','turn'),msg('a2','a'),msg('t2','a','turn')];
  assert.deepEqual([...rpTurnMessageIds(noReply)], ['a2']);
});
test('consecutive re-finishes keep just the newest check, including legacy data', () => {
  const rows = [msg('a1','a'),msg('t1','a','turn'),msg('a2','a'),msg('t2','a','turn'),msg('a3','a'),msg('t3','a','turn')];
  assert.deepEqual([...rpTurnMessageIds(rows)], ['a3']);
});
test('a future explicit target is not retroactively checked', () => {
  assert.deepEqual([...rpTurnMessageIds([msg('t','a','turn',{turnMessageId:'future'}),msg('future','a')])], []);
});
test('repeat button is not disabled merely because the message already has a check', () => {
  const page = readFileSync(new URL('../src/app/rp/page.tsx', import.meta.url),'utf8');
  assert.match(page, /const canEndTurn = !!lastOwnMessage;/);
  assert.doesNotMatch(page, /if \(!target \|\| completedMessageIds\.has/);
});
test('a repeated finish never creates extra checks', () => {
  assert.deepEqual([...rpTurnMessageIds([msg('a1','a'),msg('t1','a','turn'),msg('t2','a','turn')])], ['a1']);
});
test('missing, deleted or foreign targets are not silently reassigned', () => {
  assert.deepEqual([...rpTurnMessageIds([msg('a1','a'),msg('b1','b'),msg('t1','a','turn',{turnMessageId:'removed'}),msg('t2','a','turn',{turnMessageId:'b1'})])], []);
});
test('empty rooms and a turn before any message produce no checks', () => {
  assert.equal(rpTurnMessageIds([]).size, 0);
  assert.equal(rpTurnMessageIds([msg('t','a','turn'),msg('a1','a')]).size, 0);
});
test('OOC, description and image-only messages support completion without mutating input', () => {
  for (const kind of ['char','ooc','desc']) {
    const rows = Object.freeze([Object.freeze(msg('a1','a',kind,{text:'',imgId:'photo'})),Object.freeze(msg('t','a','turn'))]);
    assert.deepEqual([...rpTurnMessageIds(rows)], ['a1']);
  }
});
test('turn rows are filtered before pagination; no completion announcement is rendered in chat', () => {
  const page = readFileSync(new URL('../src/app/rp/page.tsx', import.meta.url),'utf8');
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url),'utf8');
  assert.match(page, /const allMsgs = roomEvents\.filter\(m => m\.kind !== 'turn'\)/);
  assert.doesNotMatch(page, /rp-turnline|대사를 끝냈다고 알렸습니다|상대가 대사를 끝냈습니다/);
  assert.match(page, /className="rp-turn-check"/);
  assert.match(page, /disabled=\{!canEndTurn\}/);
  assert.match(css, /grid-template-columns:repeat\(2,58px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,48px\)/);
});


test('turn completion does not show an acknowledgement banner when entering a room', () => {
  const page = readFileSync(new URL('../src/app/rp/page.tsx', import.meta.url),'utf8');
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url),'utf8');
  assert.doesNotMatch(page, /rp-turnbar|turnWaiting|ackTurn|turnAcks/);
  assert.doesNotMatch(css, /\.rp-turnbar/);
  assert.match(page, /rp-turn-check/);
  assert.match(page, /type: 'rpturn'/); // 종·웹푸시 알림 자체는 유지한다.
});
