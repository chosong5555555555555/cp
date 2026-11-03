import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const text = path => readFileSync(new URL(`../${path}`, import.meta.url),'utf8');
function load(path, imports = {}, globals = {}) {
  const code = ts.transpileModule(text(path), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
  }).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module,exports:module.exports,require:name => {
    if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
    return imports[name];
  },console,Event,CustomEvent, ...globals});
  return module.exports;
}
function fixture() {
  const state = {user:'a',storage:new Map(),fail:false,created:0,notes:[]};
  const window = new EventTarget();
  const localStorage = {
    getItem:key => state.storage.get(key) ?? null,
    setItem:(key,value) => {if(state.fail)throw new Error('quota');state.storage.set(key,value);},
    removeItem:key => {if(state.fail)throw new Error('denied');state.storage.delete(key);},
  };
  const prefs = load('src/lib/notificationSounds.ts',{'./currentUser':{currentUserId:() => state.user}}, {window,localStorage});
  class AudioContext {
    constructor(){state.created++;this.state='running';this.currentTime=10;this.destination={};}
    async resume(){this.state='running';}
    createOscillator(){
      const note = {frequency:{value:0},connect(){},disconnect(){},start(at){note.at=at;},stop(){}};
      state.notes.push(note);return note;
    }
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(value,at){state.notes.at(-1).gain=value;state.notes.at(-1).rampAt=at;}},connect(){},disconnect(){}};}
  }
  window.AudioContext = AudioContext;
  const engine = load('src/lib/msgSound.ts',{'./notificationSounds':prefs},{window,localStorage});
  return {state,window,prefs,engine};
}

test('default settings preserve the original chime for every alert category', () => {
  const {prefs} = fixture();
  const settings = prefs.readSoundSettings();
  assert.equal(Object.keys(settings).length,8);
  for (const kind of prefs.SOUND_KINDS) assert.equal(settings[kind].preset,'chime');
});

test('per-category choices and volumes are saved independently for each account', () => {
  const {prefs,state} = fixture();
  assert.equal(prefs.setSoundChoice('rpturn',{preset:'bell',volume:35}),true);
  assert.equal(prefs.soundChoice('rpturn').preset,'bell');
  assert.equal(prefs.soundChoice('rpturn').volume,35);
  assert.equal(prefs.soundChoice('rp').preset,'chime');
  state.user='b'; assert.equal(prefs.soundChoice('rpturn').preset,'chime');
  state.user='a'; assert.equal(prefs.soundChoice('rpturn').preset,'bell');
});

test('invalid or corrupted stored settings fall back safely and volume is clamped', () => {
  const {prefs,state} = fixture();
  for (const value of ['{', 'null','[]','42']) {
    state.storage.set('ohome.soundprefs.v1:a',value);
    assert.equal(prefs.soundChoice('rp').preset,'chime');
  }
  state.storage.set('ohome.soundprefs.v1:a',JSON.stringify({rp:{preset:'not-a-sound',volume:-8},rpturn:{preset:'bell',volume:240}}));
  assert.equal(prefs.soundChoice('rp').preset,'chime');
  assert.equal(prefs.soundChoice('rp').volume,0);
  assert.equal(prefs.soundChoice('rpturn').volume,100);
});

test('none, zero volume and repeated categories are excluded from audible batches', () => {
  const {prefs} = fixture();
  prefs.setSoundChoice('rp',{preset:'none'});prefs.setSoundChoice('rpooc',{volume:0});
  assert.deepEqual(Array.from(prefs.audibleKinds(['rp','rpooc','rpturn','rpturn','comment'])),['rpturn','comment']);
});

test('storage failure is returned to the UI, not falsely reported as saved', () => {
  const {prefs,state} = fixture();state.fail=true;
  assert.equal(prefs.setSoundChoice('comment',{preset:'ping'}),false);
  assert.equal(prefs.resetSoundSettings(),false);
});

test('saving and resetting sound settings broadcasts to the bell and RP controls', () => {
  const {prefs,window} = fixture();let events=0;
  window.addEventListener('ohome-msgsound',() => events++);
  prefs.setSoundChoice('memo',{preset:'wood'});
  prefs.resetSoundSettings();
  assert.equal(events,2); assert.equal(prefs.soundChoice('memo').preset,'chime');
});

test('automatic sounds do not create an AudioContext without an initial user gesture', () => {
  const {state,engine} = fixture();engine.playMsgTones(['rp','rpturn']);
  assert.equal(state.created,0);assert.equal(state.notes.length,0);
});

test('click preview creates the audio context and plays the selected preset', async () => {
  const {state,prefs,engine} = fixture();prefs.setSoundChoice('rpturn',{preset:'ping'});
  assert.equal(await engine.previewMsgTone('rpturn'),true);
  assert.equal(state.created,1);assert.equal(state.notes.length,1);
  assert.equal(state.notes[0].frequency.value,1568);
});

test('all six presets have valid finite patterns and can be previewed', async () => {
  const {state,prefs,engine} = fixture();
  for (const option of prefs.SOUND_PRESETS.filter(p => p.id !== 'none')) {
    prefs.setSoundChoice('comment',{preset:option.id});
    const count=state.notes.length;
    assert.equal(await engine.previewMsgTone('comment'),true);
    assert.ok(state.notes.length>count);
    for (const note of prefs.TONE_PATTERNS[option.id]) {
      assert.ok(note.frequency>0 && Number.isFinite(note.frequency));
      assert.ok(note.duration>.012);assert.ok(note.offset>=0);
    }
  }
});

test('global mute suppresses real alerts but still allows explicit preview', async () => {
  const {state,engine} = fixture();await engine.previewMsgTone('rp');
  engine.setMsgSoundOn(false);let count=state.notes.length;
  engine.playMsgTones(['rp','rpturn']);assert.equal(state.notes.length,count);
  assert.equal(await engine.previewMsgTone('rpturn'),true);
  assert.ok(state.notes.length>count);
});

test('silent categories cannot preview and do not enqueue audible sounds', async () => {
  const {state,prefs,engine} = fixture();
  prefs.setSoundChoice('rp',{preset:'none'});
  assert.equal(await engine.previewMsgTone('rp'),false);assert.equal(state.notes.length,0);
  prefs.setSoundChoice('rp',{preset:'bell',volume:0});
  assert.equal(await engine.previewMsgTone('rp'),false);
});

test('different categories use distinct selected sounds and do not overlap within a batch', async () => {
  const {state,prefs,engine} = fixture();
  prefs.setSoundChoice('rp',{preset:'ping'});prefs.setSoundChoice('rpturn',{preset:'wood'});
  await engine.previewMsgTone('rp');state.notes.length=0;
  engine.playMsgTones(['rp','rp','rpturn']);
  assert.equal(state.notes.length,3);
  assert.equal(state.notes[0].frequency.value,1568);
  assert.equal(state.notes[1].frequency.value,440);
  assert.ok(state.notes[1].at-state.notes[0].at>=.64);
});

test('message and notification subscriptions route category sounds without double-playing RP', () => {
  const effects=[],refs=[],sent=[];let refIndex=0;
  const data={rows:[],notifs:[],now:10000};
  const events=new EventTarget();
  class Clock extends Date {static now(){return data.now;}}
  const api = load('src/components/shell/MsgSound.tsx',{
    react:{useEffect:fn=>effects.push(fn),useRef:value=>refs[refIndex++]??(refs[refIndex-1]={current:value})},
    '@/lib/auth':{useAuth:()=>({user:{id:'me'}})},
    '@/lib/postStore':{useLocalList:key=>[
      key==='msgs'?data.rows:key==='ohome.rp.v1'?[{id:'room',createdBy:'me',memberIds:['me','them']}]:[],null,true,
    ]},
    '@/lib/rpStore':{RP_MSG_KEY:'msgs',rpMemberIds:room=>room.memberIds},
    '@/lib/charStore':{},
    '@/lib/msgSound':{armMsgSound(){},playMsgTones:kinds=>sent.push(Array.from(kinds))},
    '@/lib/notificationSounds':{isSoundKind:kind=>['comment','thread','memo','diary','guest'].includes(kind)},
    '@/lib/notifStore':{NOTIF_EVENT:'notify',readNotifs:()=>data.notifs,notifSettings:()=>({rp:true,rpturn:true,comment:true})},
    '@/lib/home':{currentHomeId:()=> 'home'},
  },{window:events,Date:Clock});
  api.MsgSound();const cleanups=effects.map(fn=>fn());
  data.rows.push({id:'m1',roomId:'room',authorId:'them',kind:'char'}, {id:'m2',roomId:'room',authorId:'them',kind:'ooc'}, {id:'m3',roomId:'room',authorId:'them',kind:'turn'});
  effects[2]();assert.deepEqual(sent.at(-1),['rp','rpooc','rpturn']);
  data.now+=9000;data.notifs=[{id:'rp',type:'rp',toUserId:'me',date:'1'}, {id:'turn',type:'rpturn',toUserId:'me',date:'1'}, {id:'comment',type:'comment',toUserId:'me',date:'1'}];
  events.dispatchEvent(new Event('notify'));
  assert.deepEqual(sent.at(-1),['comment']);
  const count=sent.length;events.dispatchEvent(new Event('notify'));
  assert.deepEqual(sent.at(-1),[]);
  data.notifs[2].date='2';events.dispatchEvent(new Event('notify'));
  assert.deepEqual(sent.at(-1),['comment']);
  cleanups.forEach(fn=>fn?.());
});

test('settings are discoverable and clearly distinguish website audio from OS push sounds', () => {
  const ui=text('src/components/shell/SoundSettings.tsx');
  assert.match(ui,/미리듣기/);assert.match(ui,/type="range"/);
  assert.match(ui,/시스템 푸시 소리는 브라우저·OS 설정/);
  assert.match(text('src/components/shell/TopBar.tsx'),/mypage#notification-sounds/);
  assert.match(text('src/app/mypage/page.tsx'),/<SoundSettings \/>/);
});
