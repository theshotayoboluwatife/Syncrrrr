import React, { useState, useEffect } from "react";
import { imageCacheService, resolveCoverUrl } from "@/lib/image-cache";

export function MusicPlaceholder({
  size,
  fill,
  className,
}: {
  size?: number;
  fill?: boolean;
  className?: string;
}) {
  const resolvedSize = size ?? 120;
  const iconSize = Math.max(12, Math.round(resolvedSize * 0.38));
  const sizeStyle = fill ? {} : { width: resolvedSize, height: resolvedSize };
  const fillClass = fill ? "w-full h-full" : "";
  return (
    <div
      className={`flex items-center justify-center flex-shrink-0 ${fillClass} ${className || ""}`}
      style={{ ...sizeStyle, background: "#1c1c1c" }}
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="#3a3a3a"/>
      </svg>
    </div>
  );
}

export function ProjectCover({
  coverImageUrl,
  size,
  fill,
  className,
}: {
  coverImageUrl?: string | null;
  size?: number;
  fill?: boolean;
  className?: string;
}) {
  const resolvedSize = size ?? 120;
  const sizeStyle = fill ? {} : { width: resolvedSize, height: resolvedSize };
  const fillClass = fill ? "w-full h-full" : "";

  // Initialise from in-memory map — if already cached this session, no shimmer at all
  const [imgSrc, setImgSrc] = useState<string | null>(() =>
    coverImageUrl ? imageCacheService.getBlobUrl(coverImageUrl) : null
  );

  useEffect(() => {
    if (!coverImageUrl) { setImgSrc(null); return; }

    // Already in memory — nothing to do
    const existing = imageCacheService.getBlobUrl(coverImageUrl);
    if (existing) { setImgSrc(existing); return; }

    // Reset while we wait for cache/network
    setImgSrc(null);

    let cancelled = false;
    imageCacheService.cacheImage(coverImageUrl).then(blobUrl => {
      if (!cancelled) setImgSrc(blobUrl ?? resolveCoverUrl(coverImageUrl)); // fallback to network URL on error
    });

    return () => { cancelled = true; };
  }, [coverImageUrl]);

  if (!coverImageUrl) {
    return <MusicPlaceholder size={resolvedSize} fill={fill} className={className} />;
  }

  return (
    <div
      className={`relative flex-shrink-0 overflow-hidden ${fillClass} ${className || ""}`}
      style={sizeStyle}
    >
      {!imgSrc && <div className="absolute inset-0 shimmer-bg" />}
      {imgSrc && (
        <img
          src={imgSrc}
          alt=""
          className="object-cover w-full h-full"
          onError={() => setImgSrc(null)}
        />
      )}
    </div>
  );
}

export const SvgArtwork = ({ size = 120, className }: { id: string; size?: number; className?: string }) => (
  <MusicPlaceholder size={size} className={className} />
);
