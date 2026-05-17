import { toast } from "@/hooks/use-toast";

type ErrorContext = {
  area?: string;
  action?: string;
  silent?: boolean;
};

let lastToastKey = "";
let lastToastAt = 0;

function getStringField(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export function getErrorMessage(error: unknown) {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return error;

  const data = getStringField(error, "data");
  if (data) return data;

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nested = record.data;
    const nestedMessage =
      getStringField(nested, "message") ||
      getStringField(nested, "error") ||
      getStringField(nested, "detail") ||
      getStringField(nested, "title");
    if (nestedMessage) return nestedMessage;

    const directMessage =
      getStringField(error, "message") ||
      getStringField(error, "error_description") ||
      getStringField(error, "error");
    if (directMessage) return directMessage;
  }

  return "Something went wrong.";
}

export function getFriendlyErrorMessage(error: unknown) {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("failed query") ||
    lower.includes("database") ||
    lower.includes("server logs") ||
    lower.includes("supabase_id") ||
    lower.includes("params:") ||
    lower.includes("stack trace") ||
    lower.includes("relation ") ||
    lower.includes("column ")
  ) {
    return "Something went wrong. Please try again.";
  }

  if (
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("load failed")
  ) {
    return "We could not reach the server. Check your connection or try again in a moment.";
  }

  if (lower.includes("unauthorized") || lower.includes("401")) {
    return "Your session could not be verified. Please sign in again.";
  }

  if (lower.includes("forbidden") || lower.includes("403")) {
    return "You do not have access to do that.";
  }

  if (lower.includes("not found") || lower.includes("404")) {
    return "We could not find that item. It may have been removed.";
  }

  if (lower.includes("500") || lower.includes("internal server")) {
    return "The server hit a problem. Please try again.";
  }

  return message;
}

export function reportError(error: unknown, context: ErrorContext = {}) {
  const message = getFriendlyErrorMessage(error);
  const logContext = {
    area: context.area ?? "app",
    action: context.action ?? "unknown",
  };

  console.error("[Syncr error]", logContext, error);

  if (context.silent) return;

  const now = Date.now();
  const toastKey = `${logContext.area}:${logContext.action}:${message}`;
  if (toastKey === lastToastKey && now - lastToastAt < 4000) return;
  lastToastKey = toastKey;
  lastToastAt = now;

  toast({
    variant: "destructive",
    title: "Something went wrong",
    description: message,
  });
}
