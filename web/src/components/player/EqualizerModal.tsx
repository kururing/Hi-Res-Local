import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useSettings } from '../../context/SettingsContext';
import { usePlayer } from '../../context/PlayerContext';
import { t } from '../../i18n';
import { Check, Trash2, Plus } from 'lucide-react';

const FREQUENCY_LABELS = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];

export const EqualizerModal: React.FC = () => {
  const { isEqualizerOpen, setIsEqualizerOpen } = usePlayer();
  const {
    settings,
    updateSettings,
    eqPresets,
    saveCustomEqPreset,
    deleteCustomEqPreset,
    applyEqPreset,
  } = useSettings();

  const [customName, setCustomName] = useState('');
  const [isSavingCustom, setIsSavingCustom] = useState(false);

  if (!isEqualizerOpen) return null;

  const currentGains = settings.eq_preset_id === 'custom'
    ? settings.eq_custom_gains
    : (eqPresets.find(p => p.id === settings.eq_preset_id)?.gains || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const handleBandChange = (index: number, newGain: number) => {
    const nextGains = [...currentGains];
    nextGains[index] = Math.max(-12, Math.min(12, Math.round(newGain * 2) / 2));
    updateSettings({
      eq_preset_id: 'custom',
      eq_custom_gains: nextGains,
      eq_enabled: true,
    });
  };

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) return;
    saveCustomEqPreset(customName.trim(), currentGains);
    setCustomName('');
    setIsSavingCustom(false);
  };

  return (
    <Modal
      isOpen={isEqualizerOpen}
      onClose={() => setIsEqualizerOpen(false)}
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
            const gain = currentGains[idx] || 0;
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

          <Button size="sm" variant="secondary" onClick={() => setIsEqualizerOpen(false)}>
            {t('btn_close', settings.language)}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
