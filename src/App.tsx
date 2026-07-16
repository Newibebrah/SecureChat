import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { useIdentityStore } from "./stores/identityStore";
import { usePatternStore } from "./stores/patternStore";
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
const PatternLock = lazy(() =>
  import("./components/PatternLock").then((m) => ({ default: m.PatternLock })),
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
  const [page, setPage] = useState<"landing" | "setup" | null>("landing");
  const appState = useIdentityStore((s) => s.appState);
  const pattern = usePatternStore((s) => s.pattern);

  const [patternVerified, setPatternVerified] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showPatternSetup, setShowPatternSetup] = useState(false);

  const isAppReady = appState === "ready";

  useEffect(() => {
    if (isAppReady && page === "setup" && !showReview) {
      setShowReview(true);
    }
  }, [isAppReady, page, showReview]);

  const handleNew = useCallback(() => {
    setPage("setup");
    setShowReview(false);
    setShowPatternSetup(false);
  }, []);

  const handleExisting = useCallback(() => setPage(null), []);

  const handleSetupDone = useCallback(() => {
    setShowReview(false);
    setPatternVerified(true);
    setPage("landing");
  }, []);

  const handlePatternVerified = useCallback(() => {
    setPatternVerified(true);
  }, []);

  const handleBackToLocked = useCallback(() => {
    useIdentityStore.getState().setAppState("locked");
    setPage("landing");
  }, []);

  const needsPattern = isAppReady && !patternVerified && !!pattern && !showReview;

  if (needsPattern) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <PatternLock
          mode="verify"
          onSuccess={handlePatternVerified}
          onBack={handleBackToLocked}
        />
      </Suspense>
    );
  }

  if (isAppReady && !showReview && !showPatternSetup) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <Layout />
      </Suspense>
    );
  }

  if (appState === "locked" || page === null) {
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

  // Setup flow: show identity review & optional pattern setup
  return (
    <div className="app">
      <Suspense fallback={<LoadingFallback />}>
        {showReview && !showPatternSetup && (
          <IdentitySetup
            onDone={handleSetupDone}
            onSetPattern={() => setShowPatternSetup(true)}
          />
        )}
        {showReview && showPatternSetup && (
          <PatternLock
            mode="set"
            onSuccess={handleSetupDone}
            onSetComplete={(p) => usePatternStore.getState().setPattern(p)}
            onBack={() => setShowPatternSetup(false)}
          />
        )}
        {!showReview && page === "setup" && (
          <IdentitySetup onDone={handleSetupDone} />
        )}
      </Suspense>
    </div>
  );
}

export default App;
