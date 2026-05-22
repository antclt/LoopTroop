import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SHORTCUTS = [
  { key: '?', description: 'Show keyboard shortcuts' },
  { key: 'Escape', description: 'Close current view / modal' },
  { key: 'n', description: 'Create new ticket' },
  { key: 'k', description: 'Navigate to Kanban board' },
  { key: '/', description: 'Focus search' },
]

export function KeyboardShortcuts() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
          || target.isContentEditable || target.closest('[role="textbox"]')) return
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsOpen(false)}>
      <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <CardHeader>
          <CardTitle className="text-sm">Keyboard Shortcuts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {SHORTCUTS.map(s => (
              <div key={s.key} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{s.description}</span>
                <kbd className="px-2 py-0.5 rounded bg-muted text-xs font-mono">{s.key}</kbd>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
