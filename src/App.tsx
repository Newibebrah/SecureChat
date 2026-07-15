import { useState } from "react";
import { Landing } from "./components/Landing";
import { IdentitySetup } from "./components/IdentitySetup";
import { UnlockScreen } from "./components/UnlockScreen";
import { Layout } from "./components/Layout";
import { useIdentityStore } from "./stores/identityStore";
import { useTorStore } from "./stores/torStore";
import "./App.css";

function App() {
  const [page, setPage] = useState<"landing" | "setup" | "unlock" | null>(
    "landing",
  );
  const { appState } = useIdentityStore();
  const { status } = useTorStore();

  const isAppReady = appState === "ready";

  if (isAppReady) {
    return <Layout />;
  }

  if (page === "landing") {
    return (
      <Landing
        onNew={() => setPage("setup")}
        onExisting={() => setPage("unlock")}
      />
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
      {page === "setup" && <IdentitySetup />}
      {page === "unlock" && <UnlockScreen />}
    </div>
  );
}

export default App;
