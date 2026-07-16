import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PatternState {
  pattern: string | null
  setPattern: (pattern: string) => void
  clearPattern: () => void
  verifyPattern: (pattern: string) => boolean
}

export const usePatternStore = create<PatternState>()(
  persist(
    (set, get) => ({
      pattern: null,

      setPattern: (pattern: string) => {
        set({ pattern })
      },

      clearPattern: () => {
        set({ pattern: null })
      },

      verifyPattern: (pattern: string) => {
        return get().pattern === pattern
      },
    }),
    {
      name: 'anon-chat-pattern',
    }
  )
)
