import "./style.css";
import * as wasmzip from "wasm-zip";

const zip = wasmzip;

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

const download = document.getElementById("download");
if (download !== null) {
  download.addEventListener("click", () => {
    const zipobject = zip.create_zip_object();
    const filesLoader = [
      fetch("./samplefile/dummy.pdf")
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          zip.add_file(zipobject, "pdf/dummy.pdf", new Uint8Array(buffer));
        }),
      fetch("./samplefile/dummy.pdf")
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          zip.add_file(zipobject, "pdf/dummy2.pdf", new Uint8Array(buffer));
        }),
      fetch("./samplefile/animal.jpg")
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          zip.add_file(zipobject, "img/samplefile.jpg", new Uint8Array(buffer));
        }),
      fetch("./samplefile/line_horse.jpg")
        .then((response) => response.arrayBuffer())
        .then((buffer) => {
          zip.add_file(
            zipobject,
            "img/samplefile2.jpg",
            new Uint8Array(buffer)
          );
        }),
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
