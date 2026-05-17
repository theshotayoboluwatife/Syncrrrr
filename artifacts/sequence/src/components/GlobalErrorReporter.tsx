import { useEffect } from "react";
import { reportError } from "@/lib/error-reporting";

export function GlobalErrorReporter() {
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      reportError(event.error ?? event.message, {
        area: "browser",
        action: event.filename ? `${event.filename}:${event.lineno}` : "runtime error",
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason, {
        area: "browser",
        action: "unhandled promise rejection",
      });
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
