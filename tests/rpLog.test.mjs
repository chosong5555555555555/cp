import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Load the real helpers without requiring a running Next app or backend.
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const storeUrl = dataUrl(compile(readFileSync(new URL('../src/lib/rpStore.ts', import.meta.url), 'utf8')));
const source = compile(readFileSync(new URL('../src/lib/rpLog.ts', import.meta.url), 'utf8'))
  .replace("from './rpStore'", `from '${storeUrl}'`);
const { rpLogMessages, rpLogText, rpLogHtml, rpLogRange, rpLogLastDate, rpSpeakers } = await import(dataUrl(source));
const msg = (id, kind, day, extra = {}) => Object.freeze({
  id, kind, date: `2026-10-${day}T12:00:00.000Z`, text: id,
  authorId: 'owner', charId: 'c1', ...extra,
});
const msgs = Object.freeze([
  msg('ooc-before', 'ooc', '28', { oocName: '오너' }),
  msg('kept-character', 'char', '29'),
  msg('kept-description', 'desc', '29'),
  msg('kept-legacy-player', 'player', '29'),
  msg('kept-image', 'char', '29', { text: '', imgId: 'photo-ref' }),
  msg('ooc-after', 'ooc', '30', { oocName: '오너' }),
]);
const chars = [{ id: 'c1', name: '캐릭터', color: '#8f314d' }];
const info = { title: '백업 테스트', sub: '자관' };

test('default backup retains every message, including OOC', () => {
  assert.equal(rpLogMessages(msgs), msgs);
  assert.match(rpLogText(info, rpLogMessages(msgs), chars, { time: false }), /ooc-before/);
});

test('OOC exclusion removes only OOC, preserving order and the original messages', () => {
  const selected = rpLogMessages(msgs, true);
  assert.deepEqual(selected.map(m => m.id), ['kept-character', 'kept-description', 'kept-legacy-player', 'kept-image']);
  assert.equal(msgs.length, 6);
  assert.equal(selected[0], msgs[1]);
  assert.equal(rpLogMessages(msgs, false).length, 6);
});

test('filtered range, final date and character metadata are based only on included messages', () => {
  const selected = rpLogMessages(msgs, true);
  assert.equal(rpLogRange(selected), '2026.10.29');
  assert.equal(rpLogLastDate(selected), '2026-10-29');
  assert.deepEqual(rpSpeakers(selected, chars), chars);
});

for (const style of ['script', 'imsg']) for (const forBoard of [false, true]) {
  test(`${style} HTML ${forBoard ? 'board' : 'file'} and TXT contain no excluded dialogue`, () => {
    const selected = rpLogMessages(msgs, true);
    for (const output of [
      rpLogText(info, selected, chars, { time: true, forBoard }),
      rpLogHtml(info, selected, chars, { time: true, style, forBoard }),
    ]) {
      assert.doesNotMatch(output, /ooc-before|ooc-after/);
      assert.match(output, /kept-character/);
      assert.match(output, /kept-description/);
      assert.match(output, /kept-legacy-player/);
      assert.match(output, /대화 4개/);
      assert.doesNotMatch(output, /2026\.10\.28|2026\.10\.30/);
    }
    const persistedSource = { msgs: selected, style, fmt: 'html', time: true, faces: false };
    assert.doesNotMatch(JSON.stringify(persistedSource), /ooc-before|ooc-after/);
  });
}

test('empty and OOC-only exports remain valid', () => {
  for (const original of [[], msgs.filter(m => m.kind === 'ooc')]) {
    const selected = rpLogMessages(original, true);
    assert.deepEqual(selected, []);
    assert.equal(rpLogRange(selected), '');
    assert.match(rpLogText(info, selected, chars, { time: false }), /대화 0개/);
    for (const style of ['script', 'imsg']) {
      assert.match(rpLogHtml(info, selected, chars, { time: false, style }), /대화 0개/);
    }
  }
});
