import React from "react";
import { reportError } from "@/lib/error-reporting";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, errorInfo: React.ErrorInfo) {
    reportError(error, {
      area: "render",
      action: errorInfo.componentStack || "component render",
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-background flex items-center justify-center px-4">
          <div className="max-w-sm text-center space-y-3">
            <p className="text-sm font-medium text-foreground">This view could not load</p>
            <p className="text-xs text-muted-foreground">
              We logged the error. Refresh the page or try again in a moment.
            </p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="text-sm text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
