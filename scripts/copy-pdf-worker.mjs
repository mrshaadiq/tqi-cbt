// Menyalin worker pdfjs ke public/ agar bisa dimuat dari /pdf.worker.min.js (dipanggil otomatis oleh "postinstall").
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

const src = 'node_modules/pdfjs-dist/build/pdf.worker.min.js';
if (existsSync(src)) {
  mkdirSync('public', { recursive: true });
  copyFileSync(src, 'public/pdf.worker.min.js');
  console.log('pdf.worker.min.js disalin ke public/');
}
