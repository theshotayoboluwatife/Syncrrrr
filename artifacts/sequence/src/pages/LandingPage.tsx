import { useLocation } from "wouter";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const bgUrl = `${import.meta.env.BASE_URL}doodle-bg.png`;

export function LandingPage() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden flex flex-col">
      {/* Tiled wallpaper of music gear doodles */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url("${bgUrl}")`,
          backgroundRepeat: "repeat",
          backgroundSize: "520px 520px",
          opacity: 0.22,
          filter: "contrast(1.1)",
        }}
        aria-hidden="true"
      />

      {/* Soft vignette so center copy reads cleanly */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.05) 100%)",
        }}
        aria-hidden="true"
      />

      {/* Main hero */}
      <main className="relative z-10 flex-1 flex flex-col justify-center px-6 sm:px-10">
        <div className="max-w-[1400px] mx-auto w-full">
          {/* Massive wordmark */}
          <h1
            className="text-white leading-[0.82] mb-6 sm:mb-8"
            style={{
              fontFamily: "'Syne', 'Inter', sans-serif",
              fontWeight: 800,
              fontSize: "clamp(5rem, 19vw, 19rem)",
              letterSpacing: "-0.055em",
            }}
          >
            Syncr<span className="text-primary">.</span>
          </h1>

          {/* Subheadline */}
          <p
            className="text-white/55 text-xs sm:text-sm uppercase tracking-[0.35em] mb-10 sm:mb-12"
            style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
          >
            powered by teddmusik
          </p>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 max-w-md">
            <button
              onClick={() => navigate(`${basePath}/sign-in`)}
              className="group relative px-8 py-4 bg-primary text-black font-bold text-sm uppercase tracking-[0.2em] rounded-none hover:bg-primary/90 transition-all"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              Sign in →
            </button>
            <button
              onClick={() => navigate(`${basePath}/sign-up`)}
              className="px-8 py-4 border border-white/30 text-white text-sm uppercase tracking-[0.2em] rounded-none hover:bg-white hover:text-black transition-all"
              style={{ fontFamily: "'Space Mono', ui-monospace, monospace" }}
            >
              Create account
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
