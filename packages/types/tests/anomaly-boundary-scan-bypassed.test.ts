import { describe, it, expect } from 'vitest';
import { AnomalyTypeZ } from '../src/anomaly.js';

// Phase 352 (352-01, T1): `boundary-scan-bypassed` is appended as the last
// member of AnomalyTypeZ; existing members keep their positions.
describe('AnomalyTypeZ — boundary-scan-bypassed (phase 352)', () => {
  it('352-01/AC-4: parses boundary-scan-bypassed', () => {
    expect(AnomalyTypeZ.parse('boundary-scan-bypassed')).toBe('boundary-scan-bypassed');
  });

  it('352-01/AC-4: boundary-scan-bypassed is appended directly after build-test-bypassed, which keeps its position', () => {
    // Pinned relative to its predecessor rather than to the enum's end or
    // length, so a later phase appending another member does not have to
    // edit this test.
    const options = AnomalyTypeZ.options;
    expect(options.indexOf('build-test-bypassed')).toBe(19);
    expect(options.indexOf('boundary-scan-bypassed')).toBe(options.indexOf('build-test-bypassed') + 1);
  });

  it('352-01/AC-4: boundary-scan-bypassed is the last member of AnomalyTypeZ', () => {
    // AC-4 states "as its last member" for this phase. A later phase that
    // appends another anomaly type updates this assertion with its own.
    const options = AnomalyTypeZ.options;
    expect(options[options.length - 1]).toBe('boundary-scan-bypassed');
  });
});
