import "./style.css";
import init, * as zip from "wasm-zip";

await init();

const isCrossOriginIsolated = window.crossOriginIsolated;
const isSAB = (zip.wasm_memory() as WebAssembly.Memory).buffer instanceof SharedArrayBuffer;

console.info("[wasm-zip] crossOriginIsolated:", isCrossOriginIsolated);
console.info("[wasm-zip] memory.buffer is SharedArrayBuffer:", isSAB);

// ---- helpers ----------------------------------------------------------------

function fmt(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function ms(t: number): string {
  return t >= 1000 ? `${(t / 1000).toFixed(2)} s` : `${t.toFixed(0)} ms`;
}

function jsHeapUsed(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

function fmtJSHeap(v: number | null): string {
  return v !== null ? fmt(v) : "N/A (Chrome のみ対応)";
}

function fmtTotal(js: number | null, wasm: number): string {
  return js !== null ? fmt(js + wasm) : `WASM ${fmt(wasm)} + JS N/A`;
}

function wasmBytes(): number {
  return (zip.wasm_memory() as WebAssembly.Memory).buffer.byteLength;
}

/** メモリ計測スナップショット */
interface MemSnap { js: number | null; wasm: number }
function snap(): MemSnap { return { js: jsHeapUsed(), wasm: wasmBytes() }; }

/** ZIP を生成してダウンロードリンクを返す共通ロジック */
async function buildZip(
  files: { name: string; stream: ReadableStream<Uint8Array>; size: number }[],
  onPeak?: (s: MemSnap) => void,
): Promise<{ blob: Blob; before: MemSnap; peak: MemSnap | null; after: MemSnap }> {
  const before = snap();
  const zipPtr = zip.create_zip_object(6);
  let peak: MemSnap | null = null;

  for (const f of files) {
    await addFileFromStream(zipPtr, f.name, f.stream, f.size, (s) => {
      if (peak === null) { peak = s; onPeak?.(s); }
    });
  }

  const zipblob = zip.finish(zipPtr);
  const after = snap();
  return {
    blob: new Blob([zipblob], { type: "application/zip" }),
    before,
    peak,
    after,
  };
}

// WASM32 では isize::MAX (2,147,483,647 bytes) が単一確保の上限
const WASM32_MAX_ALLOC = 2147483647;

async function addFileFromStream(
  zipPtr: unknown,
  name: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
  onStagingAllocated?: (s: MemSnap) => void,
): Promise<void> {
  if (size > WASM32_MAX_ALLOC) {
    throw new Error(
      `"${name}" は ${fmt(size)} です。WASM32 の単一確保上限 (${fmt(WASM32_MAX_ALLOC)}) を超えています。` +
      `ファイルを分割してください。`,
    );
  }
  const ptr = zip.alloc_staging(size);
  onStagingAllocated?.(snap());

  const reader = stream.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
}

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
      if (offset >= totalBytes) { controller.close(); return; }
      const size = Math.min(chunkSize, totalBytes - offset);
      const chunk = new Uint8Array(size);
      for (let i = 0; i < size; i += PATTERN_LEN)
        chunk.set(pattern.subarray(0, Math.min(PATTERN_LEN, size - i)), i);
      controller.enqueue(chunk);
      offset += size;
    },
  });
}

/** 共通メモリ統計テーブル HTML を生成 */
function memStatsTableHTML(prefix: string): string {
  const td = (label: string, id: string) =>
    `<tr><td style="padding:2px 8px">${label}</td><td id="${prefix}-${id}" style="padding:2px 8px">—</td></tr>`;
  const sep = (label: string) =>
    `<tr><td colspan="2" style="padding:4px 8px 2px;color:#888;font-size:0.9em">${label}</td></tr>`;
  return `
    <table style="font-size:0.85em;border-collapse:collapse;margin-top:0.75rem">
      ${td("ステータス", "status")}
      ${td("合計時間", "total")}
      ${td("スループット", "tput")}
      ${td("ZIP サイズ", "zipsize")}
      ${sep("── メモリ (前: ベースライン) ──")}
      ${td("　JS heap", "js-b")} ${td("　WASM linear memory", "mem-b")}
      ${td("　合計", "total-b")}
      ${sep("── メモリ (ピーク: staging 確保直後) ──")}
      ${td("　JS heap", "js-p")} ${td("　WASM linear memory", "mem-p")}
      ${td("　合計", "total-p")}
      ${sep("── メモリ (後: finish() 完了後) ──")}
      ${td("　JS heap", "js-a")} ${td("　WASM linear memory", "mem-a")}
      ${td("　合計", "total-a")}
    </table>
    <p id="${prefix}-error" style="display:none;color:#e53e3e;font-size:0.9em;margin-top:0.5rem;padding:0.5rem 0.75rem;border:1px solid #e53e3e;border-radius:4px;"></p>`;
}

/** 共通メモリ統計セッター */
function makeStats(prefix: string) {
  const set = (id: string, v: string) => {
    const el = document.getElementById(`${prefix}-${id}`);
    if (el) el.textContent = v;
  };
  const showError = (msg: string) => {
    const el = document.getElementById(`${prefix}-error`)!;
    el.textContent = msg;
    el.style.display = "";
    set("status", "エラー");
  };
  const clearError = () => {
    const el = document.getElementById(`${prefix}-error`)!;
    if (el) el.style.display = "none";
  };
  const applySnap = (suffix: string, s: MemSnap) => {
    set(`js-${suffix}`, fmtJSHeap(s.js));
    set(`mem-${suffix}`, fmt(s.wasm));
    set(`total-${suffix}`, fmtTotal(s.js, s.wasm));
  };
  return { set, showError, clearError, applySnap };
}

// ---- DOM --------------------------------------------------------------------

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>wasm-zip</h1>

    <table style="font-size:0.85em;border-collapse:collapse;margin-bottom:1rem">
      <tr><td style="padding:2px 8px">crossOriginIsolated</td><td style="padding:2px 8px">${isCrossOriginIsolated}</td></tr>
      <tr><td style="padding:2px 8px">memory.buffer type</td><td style="padding:2px 8px">${isSAB ? "SharedArrayBuffer ✓" : "ArrayBuffer (SAB 無効)"}</td></tr>
    </table>

    <hr style="margin:1.5rem 0"/>

    <!-- ① Fetch Stream -->
    <h2 style="font-size:1.1em">① Fetch Stream</h2>
    <p style="font-size:0.85em;color:#888">
      サーバーからファイルを fetch し、<code>response.body</code>（ReadableStream）を直接 WASM に書き込みます。<br>
      JS 側にファイル全体の ArrayBuffer を作りません。
    </p>
    <div style="font-size:0.9em;margin-bottom:0.5rem">
      <label><input type="checkbox" class="fetch-check" value="samplefile/dummy.pdf"    data-name="pdf/dummy.pdf"    checked> dummy.pdf</label><br>
      <label><input type="checkbox" class="fetch-check" value="samplefile/animal.jpg"   data-name="img/animal.jpg"   checked> animal.jpg</label><br>
      <label><input type="checkbox" class="fetch-check" value="samplefile/line_horse.jpg" data-name="img/line_horse.jpg" checked> line_horse.jpg</label>
    </div>
    <button id="fetch-run" type="button">Create ZIP (Fetch Stream)</button>
    ${memStatsTableHTML("fs")}

    <hr style="margin:1.5rem 0"/>

    <!-- ② File Upload Stream -->
    <h2 style="font-size:1.1em">② File Upload Stream</h2>
    <p style="font-size:0.85em;color:#888">
      ローカルファイルを選択し、<code>file.stream()</code>（ReadableStream）を直接 WASM に書き込みます。<br>
      <code>File.size</code> でサイズを取得するため Content-Length 不要です。
    </p>
    <input id="upload-input" type="file" multiple style="font-size:0.9em"/>
    <br><br>
    <button id="upload-run" type="button">Create ZIP (Upload Stream)</button>
    ${memStatsTableHTML("up")}

    <hr style="margin:1.5rem 0"/>

    <!-- ③ Large File Test (synthetic) -->
    <h2 style="font-size:1.1em">③ Large File Test (合成データ)</h2>
    <p style="font-size:0.85em;color:#888">
      合成 ReadableStream を使い、JS 側に大きなバッファを作らずに大容量ファイルの動作を検証します。
    </p>
    <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">
      <label style="font-size:0.9em">サイズ:
        <select id="large-size">
          <option value="10">10 MB</option>
          <option value="100" selected>100 MB</option>
          <option value="512">512 MB</option>
          <option value="1024">1 GB</option>
          <option value="2048">2 GB</option>
        </select>
      </label>
      <label style="font-size:0.9em">ファイル数:
        <select id="large-count">
          <option value="1" selected>1</option>
          <option value="2">2</option>
          <option value="4">4</option>
        </select>
      </label>
      <button id="large-test" type="button">Run Test</button>
    </div>
    ${memStatsTableHTML("ls")}
  </div>
`;

// ---- ① Fetch Stream ---------------------------------------------------------

document.getElementById("fetch-run")!.addEventListener("click", async () => {
  const st = makeStats("fs");
  st.clearError();
  st.set("status", "fetch 中…");

  const checks = Array.from(
    document.querySelectorAll<HTMLInputElement>(".fetch-check:checked"),
  );
  if (checks.length === 0) { st.showError("ファイルを1つ以上選択してください。"); return; }

  let files: { name: string; stream: ReadableStream<Uint8Array>; size: number }[];
  try {
    const responses = await Promise.all(
      checks.map(async (el) => {
        const res = await fetch(`./${el.value}`);
        if (!res.ok) throw new Error(`fetch failed: ${el.value} (${res.status})`);
        const contentLength = res.headers.get("Content-Length");
        if (!contentLength) throw new Error(`Content-Length が取得できません: ${el.value}`);
        return { name: el.dataset.name!, stream: res.body!, size: Number(contentLength) };
      }),
    );
    files = responses;
  } catch (e) {
    st.showError(e instanceof Error ? e.message : String(e));
    return;
  }

  st.set("status", "ZIP 生成中…");
  const tStart = performance.now();
  try {
    const { blob, before, peak, after } = await buildZip(files);
    const elapsed = performance.now() - tStart;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);

    st.applySnap("b", before);
    if (peak) st.applySnap("p", peak);
    st.applySnap("a", after);
    st.set("total", ms(elapsed));
    st.set("tput", `${(totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(1)} MB/s`);
    st.set("zipsize", fmt(blob.size));
    st.set("status", "完了 ✓");

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fetch-stream.zip";
    link.click();
  } catch (e) {
    st.showError(e instanceof Error ? e.message : String(e));
  }
});

// ---- ② File Upload Stream ---------------------------------------------------

document.getElementById("upload-run")!.addEventListener("click", async () => {
  const st = makeStats("up");
  st.clearError();

  const input = document.getElementById("upload-input") as HTMLInputElement;
  const fileList = Array.from(input.files ?? []);
  if (fileList.length === 0) { st.showError("ファイルを選択してください。"); return; }

  const files = fileList.map((f) => ({
    name: f.name,
    stream: f.stream() as ReadableStream<Uint8Array>,
    size: f.size,
  }));

  st.set("status", "ZIP 生成中…");
  const tStart = performance.now();
  try {
    const { blob, before, peak, after } = await buildZip(files);
    const elapsed = performance.now() - tStart;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);

    st.applySnap("b", before);
    if (peak) st.applySnap("p", peak);
    st.applySnap("a", after);
    st.set("total", ms(elapsed));
    st.set("tput", `${(totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(1)} MB/s`);
    st.set("zipsize", fmt(blob.size));
    st.set("status", "完了 ✓");

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "upload-stream.zip";
    link.click();
  } catch (e) {
    st.showError(e instanceof Error ? e.message : String(e));
  }
});

// ---- ③ Large File Test ------------------------------------------------------

document.getElementById("large-test")!.addEventListener("click", async () => {
  const st = makeStats("ls");
  st.clearError();

  const sizeMB = parseInt((document.getElementById("large-size") as HTMLSelectElement).value);
  const fileCount = parseInt((document.getElementById("large-count") as HTMLSelectElement).value);
  const byteLength = sizeMB * 1024 * 1024;
  const totalBytes = byteLength * fileCount;

  const files = Array.from({ length: fileCount }, (_, i) => ({
    name: `large/file_${i + 1}.bin`,
    stream: createSyntheticStream(byteLength),
    size: byteLength,
  }));

  st.set("status", "ZIP 生成中…");
  const tStart = performance.now();
  try {
    const { blob, before, peak, after } = await buildZip(files);
    const elapsed = performance.now() - tStart;

    st.applySnap("b", before);
    if (peak) st.applySnap("p", peak);
    st.applySnap("a", after);
    st.set("total", ms(elapsed));
    st.set("tput", `${(totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(1)} MB/s`);
    st.set("zipsize", fmt(blob.size));
    st.set("status", "完了 ✓");
  } catch (e) {
    st.showError(e instanceof Error ? e.message : String(e));
  }
});
