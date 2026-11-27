// Provider adapters normalize imports to File objects and consume export entries.
// No provider-specific code belongs in the workspace or crypto codec.
export class LocalImportSource {
  async read(files) { return Array.from(files); }
}
export class LocalDownloadDestination {
  async write({ blob, name }) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    // Keep the URL briefly for browsers that start reading after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
