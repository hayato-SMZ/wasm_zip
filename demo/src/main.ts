import "./style.css";
import * as zip from "wasm-zip";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>wasm-zip</h1>
    <div class="card">
      <button id="download" type="button">Download</button>
    </div>
    <p class="read-the-docs">
      Click Download to download the zip file.
    </p>
  </div>
`;

async function addFileZeroCopy(
  zipPtr: unknown,
  name: string,
  buffer: ArrayBuffer,
): Promise<void> {
  const bytes = new Uint8Array(buffer);
  // Allocate a staging buffer inside Wasm linear memory.
  const ptr = zip.alloc_staging(bytes.byteLength);
  // Write directly into Wasm linear memory — no intermediate copy.
  // When served with COOP/COEP headers (see vite.config.ts), the Wasm
  // Memory is backed by a SharedArrayBuffer, making set() truly zero-copy.
  const memory = zip.wasm_memory() as WebAssembly.Memory;
  new Uint8Array(memory.buffer, ptr, bytes.byteLength).set(bytes);
  zip.add_file_from_staging(zipPtr, name, ptr, bytes.byteLength);
}

const download = document.getElementById("download");
if (download !== null) {
  download.addEventListener("click", () => {
    const zipobject = zip.create_zip_object(6);
    const filesLoader = [
      fetch("./samplefile/dummy.pdf")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileZeroCopy(zipobject, "pdf/dummy.pdf", buf)),
      fetch("./samplefile/dummy.pdf")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileZeroCopy(zipobject, "pdf/dummy2.pdf", buf)),
      fetch("./samplefile/animal.jpg")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileZeroCopy(zipobject, "img/samplefile.jpg", buf)),
      fetch("./samplefile/line_horse.jpg")
        .then((r) => r.arrayBuffer())
        .then((buf) => addFileZeroCopy(zipobject, "img/samplefile2.jpg", buf)),
    ];
    Promise.all(filesLoader).then(() => {
      const zipblob = zip.finish(zipobject);
      const zipBlob = new Blob([zipblob], { type: "application/zip" });
      const zipurl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = zipurl;
      link.download = "sample.zip";
      link.click();
    });
  });
}
