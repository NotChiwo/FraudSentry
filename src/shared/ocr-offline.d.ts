// Embedded OCR engine for the offline build (see vite.config.ts → ocrOfflineAssets).
// In every other build the module exports `available: false` and empty strings.
declare module 'virtual:ocr-offline' {
  export const available: boolean;
  /** tesseract.min.js 5.1.1 source (same file as on jsDelivr) */
  export const tesseractJs: string;
  /** worker.min.js source */
  export const workerJs: string;
  /** tesseract-core-simd-lstm.wasm.js source (WebAssembly embedded) */
  export const coreSimdLstmJs: string;
  /** gzipped traineddata, base64 */
  export const engGzBase64: string;
  export const filGzBase64: string;
}
