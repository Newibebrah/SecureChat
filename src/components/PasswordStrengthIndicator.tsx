import { useMemo } from "react";

interface StrengthResult {
  score: number;
  label: string;
  color: string;
  checks: { label: string; met: boolean }[];
}

function analyzePassword(password: string): StrengthResult {
  const checks = [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "At least 12 characters", met: password.length >= 12 },
    { label: "Uppercase letter", met: /[A-Z]/.test(password) },
    { label: "Lowercase letter", met: /[a-z]/.test(password) },
    { label: "Number", met: /\d/.test(password) },
    { label: "Special character", met: /[^A-Za-z0-9]/.test(password) },
  ];

  const passed = checks.filter((c) => c.met).length;

  let score: number;
  let label: string;
  let color: string;

  if (password.length === 0) {
    score = 0;
    label = "Enter a password";
    color = "var(--text-secondary)";
  } else if (passed <= 2) {
    score = 20;
    label = "Weak";
    color = "var(--error)";
  } else if (passed <= 3) {
    score = 40;
    label = "Fair";
    color = "#f97316";
  } else if (passed <= 4) {
    score = 60;
    label = "Good";
    color = "var(--warning)";
  } else if (passed <= 5) {
    score = 80;
    label = "Strong";
    color = "#22c55e";
  } else {
    score = 100;
    label = "Very Strong";
    color = "#06b6d4";
  }

  return { score, label, color, checks };
}

export function PasswordStrengthIndicator({
  password,
  confirm,
}: {
  password: string;
  confirm?: string;
}) {
  const strength = useMemo(() => analyzePassword(password), [password]);

  if (password.length === 0) return null;

  const matchBarWidth =
    confirm && confirm.length > 0
      ? password === confirm
        ? 100
        : confirm.length > password.length
          ? 80
          : Math.min(90, (confirm.length / Math.max(password.length, 1)) * 100)
      : 0;

  return (
    <div className="pwd-strength">
      {/* Strength bar */}
      <div className="pwd-strength-bar-track">
        <div
          className="pwd-strength-bar-fill"
          style={{
            width: `${strength.score}%`,
            backgroundColor: strength.color,
          }}
        />
      </div>

      <div className="pwd-strength-header">
        <span className="pwd-strength-label" style={{ color: strength.color }}>
          {strength.label}
        </span>
        {confirm && confirm.length > 0 && (
          <span
            className={`pwd-strength-match ${matchBarWidth >= 100 ? "match-ok" : "match-pending"}`}
          >
            {matchBarWidth >= 100 ? "✓ Passwords match" : "✗ Passwords differ"}
          </span>
        )}
      </div>

      {/* Check grid */}
      <div className="pwd-checks">
        {strength.checks.map((check) => (
          <span
            key={check.label}
            className={`pwd-check-item ${check.met ? "check-met" : "check-unmet"}`}
          >
            <span className="pwd-check-icon">
              {check.met ? "✓" : "○"}
            </span>
            {check.label}
          </span>
        ))}
      </div>
    </div>
  );
}
