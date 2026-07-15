import { useEffect } from "react";
import { TorStatus } from "./components/TorStatus";
import { IdentitySetup } from "./components/IdentitySetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { Layout } from "./components/Layout";
import { useIdentityStore } from "./stores/identityStore";
import { initTorEventListener, useTorStore } from "./stores/torStore";
import "./App.css";

function App() {
  const { appState, checkDatabase } = useIdentityStore();
  const { status } = useTorStore();

  useEffect(() => {
    initTorEventListener();
    checkDatabase();
  }, []);

  const showTorScreen =
    status.status === "offline" || status.status === "bootstrapping";

  const isAppReady = appState === "ready";

  // When the full app is ready, render with unbounded width
  if (isAppReady && status.status !== "error") {
    return <Layout />;
  }

  // Pre-ready screens use the centered constrained layout
  return (
    <div className="app">
      {showTorScreen && (
        <>
          <header className="app-header">
            <h1>Anon-Chat</h1>
            <p className="subtitle">Private. Anonymous. Encrypted.</p>
          </header>
          <main className="app-main">
            <TorStatus />
          </main>
          <footer className="app-footer">
            <p>Connecting to the Tor network...</p>
          </footer>
        </>
      )}

      {status.status === "error" && (
        <>
          <header className="app-header">
            <h1>Anon-Chat</h1>
          </header>
          <main className="app-main">
            <TorStatus />
          </main>
        </>
      )}

      {status.status === "ready" && appState === "uninitialized" && (
        <IdentitySetup />
      )}
      {status.status === "ready" && appState === "locked" && <UnlockScreen />}
    </div>
  );
}

export default App;
