'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { KSelect, KToggle } from '@/components/ui/Kit';
import { isMsgSoundOn, setMsgSoundOn, MSG_SOUND_EVT, previewMsgTone } from '@/lib/msgSound';
import {
  SOUND_KINDS, SOUND_LABELS, SOUND_PRESETS, readSoundSettings, setSoundChoice, resetSoundSettings,
  type SoundSettings as Choices, type SoundKind, type SoundPreset,
} from '@/lib/notificationSounds';

export function SoundSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<Choices | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const refresh = () => { setSettings(readSoundSettings()); setEnabled(isMsgSoundOn()); };
    refresh();
    window.addEventListener(MSG_SOUND_EVT, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(MSG_SOUND_EVT, refresh); window.removeEventListener('storage', refresh); };
  }, [user?.id]);
  if (!user || !settings) return null;
  const change = (kind: SoundKind, patch: Parameters<typeof setSoundChoice>[1]) => {
    if (setSoundChoice(kind, patch)) {
      setSettings(readSoundSettings());
      setStatus('설정이 자동 저장되었습니다');
    } else setStatus('설정을 저장하지 못했습니다. 브라우저 저장소 허용 여부를 확인해 주세요.');
  };
  const preview = async (kind: SoundKind) => {
    const ok = await previewMsgTone(kind);
    setStatus(ok ? `${SOUND_LABELS[kind]} 알림음 미리듣기` : '재생하지 못했습니다. 탭 음소거·브라우저의 소리 허용 설정을 확인해 주세요.');
  };
  return (
    <section className="panel sound-settings" id="notification-sounds" aria-labelledby="sound-settings-title">
      <div className="sound-settings-head">
        <div>
          <h4 id="sound-settings-title">알림 소리 설정</h4>
          <p className="hint">알림 종류마다 소리와 음량을 고를 수 있습니다. 변경하면 바로 저장됩니다.</p>
        </div>
        <KToggle label="전체 소리" checked={enabled} onChange={setMsgSoundOn} />
      </div>
      {!enabled && <p className="sound-settings-muted">현재 실제 알림음은 모두 꺼져 있습니다. 미리듣기는 사용할 수 있습니다.</p>}
      <div className="sound-settings-list">
        {SOUND_KINDS.filter(kind => kind !== 'guest').map(kind => {
          const choice = settings[kind];
          return (
            <div className="sound-settings-row" key={kind}>
              <span className="sound-settings-name">{SOUND_LABELS[kind]}</span>
              <div className="sound-settings-preset" aria-label={`${SOUND_LABELS[kind]} 소리`}>
                <KSelect value={choice.preset} onChange={value => change(kind, { preset: value as SoundPreset })}
                  minWidth={145} maxWidth={170} options={SOUND_PRESETS.map(p => ({ value: p.id, label: p.label }))} />
              </div>
              <label className="sound-settings-volume">
                <span className="sound-volume-label">음량</span>
                <input type="range" min={0} max={100} step={1} value={choice.volume}
                  aria-label={`${SOUND_LABELS[kind]} 음량`} disabled={choice.preset === 'none'}
                  onChange={e => change(kind, { volume: Number(e.target.value) })} />
                <output>{choice.volume}%</output>
              </label>
              <button type="button" className="btn btn-ghost sound-preview" onClick={() => void preview(kind)}
                aria-label={`${SOUND_LABELS[kind]} 미리듣기`} disabled={choice.preset === 'none' || choice.volume === 0}>미리듣기</button>
            </div>
          );
        })}
      </div>
      <div className="sound-settings-footer">
        <p className="hint">소리·음량은 이 브라우저의 현재 계정에 저장됩니다. 전체 소리 켜기/끄기는 상단 종 메뉴·역극의 종 버튼과 연결됩니다.<br />
          사이트가 열려 있을 때 재생되는 알림음 설정입니다. PC·모바일 시스템 푸시 소리는 브라우저·OS 설정을 따릅니다.</p>
        <button type="button" className="btn btn-ghost" onClick={() => {
          setStatus(resetSoundSettings() ? '소리와 음량을 기본값으로 복원했습니다' : '기본값을 저장하지 못했습니다');
          setSettings(readSoundSettings());
        }}>기본값 복원</button>
      </div>
      <p className="hint sound-settings-status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
