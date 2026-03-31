import { create } from 'zustand'
import type { GenerationRecord } from '@/types/api'
import { api } from '@/lib/api'

// Timer lives outside state — it's an implementation detail, not reactive state
let pollTimer: ReturnType<typeof setInterval> | null = null

interface HistoryStore {
  items: GenerationRecord[]
  total: number
  activeCount: number
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
  isOpen: boolean

  loadHistory: () => Promise<void>
  deleteItem: (id: string) => Promise<void>
  open: () => void
  close: () => void
  startPolling: () => void
  stopPolling: () => void
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  items: [],
  total: 0,
  activeCount: 0,
  status: 'idle',
  isOpen: false,

  loadHistory: async () => {
    set({ status: 'loading' })
    try {
      const data = await api.getGenerations()
      set({
        items: data.items,
        total: data.total,
        activeCount: data.active_count,
        status: 'succeeded',
      })
      if (data.active_count === 0) {
        get().stopPolling()
      }
    } catch {
      set({ status: 'failed' })
    }
  },

  deleteItem: async (id) => {
    try {
      await api.deleteGeneration(id)
      set((s) => ({
        items: s.items.filter((i) => i.id !== id),
        total: s.total - 1,
      }))
    } catch {
      // API failed — don't remove from local state
    }
  },

  open: () => {
    set({ isOpen: true })
    get().loadHistory()
    get().startPolling()
  },

  close: () => {
    set({ isOpen: false })
    get().stopPolling()
  },

  startPolling: () => {
    if (pollTimer) return
    pollTimer = setInterval(() => {
      if (get().isOpen && get().activeCount > 0) {
        get().loadHistory()
      } else {
        get().stopPolling()
      }
    }, 2000)
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  },
}))
