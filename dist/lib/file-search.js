export function filterResults(files, query) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (!terms.length) return files;
  return files.filter(file => {
    const path = `${file.rootName && file.group ? `${file.rootName}/` : ''}${file.path}`.toLocaleLowerCase();
    return terms.every(term => path.includes(term));
  });
}
