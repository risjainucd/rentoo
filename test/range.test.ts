import { describe, test, expect } from 'vitest';
import { parseRange } from '../src/lib/range';

describe('parseRange', () => {
  test('no header -> full', () => {
    expect(parseRange(null, 100)).toEqual({ type: 'full' });
  });
  test('bytes=0-1 -> first 2 bytes', () => {
    expect(parseRange('bytes=0-1', 100)).toEqual({ type: 'range', offset: 0, length: 2 });
  });
  test('bytes=0- (iOS Safari probe) -> whole object', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ type: 'range', offset: 0, length: 100 });
  });
  test('bytes=50- -> tail from 50', () => {
    expect(parseRange('bytes=50-', 100)).toEqual({ type: 'range', offset: 50, length: 50 });
  });
  test('bytes=-20 (suffix) -> last 20 bytes', () => {
    expect(parseRange('bytes=-20', 100)).toEqual({ type: 'range', offset: 80, length: 20 });
  });
  test('bytes=20-10 (end < start) -> unsatisfiable', () => {
    expect(parseRange('bytes=20-10', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('start >= size -> unsatisfiable', () => {
    expect(parseRange('bytes=100-', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('bytes=-0 -> unsatisfiable', () => {
    expect(parseRange('bytes=-0', 100)).toEqual({ type: 'unsatisfiable' });
  });
  test('size 0 with any range -> unsatisfiable', () => {
    expect(parseRange('bytes=0-0', 0)).toEqual({ type: 'unsatisfiable' });
  });
  test('end past EOF clamps to size-1', () => {
    expect(parseRange('bytes=90-999', 100)).toEqual({ type: 'range', offset: 90, length: 10 });
  });
  test('malformed header -> full', () => {
    expect(parseRange('bytes=abc', 100)).toEqual({ type: 'full' });
  });
  test('multi-range header -> full (R2 cannot emit multipart)', () => {
    expect(parseRange('bytes=0-1,5-6', 100)).toEqual({ type: 'full' });
  });
});
