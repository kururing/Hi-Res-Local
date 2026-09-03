import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useSettings } from '../../context/SettingsContext';
import { usePlayer } from '../../context/PlayerContext';
import { t } from '../../i18n';
import { Check, Trash2, Plus } from 'lucide-react';
import { isEqualizerAvailable } from '../../services/playbackDisplay';
import { PlatformUnsupportedError, usePlatform } from '../../platform';

const FREQUENCY_LABELS = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
const FLAT_GAINS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const EQ_PREVIEW_INTERVAL_MS = 60;

function gainsAreEqual(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((gain, index) => gain === right[index]);
}

export const EqualizerModal: React.FC = () => {
  const { isEqualizerOpen, setIsEqualizerOpen, engineStatus } = usePlayer();
  const {
    settings,
    updateSettings,
    eqPresets,
    saveCustomEqPreset,
    deleteCustomEqPreset,
    applyEqPreset,
  } = useSettings();
  const { runtime, audioConfiguration } = usePlatform();
  const dspSupported = runtime !== 'web';

  const [customName, setCustomName] = useState('');
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const eqAvailable = dspSupported && isEqualizerAvailable(engineStatus, settings);
  const configuredGains = settings.eq_preset_id === 'custom'
    ? settings.eq_custom_gains
    : (eqPresets.find(preset => preset.id === settings.eq_preset_id)?.gains || FLAT_GAINS);
  const [draftGains, setDraftGains] = useState<number[]>(() => [...configuredGains]);
  const draftGainsRef = useRef(draftGains);
  const isAdjustingEqRef = useRef(false);
  const pendingPreviewRef = useRef<number[] | null>(null);
  const previewTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isAdjustingEqRef.current || gainsAreEqual(draftGainsRef.current, configuredGains)) return;
    const nextGains = [...configuredGains];
    draftGainsRef.current = nextGains;
    setDraftGains(nextGains);
  }, [configuredGains]);

  const clearPendingPreview = useCallback(() => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    pendingPreviewRef.current = null;
  }, []);

  useEffect(() => clearPendingPreview, [clearPendingPreview]);

  const applyEqualizer = useCallback((enabled: boolean, gains: number[]) => {
    if (!dspSupported) return;
    void audioConfiguration.setEqualizer(enabled, gains).catch(error => {
      if (error instanceof PlatformUnsupportedError) {
        console.error('Equalizer is not available in this runtime', error);
        return;
      }
      console.error('Failed to apply equalizer', error);
    });
  }, [audioConfiguration, dspSupported]);

  const scheduleEqPreview = useCallback((gains: number[]) => {
    pendingPreviewRef.current = [...gains];
    if (previewTimerRef.current !== null) return;

    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      const nextGains = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (!nextGains) return;
      applyEqualizer(true, nextGains);
    }, EQ_PREVIEW_INTERVAL_MS);
  }, [applyEqualizer]);

  const commitEqChanges = useCallback(() => {
    if (!isAdjustingEqRef.current) return;
    isAdjustingEqRef.current = false;
    clearPendingPreview();
    updateSettings({
      eq_preset_id: 'custom',
      eq_custom_gains: [...draftGainsRef.current],
      eq_enabled: true,
    });
  }, [clearPendingPreview, updateSettings]);

  const cancelEqChanges = useCallback(() => {
    if (!isAdjustingEqRef.current) return;
    isAdjustingEqRef.current = false;
    clearPendingPreview();
    const nextGains = [...configuredGains];
    draftGainsRef.current = nextGains;
    setDraftGains(nextGains);
    applyEqualizer(settings.eq_enabled, nextGains);
  }, [applyEqualizer, clearPendingPreview, configuredGains, settings.eq_enabled]);

  useEffect(() => {
    if (!eqAvailable && isEqualizerOpen) {
      setIsEqualizerOpen(false);
    }
  }, [eqAvailable, isEqualizerOpen, setIsEqualizerOpen]);

  if (!isEqualizerOpen) return null;

  const handleBandChange = (index: number, newGain: number) => {
    const nextGains = [...draftGainsRef.current];
    nextGains[index] = Math.max(-12, Math.min(12, Math.round(newGain * 2) / 2));
    isAdjustingEqRef.current = true;
    draftGainsRef.current = nextGains;
    setDraftGains(nextGains);
    scheduleEqPreview(nextGains);
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    commitEqChanges();
    saveCustomEqPreset(customName.trim(), draftGainsRef.current);
    setCustomName('');
    setIsSavingCustom(false);
  };

  return (
    <Modal
      isOpen={isEqualizerOpen}
      onClose={() => {
        commitEqChanges();
        setIsEqualizerOpen(false);
      }}
      title={t('settings_eq_section', settings.language)}
      maxWidth="2xl"
    >
      <div className="flex flex-col gap-6">
        {/* Toggle & Preset Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-oled-base/60 border border-brand-border">
          <div className="flex items-center gap-3">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.eq_enabled}
                onChange={e => updateSettings({ eq_enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-accent"></div>
            </label>
            <span className="font-semibold text-sm">
              {settings.eq_enabled ? 'Equalizer ON' : 'Equalizer OFF'}
            </span>
          </div>

          {/* Preset Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-brand-muted">{t('settings_eq_preset', settings.language)}:</span>
            <select
              value={settings.eq_preset_id}
              onChange={e => applyEqPreset(e.target.value)}
              className="bg-oled-card border border-brand-border rounded-lg px-3 py-1.5 text-xs text-brand-foreground focus-visible:outline-none"
            >
              {eqPresets.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="custom">Custom (User Modified)</option>
            </select>
          </div>
        </div>

        {/* 10 Vertical Sliders */}
        <div className={`grid grid-cols-10 gap-2 p-4 rounded-xl bg-oled-base/40 border border-brand-border transition-opacity ${!settings.eq_enabled ? 'opacity-40 pointer-events-none' : ''}`}>
          {FREQUENCY_LABELS.map((label, idx) => {
            const gain = draftGains[idx] || 0;
            return (
              <div key={label} className="flex flex-col items-center gap-2">
                <span className="text-[11px] font-mono font-medium text-brand-accent">
                  {gain > 0 ? `+${gain}` : gain}dB
                </span>

                {/* Vertical Range Input */}
                <div className="h-44 flex items-center justify-center py-2 relative">
                  <div className="absolute w-full h-px bg-brand-border/80 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={gain}
                    onChange={e => handleBandChange(idx, parseFloat(e.target.value))}
                    onPointerUp={commitEqChanges}
                    onPointerCancel={cancelEqChanges}
                    onKeyUp={commitEqChanges}
                    onBlur={commitEqChanges}
                    aria-label={`Gain for ${label}`}
                    style={{
                      writingMode: 'vertical-lr',
                      direction: 'rtl',
                      height: '140px',
                      width: '6px',
                    }}
                    className="cursor-pointer"
                  />
                </div>

                <span className="text-[10px] font-mono text-brand-muted">{label}</span>
              </div>
            );
          })}
        </div>

        {/* Custom Preset Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-brand-border/60">
          {isSavingCustom ? (
            <form onSubmit={handleSaveCustom} className="flex items-center gap-2 w-full max-w-sm">
              <input
                type="text"
                value={customName}
                onChange={e => setCustomName(e.target.value)}
                placeholder="Custom Preset Name"
                className="flex-1 bg-oled-card border border-brand-border rounded-lg px-3 py-1.5 text-xs text-brand-foreground"
                autoFocus
              />
              <Button type="submit" size="sm" variant="accent" icon={<Check className="w-3.5 h-3.5" />}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setIsSavingCustom(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setIsSavingCustom(true)}
              >
                Save as Preset
              </Button>

              {settings.eq_preset_id.startsWith('custom-') && (
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  onClick={() => deleteCustomEqPreset(settings.eq_preset_id)}
                >
                  Delete Preset
                </Button>
              )}
            </div>
          )}

          <Button size="sm" variant="secondary" onClick={() => {
            commitEqChanges();
            setIsEqualizerOpen(false);
          }}>
            {t('btn_close', settings.language)}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
