import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';

const text = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function loadTs(path, imports, globals = {}) {
  const code = ts.transpileModule(text(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, require: name => {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    }, Buffer, URL, Uint8Array, ArrayBuffer, console, setTimeout, clearTimeout,
    atob: value => Buffer.from(value, 'base64').toString('binary'), ...globals,
  }, { filename: path });
  return module.exports;
}
function clientFixture(extraGlobals = {}) {
  const state = { rows: [], requests: [], sync: [], reads: 0, lookups: [], user: 'me', home: 'home-a' };
  const api = loadTs('src/lib/push.ts', {
    './backend': { backend: () => ({ authToken: async () => 'session-token' }), isServerMode: () => true },
    './db': {
      fetchList: async (coll, options) => { assert.equal(coll, 'push_subs'); assert.ok(options?.authorId); state.reads++; state.lookups.push(options); return state.rows.filter(s => s.authorId === options.authorId); },
      syncList: async (...args) => state.sync.push(args),
    },
    './currentUser': { currentUserId: () => state.user },
    './home': { currentHomeId: () => state.home },
    './settingStore': { getSetting: () => ({ favicon: 'https://assets.example/icon.png' }) },
  }, {
    window: {}, navigator: { userAgent: 'Mozilla/5.0 (Windows) Chrome/140.0', platform: 'Win32', maxTouchPoints: 0 },
    location: { origin: 'https://home.example' },
    fetch: async (url, options) => {
      state.requests.push({ url, ...options, body: JSON.parse(options.body) });
      if (state.networkError) throw new Error('network offline');
      return { ok: !state.error, status: state.status ?? 200, json: async () => state.error
        ? { error: state.error }
        : { sent: state.sent ?? 1, failed: state.failed ?? 0, codes: state.codes ?? [], dead: state.dead ?? [] } };
    },
    ...extraGlobals,
  });
  return { api, state };
}
const sub = (id, userId, extra = {}) => ({
  id, userId, authorId: userId, kind: 'pc', on: true, endpoint: `https://push.example/${id}`,
  keys: { p256dh: 'key', auth: 'auth' }, visibility: 'member', ...extra,
});

test('concurrent sends to the same recipient share the in-flight owner lookup', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('one', 'receiver')];
  await Promise.all(Array.from({length: 8}, () => api.webPushTo(['receiver'], {title:'test',url:'/'})));
  assert.equal(state.reads, 1);
  assert.equal(state.requests.length, 8);
});

test('multiple recipients query only their own subscriptions and reuse each recipient cache', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('a', 'alice'), sub('b', 'bob'), sub('ignored', 'unrelated')];
  await Promise.all([
    api.webPushTo(['alice'], {title:'test',url:'/'}),
    api.webPushTo(['alice','bob','alice'], {title:'test',url:'/'}),
    api.webPushTo(['bob'], {title:'test',url:'/'}),
  ]);
  assert.equal(state.reads, 2);
  assert.deepEqual(state.lookups.map(x => x.authorId).sort(), ['alice','bob']);
  assert.equal(state.requests.some(r => JSON.stringify(r.body).includes('ignored')), false);
});

test('an empty subscription result is cached across sequential and concurrent sends', async () => {
  const { api, state } = clientFixture();
  await api.webPushTo(['not-registered'], {title:'test',url:'/'});
  await Promise.all(Array.from({length: 5}, () => api.webPushTo(['not-registered'], {title:'test',url:'/'})));
  assert.equal(state.reads, 1);
  assert.equal(state.requests.length, 0);
});

test('a home switch while lookup is pending cannot send using the previous home subscriptions', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('old', 'receiver')];
  const pending = api.webPushTo(['receiver'], {title:'test',url:'/'});
  state.home = 'new-home';
  assert.equal(await pending, null);
  assert.equal(state.requests.length, 0);
  await api.webPushTo(['receiver'], {title:'test',url:'/'});
  assert.equal(state.reads, 2);
});

test('web push sends only enabled, complete subscriptions for the requested recipients', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('yes', 'receiver'), sub('off', 'receiver', { on: false }), sub('other', 'other'), sub('bad', 'receiver', { keys: {} })];
  const result = await api.webPushTo(['receiver'], { title: '새 댓글', body: '내용', url: '/board/one', kind: 'comment' });
  assert.equal(result.sent, 1);
  assert.equal(state.requests.length, 1);
  const request = state.requests[0];
  assert.equal(request.headers.Authorization, 'Bearer session-token');
  assert.deepEqual(request.body.subs.map(s => s.endpoint), ['https://push.example/yes']);
  assert.equal(request.body.payload.url, 'https://home.example/board/one');
  assert.equal(request.body.payload.icon, 'https://assets.example/icon.png');
});

test('hidden notifications are sent separately without leaking the original title or body', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('normal', 'receiver'), sub('hidden', 'receiver', { hide: true })];
  await api.webPushTo(['receiver'], { title: '비밀 제목', body: '비밀 내용', url: '/rp', kind: 'rp', tag: 'room' });
  assert.equal(state.requests.length, 2);
  const hidden = state.requests.find(r => r.body.subs[0].endpoint.endsWith('/hidden'));
  assert.equal(hidden.body.payload.title, '역극 새 메시지');
  assert.equal(hidden.body.payload.body, '내용은 홈에서 확인해 주세요');
  assert.equal(hidden.body.payload.tag, 'room');
  assert.doesNotMatch(JSON.stringify(hidden.body), /비밀/);
});

test('subscription cache is scoped to both the active home and the signed-in account', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('cached', 'receiver')];
  await api.webPushTo(['receiver'], { title: 'test', url: '/' });
  await api.webPushTo(['receiver'], { title: 'test', url: '/' });
  assert.equal(state.reads, 1);
  state.home = 'home-b';
  await api.webPushTo(['receiver'], { title: 'test', url: '/' });
  state.user = 'another-user';
  await api.webPushTo(['receiver'], { title: 'test', url: '/' });
  assert.equal(state.reads, 3);
});

test('expired subscriptions are removed only when owned by the current user', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('mine', 'me'), sub('theirs', 'receiver')];
  state.dead = state.rows.map(s => s.endpoint);
  await api.webPushTo(['me', 'receiver'], { title: 'test', url: '/' });
  assert.equal(state.sync.length, 1);
  assert.deepEqual(Array.from(state.sync[0][2], s => s.id), ['theirs']);
});

test('no enabled recipients means no network send', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('off', 'receiver', { on: false })];
  assert.equal(await api.webPushTo(['receiver'], { title: 'test', url: '/' }), null);
  assert.equal(state.requests.length, 0);
});

function routeFixture() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const state = { env: { PUSH_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url') }, config: null, sent: [], authOk: false };
  const route = loadTs('src/app/api/push/route.ts', {
    'next/server': { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200, headers: options.headers }) } },
    'web-push': {
      setVapidDetails: () => {},
      sendNotification: async (s, payload, options) => {
        if (s.endpoint.endsWith('/expired')) throw { statusCode: 410 };
        state.sent.push({ s, payload: JSON.parse(payload), options });
      },
    },
    'node:crypto': crypto,
    '@/lib/siteMeta': { serverSideConfig: async () => state.config },
  }, {
    process: { env: state.env },
    fetch: async () => ({ ok: state.authOk, json: async () => ({ id: 'verified-user' }) }),
  });
  const request = body => ({ headers: new Headers({ authorization: 'Bearer token', host: 'home.example' }), json: async () => body });
  return { route, state, request };
}

test('API exposes only the public VAPID key and disables invalid or absent private keys', async () => {
  const { route, state } = routeFixture();
  const valid = await route.GET();
  assert.equal(valid.body.enabled, true);
  assert.equal(Buffer.from(valid.body.publicKey, 'base64url').length, 65);
  assert.equal(valid.body.privateKey, undefined);
  state.env.PUSH_VAPID_PRIVATE_KEY = 'invalid';
  assert.equal((await route.GET()).body.enabled, false);
  delete state.env.PUSH_VAPID_PRIVATE_KEY;
  assert.equal((await route.GET()).body.enabled, false);
});

test('API never bypasses authentication when server connection configuration is absent', async () => {
  const { route, state, request } = routeFixture();
  assert.equal((await route.POST(request({}))).status, 401);
  state.config = { kind: 'supabase', url: 'https://db.example', anonKey: 'anon' };
  assert.equal((await route.POST(request({}))).status, 401);
  assert.equal(state.sent.length, 0);
});

test('authenticated API signs sends and reports expired endpoints; invalid endpoints are ignored', async () => {
  const { route, state, request } = routeFixture();
  state.config = { kind: 'supabase', url: 'https://db.example', anonKey: 'anon' };
  state.authOk = true;
  const response = await route.POST(request({
    subs: [sub('ok', 'receiver'), sub('expired', 'receiver'), { endpoint: 'http://unsafe.example', keys: { p256dh: 'key', auth: 'auth' } }],
    payload: { title: 'test', body: 'content', url: 'https://home.example/rp' },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.body.sent, 1);
  assert.equal(response.body.failed, 1);
  assert.deepEqual(Array.from(response.body.dead), ['https://push.example/expired']);
  assert.equal(state.sent[0].options.TTL, 86400);
});

test('API rejects invalid JSON before sending', async () => {
  const { route, state, request } = routeFixture();
  state.config = { kind: 'supabase', url: 'https://db.example', anonKey: 'anon' };
  state.authOk = true;
  const req = request({});
  req.json = async () => { throw new SyntaxError('bad json'); };
  assert.equal((await route.POST(req)).status, 400);
  assert.equal(state.sent.length, 0);
});

test('service worker displays payload and clicking focuses and navigates an existing tab', async () => {
  const handlers = {};
  const events = [];
  vm.runInNewContext(text('public/sw.js'), {
    URL, self: {
      location: { origin: 'https://home.example' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      registration: { showNotification: async (title, options) => events.push({ title, options }) },
      clients: {
        matchAll: async () => [{ url: 'https://home.example/', navigate: url => events.push({ navigate: url }), focus: () => events.push({ focused: true }) }],
        openWindow: () => { throw new Error('Should reuse the existing tab'); },
      },
    },
  });
  let pending;
  handlers.push({ data: { json: () => ({ title: '알림', body: '내용', url: '/rp', tag: 'room' }) }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(events[0].title, '알림');
  assert.equal(events[0].options.data.url, '/rp');
  handlers.notificationclick({ notification: { data: { url: '/rp' }, close: () => {} }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(events[1].navigate, 'https://home.example/rp');
  assert.equal(events[2].focused, true);
});

test('both database rule sources and schemas include push subscriptions without losing multi-home support', () => {
  for (const path of ['firebase/firestore.rules', 'src/lib/firebaseRules.ts']) {
    const rules = text(path);
    assert.match(rules, /'push_subs'/);
    assert.match(rules, /match \/homes\/\{homeId\}/);
    assert.match(rules, /'thread_posts', 'videos', 'rp_typing'/);
  }
  for (const path of ['supabase/schema.sql', 'src/lib/schemaSql.ts']) assert.match(text(path), /'push_subs'/);
  assert.match(text('src/app/mypage/page.tsx'), /<PushSettings \/>/);
  assert.match(text('src/app/settings/page.tsx'), /<PushAdminRow \/>/);
  assert.match(text('src/app/layout.tsx'), /manifest: '\/manifest.webmanifest'/);
});


test('fresh desktop test targets only this browser, not another registered PC', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('this-pc','me'), sub('other-pc','me')];
  const result = await api.webPushTo(['me'], {title:'test', url:'/mypage'}, {endpoint:'https://push.example/this-pc', fresh:true});
  assert.equal(result.sent, 1);
  assert.deepEqual(state.requests[0].body.subs.map(s => s.endpoint), ['https://push.example/this-pc']);
  assert.equal(state.requests[0].keepalive, true);
});

test('missing desktop endpoint produces an actionable error, not a false success from another PC', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('other-pc','me')];
  const result = await api.webPushTo(['me'], {title:'test',url:'/'}, {endpoint:'https://push.example/missing',fresh:true});
  assert.deepEqual(Array.from(result.errors), ['no-targets']);
  assert.equal(state.requests.length, 0);
});

test('registration explicitly invalidates an empty cache without retrying every normal send', async () => {
  const { api, state } = clientFixture();
  await api.webPushTo(['me'], {title:'test',url:'/'});
  state.rows = [sub('new-pc','me')];
  api.dropSubsCache();
  const result = await api.webPushTo(['me'], {title:'test',url:'/'});
  assert.equal(result.sent, 1);
});

test('HTTP configuration and auth failures remain visible in diagnostic results', async () => {
  for (const error of ['no-key','unauthorized']) {
    const { api, state } = clientFixture();
    state.rows = [sub('pc','me')]; state.error = error; state.status = 503;
    const result = await api.webPushTo(['me'], {title:'test',url:'/'});
    assert.equal(result.sent, 0); assert.equal(result.failed, 1);
    assert.equal(result.errors[0], error);
    assert.notEqual(api.pushErrorMessage(error), error);
  }
});

test('expired VAPID rejection and connection errors are not swallowed', async () => {
  const { api, state } = clientFixture();
  state.rows = [sub('pc','me')]; state.sent = 0; state.failed = 1; state.codes = [403];
  assert.equal((await api.webPushTo(['me'], {title:'test',url:'/'})).errors[0], 'push-403');
  state.networkError = true;
  assert.equal((await api.webPushTo(['me'], {title:'test',url:'/'})).errors[0], 'network');
});

test('more than 30 desktop subscriptions are chunked rather than silently truncated', async () => {
  const { api, state } = clientFixture();
  state.rows = Array.from({length:31}, (_,i) => sub(`pc-${i}`, 'receiver'));
  await api.webPushTo(['receiver'], {title:'test',url:'/'});
  assert.deepEqual(state.requests.map(r => r.body.subs.length), [30,1]);
});

test('server sends high urgency with a finite push-service timeout', async () => {
  const {route,state,request} = routeFixture();
  state.config = {kind:'supabase', url:'https://db.example', anonKey:'anon'}; state.authOk = true;
  await route.POST(request({subs:[sub('ok','receiver'),sub('expired','receiver')],payload:{title:'test'}}));
  assert.equal(state.sent[0].options.urgency, 'high');
  assert.equal(state.sent[0].options.timeout, 10000);
});

function browserFixture({oldKey = [1,2,3], expectedKey = [1,2,3], expired = false, permission = 'granted'} = {}) {
  const calls = [];
  const oldSub = { endpoint:'old', expirationTime:expired ? 1 : null,
    options:{applicationServerKey:new Uint8Array(oldKey).buffer},
    unsubscribe:async () => {calls.push('unsubscribe');return true;} };
  const reg = { update:async () => {calls.push('update');},
    showNotification:async (title,options) => calls.push({title,options}),
    pushManager:{getSubscription:async () => oldSub, subscribe:async () => {calls.push('subscribe');return {endpoint:'new'};}},
  };
  const {api} = clientFixture({window:{PushManager:{},Notification:{}},
    Notification:{permission,requestPermission:async () => {calls.push('permission');return permission;}},
    navigator:{userAgent:'Windows Chrome',platform:'Win32',maxTouchPoints:0,serviceWorker:{
      register:async (url,options) => {calls.push({url,options});return reg;},ready:Promise.resolve(reg),
    }},
  });
  return {api,calls,oldSub,reg,key:Buffer.from(expectedKey).toString('base64url')};
}

test('an existing same-key PC subscription is reused without another permission prompt', async () => {
  const {api,key,calls,oldSub} = browserFixture();
  assert.equal(await api.subscribeBrowser(key),oldSub);
  assert.equal(calls.includes('permission'),false);
  assert.equal(calls.includes('unsubscribe'),false);
  assert.equal(calls[0].options.updateViaCache,'none');
});

test('VAPID rotation and expiry renew the browser subscription', async () => {
  for (const config of [{expectedKey:[3,2,1]}, {expired:true}]) {
    const {api,key,calls} = browserFixture(config);
    assert.equal((await api.subscribeBrowser(key)).endpoint,'new');
    assert.ok(calls.includes('unsubscribe')); assert.ok(calls.includes('subscribe'));
  }
});

test('denied notification permission cannot create a subscription', async () => {
  const {api,key,calls} = browserFixture({permission:'denied'});
  await assert.rejects(api.subscribeBrowser(key),/permission-denied/);
  assert.equal(calls.includes('subscribe'),false);
});

test('local popup test uses the active service worker independently of server delivery', async () => {
  const {api,calls} = browserFixture();
  await api.localPushTest();
  const notification = calls.find(c => c.title);
  assert.equal(notification.title,'이 기기 팝업 확인');
  assert.equal(notification.options.requireInteraction,true);
});

test('desktop settings expose repair, separate popup/delivery tests and per-browser registration state', () => {
  const settings = text('src/components/shell/PushSettings.tsx');
  assert.match(settings,/이 기기 등록 복구/);
  assert.match(settings,/팝업 표시 확인/);
  assert.match(settings,/이 기기로 서버 배달 테스트/);
  assert.match(settings,/perm === 'granted' && !!thisSub\?\.on/);
  assert.match(settings,/await persistSubs\(next\)/);
  assert.match(settings,/endpoint, fresh: true/);
});

test('saved PC subscription updates immediately without realtime and cannot be overwritten by an older fetch', async () => {
  const effects = [], updates = [];
  let stateIndex = 0, resolveFetch;
  const events = new EventTarget();
  const api = loadTs('src/lib/postStore.ts', {
    react: {
      useCallback: fn => fn,
      useEffect: fn => effects.push(fn),
      useRef: current => ({ current }),
      useState: initial => {
        const index = stateIndex++;
        return [typeof initial === 'function' ? initial() : initial, value => updates.push({ index, value })];
      },
    },
    './supabase': { isServerMode: () => true },
    './db': {
      TABLE_OF: { 'ohome.pushsubs.v1': 'push_subs' },
      fetchList: () => new Promise(resolve => { resolveFetch = resolve; }),
      subscribeTable: () => () => {},
    },
    './currentUser': { currentUserId: () => 'me' },
  }, { window: events });
  api.useLocalList('ohome.pushsubs.v1', []);
  const cleanup = effects[0]();
  const saved = [sub('registered-pc','me')];
  events.dispatchEvent(new CustomEvent('ohome-list', { detail: { key:'ohome.pushsubs.v1', next:saved } }));
  resolveFetch([]);
  await Promise.resolve(); await Promise.resolve();
  const listUpdates = updates.filter(x => x.index === 0);
  assert.equal(listUpdates.length, 1);
  assert.equal(listUpdates[0].value, saved);
  cleanup();
  events.dispatchEvent(new CustomEvent('ohome-list', { detail: { key:'ohome.pushsubs.v1', next:[] } }));
  assert.equal(updates.filter(x => x.index === 0).length, 1);
});
