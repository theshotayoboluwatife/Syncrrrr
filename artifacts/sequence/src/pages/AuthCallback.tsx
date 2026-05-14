import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { Logo } from "@/components/Logo";

export function AuthCallback() {
  const [, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase puts the tokens in the URL hash after email confirmation / OAuth redirect.
    // getSession() picks them up automatically from window.location.hash.
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setError(error.message);
        return;
      }
      if (session) {
        // Strip the hash so it doesn't linger in history
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        navigate("/dashboard");
      } else {
        // No session yet — try exchanging the code/token from the hash
        const hash = window.location.hash;
        if (hash && hash.includes("access_token")) {
          // onAuthStateChange in AuthContext will pick this up and update the session
          // Just wait a moment then redirect
          setTimeout(() => navigate("/dashboard"), 500);
        } else {
          navigate("/sign-in");
        }
      }
    });
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
