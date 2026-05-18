export const AUDIO_FILE_EXTENSIONS = [
  ".mp3",
  ".wav",
  ".wave",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".oga",
  ".aif",
  ".aiff",
];

const BLOCKED_MEDIA_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".heic",
  ".heif",
  ".webp",
];

export const AUDIO_FILE_ACCEPT = [
  ...AUDIO_FILE_EXTENSIONS,
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac",
  "audio/ogg",
  "audio/aiff",
].join(",");

export function isAcceptedAudioFile(file: File) {
  const name = file.name.toLowerCase();
  if (BLOCKED_MEDIA_EXTENSIONS.some((ext) => name.endsWith(ext))) return false;
  if (AUDIO_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return file.type.startsWith("audio/") && !file.type.includes("mp4");
}

export function splitAudioFiles(files: File[]) {
  return files.reduce(
    (acc, file) => {
      acc[isAcceptedAudioFile(file) ? "accepted" : "rejected"].push(file);
      return acc;
    },
    { accepted: [] as File[], rejected: [] as File[] },
  );
}
