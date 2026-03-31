import { useEffect } from 'react'
import { Layout } from '@/layout/Layout'
import { useConfigStore } from '@/store/configStore'

export function App() {
  const loadConfig = useConfigStore((s) => s.loadConfig)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  return <Layout />
}
