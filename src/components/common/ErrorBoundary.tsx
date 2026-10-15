import { Component, type ErrorInfo, type ReactNode } from 'react';

// Keeps one crashing page from blanking the whole app. Nothing is reported
// anywhere (no backend, by design) — the error is shown locally so the user
// can retry or go back, and logged to this browser's console only.
interface Props { children: ReactNode; onHome?: () => void; }
interface State { error: Error | null; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('FraudSentry page error:', error, info.componentStack);
  }

  retry = () => this.setState({ error: null });
  home = () => { this.setState({ error: null }); this.props.onHome?.(); };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="card" style={{ margin: '40px auto', maxWidth: 520, padding: 24, textAlign: 'center' }}>
        <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>Something went wrong on this page</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px' }}>
          Your saved history is safe. Try again, or go back to Home. If it keeps happening, a clearer screenshot or a page reload usually helps.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'monospace', margin: '0 0 16px', wordBreak: 'break-word' }}>{this.state.error.message}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={this.retry}>Try again</button>
          {this.props.onHome && <button className="btn-ghost" onClick={this.home}>Back to Home</button>}
        </div>
      </div>
    );
  }
}
