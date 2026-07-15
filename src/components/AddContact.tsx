import { useState, useRef, useEffect, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useContactStore } from "../stores/contactStore";

type InputMode = "paste" | "scan";

export function AddContact() {
  const [mode, setMode] = useState<InputMode>("paste");
  const [pasteInput, setPasteInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const { resolveQr, setPendingContact, setView } = useContactStore();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-scanner-container";

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanner = useCallback(async () => {
    setScanError(null);
    try {
      const scanner = new Html5Qrcode(scannerContainerId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // On successful scan, stop and process
          scanner.stop().catch(() => {});
          scannerRef.current = null;
          processQrData(decodedText);
        },
        () => {
          // No-op on non-decode
        },
      );
    } catch (err) {
      setScanError(
        "Could not access camera: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore
      }
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mode === "scan") {
      // Small delay to ensure DOM is ready
      const t = setTimeout(() => startScanner(), 100);
      return () => {
        clearTimeout(t);
        stopScanner();
      };
    } else {
      stopScanner();
    }
  }, [mode, startScanner, stopScanner]);

  const processQrData = async (data: string) => {
    setProcessing(true);
    try {
      const contact = await resolveQr(data);
      setPendingContact(contact);
      setView("verify-contact");
    } catch (err) {
      setScanError("Invalid QR data: " + String(err));
    } finally {
      setProcessing(false);
    }
  };

  const handlePasteSubmit = async () => {
    const trimmed = pasteInput.trim();
    if (!trimmed) return;

    setProcessing(true);
    try {
      // Try as JSON first
      const contact = await resolveQr(trimmed);
      setPendingContact(contact);
      setView("verify-contact");
    } catch {
      // Try as just an onion address — not supported without pubkey
      setScanError(
        "Please paste the full QR data (JSON with 'onion' and 'pubkey' fields).",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="contact-screen">
      <div className="contact-screen-header">
        <button className="btn-back" onClick={() => setView("contacts")}>
          &larr; Back
        </button>
        <h2>Add Contact</h2>
      </div>

      {/* Mode switcher */}
      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === "paste" ? "active" : ""}`}
          onClick={() => setMode("paste")}
        >
          Paste
        </button>
        <button
          className={`mode-tab ${mode === "scan" ? "active" : ""}`}
          onClick={() => {
            setMode("scan");
            setScanError(null);
          }}
        >
          Scan QR
        </button>
      </div>

      {mode === "paste" && (
        <div className="paste-section">
          <p className="section-hint">
            Paste the JSON you received from your contact:
          </p>
          <textarea
            className="paste-input"
            rows={4}
            value={pasteInput}
            onChange={(e) => setPasteInput(e.target.value)}
            placeholder='{"onion":"...","pubkey":"..."}'
          />
          {scanError && <p className="error-text">{scanError}</p>}
          <button
            className="btn-primary"
            onClick={handlePasteSubmit}
            disabled={processing || !pasteInput.trim()}
          >
            {processing ? "Validating..." : "Preview Contact"}
          </button>
        </div>
      )}

      {mode === "scan" && (
        <div className="scan-section">
          <div id={scannerContainerId} className="qr-scanner-box" />
          {scanError && (
            <div className="scan-error">
              <p className="error-text">{scanError}</p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setScanError(null);
                  startScanner();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {processing && <p className="processing-text">Processing...</p>}
          <p className="section-hint">
            Point your camera at the contact's QR code.
          </p>
        </div>
      )}
    </div>
  );
}
