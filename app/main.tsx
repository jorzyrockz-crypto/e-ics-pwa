import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import UpdateNotice from './UpdateNotice';
import '../index.css';

// Development previews should never be controlled by a stale installed-PWA worker.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  const controlled = Boolean(navigator.serviceWorker.controller);
  void navigator.serviceWorker.getRegistrations().then(async registrations => {
    if (!registrations.length) return;
    await Promise.all(registrations.map(registration => registration.unregister()));
    if (controlled && sessionStorage.getItem('eics.dev-sw-reset') !== '1') {
      sessionStorage.setItem('eics.dev-sw-reset', '1');
      window.location.reload();
    }
  }).catch(() => {});
}

class AppErrorBoundary extends React.Component<{children:React.ReactNode},{error:Error|null}> {
  state={error:null as Error|null};
  static getDerivedStateFromError(error:Error){ return {error}; }
  componentDidCatch(error:Error){ console.error('E-LOAD Tracker failed to render',error); }
  render(){
    if(this.state.error) return <main className="min-h-screen grid place-items-center bg-[var(--bg)] p-5 text-[var(--ink)]"><section className="card w-full max-w-lg p-6 text-center"><h1 className="font-display text-2xl font-extrabold">The app could not finish loading</h1><p className="mt-2 text-sm font-semibold text-[var(--muted)]">Your saved records have not been changed. Reload the app to try again.</p><pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-black/5 p-3 text-left text-xs text-red-800">{this.state.error.message || String(this.state.error)}</pre><button type="button" onClick={()=>window.location.reload()} className="big-btn mt-5 w-full bg-[var(--green)] text-white">Reload app</button></section></main>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <>
        <App />
        {!import.meta.env.DEV && <UpdateNotice />}
      </>
    </AppErrorBoundary>
  </React.StrictMode>,
);
