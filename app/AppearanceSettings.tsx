import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { AppearanceControls, ThemePreference } from './appearance';

const options = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies readonly { value: ThemePreference; label: string; icon: typeof Sun }[];

export default function AppearanceSettings({ preference, resolvedTheme, setPreference }: AppearanceControls) {
  const id = useId();
  return (
    <section className="card p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-xl font-bold"><Moon size={20} aria-hidden="true" />Appearance</h2>
      <p id={`${id}-help`} className="mt-1 text-sm font-semibold text-[var(--muted)]">Choose a comfortable look. System follows your device’s light or dark setting.</p>
      <fieldset className="mt-4" aria-describedby={`${id}-help`}>
        <legend className="sr-only">Color theme</legend>
        <div className="appearance-options">
          {options.map(({ value, label, icon: Icon }) => (
            <label key={value} className="appearance-option" data-selected={preference === value}>
              <input type="radio" name={`${id}-theme`} value={value} checked={preference === value} onChange={() => setPreference(value)} />
              <Icon size={22} aria-hidden="true" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" className="mt-3 text-sm font-bold text-[var(--green)]">{resolvedTheme === 'dark' ? 'Dark' : 'Light'} mode active{preference === 'system' ? ' · follows your device' : ''}.</p>
      <p className="mt-1 text-xs font-semibold text-[var(--muted)]">Applies immediately on this browser/device. Store records, wallet balances, and other devices are not changed.</p>
    </section>
  );
}
