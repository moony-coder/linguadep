import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error inside LinguaBot:", error, errorInfo);
  }

  private handleReset = () => {
    try {
      localStorage.removeItem("ielts_v1_active_tab");
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF9F5] flex flex-col items-center justify-center p-6 text-stone-850 font-sans">
          <div className="w-full max-w-md bg-white border border-stone-200 shadow-xl rounded-2xl p-8 text-center space-y-6">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-100">
              <span className="text-2xl font-bold">!</span>
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-bold text-stone-900 tracking-tight">Something went wrong</h1>
              <p className="text-sm text-stone-600 leading-relaxed">
                An unexpected error occurred during the test. This can be caused by audio hardware changes or network interruptions.
              </p>
              {this.state.error && (
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 text-[11px] font-mono text-stone-500 text-left overflow-x-auto max-h-32">
                  {this.state.error.toString()}
                </div>
              )}
            </div>
            <button
              onClick={this.handleReset}
              className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm transition-all cursor-pointer"
            >
              Restart test
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
