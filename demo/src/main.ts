import "./style.css";
import init, * as zip from "wasm-zip";

await init();

const wasmMemory = zip.wasm_memory() as WebAssembly.Memory;
const isCrossOriginIsolated = window.crossOriginIsolated;
const isSAB = wasmMemory.buffer instanceof SharedArrayBuffer;

console.info("[wasm-zip] crossOriginIsolated:", isCrossOriginIsolated);
console.info("[wasm-zip] memory.buffer is SharedArrayBuffer:", isSAB);
console.info("[wasm-zip] initial WASM memory size:", wasmMemory.buffer.byteLength, "bytes");

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>wasm-zip</h1>

    <div class="card">
      <button id="download" type="button">Download (sample)</button>
    </div>
    <p class="read-the-docs">Click Download to download the zip file.</p>

    <table style="font-size:0.85em;border-collapse:collapse;margin-top:1rem">
      <tr><td style="padding:2px 8px">crossOriginIsolated</td><td id="coi" style="padding:2px 8px"></td></tr>
      <tr><td style="padding:2px 8px">memory.buffer type</td><td id="buftype" style="padding:2px 8px"></td></tr>
      <tr><td style="padding:2px 8px">WASM memory (before)</td><td id="mem-before" style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">WASM memory (after)</td><td id="mem-after" style="padding:2px 8px">—</td></tr>
    </table>

    <hr style="margin:2rem 0"/>

    <h2 style="font-size:1.1em">Large File Test</h2>
    <p style="font-size:0.85em;color:#888">
      合成データを ReadableStream 経由でゼロコピー API に流し込み、JS 側にファイル全体を保持しないことを検証します。<br>
      WASM メモリ使用量 ≈ staging buffer (入力) + ZIP 出力バッファ のみ。
    </p>
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <label style="font-size:0.9em">
        ファイルサイズ:
        <select id="large-size">
          <option value="10">10 MB</option>
          <option value="100" selected>100 MB</option>
          <option value="512">512 MB</option>
          <option value="1024">1 GB</option>
          <option value="2048">2 GB</option>
        </select>
      </label>
      <label style="font-size:0.9em">
        ファイル数:
        <select id="large-count">
          <option value="1" selected>1</option>
          <option value="2">2</option>
          <option value="4">4</option>
        </select>
      </label>
      <button id="large-test" type="button">Run Test</button>
    </div>

    <table id="large-stats" style="font-size:0.85em;border-collapse:collapse;margin-top:1rem;display:none">
      <tr><td style="padding:2px 8px">ステータス</td>      <td id="ls-status"  style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">ZIP 追加時間</td>    <td id="ls-add"     style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">finish() 時間</td>   <td id="ls-finish"  style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">合計時間</td>        <td id="ls-total"   style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">スループット</td>    <td id="ls-tput"    style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">WASM memory (前)</td><td id="ls-mem-b"   style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">WASM memory (後)</td><td id="ls-mem-a"   style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">JS peak 推定</td>    <td id="ls-js-peak" style="padding:2px 8px">—</td></tr>
      <tr><td style="padding:2px 8px">ZIP サイズ</td>     <td id="ls-zipsize" style="padding:2px 8px">—</td></tr>
    </table>
  </div>
`;

document.getElementById("coi")!.textContent = String(isCrossOriginIsolated);
document.getElementById("buftype")!.textContent = isSAB
  ? "SharedArrayBuffer ✓"
  : "ArrayBuffer (SAB 無効)";

// ---- helpers ----------------------------------------------------------------

function fmt(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function ms(t: number): string {
  return t >= 1000 ? `${(t / 1000).toFixed(2)} s` : `${t.toFixed(0)} ms`;
}

/**
 * ReadableStream からチャンクずつ読み取り、WASM staging buffer に直接書き込む。
 * JS 側にファイル全体の ArrayBuffer を作らないため、JS peak メモリ ≈ chunk サイズのみ。
 */
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
      // memory.buffer は WASM メモリ拡張時に新しい SAB になるため毎回参照する
      new Uint8Array(
        (zip.wasm_memory() as WebAssembly.Memory).buffer,
        ptr + offset,
        value.length,
      ).set(value);
      offset += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  zip.add_file_from_staging(zipPtr, name, ptr, size);
  console.debug(`[wasm-zip] stream added "${name}" (${fmt(size)}), ptr=${ptr}`);
}

/** ArrayBuffer を持っている場合の従来パス（後方互換）*/
async function addFileFromBuffer(
  zipPtr: unknown,
  name: string,
  buffer: ArrayBuffer,
): Promise<void> {
  const bytes = new Uint8Array(buffer);
  const ptr = zip.alloc_staging(bytes.byteLength);
  new Uint8Array(
    (zip.wasm_memory() as WebAssembly.Memory).buffer,
    ptr,
    bytes.byteLength,
  ).set(bytes);
  zip.add_file_from_staging(zipPtr, name, ptr, bytes.byteLength);
}

/**
 * 合成 ReadableStream を生成する。
 * 繰り返しパターンを chunk ずつ作るため、JS 側にファイル全体を確保しない。
 */
function createSyntheticStream(
  totalBytes: number,
  chunkSize = 64 * 1024,
): ReadableStream<Uint8Array> {
  const PATTERN_LEN = 256;
  const pattern = new Uint8Array(PATTERN_LEN);
  for (let i = 0; i < PATTERN_LEN; i++) pattern[i] = i;

  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, totalBytes - offset);
      const chunk = new Uint8Array(size);
      for (let i = 0; i < size; i += PATTERN_LEN) {
        chunk.set(pattern.subarray(0, Math.min(PATTERN_LEN, size - i)), i);
      }
      controller.enqueue(chunk);
      offset += size;
    },
  });
}

// ---- sample download --------------------------------------------------------

const download = document.getElementById("download");
if (download !== null) {
  download.addEventListener("click", () => {
    const memBefore = (zip.wasm_memory() as WebAssembly.Memory).buffer.byteLength;
    document.getElementById("mem-before")!.textContent = fmt(memBefore);

    const zipobject = zip.create_zip_object(6);
    const filesLoader = [
      fetch("./samplefile/dummy.pdf")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileFromBuffer(zipobject, "pdf/dummy.pdf", buf)),
      fetch("./samplefile/dummy.pdf")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileFromBuffer(zipobject, "pdf/dummy2.pdf", buf)),
      fetch("./samplefile/animal.jpg")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileFromBuffer(zipobject, "img/samplefile.jpg", buf)),
      fetch("./samplefile/line_horse.jpg")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileFromBuffer(zipobject, "img/samplefile2.jpg", buf)),
    ];
    Promise.all(filesLoader).then(() => {
      const memAfter = (zip.wasm_memory() as WebAssembly.Memory).buffer.byteLength;
      document.getElementById("mem-after")!.textContent = fmt(memAfter);

      const zipblob = zip.finish(zipobject);
      const zipBlob = new Blob([zipblob], { type: "application/zip" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = "sample.zip";
      link.click();
    });
  });
}

// ---- large file test --------------------------------------------------------

document.getElementById("large-test")!.addEventListener("click", async () => {
  const sizeMB = parseInt(
    (document.getElementById("large-size") as HTMLSelectElement).value,
  );
  const fileCount = parseInt(
    (document.getElementById("large-count") as HTMLSelectElement).value,
  );
  const byteLength = sizeMB * 1024 * 1024;
  const totalBytes = byteLength * fileCount;

  const statsTable = document.getElementById("large-stats")!;
  statsTable.style.display = "";
  const CHUNK_SIZE = 64 * 1024; // 64KB

  const set = (id: string, v: string) =>
    (document.getElementById(id)!.textContent = v);

  set("ls-status", "ZIP 追加中…");
  set("ls-add", "—"); set("ls-finish", "—"); set("ls-total", "—");
  set("ls-tput", "—"); set("ls-zipsize", "—");
  set("ls-js-peak", `chunk のみ (≤ ${fmt(CHUNK_SIZE)})`);

  const memBefore = (zip.wasm_memory() as WebAssembly.Memory).buffer.byteLength;
  set("ls-mem-b", fmt(memBefore));

  const tStart = performance.now();

  let zipobject: unknown;
  try {
    zipobject = zip.create_zip_object(6);
    for (let i = 0; i < fileCount; i++) {
      const stream = createSyntheticStream(byteLength, CHUNK_SIZE);
      await addFileFromStream(zipobject, `large/file_${i + 1}.bin`, stream, byteLength);
    }
  } catch (e) {
    set("ls-status", `ZIP 追加失敗: ${e}`);
    return;
  }
  const tAdd = performance.now();
  set("ls-add", ms(tAdd - tStart));
  set("ls-status", "finish() 実行中…");

  let zipblob: Uint8Array;
  try {
    zipblob = zip.finish(zipobject);
  } catch (e) {
    set("ls-status", `finish 失敗: ${e}`);
    return;
  }
  const tFinish = performance.now();

  const memAfter = (zip.wasm_memory() as WebAssembly.Memory).buffer.byteLength;
  set("ls-mem-a", fmt(memAfter));
  set("ls-finish", ms(tFinish - tAdd));
  set("ls-total", ms(tFinish - tStart));
  set("ls-tput", `${(totalBytes / 1024 / 1024 / ((tFinish - tStart) / 1000)).toFixed(1)} MB/s`);
  set("ls-zipsize", fmt(zipblob.byteLength));
  set("ls-status", "完了 ✓");

  console.info(
    `[wasm-zip] large test: ${fileCount}x${sizeMB}MB, total=${fmt(totalBytes)},`,
    `add=${ms(tAdd - tStart)}, finish=${ms(tFinish - tAdd)},`,
    `zip=${fmt(zipblob.byteLength)}, mem ${fmt(memBefore)}→${fmt(memAfter)}`,
  );
});
