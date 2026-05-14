import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Eagerly open the database connection pool so the first real request
  // does not incur the cold-start penalty (can be 10-15 s in production).
  db.execute(sql`SELECT 1`)
    .then(() => logger.info("Database connection pool warmed up"))
    .catch((e) => logger.warn({ err: e }, "Database warmup query failed"));
});
