export type AnswerPayload = {
  attemptId: string;
  questionId: string;
  optionId: string | null;
  flagged: boolean;
  clientSeq: number;
  token: string;
};

const FATAL = ['time_over', 'session_replaced', 'forbidden', 'not_authenticated'];

/**
 * Antrean jawaban: hanya nilai terbaru per soal yang dikirim, nomor urut (clientSeq) selalu naik,
 * gagal jaringan -> coba lagi dengan jeda bertambah, error fatal -> berhenti dan lapor.
 */
export class AnswerQueue {
  private map = new Map<string, AnswerPayload>();
  private lastSeq = 0;
  private running = false;
  private stopped = false;
  private delay = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private send: (a: AnswerPayload) => Promise<void>,
    private onFatal: (code: string) => void = () => {},
    private opts = { baseDelayMs: 1000, maxDelayMs: 15000 },
  ) {}

  enqueue(a: Omit<AnswerPayload, 'clientSeq'>): void {
    if (this.stopped) return;
    // Date.now() menjaga nomor tetap naik walau halaman dimuat ulang (lastSeq mulai dari 0 lagi)
    this.lastSeq = Math.max(this.lastSeq + 1, Date.now());
    this.map.set(a.questionId, { ...a, clientSeq: this.lastSeq });
    if (!this.timer) void Promise.resolve().then(() => this.flush());
  }

  pending(): number {
    return this.map.size;
  }

  async flush(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.map.size > 0) {
        const [qid, payload] = this.map.entries().next().value as [string, AnswerPayload];
        try {
          await this.send(payload);
          if (this.map.get(qid) === payload) this.map.delete(qid); // yang lebih baru tetap menunggu
          this.delay = 0;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const fatal = FATAL.find((c) => msg.includes(c));
          if (fatal) {
            this.stopped = true;
            this.map.clear();
            this.onFatal(fatal);
            return;
          }
          this.delay = Math.min(this.delay ? this.delay * 2 : this.opts.baseDelayMs, this.opts.maxDelayMs);
          this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush();
          }, this.delay);
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
