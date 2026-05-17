import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, projectsTable } from "@workspace/db";
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

  try {
    // coverImageUrl is stored as an absolute path like
    // /api/storage/objects/uploads/<uuid>. Strip /api/storage so we get
    // /objects/uploads/<uuid> which is what getObjectEntityFile expects.
    const storageObjectPath = project.coverImageUrl.replace(/^\/api\/storage/, "");
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

  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
    req.get("host") ??
    "localhost:8080";
  const origin = `${proto}://${host}`;

  const sharePageUrl = `${origin}/share/${rawToken}`;
  const userAgent = req.headers["user-agent"] ?? "";

  if (!SOCIAL_BOT_UA.test(userAgent)) {
    res.redirect(302, sharePageUrl);
    return;
  }

  const title = escapeHtml(project.title);
  const description = "Listen on Syncr";

  // Use the resized thumbnail endpoint for the og:image — ensures the image is
  // under ~150KB and properly sized, so WhatsApp can load it reliably.
  let imageTag = "";
  if (project.coverImageUrl) {
    const thumbUrl = escapeHtml(`${origin}/api/og-image/${rawToken}`);
    imageTag = `
  <meta property="og:image" content="${thumbUrl}">
  <meta property="og:image:width" content="${OG_IMAGE_WIDTH}">
  <meta property="og:image:height" content="${OG_IMAGE_HEIGHT}">
  <meta name="twitter:image" content="${thumbUrl}">`;
  }

  const canonicalUrl = escapeHtml(sharePageUrl);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — Syncr</title>
  <meta property="og:type" content="music.song">
  <meta property="og:site_name" content="Syncr">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">${imageTag}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta http-equiv="refresh" content="0;url=${canonicalUrl}">
</head>
<body>
  <script>window.location.replace(${JSON.stringify(sharePageUrl)});</script>
  <p>Redirecting to <a href="${canonicalUrl}">${title} on Syncr</a>…</p>
</body>
</html>`);
});

export default router;
