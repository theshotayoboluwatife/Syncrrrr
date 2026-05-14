import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from "@clerk/react";
import { Logo } from "@/components/Logo";
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

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
// In production the Clerk proxy must route through our own API server so that
// auth works on the .replit.app domain (no CNAME needed). We compute the URL
// at runtime from window.location so it is always correct regardless of what
// domain the app is deployed to. In development Clerk connects directly and
// does not need a proxy, so we omit it.
const clerkProxyUrl = import.meta.env.PROD
  ? `${window.location.origin}/api/__clerk`
  : undefined;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function ClerkAuthTokenSetter() {
  const { getToken, isLoaded } = useAuth();
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
  }, [isLoaded, getToken]);
  return null;
}

function UserSync() {
  const { user, isLoaded } = useUser();
  const upsertMe = useUpsertMe();
  const hasSynced = useRef(false);

  useEffect(() => {
    if (!isLoaded || !user || hasSynced.current) return;
    hasSynced.current = true;
    upsertMe.mutate({
      data: {
        email: user.primaryEmailAddress?.emailAddress || user.emailAddresses?.[0]?.emailAddress || "",
        displayName: user.fullName || user.firstName || user.username || "User",
        avatarUrl: user.imageUrl || null,
      }
    });
  }, [isLoaded, user]);

  return null;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return null;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  return <>{children}</>;
}

const clerkAppearance = {
  variables: {
    colorPrimary: "#1DB954",
    colorBackground: "#181818",
    colorInputBackground: "#242424",
    colorInputText: "#ffffff",
    colorText: "#ffffff",
    colorTextSecondary: "#a7a7a7",
    colorNeutral: "#535353",
    borderRadius: "0.75rem",
    fontFamily: "inherit",
  },
  elements: {
    card: "shadow-2xl border border-white/10",
    headerTitle: "hidden",
    headerSubtitle: "hidden",
    dividerRow: "!text-white/30",
    dividerLine: "!bg-white/10",
    formButtonPrimary: "!bg-primary hover:!bg-primary/90 !text-black font-semibold",
    footerActionLink: "!text-primary hover:!text-primary/80",
    // Social OAuth buttons — must be clearly visible on the dark card background
    socialButtonsBlockButton: "!bg-white/[0.07] !border !border-white/20 hover:!bg-white/[0.12] !transition-colors",
    socialButtonsBlockButtonText: "!text-white !font-medium",
    socialButtonsBlockButtonArrow: "!text-white/50",
    socialButtonsIconButton: "!bg-white/[0.07] !border !border-white/20 hover:!bg-white/[0.12]",
    // Form fields
    formFieldInput: "!border-white/15 focus:!border-primary/60",
    formFieldLabel: "!text-white/70",
    identityPreviewEditButton: "!text-primary",
    // Hide "Powered by Clerk" and help/privacy/terms footer links
    footerPages: "!hidden",
  },
};

function AuthBranding() {
  return (
    <div className="flex items-center justify-center mb-6">
      <Logo size={32} />
    </div>
  );
}

const authBgUrl = `${import.meta.env.BASE_URL}doodle-bg.png`;

function AuthBackground() {
  return (
    <>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("${authBgUrl}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "520px 520px",
          opacity: 0.18,
          filter: "contrast(1.1)",
        }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 55% at 50% 50%, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.10) 100%)",
        }}
        aria-hidden="true"
      />
    </>
  );
}

function SignInPage() {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get("invite");
  const redirect = params.get("redirect");
  const afterUrl = invite
    ? `${basePath}/join/${invite}`
    : redirect
      ? `${basePath}${redirect.startsWith("/") ? redirect : `/${redirect}`}`
      : `${basePath}/dashboard`;
  const signUpUrl = invite
    ? `${basePath}/sign-up?invite=${invite}`
    : redirect
      ? `${basePath}/sign-up?redirect=${encodeURIComponent(redirect)}`
      : `${basePath}/sign-up`;
  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center p-4">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-sm">
        <AuthBranding />
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={signUpUrl} afterSignInUrl={afterUrl} appearance={clerkAppearance} />
      </div>
    </div>
  );
}

function SignUpPage() {
  const params = new URLSearchParams(window.location.search);
  const invite = params.get("invite");
  const redirect = params.get("redirect");
  const afterUrl = invite
    ? `${basePath}/join/${invite}`
    : redirect
      ? `${basePath}${redirect.startsWith("/") ? redirect : `/${redirect}`}`
      : `${basePath}/dashboard`;
  const signInUrl = invite
    ? `${basePath}/sign-in?invite=${invite}`
    : redirect
      ? `${basePath}/sign-in?redirect=${encodeURIComponent(redirect)}`
      : `${basePath}/sign-in`;
  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center px-4 pt-4 pb-16">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-sm">
        <AuthBranding />
        <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={signInUrl} afterSignUpUrl={afterUrl} appearance={clerkAppearance} />
      </div>
    </div>
  );
}

function HomeRoute() {
  const { isLoaded, isSignedIn } = useUser();
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
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
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

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkAuthTokenSetter />
        <AppShell />
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
