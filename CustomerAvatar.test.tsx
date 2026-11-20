// @vitest-environment happy-dom
import React from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import CustomerAvatar from './app/CustomerAvatar';
import { CUSTOMER_AVATARS, getCustomerAvatar } from './app/customerAvatars';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

const identity = { name: 'Ada Test', phone: '09171234567' };

describe('stable, private clay customer portraits', () => {
  it('assigns the same bundled portrait on every render/device without random state', () => {
    const first = getCustomerAvatar(identity);
    for (let i = 0; i < 20; i++) expect(getCustomerAvatar({ ...identity })).toBe(first);
    expect(CUSTOMER_AVATARS).toContain(first);
  });

  it.each(['0917 123 4567', '0917-123-4567', '+63 917 123 4567', '639171234567', '00639171234567', '9171234567'])(
    'keeps a phone-only customer consistent when the number is formatted as %s', phone => {
      expect(getCustomerAvatar({ phone })).toBe(getCustomerAvatar(identity));
    },
  );

  it('does not change a portrait when an unnamed customer gets a name or a name is corrected', () => {
    const first = getCustomerAvatar({ phone: identity.phone });
    expect(getCustomerAvatar(identity)).toBe(first);
    expect(getCustomerAvatar({ ...identity, name: 'A corrected name' })).toBe(first);
  });

  it('normalizes name-only legacy records and handles missing details safely', () => {
    expect(getCustomerAvatar({ name: '  ADA   Test ' })).toBe(getCustomerAvatar({ name: 'ada test' }));
    expect(getCustomerAvatar({ name: 'José' })).toBe(getCustomerAvatar({ name: 'Jose\u0301' }));
    expect(CUSTOMER_AVATARS).toContain(getCustomerAvatar());
    expect(getCustomerAvatar({ name: ' ', phone: ' - ' })).toBe(getCustomerAvatar());
  });

  it('uses the full colorful collection without depending on record order', () => {
    const customers = Array.from({ length: 100 }, (_, i) => ({ phone: `0917000${String(i).padStart(4, '0')}` }));
    const portraits = customers.map(customer => getCustomerAvatar(customer).id);
    expect(new Set(portraits).size).toBe(CUSTOMER_AVATARS.length);
    expect([...customers].reverse().map(customer => getCustomerAvatar(customer).id).reverse()).toEqual(portraits);
  });

  it('ships eight optimized local WebP assets instead of a network avatar service', () => {
    expect(CUSTOMER_AVATARS).toHaveLength(8);
    expect(new Set(CUSTOMER_AVATARS.map(avatar => avatar.file)).size).toBe(8);
    let totalBytes = 0;
    for (const avatar of CUSTOMER_AVATARS) {
      expect(avatar.file).toMatch(/^avatars\/clay-\d{2}\.webp$/);
      const file = resolve('public', avatar.file);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
      totalBytes += statSync(file).size;
    }
    expect(totalBytes).toBeLessThan(128 * 1024);
  });
});

describe('shared customer avatar component', () => {
  it('replaces initials with a decorative portrait without changing the button name', () => {
    const view = render(<button><CustomerAvatar {...identity} />Ada Test</button>);
    expect(within(view.container).getByRole('button', { name: 'Ada Test' })).not.toBeNull();
    const avatar = view.container.querySelector('.customer-avatar')!;
    const image = avatar.querySelector('img')!;
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
    expect(avatar.textContent).toBe('');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('src')).toBe(`/${getCustomerAvatar(identity).file}`);
    expect(image.getAttribute('src')).not.toContain(identity.phone);
    expect(image.getAttribute('src')).not.toContain('Ada');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(image.getAttribute('decoding')).toBe('async');
  });

  it('respects the deployed GitHub Pages subpath', () => {
    vi.stubEnv('BASE_URL', '/e-ics-pwa/');
    const view = render(<CustomerAvatar {...identity} />);
    expect(view.container.querySelector('img')!.getAttribute('src')).toBe(`/e-ics-pwa/${getCustomerAvatar(identity).file}`);
  });

  it.each([32, 44, 48, 56] as const)('reserves a %ipx square before the image loads', size => {
    const view = render(<CustomerAvatar {...identity} size={size} />);
    const frame = view.container.firstElementChild as HTMLElement;
    const image = frame.querySelector('img')!;
    expect(frame.style.width).toBe(`${size}px`); expect(frame.style.height).toBe(`${size}px`);
    expect(image.width).toBe(size); expect(image.height).toBe(size);
  });

  it('uses a non-initials clay-colored icon fallback when an image cannot load', () => {
    const view = render(<CustomerAvatar {...identity} />);
    fireEvent.error(view.container.querySelector('img')!);
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('.customer-avatar__fallback')).not.toBeNull();
    expect(view.container.textContent).toBe('');
  });

  it('shows the new portrait when the identity changes after a failed image', () => {
    const view = render(<CustomerAvatar {...identity} />);
    fireEvent.error(view.container.querySelector('img')!);
    const next = Array.from({ length: 20 }, (_, i) => ({ phone: `0917000${String(i).padStart(4, '0')}` }))
      .find(customer => getCustomerAvatar(customer) !== getCustomerAvatar(identity))!;
    view.rerender(<CustomerAvatar {...next} />);
    expect(view.container.querySelector('img')!.getAttribute('src')).toBe(`/${getCustomerAvatar(next).file}`);
  });
});
