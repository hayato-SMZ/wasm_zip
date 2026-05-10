# wasm-zip

WebAssembly-powered ZIP archiver for frontend applications.  
Supports zero-copy file ingestion via SharedArrayBuffer when the page is cross-origin isolated.

## Installation

```sh
npm install wasm-zip
```

## Requirements

### Cross-Origin Isolation (recommended)

To enable the zero-copy streaming path, your server must send the following HTTP headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers are required for `SharedArrayBuffer` support.  
Without them, `wasm_memory().buffer` falls back to a regular `ArrayBuffer` and the copy still occurs once per chunk.

### Vite

```ts
// vite.config.ts
export default defineConfig({
  plugins: [wasm()],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    fs: { allow: [".."] }, // required when pkg/ is outside the project root
  },
});
```

---

## Quick Start

`init()` must be called once before using any API.

```ts
import init, * as zip from "wasm-zip";

await init();
```

### Recommended: stream-based (zero-copy, low JS memory)

Pass a `ReadableStream` and the file size directly. The file is written chunk by chunk into WASM linear memory — the full file is never buffered in the JS heap.

```ts
async function addFileFromStream(
  zipPtr: unknown,
  name: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<void> {
  const ptr = zip.alloc_staging(size);
  const reader = stream.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const mem = zip.wasm_memory() as WebAssembly.Memory;
      new Uint8Array(mem.buffer, ptr + offset, value.length).set(value);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  zip.add_file_from_staging(zipPtr, name, ptr, size);
}

// Fetch a file from the server
const response = await fetch("/files/document.pdf");
const size = Number(response.headers.get("Content-Length"));
const zipPtr = zip.create_zip_object(6);
await addFileFromStream(zipPtr, "document.pdf", response.body!, size);
const result = zip.finish(zipPtr);

// Local file upload
const file: File = inputElement.files![0];
await addFileFromStream(zipPtr, file.name, file.stream(), file.size);
```

**Memory profile (stream-based):**

| Location | Usage |
|---|---|
| JS heap | One chunk only (≤ 64 KB) |
| WASM linear memory | Staging buffer (= file size) + growing ZIP output |

### Legacy: ArrayBuffer-based

If you already have an `ArrayBuffer` (e.g., from a previous `arrayBuffer()` call), you can use `add_file` directly. This copies the data once from the JS heap into WASM linear memory.

```ts
const response = await fetch("/files/document.pdf");
const buffer = await response.arrayBuffer();

const zipPtr = zip.create_zip_object(6);
await zip.add_file(zipPtr, "document.pdf", new Uint8Array(buffer));
const result = zip.finish(zipPtr);
```

---

## Full Example

```ts
import init, * as zip from "wasm-zip";

await init();

async function addFileFromStream(
  zipPtr: unknown,
  name: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<void> {
  const ptr = zip.alloc_staging(size);
  const reader = stream.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const mem = zip.wasm_memory() as WebAssembly.Memory;
      new Uint8Array(mem.buffer, ptr + offset, value.length).set(value);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  zip.add_file_from_staging(zipPtr, name, ptr, size);
}

const zipPtr = zip.create_zip_object(6); // compression level 0–9

const files = [
  { url: "/files/report.pdf",  name: "report.pdf" },
  { url: "/files/photo.jpg",   name: "photo.jpg" },
];

await Promise.all(
  files.map(async ({ url, name }) => {
    const res = await fetch(url);
    const size = Number(res.headers.get("Content-Length"));
    await addFileFromStream(zipPtr, name, res.body!, size);
  }),
);

const bytes = zip.finish(zipPtr);
const blob = new Blob([bytes], { type: "application/zip" });
const a = document.createElement("a");
a.href = URL.createObjectURL(blob);
a.download = "archive.zip";
a.click();
```

---

## API Reference

### `create_zip_object(compression_level: number): unknown`

Creates a new ZIP archive instance. Returns an opaque pointer to be passed to other functions.

- `compression_level`: Deflate compression level (0 = store, 1–9 = compress, 6 = default)

### `add_file(zip_ptr, name: string, file: Uint8Array): Promise<void>`

Adds a file from a `Uint8Array`. Copies the data into WASM memory.

### `add_dir(zip_ptr, name: string): Promise<void>`

Adds a directory entry.

### `finish(zip_ptr): Uint8Array`

Finalizes the archive and returns the ZIP binary. The `zip_ptr` is consumed and must not be used afterwards.

### `alloc_staging(len: number): number`

Allocates a staging buffer in WASM linear memory and returns its pointer. Use with `add_file_from_staging` for the zero-copy path.

### `add_file_from_staging(zip_ptr, name: string, ptr: number, len: number): void`

Adds a file from a previously allocated staging buffer. The buffer is freed after this call.

### `wasm_memory(): WebAssembly.Memory`

Returns the WASM linear memory object. Use `memory.buffer` to create `Uint8Array` views for direct read/write access when implementing the streaming path.

---

## Browser Compatibility

| Browser | Minimum version |
|---|---|
| Chrome | 92+ |
| Firefox | 79+ |
| Safari | 15.2+ |

SharedArrayBuffer requires cross-origin isolation (`crossOriginIsolated === true`).  
Without it, the library still works but `memory.buffer` will be a regular `ArrayBuffer`.
