// Small, valid synthetic assets for rendering tests; never use personal files.
export function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << >> /Contents 4 0 R >>',
    '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 180] /Resources << >> /Contents 6 0 R >>',
    ''
  ];
  // Distinct colored rectangles let tests check actual pixel output on both pages.
  const first = '0.2 0.5 0.8 rg 20 20 200 140 re f\n';
  const second = '0.7 0.3 0.2 rg 20 20 200 140 re f\n';
  objects[3] = `<< /Length ${first.length} >>\nstream\n${first}endstream`;
  objects[5] = `<< /Length ${second.length} >>\nstream\n${second}endstream`;
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(text.length); text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([text], { type: 'application/pdf' });
}

export function pngFixture() {
  const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5n8AAAAASUVORK5CYII=');
  return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: 'image/png' });
}
