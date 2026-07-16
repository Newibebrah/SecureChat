import { lazy, Suspense, useState, useCallback } from "react";
import { useIdentityStore } from "./stores/identityStore";
import { useTorStore } from "./stores/torStore";
import "./App.css";

const Layout = lazy(() =>
  import("./components/Layout").then((m) => ({ default: m.Layout })),
);
const Landing = lazy(() =>
  import("./components/Landing").then((m) => ({ default: m.Landing })),
);
const IdentitySetup = lazy(() =>
  import("./components/IdentitySetup").then((m) => ({ default: m.IdentitySetup })),
);
const UnlockScreen = lazy(() =>
  import("./components/UnlockScreen").then((m) => ({ default: m.UnlockScreen })),
);

function LoadingFallback() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Loading...</p>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<"landing" | "setup" | "unlock" | null>("landing");
  const appState = useIdentityStore((s) => s.appState);
  const status = useTorStore((s) => s.status);

  const isAppReady = appState === "ready";

  const handleNew = useCallback(() => setPage("setup"), []);
  const handleExisting = useCallback(() => setPage("unlock"), []);

  if (isAppReady) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Layout />
      </Suspense>
    );
  }

  // Session locked → show unlock screen directly
  if (appState === "locked" || page === "unlock") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <UnlockScreen />
      </Suspense>
    );
  }

  if (page === "landing") {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Landing onNew={handleNew} onExisting={handleExisting} />
      </Suspense>
    );
  }

  return (
    <div className="app">
      {status.status === "error" && (
        <>
          <header className="app-header">
            <h1>Anon-Chat</h1>
          </header>
          <main className="app-main">
            <p className="error-text">
              Tor connection failed: {status.message}
            </p>
          </main>
        </>
      )}
      <Suspense fallback={<LoadingFallback />}>
        {page === "setup" && <IdentitySetup />}
      </Suspense>
    </div>
  );
}

export default App;
