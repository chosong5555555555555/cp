import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual component with lightweight hook/portal mocks, without a backend.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/components/ui/Lightbox.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
function viewer(index = 0, srcs = ['blob:first', 'blob:second', 'blob:third']) {
  const slots = [], listeners = new Map(), closed = [];
  let cursor = 0, effects = [], cleanups = [], tree;
  const react = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
    },
    useRef(initial) {
      const slot = cursor++;
      return slots[slot] ??= { current: initial };
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const previous = slots[slot];
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
        slots[slot] = deps;
        effects.push(effect);
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports, module,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react-dom') return { createPortal: node => node };
      if (name === '@/lib/blobStore') return { useBlobUrl: value => value };
      return require(name);
    },
    document: { body: {} },
    window: {
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    },
  });
  const props = { srcs, index, onClose: value => closed.push(value) };
  function render() {
    cursor = 0; effects = [];
    tree = module.exports.Lightbox(props);
    cleanups.push(...effects.map(effect => effect()));
    return tree;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(child => child == null ? [] : nodes(child))];
  }
  render();
  return {
    render, closed, nodes,
    image: () => nodes().find(node => node.type === 'img'),
    button: label => nodes().find(node => node.type === 'button' && node.props['aria-label'] === label),
    key: key => { listeners.get('keydown')?.({ key }); render(); },
    click: label => { nodes().find(node => node.type === 'button' && node.props['aria-label'] === label).props.onClick({ stopPropagation() {} }); render(); },
    root: () => tree,
  };
}

test('left/right drags and pinch endings never change the current photo', () => {
  const v = viewer(1);
  for (const [start, end, pinch] of [[300, 20, false], [20, 300, false], [20, 300, true], [300, 20, true]]) {
    for (const node of v.nodes()) node.props.onTouchStart?.({ touches: pinch ? [{ clientX: start }, { clientX: 150 }] : [{ clientX: start }] });
    for (const node of v.nodes()) node.props.onTouchEnd?.({ changedTouches: [{ clientX: end }], touches: [] });
    v.render();
    assert.equal(v.image().props.src, 'blob:second');
  }
});

test('no lightbox touch handlers or gesture-blocking style remain', () => {
  const v = viewer();
  for (const node of v.nodes()) {
    for (const prop of ['onTouchStart', 'onTouchMove', 'onTouchEnd', 'onTouchCancel']) assert.equal(node.props[prop], undefined);
    assert.equal(node.props.style?.touchAction, undefined);
  }
  assert.doesNotMatch(source, /preventDefault|touchX/);
});

test('arrow buttons navigate both ways and wrap at the ends', () => {
  const v = viewer();
  v.click('이전 사진'); assert.equal(v.image().props.src, 'blob:third');
  v.click('다음 사진'); assert.equal(v.image().props.src, 'blob:first');
  v.click('다음 사진'); assert.equal(v.image().props.src, 'blob:second');
});

test('keyboard navigation and Escape retain the current index', () => {
  const v = viewer();
  v.key('ArrowRight'); assert.equal(v.image().props.src, 'blob:second');
  v.key('ArrowLeft'); assert.equal(v.image().props.src, 'blob:first');
  v.key('ArrowLeft'); v.key('Escape'); assert.deepEqual(v.closed, [2]);
});

test('single image hides navigation and image clicks do not close it', () => {
  const v = viewer(0, ['blob:only']);
  assert.equal(v.button('이전 사진'), undefined);
  assert.equal(v.button('다음 사진'), undefined);
  let stopped = false;
  v.image().props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.deepEqual(v.closed, []);
  v.key('ArrowRight'); assert.equal(v.image().props.src, 'blob:only');
  v.click('사진 닫기'); assert.deepEqual(v.closed, [0]);
});

test('background close reports the selected image index', () => {
  const v = viewer(1);
  v.root().props.onClick();
  assert.deepEqual(v.closed, [1]);
});

test('gallery, list and video navigation have no separate swipe handlers', () => {
  const files = ['src/components/ui/BoardBrowsing.tsx', 'src/components/ui/ViewMode.tsx',
    'src/app/gallery/page.tsx', 'src/app/gallery/[id]/page.tsx',
    'src/app/board/page.tsx', 'src/app/board/[id]/page.tsx',
    'src/app/videos/page.tsx', 'src/app/videos/[id]/page.tsx'];
  for (const file of files) {
    const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /onTouch(Start|Move|End)|changedTouches|touchstart|touchmove|touchend|swipe/i, file);
  }
});
