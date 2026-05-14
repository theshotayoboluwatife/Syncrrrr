import { useLocation } from "wouter";
import { UserProfile, useClerk, useUser } from "@clerk/react";
import { Logo } from "@/components/Logo";

export function Profile() {
  const [, navigate] = useLocation();
  const { signOut } = useClerk();
  const { user } = useUser();
  const displayName =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.primaryEmailAddress?.emailAddress ||
    "Your account";

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            title="Back to dashboard"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
          </button>
          <div className="hidden sm:block">
            <Logo size={22} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate">Account</h1>
            <p className="text-xs text-muted-foreground truncate">{displayName}</p>
          </div>
        </div>
        <button
          onClick={() => signOut(() => navigate("/"))}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive border border-border/60 hover:border-destructive/40 px-3 py-1.5 rounded-full transition-colors"
          title="Sign out"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
          </svg>
          Sign out
        </button>
      </div>

      {/* Clerk profile UI */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 flex justify-center">
          <UserProfile routing="virtual" />
        </div>
      </div>
    </div>
  );
}
