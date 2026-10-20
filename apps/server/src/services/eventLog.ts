export interface LogEntry {
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

/** Small in-memory ring buffer of notable events, shown in the admin "Sistema" page. */
export class EventLog {
  private entries: LogEntry[] = [];

  constructor(
    private max = 200,
    private sink?: (entry: LogEntry) => void,
  ) {}

  add(level: LogEntry['level'], message: string): void {
    const entry = { at: new Date().toISOString(), level, message };
    this.entries.push(entry);
    if (this.entries.length > this.max) this.entries.shift();
    this.sink?.(entry);
  }

  list(): LogEntry[] {
    return [...this.entries].reverse();
  }
}
