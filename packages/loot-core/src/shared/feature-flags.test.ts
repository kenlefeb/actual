import { isFlagOn } from './feature-flags';

// The one rule for whether a flag counts as on (ADR 6), shared by the UI's
// useFeatureFlag and the server
describe('isFlagOn', () => {
  it('counts an unset paychecks flag as on while business calendars are on', () => {
    // The upgrade case: paychecks predates its own flag
    expect(isFlagOn({ 'flags.businessCalendars': 'true' }, 'paychecks')).toBe(
      true,
    );
  });

  it('counts paychecks as off while business calendars are off', () => {
    expect(isFlagOn({ 'flags.paychecks': 'true' }, 'paychecks')).toBe(false);
    expect(
      isFlagOn(
        { 'flags.paychecks': 'true', 'flags.businessCalendars': 'false' },
        'paychecks',
      ),
    ).toBe(false);
  });

  it('follows a stored value when the requirements are on', () => {
    const on = { 'flags.businessCalendars': 'true' };
    expect(isFlagOn({ ...on, 'flags.paychecks': 'true' }, 'paychecks')).toBe(
      true,
    );
    expect(isFlagOn({ ...on, 'flags.paychecks': 'false' }, 'paychecks')).toBe(
      false,
    );
  });

  it('uses the default for a flag with no requirements', () => {
    expect(isFlagOn({}, 'businessCalendars')).toBe(false);
    expect(
      isFlagOn({ 'flags.businessCalendars': 'true' }, 'businessCalendars'),
    ).toBe(true);
  });
});
