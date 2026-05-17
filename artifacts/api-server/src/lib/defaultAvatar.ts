const AVATAR_COLORS = [
  ["#1DB954", "#0B3D2E"],
  ["#1565C0", "#0B2545"],
  ["#7B2CBF", "#240046"],
  ["#D81B60", "#4A102A"],
  ["#00897B", "#083D3A"],
  ["#F9A825", "#4A3510"],
  ["#546E7A", "#18272E"],
  ["#C62828", "#3A1010"],
];

function hashSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .replace(/[<>&"]/g, "") || "S";
}

export function createDefaultAvatarDataUrl(seed: string, name: string) {
  const [start, end] = AVATAR_COLORS[hashSeed(seed || name || "syncr-account") % AVATAR_COLORS.length];
  const initials = initialsFor(name || seed || "Syncr");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs><rect width="128" height="128" rx="64" fill="url(#g)"/><circle cx="96" cy="24" r="32" fill="rgba(255,255,255,0.14)"/><text x="64" y="76" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="white">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
