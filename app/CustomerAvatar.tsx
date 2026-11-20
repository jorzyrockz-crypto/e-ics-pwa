import { useState } from 'react';
import { UserRound } from 'lucide-react';
import { getCustomerAvatar, type CustomerAvatarIdentity } from './customerAvatars';

type CustomerAvatarProps = CustomerAvatarIdentity & { size?: 32 | 44 | 48 | 56 };

export default function CustomerAvatar({ name, phone, size = 44 }: CustomerAvatarProps) {
  const avatar = getCustomerAvatar({ name, phone });
  const src = `${import.meta.env.BASE_URL}${avatar.file}`;
  const [failedSrc, setFailedSrc] = useState('');

  // Names/phone numbers are already visible beside every avatar. Keep this
  // illustration decorative so it never changes a row or button's spoken name.
  return (
    <span
      className="customer-avatar"
      style={{ width: size, height: size, backgroundColor: avatar.background }}
      aria-hidden="true"
      data-customer-avatar={avatar.id}
    >
      <UserRound className="customer-avatar__fallback" strokeWidth={1.8} />
      {failedSrc !== src && (
        <img
          key={src}
          className="customer-avatar__image"
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  );
}
