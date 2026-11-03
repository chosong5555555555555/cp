import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const text = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function loadTs(path, imports, globals = {}) {
  const code = ts.transpileModule(text(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; },
    console, URLSearchParams, URL, setTimeout, clearTimeout, setInterval, clearInterval,
    ...globals,
  }, { filename: path });
  return module.exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const change = (id, type = 'added', data = {}) => ({
  type, doc: { id, data: () => ({ data: { title: id, ...data }, sort: data.sort ?? 0 }) },
});

async function firebaseFixture() {
  const state = { listeners: [], queries: [], docReads: [], listReads: [], auth: { currentUser: { uid: 'me' } } };
  const fs = {
    initializeFirestore: () => ({}),
    collection: (_db, ...parts) => parts.join('/'),
    doc: (_db, ...parts) => parts.join('/'),
    where: (field, op, value) => ({ field, op, value }),
    query: (collection, ...constraints) => ({ collection, constraints }),
    getDoc: async path => {
      state.docReads.push(path);
      const data = path === 'meta/owner' ? { uid: 'owner' } : { homeId: 'home-a' };
      return { exists: () => true, data: () => data };
    },
    getDocsFromServer: async q => { state.listReads.push(q); return { docs: state.docs ?? [] }; },
    onSnapshot: (q, rows, error) => {
      const listener = { q, rows, error, stopped: false };
      state.listeners.push(listener);
      return () => { listener.stopped = true; };
    },
  };
  const api = loadTs('src/lib/backend/firebaseBackend.ts', {
    './types': {}, '../visFloor': {},
    'firebase/app': { getApps: () => [], initializeApp: () => ({}) },
    'firebase/auth': { getAuth: () => state.auth, onAuthStateChanged: (_auth, cb) => { state.authChange = cb; } },
    'firebase/firestore': fs,
    'firebase/storage': { getStorage: () => ({}) },
  });
  const be = await api.createFirebaseBackend({ kind: 'firebase', projectId: 'test' });
  be.setHome('home-a');
  const emit = (index, changes) => state.listeners[index].rows({ docChanges: () => changes });
  return { be, state, emit };
}

test('Firebase notification listener uses exactly one owner-scoped query, no initial or change-triggered getDocs', async () => {
  const { be, state, emit } = await firebaseFixture();
  const updates = [];
  const off = be.subscribeList('notifications', rows => updates.push(plain(rows)), undefined, { authorId: 'me' });
  await flush();
  assert.equal(state.listeners.length, 1);
  assert.deepEqual(plain(state.listeners[0].q), {
    collection: 'homes/home-a/notifications', constraints: [{ field: 'authorId', op: '==', value: 'me' }],
  });
  emit(0, [change('n1')]);
  emit(0, [change('n1', 'modified', { title: 'updated' }), change('n2')]);
  emit(0, [change('n1', 'removed')]);
  assert.deepEqual(updates.at(-1).map(x => x.id), ['n2']);
  assert.equal(updates[1].find(x => x.id === 'n1').title, 'updated');
  assert.equal(state.listReads.length, 0);
  assert.equal(state.docReads.length, 0);
  off(); assert.equal(state.listeners[0].stopped, true);
});

test('single-log body subscriptions listen only to that document and never query the body collection', async () => {
  const { be, state } = await firebaseFixture();
  const updates = [];
  const off = be.subscribeOne('trpg_log_bodies', 'one-log', row => updates.push(plain(row)));
  assert.equal(state.listeners[0].q, 'homes/home-a/trpg_log_bodies/one-log');
  state.listeners[0].rows({exists: () => true, id:'one-log', data: () => ({data:{bodyText:'one body'}})});
  state.listeners[0].rows({exists: () => false});
  assert.equal(updates[0].bodyText, 'one body'); assert.equal(updates[1], null);
  assert.equal(state.listReads.length, 0); off();
});

test('concurrent content streams share pending owner and profile permission checks', async () => {
  const { be, state } = await firebaseFixture();
  const offs = ['relations','characters','rp_rooms','rp_messages'].map(coll => be.subscribeList(coll, () => {}));
  await flush();
  assert.equal(state.docReads.filter(path => path === 'meta/owner').length, 1);
  assert.equal(state.docReads.filter(path => path === 'profiles/me').length, 1);
  offs.forEach(off => off());
});

test('identical Firebase subscribers share one listener and release it only when the final consumer leaves', async () => {
  const { be, state, emit } = await firebaseFixture();
  const a = [], b = [];
  const opts = { authorId: 'me' };
  const offA = be.subscribeList('notifications', rows => a.push(plain(rows)), undefined, opts);
  await flush(); emit(0, [change('first')]);
  const offB = be.subscribeList('notifications', rows => b.push(plain(rows)), undefined, opts);
  assert.equal(state.listeners.length, 1);
  assert.equal(b.length, 1); // shared cached snapshot, not another server read
  offA(); assert.equal(state.listeners[0].stopped, false);
  emit(0, [change('second')]);
  assert.equal(a.length, 1); assert.equal(b.length, 2);
  offB(); assert.equal(state.listeners[0].stopped, true);
});

test('permission query snapshots wait for initialization, dedupe overlap, and retain rows still in the other query', async () => {
  const { be, state, emit } = await firebaseFixture();
  const updates = [];
  const off = be.subscribeList('rp_messages', rows => updates.push(plain(rows)));
  await flush();
  assert.equal(state.listeners.length, 2);
  emit(0, [change('shared'), change('public')]);
  assert.equal(updates.length, 0);
  emit(1, [change('shared'), change('private')]);
  assert.deepEqual(updates.at(-1).map(x => x.id).sort(), ['private', 'public', 'shared']);
  emit(0, [change('shared', 'removed')]);
  assert.equal(updates.at(-1).some(x => x.id === 'shared'), true);
  emit(1, [change('shared', 'removed')]);
  assert.equal(updates.at(-1).some(x => x.id === 'shared'), false);
  assert.equal(state.listReads.length, 0); off();
});

test('shared Firebase streams are isolated by home, account and recipient', async () => {
  const { be, state } = await firebaseFixture();
  const offs = [];
  offs.push(be.subscribeList('notifications', () => {}, undefined, { authorId: 'me' }));
  offs.push(be.subscribeList('notifications', () => {}, undefined, { authorId: 'other' }));
  await flush();
  be.setHome('home-b');
  offs.push(be.subscribeList('notifications', () => {}, undefined, { authorId: 'me' }));
  await flush();
  state.auth.currentUser = { uid: 'another' };
  offs.push(be.subscribeList('notifications', () => {}, undefined, { authorId: 'me' }));
  await flush();
  assert.equal(state.listeners.length, 4);
  assert.equal(state.listeners[2].q.collection, 'homes/home-b/notifications');
  offs.forEach(off => off());
});

test('disposing before Firebase permission lookup resolves does not leave orphan listeners', async () => {
  const { be, state } = await firebaseFixture();
  be.subscribeList('relations', () => {})();
  await flush();
  assert.equal(state.listeners.length, 0);
});

test('Firebase subscription query errors are reported without expensive polling fallback', async () => {
  const { be, state } = await firebaseFixture();
  const errors = [];
  const off = be.subscribeList('notifications', () => {}, e => errors.push(e), { authorId: 'me' });
  await flush();
  const error = new Error('permission-denied');
  state.listeners[0].error(error);
  assert.equal(errors[0], error);
  assert.equal(state.listReads.length, 0); off();
});

test('Firebase push subscription reads query only the target owner using the existing single-field metadata index', async () => {
  const { be, state } = await firebaseFixture();
  await be.fetchList('push_subs', { authorId: 'receiver' });
  assert.equal(state.listReads.length, 1);
  assert.deepEqual(plain(state.listReads[0].constraints), [{ field: 'authorId', op: '==', value: 'receiver' }]);
  assert.equal(state.docReads.length, 0);
});

function notifFixture({ realtime = true } = {}) {
  const store = new Map();
  const state = { reads: 0, writes: [], timers: 0, user: 'me', home: 'home-a', opts: null };
  const be = {
    subscribe: () => () => {},
    ...(realtime ? { subscribeList: (coll, cb, error, options) => {
      assert.equal(coll, 'notifications'); state.emit = cb; state.error = error; state.opts = options;
      return () => { state.stopped = true; };
    } } : {}),
  };
  const events = new EventTarget();
  const api = loadTs('src/lib/notifStore.ts', {
    './postStore': { newId: () => `id-${Math.random()}` },
    './backend': { backend: () => be, isServerMode: () => true },
    './db': {
      fetchList: async (_coll, options) => { state.reads++; state.opts = options; return state.rows ?? []; },
      fetchOne: async () => null,
      syncList: async (...args) => state.writes.push(args),
    },
    './currentUser': { currentUserId: () => state.user },
    './home': { currentHomeId: () => state.home },
    './push': { webPushTo: async () => null },
  }, {
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    window: events, Event,
    document: { visibilityState: 'visible' },
    setInterval: () => { state.timers++; return 1; }, clearInterval: () => {},
  });
  return { api, state, store };
}
const notif = (id, extra = {}) => ({
  id, type: 'rpturn', toUserId: 'me', title: id, href: '/rp?room=one', read: false,
  date: '2026-11-03T10:00:00.000Z', ...extra,
});

test('notification boot, cached resync and live changes never trigger Firebase list reads or polling', async () => {
  const { api, state } = notifFixture();
  const off = api.watchNotifs('me');
  await api.syncNotifs('me', true); // even while the first snapshot is pending
  state.emit([notif('n1')]);
  state.emit([notif('n1', { body: 'updated' }), notif('other', { toUserId: 'other' })]);
  await api.syncNotifs('me', true);
  assert.equal(state.reads, 0); assert.equal(state.timers, 0);
  assert.deepEqual(plain(state.opts), { authorId: 'me' });
  assert.equal(api.readNotifs().length, 1);
  assert.equal(api.readNotifs()[0].body, 'updated'); off();
});

test('remote read state, remote deletion and recipient settings reconcile without resurrecting notifications', () => {
  const { api, state } = notifFixture();
  const off = api.watchNotifs('me');
  state.emit([notif('n1')]);
  api.markRead('n1');
  state.emit([notif('n1')]); // delayed snapshot cannot undo the optimistic read
  assert.equal(api.readNotifs()[0].read, true);
  state.emit([]); assert.equal(api.readNotifs().length, 0);
  state.emit([notif('n2')]);
  api.setNotifSetting('me', 'rpturn', false);
  assert.equal(api.readNotifs().length, 0);
  api.setNotifSetting('me', 'rpturn', true);
  assert.equal(api.readNotifs()[0].id, 'n2'); off();
});

test('duplicate unread rows and expired read rows are deleted, while distinct rooms remain', () => {
  const { api, state } = notifFixture();
  const off = api.watchNotifs('me');
  state.emit([
    notif('old', { title: 'same', date: '2026-11-01T10:00:00.000Z' }),
    notif('new', { title: 'same', date: '2026-11-03T10:00:00.000Z' }),
    notif('room-2', { title: 'same', href: '/rp?room=two' }),
    notif('expired', { read: true, readAt: '2020-01-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(Array.from(api.readNotifs(), n => n.id).sort(), ['new', 'room-2']);
  const deleted = state.writes.flatMap(args => Array.from(args[1], n => n.id)).sort();
  assert.deepEqual(deleted, ['expired', 'old']); off();
});

test('late snapshots after unsubscribe or a home switch cannot overwrite the current inbox', () => {
  const { api, state } = notifFixture();
  const off = api.watchNotifs('me');
  state.home = 'home-b'; state.emit([notif('wrong-home')]);
  assert.equal(api.readNotifs().length, 0);
  state.home = 'home-a'; off(); state.emit([notif('late')]);
  assert.equal(api.readNotifs().length, 0);
});

test('non-realtime fallback reads only one recipient and shares concurrent refreshes', async () => {
  const { api, state } = notifFixture({ realtime: false });
  state.rows = [notif('n1')];
  await Promise.all([api.syncNotifs('me', true), api.syncNotifs('me', true), api.syncNotifs('me', true)]);
  assert.equal(state.reads, 1); assert.equal(state.opts.authorId, 'me');
});

test('useLocalList consumes a data listener directly without an initial or change-triggered fetch', () => {
  const effects = [], updates = [];
  let emit, stopped = false;
  const events = new EventTarget();
  const api = loadTs('src/lib/postStore.ts', {
    react: { useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: current => ({ current }),
      useState: value => [typeof value === 'function' ? value() : value, next => updates.push(next)] },
    './supabase': { isServerMode: () => true },
    './db': { TABLE_OF: { 'ohome.rpmsgs.v1': 'rp_messages' },
      fetchList: () => { throw new Error('Unexpected full read'); },
      subscribeTable: () => { throw new Error('Unexpected signal listener'); },
      subscribeList: (_coll, cb) => { emit = cb; return () => { stopped = true; }; },
    },
    './currentUser': { currentUserId: () => 'me' },
  }, { window: events });
  api.useLocalList('ohome.rpmsgs.v1', []);
  const off = effects[0]();
  emit([{ id: 'one' }]); emit([{ id: 'one' }, { id: 'two' }]);
  assert.equal(updates.filter(Array.isArray).length, 2);
  off(); assert.equal(stopped, true);
});

for (const authorId of [undefined, 'me']) {
  test(`push settings never subscribe broadly during auth startup (explicit owner: ${authorId ?? 'pending'})`, () => {
    const effects = [], queries = [];
    const api = loadTs('src/lib/postStore.ts', {
      react: {useCallback: fn => fn, useEffect: fn => effects.push(fn), useRef: current => ({current}),
        useState: value => [typeof value === 'function' ? value() : value, () => {}]},
      './supabase': {isServerMode: () => true},
      './currentUser': {currentUserId: () => null},
      './db': {TABLE_OF:{'ohome.pushsubs.v1':'push_subs'},
        fetchList: () => {throw new Error('Unexpected list read');},
        subscribeTable: () => {throw new Error('Unexpected broad subscription');},
        subscribeList: (_table, _rows, _error, options) => {queries.push(options); return () => {};},
      },
    }, {window: new EventTarget()});
    api.useLocalList('ohome.pushsubs.v1', [], {authorId});
    const off = effects[0]();
    if (authorId) {assert.equal(queries.length, 1); assert.equal(queries[0].authorId, 'me'); off();}
    else assert.equal(queries.length, 0);
  });
}

const navigation = loadTs('src/lib/relationNavigation.ts', {});
test('relation links safely encode IDs and preserve an explicit original/AU scope', () => {
  const base = new URL(navigation.relationListHref('log', 'a&b', 'base'), 'https://home.example');
  assert.equal(base.searchParams.get('rel'), 'a&b'); assert.equal(base.searchParams.get('au'), 'base');
  const au = new URL(navigation.relationListHref('rp', 'relation', '학원 AU'), 'https://home.example');
  assert.equal(au.searchParams.get('au'), '학원 AU');
  const room = new URL(navigation.rpRoomHref({ id: 'room & one', relId: 'rel', auId: 'au' }), 'https://home.example');
  assert.equal(room.searchParams.get('room'), 'room & one'); assert.equal(room.searchParams.get('rel'), 'rel');
});
test('relation lists exclude unrelated content and distinguish the original setting from each AU', () => {
  const rows = [{ id: 'base', relId: 'a' }, { id: 'au', relId: 'a', auId: 'school' }, { id: 'other', relId: 'b' }];
  assert.deepEqual(rows.filter(r => navigation.matchesRelation(r, 'a')).map(r => r.id), ['base', 'au']);
  assert.deepEqual(rows.filter(r => navigation.matchesRelation(r, 'a', 'base')).map(r => r.id), ['base']);
  assert.deepEqual(rows.filter(r => navigation.matchesRelation(r, 'a', 'school')).map(r => r.id), ['au']);
});
test('roleplay sends persisted notifications only from the explicit end-turn button and deep-links the target room', () => {
  const page = text('src/app/rp/page.tsx');
  const send = page.slice(page.indexOf('  const send = async'), page.indexOf('  const endTurn ='));
  assert.doesNotMatch(send, /pushNotif\(/);
  assert.match(page, /type: 'rpturn'.*href: rpRoomHref\(sel\)/);
  assert.match(page, /useSearchParams\(\)/);
  assert.match(page, /requestedRoom \|\| relFilter \? 'all' : 'ongoing'/);
  assert.match(text('src/app/rels/[id]/page.tsx'), /href=\{rpRoomHref\(rm\)\}/);
  assert.match(text('src/app/rels/[id]/page.tsx'), /href=\{logPath\(l\)\}/);
  assert.doesNotMatch(text('src/components/shell/TopBar.tsx'), /setInterval|subscribeTable/);
});
