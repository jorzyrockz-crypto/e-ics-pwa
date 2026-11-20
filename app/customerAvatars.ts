// Local AI-generated illustrations, not customer photos. Selection is decorative:
// it does not infer anyone's appearance, age, or gender from their name.
// Keep this order stable so existing customers retain their assigned portrait.
export const CUSTOMER_AVATARS = [
  { id: 'clay-01', file: 'avatars/clay-01.webp', background: '#fbd8b4' },
  { id: 'clay-02', file: 'avatars/clay-02.webp', background: '#d9c9e8' },
  { id: 'clay-03', file: 'avatars/clay-03.webp', background: '#f3d379' },
  { id: 'clay-04', file: 'avatars/clay-04.webp', background: '#c1e9e5' },
  { id: 'clay-05', file: 'avatars/clay-05.webp', background: '#c5e0f6' },
  { id: 'clay-06', file: 'avatars/clay-06.webp', background: '#f4c6d7' },
  { id: 'clay-07', file: 'avatars/clay-07.webp', background: '#fbd3ad' },
  { id: 'clay-08', file: 'avatars/clay-08.webp', background: '#bfe5cf' },
] as const;

export type CustomerAvatarIdentity = { name?: string; phone?: string };

function identityKey({ name, phone }: CustomerAvatarIdentity): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits) {
    // Treat local, spaced, and international PH mobile formats alike. Prefer the
    // phone to the editable display name so adding/correcting a name is stable.
    const mobile = digits.match(/^(?:0|63|0063)?(9\d{9})$/);
    return `phone:${mobile ? `0${mobile[1]}` : digits}`;
  }
  return `name:${(name || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

export function getCustomerAvatar(identity: CustomerAvatarIdentity = {}) {
  // Deterministic across devices, record order, and renders. No random state,
  // database migration, third-party avatar service, or personal data in the URL.
  const key = identityKey(identity);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return CUSTOMER_AVATARS[(hash >>> 0) % CUSTOMER_AVATARS.length];
}
