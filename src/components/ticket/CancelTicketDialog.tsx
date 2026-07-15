import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCancelTicket } from '@/hooks/useTickets'

interface CancelTicketDialogProps {
  ticketId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CancelTicketDialog({ ticketId, open, onOpenChange }: CancelTicketDialogProps) {
  const { mutate: cancelTicket, isPending } = useCancelTicket()
  const [deleteContent, setDeleteContent] = useState(false)
  const [deleteLog, setDeleteLog] = useState(false)

  const close = () => {
    onOpenChange(false)
    setDeleteContent(false)
    setDeleteLog(false)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel Ticket</DialogTitle>
          <DialogDescription className="sr-only">
            Confirm cancellation and choose optional cleanup actions.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The ticket will be stopped and moved to Canceled. No further AI execution will occur.
          Artifacts generated up to this point are preserved by default.
        </p>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background accent-destructive cursor-pointer"
              checked={deleteContent}
              onChange={(event) => setDeleteContent(event.target.checked)}
              data-testid="delete-content-checkbox"
            />
            <span className="text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
              <span className="font-medium text-foreground">Delete AI-generated artifacts and worktree</span>
              <br />
              Permanently removes all AI-generated content stored for this ticket — interview questions and answers, PRD drafts, beads plan entries — and deletes the isolated git worktree including its branch and any code written to it. This cannot be undone.
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 rounded border border-border bg-background accent-destructive cursor-pointer"
              checked={deleteLog}
              onChange={(event) => setDeleteLog(event.target.checked)}
              data-testid="delete-log-checkbox"
            />
            <span className="text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
              <span className="font-medium text-foreground">Delete execution log</span>
              <br />
              Permanently removes both persisted execution logs: the normal phase log and the debug/forensic log. The log viewer will show no history for this ticket after deletion.
            </span>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={close}>Keep Ticket</Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={isPending}
            onClick={() => {
              cancelTicket({ id: ticketId, options: { deleteContent, deleteLog } })
              close()
            }}
          >
            Yes, Cancel Ticket
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
