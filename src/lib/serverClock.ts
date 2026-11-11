/** Jam server: selisih antara jam database dan jam perangkat peserta. */
export class ServerClock {
  private offset = 0;

  /** Panggil setiap kali menerima `server_now` dari database. */
  sync(serverNowIso: string, receivedAtMs: number = Date.now()): void {
    this.offset = Date.parse(serverNowIso) - receivedAtMs;
  }

  /** Waktu server saat ini (ms sejak epoch). */
  now(): number {
    return Date.now() + this.offset;
  }
}
