export interface SessionQueueChipProps {
  label: string;
  state: "done" | "current" | "upcoming" | "bypassed";
}

export function SessionQueueChip({ label, state }: SessionQueueChipProps) {
  return (
    <span
      className={`session-queue-chip ${state}`}
      data-testid="session-queue-chip"
      data-state={state}
    >
      {label}
    </span>
  );
}
