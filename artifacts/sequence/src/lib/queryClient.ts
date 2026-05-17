import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { reportError } from "@/lib/error-reporting";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      reportError(error, {
        area: "api query",
        action: query.queryHash,
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const key = mutation.options.mutationKey?.join(":") || "mutation";
      reportError(error, {
        area: "api mutation",
        action: key,
      });
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10,   // keep unused cache 10 minutes
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
    },
  },
});
