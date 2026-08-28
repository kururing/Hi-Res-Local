import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Unhandled application render error', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0f1014] px-6 text-center text-white">
        <section
          role="alert"
          className="max-w-md rounded-2xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl"
        >
          <h1 className="text-xl font-semibold">Đã xảy ra lỗi</h1>
          <p className="mt-3 text-sm text-white/60">
            Giao diện không thể hiển thị phần này. Hãy tải lại ứng dụng để tiếp tục.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-6 min-h-11 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1014]"
          >
            Tải lại ứng dụng
          </button>
        </section>
      </main>
    );
  }
}

export default ErrorBoundary;
