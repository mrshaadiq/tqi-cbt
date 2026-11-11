export async function requestCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('CAMERA_UNSUPPORTED');
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
}

export function streamIsLive(stream: MediaStream | null): boolean {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live' && t.enabled);
}

/** Ambil satu frame dari aliran kamera, kecilkan, kompres ke JPEG. Tanpa pratinjau di layar. */
export async function captureJpeg(stream: MediaStream, maxWidth = 480, quality = 0.6): Promise<Blob> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true; // wajib di Safari iPhone
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise<void>((res) => video.addEventListener('loadeddata', () => res(), { once: true }));
  }
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.pause();
  video.srcObject = null;
  return new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('CAPTURE_FAILED'))), 'image/jpeg', quality),
  );
}
