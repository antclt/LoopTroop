import packageJson from '../../../package.json'
import { AlertTriangle, Database, Settings } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useProjects } from '@/hooks/useProjects'
import { useStartupStatus } from '@/hooks/useStartupStatus'

function formatStorageSource(source: string) {
  if (source === 'LOOPTROOP_APP_DB_PATH') return 'Custom database path override'
  if (source === 'LOOPTROOP_CONFIG_DIR') return 'Custom config directory override'
  return 'Default app storage location'
}

export function AboutDialog() {
  const { data: startupStatus } = useStartupStatus()
  const { data: projects } = useProjects()

  if (!startupStatus) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Loading LoopTroop details...
        </p>
      </div>
    )
  }

  const attachedProjectCount = projects?.length ?? startupStatus.storage.restoredProjectCount

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          LoopTroop stores application data centrally and keeps project-specific state inside each attached repository.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Runtime
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version</p>
            <p className="mt-1 text-sm font-medium text-foreground">v{packageJson.version}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operating System</p>
            <p className="mt-1 text-sm font-medium text-foreground">{startupStatus.runtime.osLabel}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Application Location</p>
            <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">{startupStatus.runtime.appRoot}</p>
          </div>
          {startupStatus.runtime.appPathWarning && (
            <div className="sm:col-span-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{startupStatus.runtime.appPathWarning}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Storage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attached Projects</p>
              <p className="mt-1 text-sm font-medium text-foreground">{attachedProjectCount}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Storage Source</p>
              <p className="mt-1 text-sm font-medium text-foreground">{formatStorageSource(startupStatus.storage.source)}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">App Database</p>
            <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">{startupStatus.storage.dbPath}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Config Directory</p>
            <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">{startupStatus.storage.configDir}</p>
          </div>
          <p>
            Each attached project stores its local LoopTroop state in:
          </p>
          <p className="rounded-md bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">&lt;repo&gt;/.looptroop/</p>
          <p className="text-xs text-muted-foreground">
            The exact repository path is shown in Project Details.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}