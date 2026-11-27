import test from 'node:test';
import assert from 'node:assert/strict';
import { filterResults } from '../dist/lib/file-search.js';

const files = [
  { path: 'docs/Annual Report.txt', rootName: 'Business', group: 'business' },
  { path: 'photos/beach.jpg', rootName: 'Vacation', group: 'holiday' },
  { path: 'notes/packing.txt', rootName: 'Vacation', group: 'holiday' },
  { path: 'hello.txt', rootName: 'unrelated', group: null }
];
test('search includes nested paths and container folder names, ignoring case', () => {
  assert.deepEqual(filterResults(files, 'ANNUAL'), [files[0]]);
  assert.deepEqual(filterResults(files, 'photos/beach'), [files[1]]);
  assert.deepEqual(filterResults(files, 'vacation'), [files[1], files[2]]);
  assert.deepEqual(filterResults(files, 'Vacation packing'), [files[2]]);
});
test('empty searches restore all results; unmatched searches return none', () => {
  assert.deepEqual(filterResults(files, '  '), files);
  assert.deepEqual(filterResults(files, 'nonexistent'), []);
  assert.deepEqual(filterResults(files, 'unrelated'), []);
  assert.equal(files.length, 4);
});
