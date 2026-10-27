import { Trans, useTranslation } from 'react-i18next';

import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { isRelativeDate } from '@actual-app/core/shared/relative-dates';
import type {
  RelativeDateConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import { Checkbox } from '#components/forms';
import { useBusinessCalendarLookup } from '#hooks/useBusinessCalendarLookup';
import { useScheduleDateLookup } from '#hooks/useScheduleDateLookup';

type RelativeDateEditorProps = {
  value: RelativeDateConfig;
  // The schedule being edited, which cannot be its own source
  scheduleId?: ScheduleEntity['id'];
  onChange: (value: RelativeDateConfig) => void;
};

export function RelativeDateEditor({
  value,
  scheduleId,
  onChange,
}: RelativeDateEditorProps) {
  const { t } = useTranslation();
  const { schedules, isLoading } = useScheduleDateLookup();
  const calendars = useBusinessCalendarLookup();
  const { relativeTo } = value;

  // Relative schedules cannot be sources, so chains never form
  const sources = schedules.filter(
    s => !s.tombstone && s.id !== scheduleId && !isRelativeDate(s._date),
  );
  const isSourceMissing =
    !isLoading &&
    relativeTo.scheduleId !== '' &&
    !schedules.some(s => s.id === relativeTo.scheduleId && !s.tombstone);

  const update = (fields: Partial<RelativeDateConfig>) =>
    onChange({ ...value, ...fields });
  const updateRelative = (fields: Partial<RelativeDateConfig['relativeTo']>) =>
    update({ relativeTo: { ...relativeTo, ...fields } });

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        <Input
          aria-label={t('Offset')}
          type="number"
          min={0}
          value={String(relativeTo.offset)}
          onChangeValue={offset =>
            updateRelative({ offset: Math.max(0, Number(offset) || 0) })
          }
          style={{ width: 55 }}
        />
        <Select
          options={[
            ['business-days', t('business days')],
            ['days', t('days')],
          ]}
          value={relativeTo.unit}
          onChange={unit => updateRelative({ unit })}
        />
        <Select
          options={[
            ['before', t('before')],
            ['after', t('after')],
          ]}
          value={relativeTo.direction}
          onChange={direction => updateRelative({ direction })}
        />
        <Select
          options={[
            ...(isSourceMissing
              ? [[relativeTo.scheduleId, t('deleted schedule')] as const]
              : []),
            ...sources.map(
              s => [s.id, s.name || t('Unnamed schedule')] as const,
            ),
          ]}
          value={relativeTo.scheduleId}
          defaultLabel={t('Choose a schedule')}
          onChange={scheduleId => updateRelative({ scheduleId })}
        />
      </View>

      {/* Counts business days and decides the move below */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text>
          <Trans>Business days in</Trans>
        </Text>
        <Select
          options={[
            ['', t('weekends only')],
            ...calendars.map(c => [c.id, c.name] as const),
          ]}
          value={value.businessCalendarId ?? ''}
          onChange={id => update({ businessCalendarId: id || undefined })}
        />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Checkbox
          id="relative_skipwe"
          checked={!!value.skipWeekend}
          onChange={e => update({ skipWeekend: e.target.checked })}
        />
        <label htmlFor="relative_skipwe" style={{ userSelect: 'none' }}>
          <Trans>Then move</Trans>
        </label>
        <Select
          options={[
            ['before', t('before')],
            ['after', t('after')],
          ]}
          value={value.weekendSolveMode ?? 'after'}
          onChange={weekendSolveMode => update({ weekendSolveMode })}
          disabled={!value.skipWeekend}
        />
        <Text>
          <Trans>non-business days</Trans>
        </Text>
      </View>

      {isSourceMissing && (
        <Text role="note" style={{ color: theme.warningText }}>
          <Trans>
            Source schedule was deleted. Choose another schedule or delete this
            one.
          </Trans>
        </Text>
      )}
    </View>
  );
}
