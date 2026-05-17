import { useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey, useGetMe, useRequestUploadUrl, useUpsertMe } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { SignOutConfirmDialog } from "@/components/SignOutConfirmDialog";
import { UserAvatar } from "@/components/UserAvatar";
import { getAuthAvatarUrl, getAuthDisplayName } from "@/lib/auth-user";
import { uploadFileToStorage } from "@/lib/storage-upload";
import { supabase } from "@/lib/supabase";
import { reportError } from "@/lib/error-reporting";

export function Profile() {
  const [, navigate] = useLocation();
  const { isLoaded, signOut, user } = useAuth();
  const queryClient = useQueryClient();
  const getMe = useGetMe({ query: { enabled: isLoaded && !!user } });
  const upsertMe = useUpsertMe();
  const requestUploadUrl = useRequestUploadUrl();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fallbackUsername = getAuthDisplayName(user);
  const fallbackAvatarUrl = getAuthAvatarUrl(user);
  const currentUsername = getMe.data?.displayName ?? fallbackUsername;
  const currentAvatarUrl = avatarUrl ?? getMe.data?.avatarUrl ?? fallbackAvatarUrl ?? null;

  useEffect(() => {
    setUsername(currentUsername);
  }, [currentUsername]);

  useEffect(() => {
    setAvatarUrl(getMe.data?.avatarUrl ?? fallbackAvatarUrl ?? null);
  }, [getMe.data?.avatarUrl, fallbackAvatarUrl]);

  if (!isLoaded) return null;

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut();
    setIsSigningOut(false);
    setShowSignOutConfirm(false);
    navigate("/sign-in");
  };

  const handleAvatarFile = async (file: File | null) => {
    if (!file) return;
    setProfileError("");
    setProfileMessage("");
    setIsUploadingAvatar(true);
    try {
      const { uploadURL, objectPath } = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type || "image/jpeg" },
      });
      await uploadFileToStorage({
        uploadURL,
        file,
        contentType: file.type || "image/jpeg",
      });
      setAvatarUrl(`/api/storage${objectPath}`);
      setProfileMessage("Profile image ready. Save your changes to keep it.");
    } catch (error) {
      reportError(error, { area: "profile", action: "upload avatar" });
      setProfileError("We could not upload that image. Try another one.");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user?.email) return;
    const nextUsername = username.trim();
    if (!nextUsername) {
      setProfileError("Choose a username before saving.");
      return;
    }

    setProfileError("");
    setProfileMessage("");
    setIsSavingProfile(true);
    try {
      const nextAvatarUrl = currentAvatarUrl;
      const updated = await upsertMe.mutateAsync({
        data: {
          email: user.email,
          displayName: nextUsername,
          avatarUrl: nextAvatarUrl,
        },
      });

      const { error } = await supabase.auth.updateUser({
        data: {
          user_name: nextUsername,
          preferred_username: nextUsername,
          name: nextUsername,
          avatar_url: nextAvatarUrl,
        },
      });
      if (error) throw error;

      queryClient.setQueryData(getGetMeQueryKey(), updated);
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setProfileMessage("Profile updated.");
    } catch (error) {
      reportError(error, { area: "profile", action: "save profile" });
      setProfileError("We could not save your profile. Please try again.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  return (
    <div className="h-full bg-background flex flex-col overflow-hidden">
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
            <p className="text-xs text-muted-foreground truncate">{currentUsername}</p>
          </div>
        </div>
        <button
          onClick={() => setShowSignOutConfirm(true)}
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-destructive border border-border/60 hover:border-destructive/40 px-3 py-1.5 rounded-full transition-colors"
          title="Sign out"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
          </svg>
          Sign out
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="flex items-center gap-4">
            <UserAvatar avatarUrl={currentAvatarUrl} name={currentUsername} seed={user?.id} size={64} />
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate">{currentUsername}</p>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <div className="border border-border rounded-xl p-4 space-y-4 bg-card/50">
            <div className="flex items-center gap-4">
              <div className="relative">
                <UserAvatar avatarUrl={currentAvatarUrl} name={username || currentUsername} seed={user?.id} size={72} />
                {isUploadingAvatar && (
                  <div className="absolute inset-0 rounded-full bg-black/55 flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>
              <div className="space-y-2 min-w-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingAvatar || isSavingProfile}
                  className="text-xs border border-border hover:border-foreground/30 px-3 py-2 rounded-full text-foreground transition-colors disabled:opacity-50"
                >
                  Change image
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    void handleAvatarFile(file);
                  }}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Username</label>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {profileError && <p className="text-xs text-destructive">{profileError}</p>}
            {profileMessage && <p className="text-xs text-primary">{profileMessage}</p>}

            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSavingProfile || isUploadingAvatar}
              className="w-full bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold disabled:opacity-50"
            >
              {isSavingProfile ? "Saving..." : "Save profile"}
            </button>
          </div>
        </div>
      </div>
      {showSignOutConfirm && (
        <SignOutConfirmDialog
          isSigningOut={isSigningOut}
          onCancel={() => setShowSignOutConfirm(false)}
          onConfirm={handleSignOut}
        />
      )}
    </div>
  );
}
