import type { ServerClock } from './serverClock';
import { PHOTO_INTERVAL_MIN } from './config';

const SLOT_MS = PHOTO_INTERVAL_MIN * 60_000;

/** Slot yang sudah jatuh tempo dan belum selesai. Slot 0 = saat Start, slot n = started_at + n*10 menit. */
export function dueSlots(startedAtMs: number, nowMs: number, done: Set<number>): number[] {
  if (nowMs < startedAtMs) return [];
  const max = Math.floor((nowMs - startedAtMs) / SLOT_MS);
  const out: number[] = [];
  for (let s = 0; s <= max; s++) if (!done.has(s)) out.push(s);
  return out;
}

type Deps = {
  clock: ServerClock;
  stream: () => MediaStream | null;
  capture: (stream: MediaStream) => Promise<Blob>;
  upload: (slot: number, blob: Blob) => Promise<void>;
  onCameraLost: () => void;
};

export class SnapshotScheduler {
  private startedAt = 0;
  private done = new Set<number>();
  private inflight = new Set<number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lostReported = false;

  constructor(private deps: Deps, private tickMs = 15_000) {}

  start(startedAtMs: number, doneSlots: number[]): void {
    this.startedAt = startedAtMs;
    this.done = new Set(doneSlots);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const skip = new Set([...this.done, ...this.inflight]);
    const due = dueSlots(this.startedAt, this.deps.clock.now(), skip);
    if (!due.length) return;
    const slot = due[due.length - 1];
    // slot yang terlewat (misalnya HP mati) tidak dikejar: cukup foto terbaru
    for (const s of due.slice(0, -1)) this.done.add(s);

    const stream = this.deps.stream();
    if (!stream) {
      if (!this.lostReported) {
        this.lostReported = true;
        this.deps.onCameraLost();
      }
      return; // dicoba lagi pada tick berikutnya
    }
    this.lostReported = false;
    this.inflight.add(slot);
    try {
      const blob = await this.deps.capture(stream);
      await this.deps.upload(slot, blob);
      this.done.add(slot);
    } catch {
      /* gagal (jaringan): slot tetap belum selesai, dicoba lagi pada tick berikutnya */
    } finally {
      this.inflight.delete(slot);
    }
  }
}
