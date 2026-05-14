import { useEffect, useRef } from "react";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useUpsertMe, setAuthTokenGetter } from "@workspace/api-client-react";
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

function UserSync() {
  const { user, isLoaded, isSignedIn } = useAuth();
  const upsertMe = useUpsertMe();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user || hasSynced.current) return;
    hasSynced.current = true;
    const email = user.email ?? "";
    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      email.split("@")[0] ||
      "User";
    const avatarUrl = user.user_metadata?.avatar_url ?? null;
    upsertMe.mutate({ data: { email, displayName, avatarUrl } });
  }, [isLoaded, isSignedIn, user]);

  // Reset sync flag on sign-out so next login re-syncs
  useEffect(() => {
    if (!isSignedIn) hasSynced.current = false;
  }, [isSignedIn]);

  return null;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
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
      <div className="flex-1 overflow-hidden min-h-0">{children}</div>
      <AudioPlayerBar />
    </div>
  );
}

function AppShell() {
  return (
    <AudioPlayerProvider>
      <UserSync />
      <Switch>
        <Route path="/" component={HomeRoute} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/join/:token" component={JoinTeam} />
        <Route path="/share/:shareToken">
          <WithPlayer>
            <div className="flex-1 overflow-auto h-full">
              <SharedProject />
            </div>
          </WithPlayer>
        </Route>
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

function AppWithProviders() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <CacheInvalidatorOnSignOut />
        <AuthTokenSetter />
        <AppShell />
      </QueryClientProvider>
    </AuthProvider>
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
