import { useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

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

export function SignUpPage() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const invite = params.get("invite");
  const redirect = params.get("redirect");
  const afterUrl = invite
    ? `/join/${invite}`
    : redirect
      ? redirect.startsWith("/") ? redirect : `/${redirect}`
      : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}${basePath}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      setEmailSent(true);
    }
  };

  const handleGoogleSignUp = async () => {
    setError("");
    const redirectTo = `${window.location.origin}${basePath}${afterUrl}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setError(error.message);
  };

  const signInUrl = invite
    ? `${basePath}/sign-in?invite=${invite}`
    : redirect
      ? `${basePath}/sign-in?redirect=${encodeURIComponent(redirect!)}`
      : `${basePath}/sign-in`;

  if (emailSent) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center p-4">
        <AuthBackground />
        <div className="relative z-10 w-full max-w-sm">
          <div className="flex items-center justify-center mb-6">
            <Logo size={32} />
          </div>
          <div className="bg-[#181818] border border-white/10 rounded-2xl shadow-2xl p-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#1DB954]/20 flex items-center justify-center mx-auto">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#1DB954">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold text-white">Check your email</h2>
            <p className="text-sm text-white/60">
              We sent a confirmation link to <strong className="text-white">{email}</strong>. Click it to activate your account.
            </p>
            <a href={signInUrl} className="block text-sm text-[#1DB954] hover:underline mt-2">
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden flex items-center justify-center px-4 pt-4 pb-16">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-sm">
        <div className="flex items-center justify-center mb-6">
          <Logo size={32} />
        </div>
        <div className="bg-[#181818] border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
          <h1 className="text-lg font-semibold text-white text-center">Create your account</h1>

          <button
            onClick={handleGoogleSignUp}
            className="w-full flex items-center justify-center gap-3 bg-white/[0.07] border border-white/20 hover:bg-white/[0.12] transition-colors rounded-xl py-2.5 text-sm font-medium text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-xs text-white/30">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={handleEmailSignUp} className="space-y-3">
            <div>
              <label className="text-xs text-white/70 mb-1 block">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                placeholder="Your name"
                className="w-full bg-[#242424] border border-white/15 focus:border-[#1DB954]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-white/70 mb-1 block">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="w-full bg-[#242424] border border-white/15 focus:border-[#1DB954]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none transition-colors"
              />
            </div>
            <div>
              <label className="text-xs text-white/70 mb-1 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="Min. 6 characters"
                minLength={6}
                className="w-full bg-[#242424] border border-white/15 focus:border-[#1DB954]/60 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none transition-colors"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-sm font-semibold bg-[#1DB954] hover:bg-[#1DB954]/90 text-black rounded-xl transition-colors disabled:opacity-50"
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="text-xs text-center text-white/50">
            Already have an account?{" "}
            <a href={signInUrl} className="text-[#1DB954] hover:text-[#1DB954]/80 transition-colors">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
