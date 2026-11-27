import { Check, Sliders, X } from 'lucide-react';
import type { AccentThemeId, AppSettings, UnitSystem } from '../types/timeline';
import { ACCENT_THEMES, APP_VERSION } from '../utils/settings';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
}

const ACCENT_LIST: AccentThemeId[] = ['CYAN', 'CRIMSON', 'EMERALD', 'AMBER'];

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}: SettingsModalProps) {
  if (!isOpen) return null;

  const activeAccent = ACCENT_THEMES[settings.accentTheme];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="ChronoMap Settings"
    >
      <div
        className="w-full max-w-md rounded-xl instrument-surface-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4" style={{ color: activeAccent.primary }} />
            <h2 className="text-sm font-semibold text-white">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.07] active:scale-[0.98] transition-all"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5 max-h-[75vh] overflow-y-auto obsidian-scroll">
          {/* Accent Theme */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">Accent theme</div>
            <div className="grid grid-cols-2 gap-2">
              {ACCENT_LIST.map((themeId) => {
                const theme = ACCENT_THEMES[themeId];
                const isSelected = settings.accentTheme === themeId;
                return (
                  <button
                    key={themeId}
                    type="button"
                    onClick={() => onUpdateSettings({ accentTheme: themeId })}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left active:scale-[0.98] transition-all"
                    style={{
                      backgroundColor: isSelected
                        ? theme.softBg
                        : 'rgba(255,255,255,0.025)',
                      borderColor: isSelected
                        ? theme.border
                        : 'rgba(255,255,255,0.07)',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 ring-1 ring-white/25"
                        style={{ backgroundColor: theme.primary }}
                      />
                      <span className="text-xs font-medium text-slate-100 truncate">
                        {theme.name}
                      </span>
                    </div>
                    {isSelected && (
                      <Check
                        className="w-3.5 h-3.5 shrink-0"
                        style={{ color: theme.primary }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Route Styling */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">Route line</div>

            <div className="p-3 rounded-lg instrument-inset space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Stroke width</span>
                  <span className="font-mono text-slate-100 tabular-nums">
                    {settings.routeWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={2}
                  max={8}
                  step={1}
                  value={settings.routeWidth}
                  onChange={(e) =>
                    onUpdateSettings({ routeWidth: Number(e.target.value) })
                  }
                  className="w-full cursor-pointer"
                  style={{ accentColor: activeAccent.primary }}
                />
                <div className="h-6 rounded-lg bg-[#070A0F] border border-white/[0.06] flex items-center justify-center px-4 overflow-hidden">
                  <div
                    className="w-full rounded-full transition-all"
                    style={{
                      height: `${settings.routeWidth}px`,
                      backgroundColor: activeAccent.primary,
                      opacity: settings.routeGlow ? 0.96 : 0.85,
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2.5 border-t border-white/[0.07]">
                <div>
                  <div className="text-xs font-medium text-slate-200">
                    Route halo
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Subtle outer luminescence behind active paths
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.routeGlow}
                  onClick={() =>
                    onUpdateSettings({ routeGlow: !settings.routeGlow })
                  }
                  className="relative inline-flex h-6 w-11 items-center rounded-full active:scale-[0.98] transition-colors border"
                  style={{
                    backgroundColor: settings.routeGlow
                      ? activeAccent.primary
                      : 'rgba(30, 41, 59, 0.8)',
                    borderColor: settings.routeGlow
                      ? activeAccent.border
                      : 'rgba(255,255,255,0.12)',
                  }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      settings.routeGlow ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Measurement Units */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">Units</div>
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg instrument-inset">
              {(
                [
                  { id: 'METRIC', label: 'Metric', sub: 'km · km/h' },
                  { id: 'IMPERIAL', label: 'Imperial', sub: 'mi · mph' },
                ] as { id: UnitSystem; label: string; sub: string }[]
              ).map((opt) => {
                const active = settings.units === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ units: opt.id })}
                    className="px-3 py-2 rounded-md text-center active:scale-[0.98] transition-all border"
                    style={{
                      backgroundColor: active ? activeAccent.softBg : 'transparent',
                      borderColor: active ? activeAccent.border : 'transparent',
                      color: active ? activeAccent.text : '#94a3b8',
                    }}
                  >
                    <div className="text-xs font-medium">{opt.label}</div>
                    <div className="text-[10px] opacity-75 font-mono">{opt.sub}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Subtle Footer with Semantic Version */}
        <div className="px-4 py-2.5 border-t border-white/[0.08] flex items-center justify-between text-[11px] text-slate-500">
          <span>100% client-side · Zero telemetry</span>
          <span className="font-mono tabular-nums text-slate-400">
            ChronoMap {APP_VERSION}
          </span>
        </div>
      </div>
    </div>
  );
}
