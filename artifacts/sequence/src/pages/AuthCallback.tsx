import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";
import { reportError } from "@/lib/error-reporting";

export function AuthCallback() {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get("redirect");
    const redirectTo = redirectParam?.startsWith("/") ? redirectParam : "/dashboard";

    async function finishAuth() {
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          reportError(error, { area: "auth", action: "exchange oauth code" });
          setError(error.message);
          return;
        }
      }

      // Supabase may put tokens in either the URL hash or a PKCE code param.
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        reportError(error, { area: "auth", action: "read callback session" });
        setError(error.message);
        return;
      }
      if (session) {
        window.history.replaceState(null, "", window.location.pathname);
        navigate(redirectTo);
      } else {
        const hash = window.location.hash;
        if (hash && hash.includes("access_token")) {
          setTimeout(() => navigate(redirectTo), 500);
        } else {
          navigate("/sign-in");
        }
      }
    }

    finishAuth();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <Logo size={32} />
          <p className="text-sm text-red-400">{error}</p>
          <a href="/sign-in" className="text-sm text-[#1DB954] hover:underline">Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Logo size={32} />
        <div className="w-6 h-6 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-white/50">Signing you in…</p>
      </div>
    </div>
  );
}
