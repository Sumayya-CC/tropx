import { centsToDisplay, displayToCents } from './currency.utils';

// Phase 3.0 proved the harness runs here (round-trip + one float-drift
// case). Phase 3.1 extends this to the full set of float-hostile values —
// this is the one genuinely pure, standalone money-math utility in the
// repo (see the money-math component specs alongside order-form/
// order-detail/bill-form for the trapped tax/discount/total/balance logic
// this phase also covers).
describe('currency.utils', () => {
  it('round-trips a dollar amount through display and back to exact cents', () => {
    expect(displayToCents(centsToDisplay(1050))).toBe(1050);
  });

  it('rounds away float drift instead of truncating it (19.99 * 100 is 1998.9999999999998 in raw JS float math)', () => {
    expect(displayToCents(19.99)).toBe(1999);
  });

  it('rounds away float drift on other classic 0.1-plus-0.2-style values', () => {
    // 0.29 * 100 is 28.999999999999996 in raw JS float math.
    expect(displayToCents(0.29)).toBe(29);
  });

  it('documents a known boundary case: half-cent float representation can round the "wrong" way', () => {
    // 1.005 * 100 is 100.49999999999999 in raw JS float math — Math.round
    // sees a value just under the .5 threshold and rounds DOWN to 100,
    // not the mathematically-expected 101. This is inherent to any
    // Math.round(x * 100) conversion on a binary float and isn't fixed
    // here (that's a rounding-strategy decision, not a Phase 3.1 fix) —
    // asserting the real, current behavior so a future change to this
    // function is a deliberate choice, not an accidental regression.
    expect(displayToCents(1.005)).toBe(100);
  });

  it('parses a formatted display string back to the same exact cents', () => {
    expect(displayToCents(centsToDisplay(84475))).toBe(84475); // $844.75
    expect(displayToCents('$844.75')).toBe(84475);
  });

  it('never returns NaN for null/undefined/garbage input', () => {
    expect(displayToCents(null as unknown as string)).toBe(0);
    expect(centsToDisplay(NaN)).toBe('');
  });
});
