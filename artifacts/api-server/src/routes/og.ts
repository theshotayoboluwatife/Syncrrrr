import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, projectsTable, teamsTable } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

const SOCIAL_BOT_UA =
  /facebookexternalhit|whatsapp|twitterbot|slackbot|telegrambot|linkedinbot|discordbot|pinterest|googlebot|bingbot|crawl|spider/i;

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function getRequestOrigin(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
    req.get("host") ??
    "localhost:8080";
  return `${proto}://${host}`;
}

async function sendResizedImage(res: Response, imageUrl: string | null): Promise<void> {
  if (!imageUrl) {
    res.status(404).send("No image");
    return;
  }

  try {
    const storageObjectPath = imageUrl.replace(/^\/api\/storage/, "");
    const objectFile = await storage.getObjectEntityFile(storageObjectPath);
    const response = await storage.downloadObject(objectFile);

    if (!response.body) {
      res.status(404).send("Image not found");
      return;
    }

    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    const imageBuffer = Buffer.concat(chunks);

    const resized = await sharp(imageBuffer)
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, {
        fit: "cover",
        position: "center",
      })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Length", resized.length);
    res.send(resized);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).send("Image not found");
      return;
    }
    res.status(500).send("Image processing failed");
  }
}

function sendOgHtml({
  res,
  title,
  description,
  canonicalUrl,
  imageUrl,
  type = "website",
}: {
  res: Response;
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string | null;
  type?: string;
}) {
  const escapedTitle = escapeHtml(title);
  const escapedDescription = escapeHtml(description);
  const escapedUrl = escapeHtml(canonicalUrl);
  const escapedImage = imageUrl ? escapeHtml(imageUrl) : null;
  const imageTag = escapedImage
    ? `
  <meta property="og:image" content="${escapedImage}">
  <meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
  <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
  <meta name="twitter:image" content="${escapedImage}">`
    : "";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapedTitle}</title>
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:site_name" content="Syncr">
  <meta property="og:url" content="${escapedUrl}">
  <meta property="og:title" content="${escapedTitle}">
  <meta property="og:description" content="${escapedDescription}">${imageTag}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapedTitle}">
  <meta name="twitter:description" content="${escapedDescription}">
  <meta http-equiv="refresh" content="0;url=${escapedUrl}">
</head>
<body>
  <script>window.location.replace(${JSON.stringify(canonicalUrl)});</script>
  <p>Redirecting to <a href="${escapedUrl}">${escapedTitle}</a>…</p>
</body>
</html>`);
}

async function sendProjectOg(req: Request, res: Response, rawToken?: string): Promise<void> {
  if (!rawToken) {
    res.status(400).send("Missing share token");
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.shareToken, rawToken));

  if (!project) {
    res.status(404).send("Project not found");
    return;
  }

  const [team] = project.teamId
    ? await db.select().from(teamsTable).where(eq(teamsTable.id, project.teamId))
    : [];
  const origin = getRequestOrigin(req);
  const sharePageUrl = `${origin}/share/${rawToken}`;
  const userAgent = req.headers["user-agent"] ?? "";

  if (!SOCIAL_BOT_UA.test(userAgent)) {
    res.redirect(302, sharePageUrl);
    return;
  }

  sendOgHtml({
    res,
    title: team?.name ? `${project.title} - ${team.name}` : `${project.title} - Syncr`,
    description: "Listen on Syncr",
    canonicalUrl: sharePageUrl,
    imageUrl: project.coverImageUrl ? `${origin}/api/og-image/${rawToken}` : null,
    type: "music.song",
  });
}

/**
 * GET /api/og-image/:shareToken
 *
 * Serves a resized, compressed JPEG thumbnail (1200x630) of the project cover
 * art. Sized for social media link previews — keeps the image under ~150KB so
 * WhatsApp, Slack, Telegram, etc. can fetch and display it quickly.
 */
router.get("/og-image/:shareToken", async (req, res): Promise<void> => {
  const rawToken = Array.isArray(req.params.shareToken)
    ? req.params.shareToken[0]
    : req.params.shareToken;

  if (!rawToken) {
    res.status(400).send("Missing share token");
    return;
  }

  const [project] = await db
    .select({ coverImageUrl: projectsTable.coverImageUrl })
    .from(projectsTable)
    .where(eq(projectsTable.shareToken, rawToken));

  if (!project || !project.coverImageUrl) {
    res.status(404).send("No cover image");
    return;
  }

  await sendResizedImage(res, project.coverImageUrl);
});

router.get("/og-image/team-invite/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  if (!token) {
    res.status(400).send("Missing invite token");
    return;
  }

  const [team] = await db
    .select({ imageUrl: teamsTable.imageUrl })
    .from(teamsTable)
    .where(eq(teamsTable.inviteToken, token));

  if (!team || !team.imageUrl) {
    res.status(404).send("No team image");
    return;
  }

  await sendResizedImage(res, team.imageUrl);
});

/**
 * GET /api/og/:shareToken
 *
 * Social media link-preview endpoint. Social bots receive a full HTML page
 * with Open Graph meta tags (title, description, cover image). Real browsers
 * are immediately redirected to /share/:shareToken.
 */
router.get("/og/:shareToken", async (req, res): Promise<void> => {
  const rawToken = Array.isArray(req.params.shareToken)
    ? req.params.shareToken[0]
    : req.params.shareToken;
  await sendProjectOg(req, res, rawToken);
});

router.get("/og/share/:shareToken", async (req, res): Promise<void> => {
  const rawToken = Array.isArray(req.params.shareToken)
    ? req.params.shareToken[0]
    : req.params.shareToken;
  await sendProjectOg(req, res, rawToken);
});

router.get("/og/join/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  if (!token) {
    res.status(400).send("Missing invite token");
    return;
  }

  const [team] = await db
    .select()
    .from(teamsTable)
    .where(eq(teamsTable.inviteToken, token));

  if (!team) {
    res.status(404).send("Team invite not found");
    return;
  }

  const origin = getRequestOrigin(req);
  const joinPageUrl = `${origin}/join/${token}`;
  const userAgent = req.headers["user-agent"] ?? "";

  if (!SOCIAL_BOT_UA.test(userAgent)) {
    res.redirect(302, joinPageUrl);
    return;
  }

  sendOgHtml({
    res,
    title: `${team.name} has invited you`,
    description: "Join on Syncr",
    canonicalUrl: joinPageUrl,
    imageUrl: team.imageUrl ? `${origin}/api/og-image/team-invite/${token}` : null,
  });
});

export default router;
