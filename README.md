# wasm_zip

This project is aimed at enabling zip compression in frontend development.

## Usage

```
import * as wasm_zip from "wasm-zip"
const zip = wasm_zip;

const action = (){
  const zipObject = zip.create_zip_object();

  fetch("filepath/sample.pdf").then((file) => {
    file.arrayBuffer().then((buffer) => {
      zip.add_file(zipObject, "sample.pdf", new Uint8Array(buffer)).then(() => {
        const deploy_zip = zip.finish(zipObject);
        const blob = new Blob([deploy_zip], {type: "application/zip"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "sample.zip";
        a.click();
        URL.revokeObjectURL(url);
      });
    });
  });
}
action();
```

- `create_zip_object`: create zip instance
- `add_file`: zip instance add a file
- `finish`: response zip buffer
