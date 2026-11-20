import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { History } from 'lucide-react';
import { findSavedPromos, type SavedPromo } from './savedPromos';

type PromoNameSuggestProps = {
  network: string;
  value: string;
  promos: readonly SavedPromo[];
  onChange: (value: string) => void;
  onSelect: (promo: SavedPromo) => void;
};
const price = (amount: number) => `₱${amount.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

export default function PromoNameSuggest({ network, value, promos, onChange, onSelect }: PromoNameSuggestProps) {
  const id = useId(), listId = `${id}-saved-promos`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const hasHistory = useMemo(() => findSavedPromos(promos, network, '', 1).length > 0, [promos, network]);
  const matches = useMemo(() => findSavedPromos(promos, network, value), [promos, network, value]);
  const expanded = open && hasHistory;
  const activeIndex = matches.findIndex(promo => promo.key === activeKey);
  const active = expanded && activeIndex >= 0 ? matches[activeIndex] : undefined;
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (active) listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const close = () => { setOpen(false); setActiveKey(null); };
  const choose = (promo: SavedPromo) => {
    onSelect(promo);
    inputRef.current?.focus({ preventScroll: true });
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Committing an IME composition is not a suggestion choice or a sale save.
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === 'Enter' || event.key === 'Escape' || event.key.startsWith('Arrow') || event.keyCode === 229) event.stopPropagation();
      return;
    }
    // Preserve the app's explicit modified-Enter save shortcut.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Holding Enter after choosing a suggestion must not submit the sale.
    if (event.key === 'Enter' && event.repeat) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault(); event.stopPropagation();
      const index = expanded ? activeIndex : -1;
      const next = event.key === 'ArrowDown' ? (index + 1) % matches.length : index <= 0 ? matches.length - 1 : index - 1;
      setOpen(true); setActiveKey(matches[next].key);
      inputRef.current?.focus({ preventScroll: true });
    } else if (event.key === 'Enter' && expanded) {
      event.preventDefault(); event.stopPropagation();
      // Never silently take the first result or submit the underlying sale.
      if (active) choose(active); else close();
    } else if (event.key === 'Escape' && expanded) {
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === 'Tab') close();
  };

  return (
    <div className="min-w-0" onKeyDown={onKeyDown} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
    }}>
      <label htmlFor={`${id}-name`} className="label">Promo / package name</label>
      <input
        ref={inputRef}
        id={`${id}-name`}
        value={value}
        onChange={event => { onChange(event.target.value); setOpen(true); setActiveKey(null); }}
        onFocus={() => setOpen(true)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        placeholder="Type to find a saved promo or enter a new one"
        className="field mt-1"
        role="combobox"
        aria-label="Promo or package name"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-activedescendant={active ? optionId(activeIndex) : undefined}
        aria-describedby={`${id}-help`}
        autoComplete="off"
        spellCheck={false}
      />
      {expanded && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
          <p className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--surface2)] px-3 py-2 text-xs font-extrabold text-[var(--muted)]"><History size={15} aria-hidden="true" />From recent saved {network} sales</p>
          <ul ref={listRef} id={listId} role="listbox" aria-label={`Saved ${network} promos`} className="max-h-64 overflow-y-auto overscroll-contain p-1">
            {matches.map((promo, index) => (
              <li key={promo.key} role="presentation">
                <button
                  id={optionId(index)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={active?.key === promo.key}
                  onMouseDown={event => { if (event.button === 0) event.preventDefault(); }}
                  onFocus={() => setActiveKey(promo.key)}
                  onClick={() => choose(promo)}
                  className={`block min-h-14 w-full rounded-xl px-3 py-2.5 text-left ${active?.key === promo.key ? 'bg-[var(--green-soft)] ring-2 ring-inset ring-[var(--green)]' : 'hover:bg-[var(--surface2)]'}`}
                >
                  <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm font-extrabold">{promo.name}</span><span className="shrink-0 text-sm font-extrabold text-[var(--green)]">{price(promo.amount)}</span></span>
                  {promo.details && <span className="mt-0.5 block break-words text-xs font-semibold text-[var(--muted)]">{promo.details}</span>}
                  <span className="mt-0.5 block break-words text-xs font-bold text-[var(--muted)]">{promo.validity ? `${promo.validity} · ` : ''}{promo.uses} recent {promo.uses === 1 ? 'sale' : 'sales'}</span>
                </button>
              </li>
            ))}
          </ul>
          {!matches.length && <p className="px-3 pb-3 text-sm font-semibold text-[var(--muted)]">No saved {network} promos match. You can keep this as a new promo name.</p>}
        </div>
      )}
      <p id={`${id}-help`} className="mt-1.5 text-xs font-bold text-[var(--muted)]">{hasHistory ? 'Suggestions use your recent saved sales. Choose one to fill its price, inclusions and validity, or type a new promo. Review details, fees and provider discount before saving.' : `No recent saved ${network} promos yet. Enter a new promo or choose a provider example above.`}</p>
      <span role="status" aria-live="polite" className="sr-only">{expanded ? `${matches.length} saved ${network} promo suggestions. Use Up and Down, then Enter to choose. Escape dismisses suggestions.` : ''}</span>
    </div>
  );
}
