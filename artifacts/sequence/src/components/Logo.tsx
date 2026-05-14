export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span
      className={className}
      style={{
        fontFamily: "'Syne', 'Inter', sans-serif",
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1,
        letterSpacing: "-0.04em",
        color: "white",
        display: "inline-flex",
        alignItems: "baseline",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      Syncr<span style={{ color: "#1DB954" }}>.</span>
    </span>
  );
}
