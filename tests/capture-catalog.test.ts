import { expect, test } from 'vitest';
import { categoryForFileName, fileExtension } from '../src/generated/capture-catalog';

test.each([
  ['app.apk', 'programs'], ['app.APK', 'programs'], ['report.pdf.exe', 'programs'],
  ['data.tar.unlisted', 'compressed'], ['data.tar.exe', 'programs'],
  ['file.completelyunlisted', 'other'], ['download.mp4.part', 'other'], ['README', 'other'],
])('canonical filename classification: %s', (name, expected) => {
  expect(categoryForFileName(name)).toBe(expected);
});

test.each([
  ['.exe', 'programs', ''], ['C:/temp/report.pdf.exe', 'programs', 'exe'],
  ['C:\\temp\\report.pdf.exe', 'programs', 'exe'], ['/temp.tar.apk/data.tar.unknown', 'compressed', 'unknown'],
  ['/temp.exe/no-extension', 'other', ''], ['.hidden.apk', 'programs', 'apk'],
])('basename and extension parity: %s', (name, category, extension) => {
  expect(categoryForFileName(name)).toBe(category);
  expect(fileExtension(name)).toBe(extension);
});
