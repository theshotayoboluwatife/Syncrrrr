import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useGetJoinInfo, useJoinTeamViaInvite, useUpsertMe } from "@workspace/api-client-react";
import { Logo } from "@/components/Logo";
import { getAuthAvatarUrl, getAuthDisplayName } from "@/lib/auth-user";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function TeamAvatar({ name, imageUrl, size = 64 }: { name: string; imageUrl?: string | null; size?: number }) {
  const colors = [
    "#1DB954", "#1565C0", "#6A1B9A", "#AD1457", "#E65100",
    "#00695C", "#558B2F", "#37474F", "#4527A0", "#283593",
  ];
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  const bg = colors[idx];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="rounded-2xl object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-2xl flex items-center justify-center font-bold text-white flex-shrink-0"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.35 }}
    >
      {initials}
    </div>
  );
}

export function JoinTeam() {
  const { token } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const { isLoaded, isSignedIn, user } = useAuth();
  const { data: info, isLoading, error } = useGetJoinInfo(token, { query: { retry: false } });
  const joinMutation = useJoinTeamViaInvite();
  const upsertMe = useUpsertMe();
  const [syncedUserId, setSyncedUserId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const syncingUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setSyncedUserId(null);
      setSyncError(false);
      syncingUserIdRef.current = null;
      return;
    }

    if (syncedUserId === user.id || syncingUserIdRef.current === user.id) return;

    syncingUserIdRef.current = user.id;
    setSyncError(false);
    upsertMe.mutate(
      {
        data: {
          email: user.email ?? "",
          displayName: getAuthDisplayName(user),
          avatarUrl: getAuthAvatarUrl(user),
        },
      },
      {
        onSuccess: () => setSyncedUserId(user.id),
        onError: () => setSyncError(true),
        onSettled: () => {
          syncingUserIdRef.current = null;
        },
      },
    );
  }, [isLoaded, isSignedIn, user, syncedUserId]);

  const accountReady = isSignedIn && !!user && syncedUserId === user.id;

  const handleJoin = async () => {
    if (!accountReady) return;
    try {
      const team = await joinMutation.mutateAsync({ token });
      navigate(`/dashboard?team=${team.id}`);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center">
        <Logo size={26} />
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {isLoading ? (
            <div className="flex justify-center">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error || !info ? (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-muted mx-auto flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Invalid invite link</h1>
                <p className="text-sm text-muted-foreground mt-1">This invite link is invalid or has expired.</p>
              </div>
              <a href={`${basePath}/`} className="inline-block text-sm text-primary hover:underline">
                Go to Syncr
              </a>
            </div>
          ) : (
            <div className="text-center space-y-6">
              <div className="flex flex-col items-center gap-4">
                <TeamAvatar name={info.teamName} imageUrl={info.teamImageUrl} size={80} />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">You're invited to join</p>
                  <h1 className="text-2xl font-bold text-foreground">{info.teamName}</h1>
                </div>
              </div>

              {!isLoaded ? null : !isSignedIn ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Use your Syncr account to accept this invite.</p>
                  <div className="flex flex-col gap-2">
                    <a
                      href={`${basePath}/sign-in?invite=${token}`}
                      className="block w-full py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:opacity-90 transition-opacity text-center"
                    >
                      Sign in
                    </a>
                    <a
                      href={`${basePath}/sign-up?invite=${token}`}
                      className="block w-full py-2.5 text-sm font-medium border border-border text-foreground rounded-xl hover:bg-muted transition-colors text-center"
                    >
                      Create account
                    </a>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    onClick={handleJoin}
                    disabled={!accountReady || upsertMe.isPending || joinMutation.isPending}
                    className="w-full py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {!accountReady || upsertMe.isPending ? "Preparing account…" : joinMutation.isPending ? "Joining…" : `Join ${info.teamName}`}
                  </button>
                  {syncError && (
                    <p className="text-xs text-destructive">We could not prepare your account. Please try again.</p>
                  )}
                  {joinMutation.isError && (
                    <p className="text-xs text-destructive">Something went wrong. Please try again.</p>
                  )}
                  <button
                    onClick={() => navigate("/dashboard")}
                    className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Maybe later
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
