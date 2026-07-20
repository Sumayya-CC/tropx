import { centsToDisplay, displayToCents } from './currency.utils';

// Trivial, dependency-free proof that the Karma/ChromeHeadless harness runs.
// Full money-math invariant coverage (tax, discount, balance, reconciliation)
// is a separate, later testing phase — this only proves the machinery works.
describe('currency.utils', () => {
  it('round-trips a dollar amount through display and back to exact cents', () => {
    expect(displayToCents(centsToDisplay(1050))).toBe(1050);
  });

  it('rounds away float drift instead of truncating it (19.99 * 100 is 1998.9999999999998 in raw JS float math)', () => {
    expect(displayToCents(19.99)).toBe(1999);
  });
});
