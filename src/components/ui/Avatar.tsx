'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { sanitizeImageSource } from '@/lib/svgSanitizer';

interface AvatarProps {
  src?: string | null;
  alt: string;
  initials: string;
  size?: number;
  className?: string;
  priority?: boolean;
}

export function Avatar({
  src,
  alt,
  initials,
  size = 28,
  className = '',
  priority = false,
}: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const safeSrc = useMemo(() => (src ? sanitizeImageSource(src) : ''), [src]);

  if (safeSrc && !imgError) {
    return (
      <div
        className={`relative shrink-0 rounded-full overflow-hidden ${className}`}
        style={{ width: size, height: size }}
      >
        <Image
          src={safeSrc}
          alt={alt}
          width={size}
          height={size}
          className="rounded-full object-cover"
          priority={priority}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // Fallback: show initials
  return (
    <div
      className={`rounded-full flex items-center justify-center shrink-0 font-bold ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.4),
        background: 'rgba(0,200,150,0.15)',
        color: '#00C896',
        border: '1px solid rgba(0,200,150,0.2)',
      }}
      aria-label={alt}
    >
      {initials}
    </div>
  );
}
