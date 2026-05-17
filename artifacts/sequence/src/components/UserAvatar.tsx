import { useEffect, useMemo, useState } from "react";
import { getDefaultAvatarDataUrl } from "@/lib/default-avatar";

type UserAvatarProps = {
  avatarUrl?: string | null;
  name?: string | null;
  seed?: string | null;
  size?: number;
  className?: string;
  alt?: string;
  title?: string;
};

export function UserAvatar({
  avatarUrl,
  name,
  seed,
  size = 32,
  className = "",
  alt = "",
  title,
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const source = avatarUrl?.trim() || null;
  const fallback = useMemo(() => getDefaultAvatarDataUrl(seed || source || name, name), [seed, source, name]);
  const src = source && !failed ? source : fallback;

  useEffect(() => {
    setFailed(false);
  }, [source]);

  return (
    <img
      src={src}
      alt={alt}
      title={title}
      className={`rounded-full object-cover flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => {
        if (src !== fallback) setFailed(true);
      }}
    />
  );
}
