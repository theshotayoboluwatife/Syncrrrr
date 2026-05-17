export function SignOutConfirmDialog({
  isSigningOut,
  onCancel,
  onConfirm,
}: {
  isSigningOut: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div
        className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground mb-2">Sign out?</h2>
        <p className="text-sm text-muted-foreground">
          You will need to sign in again to access your projects and libraries.
        </p>
        <div className="flex gap-2 mt-5">
          <button
            onClick={onCancel}
            disabled={isSigningOut}
            className="flex-1 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSigningOut}
            className="flex-1 py-2 text-sm font-medium bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
