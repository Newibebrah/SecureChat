import { useState, useCallback, useRef, useEffect } from 'react'
import { usePatternStore } from '../stores/patternStore'

interface PatternLockProps {
  onSuccess: () => void
  onBack?: () => void
  mode: 'set' | 'verify'
  onSetComplete?: (pattern: string) => void
  error?: string | null
}

const SVG_SIZE = 300
const DOT_R = 18
const DOT_SPACING = SVG_SIZE / 4
const POSITIONS = Array.from({ length: 9 }, (_, i) => ({
  x: DOT_SPACING + (i % 3) * DOT_SPACING,
  y: DOT_SPACING + Math.floor(i / 3) * DOT_SPACING,
}))

function getDotIndex(x: number, y: number): number {
  const col = Math.round((x - DOT_SPACING) / DOT_SPACING)
  const row = Math.round((y - DOT_SPACING) / DOT_SPACING)
  if (col < 0 || col > 2 || row < 0 || row > 2) return -1
  return row * 3 + col
}

export function PatternLock({
  onSuccess,
  onBack,
  mode,
  onSetComplete,
  error: externalError,
}: PatternLockProps) {
  const [selected, setSelected] = useState<number[]>([])
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmPattern, setConfirmPattern] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  useEffect(() => {
    if (externalError) setError(externalError)
  }, [externalError])

  const getSvgPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = containerRef.current?.querySelector('svg')
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      return {
        x: ((clientX - rect.left) / rect.width) * SVG_SIZE,
        y: ((clientY - rect.top) / rect.height) * SVG_SIZE,
      }
    },
    []
  )

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      const pt = getSvgPoint(clientX, clientY)
      if (!pt) return
      const idx = getDotIndex(pt.x, pt.y)
      if (idx < 0) return
      isDragging.current = true
      setSelected([idx])
      setCurrentPos(pt)
      setError(null)
    },
    [getSvgPoint]
  )

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isDragging.current) return
      const pt = getSvgPoint(clientX, clientY)
      if (!pt) return
      setCurrentPos(pt)
      const idx = getDotIndex(pt.x, pt.y)
      if (idx >= 0 && !selected.includes(idx)) {
        setSelected((prev) => [...prev, idx])
      }
    },
    [getSvgPoint, selected]
  )

  const handleEnd = useCallback(() => {
    if (!isDragging.current) return
    isDragging.current = false
    setCurrentPos(null)

    const pattern = selected.join(',')
    if (selected.length < 4) {
      setError('Connect at least 4 dots')
      setSelected([])
      return
    }

    if (mode === 'verify') {
      if (usePatternStore.getState().verifyPattern(pattern)) {
        onSuccess()
      } else {
        setError('Wrong pattern')
        setSelected([])
      }
    } else {
      if (confirmPattern === null) {
        setConfirmPattern(pattern)
        setSelected([])
        setError('Confirm your pattern')
      } else {
        if (pattern === confirmPattern) {
          onSetComplete?.(pattern)
          onSuccess()
        } else {
          setError('Patterns do not match')
          setConfirmPattern(null)
          setSelected([])
        }
      }
    }
  }, [selected, mode, confirmPattern, onSuccess, onSetComplete])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => handleStart(e.clientX, e.clientY),
    [handleStart]
  )
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => handleMove(e.clientX, e.clientY),
    [handleMove]
  )
  const handleMouseUp = useCallback(() => handleEnd(), [handleEnd])

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0]
      handleStart(t.clientX, t.clientY)
    },
    [handleStart]
  )
  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0]
      handleMove(t.clientX, t.clientY)
    },
    [handleMove]
  )
  const handleTouchEnd = useCallback(() => handleEnd(), [handleEnd])

  const title =
    mode === 'verify'
      ? 'Draw your pattern'
      : confirmPattern === null
      ? 'Draw a pattern'
      : 'Confirm your pattern'

  const canReset = selected.length > 0

  const handleReset = () => {
    setSelected([])
    setCurrentPos(null)
    setError(null)
  }

  const handleClear = () => {
    setConfirmPattern(null)
    setSelected([])
    setCurrentPos(null)
    setError(null)
    usePatternStore.getState().clearPattern()
    onSuccess()
  }

  return (
    <div className="pattern-lock-container">
      <div className="pattern-lock-card">
        <h2 className="pattern-lock-title">{title}</h2>
        {mode === 'verify' && (
          <p className="pattern-lock-subtitle">Unlock to continue</p>
        )}
        {mode === 'set' && confirmPattern === null && (
          <p className="pattern-lock-subtitle">Connect at least 4 dots</p>
        )}

        <div
          ref={containerRef}
          className={`pattern-lock-svg-wrapper ${error ? 'pattern-error' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="pattern-lock-svg">
            {selected.map((idx, i) => {
              const p = POSITIONS[idx]
              if (i < selected.length - 1) {
                const next = POSITIONS[selected[i + 1]]
                return (
                  <line
                    key={`l-${idx}-${selected[i + 1]}`}
                    x1={p.x}
                    y1={p.y}
                    x2={next.x}
                    y2={next.y}
                    stroke="var(--accent)"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                )
              }
              if (currentPos) {
                return (
                  <line
                    key={`l-${idx}-drag`}
                    x1={p.x}
                    y1={p.y}
                    x2={currentPos.x}
                    y2={currentPos.y}
                    stroke="var(--accent)"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray="6 4"
                  />
                )
              }
              return null
            })}
            {POSITIONS.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={DOT_R}
                fill={selected.includes(i) ? 'var(--accent)' : 'var(--bg-tertiary)'}
                stroke={selected.includes(i) ? 'var(--accent)' : 'var(--text-secondary)'}
                strokeWidth="2"
                className="pattern-dot"
              />
            ))}
          </svg>
        </div>

        {error && <p className="pattern-error-text">{error}</p>}

        <div className="pattern-lock-actions">
          {mode === 'verify' && onBack && (
            <button className="btn btn-ghost" onClick={onBack}>
              Back
            </button>
          )}
          {mode === 'verify' && (
            <button className="btn btn-ghost" onClick={handleClear}>
              Clear Pattern
            </button>
          )}
          {canReset && (
            <button className="btn btn-ghost" onClick={handleReset}>
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
