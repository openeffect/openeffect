import { create } from 'zustand'
import type { GenerationRecord } from '@/types/api'
import { api } from '@/lib/api'

interface HistoryStore {
  items: GenerationRecord[]
  total: number
  activeCount: number
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
  isOpen: boolean
  _pollTimer: ReturnType<typeof setInterval> | null

  loadHistory: () => Promise<void>
  deleteItem: (id: string) => Promise<void>
  openModal: () => void
  closeModal: () => void
  startPolling: () => void
  stopPolling: () => void
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  items: [],
  total: 0,
  activeCount: 0,
  status: 'idle',
  isOpen: false,
  _pollTimer: null,

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
    await api.deleteGeneration(id)
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      total: s.total - 1,
    }))
  },

  openModal: () => {
    set({ isOpen: true })
    get().loadHistory()
    get().startPolling()
  },

  closeModal: () => {
    set({ isOpen: false })
    get().stopPolling()
  },

  startPolling: () => {
    const existing = get()._pollTimer
    if (existing) return
    const timer = setInterval(() => {
      if (get().isOpen && get().activeCount > 0) {
        get().loadHistory()
      } else {
        get().stopPolling()
      }
    }, 2000)
    set({ _pollTimer: timer })
  },

  stopPolling: () => {
    const timer = get()._pollTimer
    if (timer) {
      clearInterval(timer)
      set({ _pollTimer: null })
    }
  },
}))
