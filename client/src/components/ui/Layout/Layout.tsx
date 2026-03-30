import { useState } from 'react'
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion'
import { Header } from './Header'
import { EffectGallery } from '@/components/ui/EffectGallery/EffectGallery'
import { EffectPanel } from '@/components/ui/EffectPanel/EffectPanel'
import { GenerationView } from '@/components/ui/GenerationView/GenerationView'
import { HistoryModal } from '@/components/ui/HistoryModal/HistoryModal'
import { SettingsModal } from '@/components/ui/SettingsModal/SettingsModal'
import { OnboardingModal } from '@/components/ui/OnboardingModal/OnboardingModal'
import { useGenerationStore } from '@/store/generationStore'
import { useSelectedEffect } from '@/store/effectsStore'
import { useConfigStore } from '@/store/configStore'
import { useSse } from '@/hooks/useSse'

const PANEL_WIDTH_PERCENT = 35
const SLIDE_DURATION = 0.3
const SLIDE_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]

const panelVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: 'easeOut' } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15 } },
}

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const viewingJobId = useGenerationStore((s) => s.viewingJobId)
  const activeJobs = useGenerationStore((s) => s.activeJobs)
  const selectedEffect = useSelectedEffect()
  const showOnboarding = useConfigStore((s) => s.showOnboarding)

  useSse(viewingJobId)

  const rightOpen = !!selectedEffect
  const showGeneration = viewingJobId && activeJobs.has(viewingJobId)

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--background)' }}>
      <Header onSettingsOpen={() => setSettingsOpen(true)} />

      <LayoutGroup>
        <div className="relative flex flex-1 overflow-hidden">
          {/* Left panel */}
          <motion.div
            layout
            className="flex-1 overflow-hidden"
            animate={{ marginRight: rightOpen ? `${PANEL_WIDTH_PERCENT}%` : 0 }}
            transition={{ duration: SLIDE_DURATION, ease: SLIDE_EASE }}
          >
            <AnimatePresence mode="wait">
              {showGeneration ? (
                <motion.div
                  key="generation"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <GenerationView />
                </motion.div>
              ) : (
                <motion.div
                  key="gallery"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <EffectGallery />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Right: Effect settings panel */}
          <AnimatePresence>
            {selectedEffect && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0, transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                exit={{ x: '100%', transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                className="absolute inset-y-0 right-0 overflow-y-auto"
                style={{
                  width: `${PANEL_WIDTH_PERCENT}%`,
                  background: 'var(--surface)',
                  borderLeft: '1px solid var(--border)',
                  boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
                }}
              >
                <EffectPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <HistoryModal />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {showOnboarding && <OnboardingModal />}
    </div>
  )
}
