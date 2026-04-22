import type { AppState } from '../types'

export const selectPlaygroundIsOpen = (s: AppState) => s.playground.isOpen
