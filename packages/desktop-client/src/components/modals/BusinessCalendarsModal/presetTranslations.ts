import type { BusinessCalendarPreset } from '@actual-app/core/shared/business-calendar-presets';
import type { BusinessCalendarEntity } from '@actual-app/core/types/models';
import type { TFunction } from 'i18next';

// Preset names become user-editable data, so they are translated once, on copy
function presetLabels(t: TFunction): Record<string, string> {
  return {
    'us-federal-holidays': t('U.S. Federal Holidays'),
    'us-federal-reserve': t('U.S. Federal Reserve'),
    'new-years-day': t("New Year's Day"),
    'martin-luther-king-jr-day': t('Martin Luther King Jr. Day'),
    'washingtons-birthday': t("Washington's Birthday"),
    'memorial-day': t('Memorial Day'),
    juneteenth: t('Juneteenth National Independence Day'),
    'independence-day': t('Independence Day'),
    'labor-day': t('Labor Day'),
    'columbus-day': t('Columbus Day'),
    'veterans-day': t('Veterans Day'),
    'thanksgiving-day': t('Thanksgiving Day'),
    'christmas-day': t('Christmas Day'),
  };
}

export function calendarFromPreset(
  t: TFunction,
  preset: BusinessCalendarPreset,
): Omit<BusinessCalendarEntity, 'id'> {
  const labels = presetLabels(t);
  return {
    ...preset.calendar,
    name: labels[preset.id] ?? preset.name,
    holidays: preset.calendar.holidays.map(rule => ({
      ...rule,
      name: labels[rule.id] ?? rule.name,
    })),
  };
}
