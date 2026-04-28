import { Component, type ReactNode } from 'react';

interface State {
  hasError: boolean;
  error?: Error;
}

interface Props {
  children: ReactNode;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('ErrorBoundary caught:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center bg-surface-50 p-6 dark:bg-surface-950">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-900">
            <h1 className="mb-2 text-lg font-semibold text-surface-900 dark:text-white">
              Etwas ist schiefgelaufen
            </h1>
            <p className="mb-4 text-sm text-surface-600 dark:text-surface-400">
              Die App ist auf einen unerwarteten Fehler gestoßen.
            </p>
            {this.state.error && (
              <pre className="mb-4 max-h-32 overflow-auto rounded-lg bg-surface-100 p-3 text-xs text-surface-700 dark:bg-surface-800 dark:text-surface-400">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={this.handleReset}
                className="rounded-lg px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
              >
                Erneut versuchen
              </button>
              <button
                onClick={this.handleReload}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
              >
                Seite neu laden
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
