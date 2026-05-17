import { useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useUpsertMe, setAuthTokenGetter } from "@workspace/api-client-react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { GlobalErrorReporter } from "@/components/GlobalErrorReporter";
import { Toaster } from "@/components/ui/toaster";
import { audioCacheService } from "@/lib/audio-cache";
import { imageCacheService } from "@/lib/image-cache";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { AudioPlayerBar } from "@/components/AudioPlayerBar";
import { LandingPage } from "@/pages/LandingPage";
import { Dashboard } from "@/pages/Dashboard";
import { ProjectWorkspace } from "@/pages/ProjectWorkspace";
import { SharedProject } from "@/pages/SharedProject";
import { TeamSettings } from "@/pages/TeamSettings";
import { JoinTeam } from "@/pages/JoinTeam";
import { TeamLibrary } from "@/pages/TeamLibrary";
import { PersonalLibrary } from "@/pages/PersonalLibrary";
import { Profile } from "@/pages/Profile";
import { SignInPage } from "@/pages/SignInPage";
import { SignUpPage } from "@/pages/SignUpPage";
import { AuthCallback } from "@/pages/AuthCallback";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PendingInvitesModal } from "@/components/PendingInvitesModal";
import { getAuthAvatarUrl, getAuthDisplayName } from "@/lib/auth-user";
import { reportError } from "@/lib/error-reporting";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthTokenSetter() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(() => getToken());
    const authGetter = async () => {
      const token = await getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    };
    audioCacheService.setAuthGetter(authGetter);
    imageCacheService.setAuthGetter(authGetter);
    return () => {
      setAuthTokenGetter(null);
      audioCacheService.setAuthGetter(null);
      imageCacheService.setAuthGetter(null);
    };
  }, [isLoaded, isSignedIn, getToken]);
  return null;
}

function CacheInvalidatorOnSignOut() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const prevRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (prevRef.current !== undefined && prevRef.current !== isSignedIn) {
      qc.clear();
    }
    prevRef.current = isSignedIn;
  }, [isSignedIn, qc]);
  return null;
}

function AccountSyncGate({ children }: { children: React.ReactNode }) {
  const { user, isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const upsertMe = useUpsertMe();
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncingUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setSyncedUserId(null);
      setSyncError(null);
      syncingUserIdRef.current = null;
      return;
    }

    if (syncedUserId === user.id || syncingUserIdRef.current === user.id) return;

    const email = user.email ?? "";
    const displayName = getAuthDisplayName(user);
    const avatarUrl = getAuthAvatarUrl(user);

    setSyncError(null);
    syncingUserIdRef.current = user.id;
    upsertMe.mutate(
      { data: { email, displayName, avatarUrl } },
      {
        onSuccess: () => {
          setSyncedUserId(user.id);
          queryClient.invalidateQueries();
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : "Could not prepare your account.";
          const status = error && typeof error === "object" ? (error as { status?: number }).status : undefined;
          const isNetworkError =
            message.toLowerCase().includes("failed to fetch") ||
            message.toLowerCase().includes("network") ||
            message.toLowerCase().includes("econnrefused");
          setSyncError(
            isNetworkError
              ? "We could not connect right now. Please try again in a moment."
              : status === 500
                ? "We could not finish setting up your account. Please try again."
              : "We could not finish setting up your account. Please try again.",
          );
          reportError(error, {
            area: "auth",
            action: "sync app account",
          });
        },
        onSettled: () => {
          syncingUserIdRef.current = null;
        },
      },
    );
  }, [isLoaded, isSignedIn, user, syncedUserId, queryClient]);

  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;

  if (syncError) {
    return (
      <div className="h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-3">
          <p className="text-sm font-medium text-foreground">Could not prepare your account</p>
          <p className="text-xs text-muted-foreground">{syncError}</p>
          <button
            onClick={() => {
              setSyncedUserId(null);
              setSyncError(null);
            }}
            className="text-sm text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!user || syncedUserId !== user.id) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-xs text-muted-foreground">Preparing your account...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <PendingInvitesModal />
    </>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <AccountSyncGate>{children}</AccountSyncGate>;
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (isSignedIn) return <Redirect to="/dashboard" />;
  return <LandingPage />;
}

function WithPlayer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col h-dvh overflow-hidden">
      <div className="flex-1 overflow-auto min-h-0">{children}</div>
      <AudioPlayerBar />
    </div>
  );
}

function AppShell() {
  return (
    <AudioPlayerProvider>
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/join/:token" component={JoinTeam} />
        <Route path="/dashboard">
          <AuthGuard>
            <WithPlayer>
              <Dashboard />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route path="/projects/:projectId">
          <AuthGuard>
            <WithPlayer>
              <ProjectWorkspace />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route path="/teams/:teamId/settings">
          <AuthGuard>
            <WithPlayer>
              <TeamSettings />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route path="/teams/:teamId/library">
          <AuthGuard>
            <WithPlayer>
              <TeamLibrary />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route path="/library">
          <AuthGuard>
            <WithPlayer>
              <PersonalLibrary />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route path="/account">
          <AuthGuard>
            <WithPlayer>
              <Profile />
            </WithPlayer>
          </AuthGuard>
        </Route>
        <Route>
          <div className="h-screen bg-background flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-lg font-semibold text-foreground mb-2">Page not found</h1>
              <a href={`${basePath}/`} className="text-sm text-primary hover:underline">Go home</a>
            </div>
          </div>
        </Route>
      </Switch>
    </AudioPlayerProvider>
  );
}

function PublicShareShell() {
  return (
    <AudioPlayerProvider>
      <WithPlayer>
        <div className="flex-1 overflow-auto h-full">
          <SharedProject />
        </div>
      </WithPlayer>
    </AudioPlayerProvider>
  );
}

function AuthenticatedShell() {
  return (
    <AuthProvider>
      <CacheInvalidatorOnSignOut />
      <AuthTokenSetter />
      <AppShell />
    </AuthProvider>
  );
}

function AppWithProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <GlobalErrorReporter />
        <Switch>
          <Route path="/share/:shareToken" component={PublicShareShell} />
          <Route component={AuthenticatedShell} />
        </Switch>
      </AppErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppWithProviders />
    </WouterRouter>
  );
}

export default App;
