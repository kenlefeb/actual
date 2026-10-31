import { Trans, useTranslation } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import type { PaycheckEntity } from '@actual-app/core/types/models';
import { useQuery } from '@tanstack/react-query';

import { FinancialText } from '#components/FinancialText';
import { useFormat } from '#hooks/useFormat';
import { paycheckQueries } from '#paychecks';

type PaycheckYearToDateProps = {
  paycheckId: PaycheckEntity['id'];
};

// Totals of the posted pay transactions, to check against a W-2
export function PaycheckYearToDate({ paycheckId }: PaycheckYearToDateProps) {
  const { t } = useTranslation();
  const { data: years } = useQuery(paycheckQueries.yearToDate(paycheckId));
  if (!years) {
    return null;
  }

  const names = [
    ...new Set(years.flatMap(year => year.deductions.map(d => d.name))),
  ];
  const isEmpty = years.every(year => year.gross === 0 && year.net === 0);

  return (
    <View style={{ gap: 8, flexShrink: 0 }}>
      <Text style={{ fontWeight: 600 }}>
        <Trans>Year to date</Trans>
      </Text>
      {isEmpty ? (
        <Text style={{ color: theme.pageTextSubdued }}>
          <Trans>No paychecks posted this year or last year.</Trans>
        </Text>
      ) : (
        <table aria-label={t('Year to date')} style={{ maxWidth: 500 }}>
          <thead>
            <tr>
              <th style={labelStyle}>
                <Trans>Total</Trans>
              </th>
              {years.map(year => (
                <th key={year.year} style={cellStyle}>
                  {String(year.year)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label={t('Gross pay')} amounts={years.map(y => y.gross)} />
            {names.map(name => (
              <Row
                key={name}
                label={name || t('Unnamed deduction')}
                amounts={years.map(
                  y => y.deductions.find(d => d.name === name)?.amount ?? 0,
                )}
              />
            ))}
            <Row label={t('Net pay')} amounts={years.map(y => y.net)} />
          </tbody>
        </table>
      )}
    </View>
  );
}

const cellStyle = { width: 120, textAlign: 'right' } as const;
const labelStyle = { textAlign: 'left', fontWeight: 'normal' } as const;

function Row({ label, amounts }: { label: string; amounts: number[] }) {
  const format = useFormat();
  return (
    <tr>
      <th scope="row" style={labelStyle}>
        {label}
      </th>
      {amounts.map((amount, index) => (
        <td key={index} style={cellStyle}>
          <FinancialText>{format(amount, 'financial')}</FinancialText>
        </td>
      ))}
    </tr>
  );
}
