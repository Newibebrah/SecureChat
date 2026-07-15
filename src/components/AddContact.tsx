import { useState, useRef, useEffect, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { useContactStore } from "../stores/contactStore";

type InputMode = "paste" | "scan" | "upload";

export function AddContact() {
  const [mode, setMode] = useState<InputMode>("paste");
  const [pasteInput, setPasteInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { resolveQr, setPendingContact, setView } = useContactStore();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-scanner-container";
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const contact = await resolveQr(trimmed);
      setPendingContact(contact);
      setView("verify-contact");
    } catch {
      setScanError(
        "Please paste the full QR data (JSON with 'onion' and 'pubkey' fields).",
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    setScanError(null);
    setProcessing(true);

    try {
      const tempScanner = new Html5Qrcode("qr-upload-preview");
      scannerRef.current = tempScanner;

      const decodedText = await tempScanner.scanFile(file, true);
      scannerRef.current = null;
      processQrData(decodedText);
    } catch (err) {
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setScanError(
        "Could not read QR code from image: " +
          (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setProcessing(false);
      scannerRef.current = null;
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
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
          Camera
        </button>
        <button
          className={`mode-tab ${mode === "upload" ? "active" : ""}`}
          onClick={() => {
            setMode("upload");
            setScanError(null);
            setSelectedFile(null);
          }}
        >
          Upload
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

      {mode === "upload" && (
        <div className="upload-section">
          <p className="section-hint">
            Upload a screenshot or image containing a QR code:
          </p>

          <div
            className="upload-zone"
            onClick={handleUploadClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleUploadClick();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="upload-input-hidden"
            />
            {processing ? (
              <div className="upload-processing">
                <div className="spinner" />
                <p>Decoding QR code...</p>
              </div>
            ) : selectedFile ? (
              <div className="upload-file-info">
                <span className="upload-file-icon">&#128247;</span>
                <p className="upload-file-name">{selectedFile.name}</p>
                <p className="upload-file-size">
                  {(selectedFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div className="upload-prompt">
                <span className="upload-icon">&#128193;</span>
                <p className="upload-text">
                  <strong>Click to select</strong> or drag an image
                </p>
                <p className="upload-hint">PNG, JPG, WEBP</p>
              </div>
            )}
          </div>

          <div id="qr-upload-preview" className="upload-preview-box" />

          {scanError && (
            <div className="scan-error">
              <p className="error-text">{scanError}</p>
              <button
                className="btn-secondary"
                onClick={() => {
                  setScanError(null);
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                Try Another Image
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
