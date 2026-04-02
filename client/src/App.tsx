import { useEffect } from 'react'
import { Layout } from '@/features/app/Layout'
import { initializeApp } from '@/store/actions/appActions'

export function App() {
  useEffect(() => {
    initializeApp()
  }, [])

  return <Layout />
}
