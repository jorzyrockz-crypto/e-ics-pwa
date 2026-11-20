// @vitest-environment happy-dom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromoNameSuggest from './app/PromoNameSuggest';
import type { SavedPromo } from './app/savedPromos';

const promo = (key: string, name: string, lastUsed = 1): SavedPromo => ({
  key, name, network: 'Globe', amount: 99, details: '8GB + unli texts', validity: '7 days', uses: 2, lastUsed,
});
const promos = [promo('go99', 'Go+99', 3), promo('go149', 'Go+149', 2), promo('weekend', 'Weekend Bundle')];
function mount(initialPromos = promos) {
  const selected = vi.fn(), bubbled = vi.fn();
  function Form({ rows }: { rows: readonly SavedPromo[] }) {
    const [value, setValue] = useState('');
    return <div onKeyDown={bubbled}>
      <PromoNameSuggest network="Globe" value={value} promos={rows} onChange={setValue} onSelect={choice => { selected(choice); setValue(choice.name); }}/>
      <input aria-label="Next field"/>
    </div>;
  }
  const view = render(<Form rows={initialPromos}/>);
  const input = within(view.container).getByRole('combobox', { name: 'Promo or package name' }) as HTMLInputElement;
  act(() => { input.focus(); });
  return { ...view, input, selected, bubbled, update: (rows: readonly SavedPromo[]) => view.rerender(<Form rows={rows}/>) };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('saved promo name combobox', () => {
  it('shows saved product context on focus, links the popup, and leaves choices unselected initially', () => {
    const view = mount();
    const list = within(view.container).getByRole('listbox', { name: 'Saved Globe promos' });
    expect(view.input.getAttribute('aria-expanded')).toBe('true');
    expect(view.input.getAttribute('aria-controls')).toBe(list.id);
    expect(view.input.getAttribute('aria-activedescendant')).toBeNull();
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(list.textContent).toContain('₱99'); expect(list.textContent).toContain('8GB + unli texts');
    expect(list.textContent).toContain('7 days · 2 recent sales');
    expect(view.selected).not.toHaveBeenCalled();
  });

  it('filters while typing and preserves a custom name on no match without picking a saved result', () => {
    const view = mount();
    fireEvent.change(view.input, { target: { value: 'go+' } });
    expect(within(view.container).getAllByRole('option')).toHaveLength(2);
    fireEvent.change(view.input, { target: { value: 'My custom offer' } });
    expect(within(view.container).queryByRole('option')).toBeNull();
    expect(view.container.textContent).toContain('No saved Globe promos match');
    expect(within(view.container).getByRole('status').textContent).toContain('0 saved Globe');
    expect(view.input.value).toBe('My custom offer');
    expect(view.selected).not.toHaveBeenCalled();
  });

  it('navigates and wraps with arrows while retaining input focus, then Enter chooses without bubbling', () => {
    const view = mount();
    fireEvent.keyDown(view.input, { key: 'ArrowUp' });
    let option = within(view.container).getByRole('option', { selected: true });
    expect(option.textContent).toContain('Weekend Bundle');
    expect(view.input.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(document.activeElement).toBe(view.input);
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    option = within(view.container).getByRole('option', { selected: true });
    expect(option.textContent).toContain('Go+99');
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.selected).toHaveBeenCalledTimes(1);
    expect(view.selected).toHaveBeenCalledWith(promos[0]);
    expect(view.input.value).toBe('Go+99');
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
    expect(view.input.getAttribute('aria-activedescendant')).toBeNull();
    expect(view.bubbled).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: 'Enter', repeat: true });
    expect(view.bubbled).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    expect(view.input.getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter without an explicit highlighted choice dismisses instead of picking or submitting', () => {
    const view = mount();
    expect(fireEvent.keyDown(view.input, { key: 'Enter' })).toBe(false);
    expect(view.selected).not.toHaveBeenCalled(); expect(view.bubbled).not.toHaveBeenCalled();
    expect(view.input.value).toBe('');
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses with Escape first, leaving a second Escape for the surrounding sheet', () => {
    const view = mount();
    fireEvent.change(view.input, { target: { value: 'Go' } });
    fireEvent.keyDown(view.input, { key: 'Escape' });
    expect(view.input.value).toBe('Go');
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
    expect(view.bubbled).not.toHaveBeenCalled();
    fireEvent.keyDown(view.input, { key: 'Escape' });
    expect(view.bubbled).toHaveBeenCalledTimes(1);
    expect(view.selected).not.toHaveBeenCalled();
  });

  it('supports pointer/touch clicks and prevents mouse focus loss before choosing', () => {
    const view = mount();
    const option = within(view.container).getByRole('option', { name: /Go\+149/ });
    expect(option.getAttribute('tabindex')).toBe('-1');
    expect(fireEvent.mouseDown(option, { button: 0 })).toBe(false);
    fireEvent.pointerDown(option, { pointerType: 'touch' });
    fireEvent.pointerUp(option, { pointerType: 'touch' });
    fireEvent.click(option);
    expect(view.selected).toHaveBeenCalledTimes(1);
    expect(view.selected).toHaveBeenCalledWith(promos[1]);
    expect(document.activeElement).toBe(view.input);
    expect(within(view.container).queryByRole('listbox')).toBeNull();
  });

  it('dismisses on Tab or outside focus without accepting the highlighted option', () => {
    const view = mount();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    expect(fireEvent.keyDown(view.input, { key: 'Tab' })).toBe(true);
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
    expect(view.bubbled).toHaveBeenCalledTimes(1);
    act(() => { within(view.container).getByLabelText('Next field').focus(); view.input.focus(); });
    expect(view.input.getAttribute('aria-expanded')).toBe('true');
    act(() => { within(view.container).getByLabelText('Next field').focus(); });
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
    expect(view.input.value).toBe(''); expect(view.selected).not.toHaveBeenCalled();
  });

  it('does not choose or submit when IME Enter/Escape commits or cancels composition', () => {
    const view = mount();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    fireEvent.compositionStart(view.input);
    expect(fireEvent.keyDown(view.input, { key: 'Enter', isComposing: true })).toBe(true);
    fireEvent.keyDown(view.input, { key: 'Escape', isComposing: true });
    fireEvent.compositionEnd(view.input);
    expect(view.selected).not.toHaveBeenCalled(); expect(view.bubbled).not.toHaveBeenCalled();
    expect(view.input.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(view.input, { key: 'Enter', keyCode: 229 });
    expect(view.selected).not.toHaveBeenCalled(); expect(view.bubbled).not.toHaveBeenCalled();
  });

  it('preserves the explicit Ctrl+Enter shortcut without selecting a saved result', () => {
    const view = mount();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    fireEvent.keyDown(view.input, { key: 'Enter', ctrlKey: true });
    expect(view.bubbled).toHaveBeenCalledTimes(1); expect(view.selected).not.toHaveBeenCalled();
  });

  it('tracks highlighted identity across live reordering, but never silently picks another deleted result', () => {
    const view = mount();
    fireEvent.keyDown(view.input, { key: 'ArrowDown' });
    view.update([promo('new', 'Go New', 10), ...promos]);
    expect(within(view.container).getByRole('option', { selected: true }).textContent).toContain('Go+99');
    view.update(promos.filter(promo => promo.key !== 'go99'));
    expect(view.input.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.selected).not.toHaveBeenCalled(); expect(view.bubbled).not.toHaveBeenCalled();
  });

  it('leaves manual entry available when there is no saved data', () => {
    const view = mount([]);
    expect(view.input.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent).toContain('No recent saved Globe promos yet');
    expect(within(view.container).queryByRole('listbox')).toBeNull();
    fireEvent.change(view.input, { target: { value: 'Brand new promo' } });
    expect(view.input.value).toBe('Brand new promo');
    fireEvent.keyDown(view.input, { key: 'Enter' });
    expect(view.bubbled).toHaveBeenCalledTimes(1); expect(view.selected).not.toHaveBeenCalled();
  });

  it('renders saved names as text, not HTML', () => {
    const view = mount([promo('unsafe', '<img src=x onerror=alert(1)>')]);
    expect(within(view.container).getByRole('option').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(view.container.querySelector('img')).toBeNull();
  });
});
