import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { send } from '@actual-app/core/platform/client/connection';
import type { Query } from '@actual-app/core/shared/query';
import { isPreviewId } from '@actual-app/core/shared/transactions';
import type { TransactionEntity } from '@actual-app/core/types/models';

import { TransactionListWithBalances } from '#components/mobile/transactions/TransactionListWithBalances';
import { SchedulesProvider } from '#hooks/useCachedSchedules';
import { useDateFormat } from '#hooks/useDateFormat';
import { useNavigate } from '#hooks/useNavigate';
import { usePreviewTransactions } from '#hooks/usePreviewTransactions';
import { getSchedulesQuery } from '#hooks/useSchedules';
import { useSyncedPref } from '#hooks/useSyncedPref';
import { useTransactions } from '#hooks/useTransactions';
import { useTransactionsSearch } from '#hooks/useTransactionsSearch';
import { collapseModals, pushModal } from '#modals/modalsSlice';
import * as queries from '#queries';
import { useDispatch } from '#redux';
import * as bindings from '#spreadsheet/bindings';

import { useListFilterConditions } from './useListFilterConditions';

export function AllAccountTransactions() {
  const schedulesQuery = useMemo(() => getSchedulesQuery(), []);

  return (
    <SchedulesProvider query={schedulesQuery}>
      <TransactionListWithPreviews />
    </SchedulesProvider>
  );
}

function TransactionListWithPreviews() {
  const { t } = useTranslation();
  // Conditions from drill-downs (e.g. report activity) plus a tapped tag
  const {
    conditions: filterConditions,
    tagFilter,
    hasOtherConditions,
    onNotesTagClick,
    onClearTagFilter,
  } = useListFilterConditions();
  const isFiltered = filterConditions.length > 0;

  const [hideReconciled] = useSyncedPref('hide-reconciled-all');
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  const makeRootTransactionsQuery = useCallback(() => {
    let query = queries.transactions().options({ splits: 'all' }).select('*');
    if (hideReconciled === 'true') {
      query = query.filter({ reconciled: { $eq: false } });
    }
    return query;
  }, [hideReconciled]);

  const [currentQuery, setCurrentQuery] = useState<Query | undefined>(() =>
    isFiltered ? undefined : makeRootTransactionsQuery(),
  );
  const [transactionsQuery, setTransactionsQuery] = useState<Query | undefined>(
    currentQuery,
  );
  // The conditions the query was last built for. While a filter is being
  // resolved, show nothing rather than the previous (unfiltered) list.
  const [queryConditions, setQueryConditions] = useState<
    typeof filterConditions | null
  >(isFiltered ? null : filterConditions);
  const isFilterPending = isFiltered && queryConditions !== filterConditions;

  const { isSearching, search } = useTransactionsSearch({
    updateQuery: updateFn =>
      setTransactionsQuery(query => (query ? updateFn(query) : query)),
    resetQuery: () => setTransactionsQuery(currentQuery),
    dateFormat,
  });

  const [searchText, setSearchText] = useState('');
  const onSearch = useCallback(
    (text: string) => {
      setSearchText(text);
      search(text);
    },
    [search],
  );

  const [prevHideReconciled, setPrevHideReconciled] = useState(hideReconciled);
  if (hideReconciled !== prevHideReconciled) {
    setPrevHideReconciled(hideReconciled);
    if (!isFiltered) {
      const query = makeRootTransactionsQuery();
      setCurrentQuery(query);
      setTransactionsQuery(
        searchText !== ''
          ? queries.transactionsSearch(query, searchText, dateFormat)
          : query,
      );
    }
  }

  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const wasFilteredRef = useRef(isFiltered);

  useEffect(() => {
    let isStale = false;

    const applyFilters = async () => {
      const rootQuery = makeRootTransactionsQuery();
      let query = rootQuery;
      if (filterConditions.length > 0) {
        const { filters: queryFilters } = await send(
          'make-filters-from-conditions',
          { conditions: filterConditions },
        );
        query = rootQuery.filter({ $and: queryFilters });
      }
      if (!isStale) {
        const text = searchTextRef.current;
        setCurrentQuery(query);
        setQueryConditions(filterConditions);
        setTransactionsQuery(
          text !== ''
            ? queries.transactionsSearch(query, text, dateFormat)
            : query,
        );
      }
    };

    // The unfiltered list is set up by the initial state; only (re)build the
    // query when conditions are present or have just been cleared
    if (filterConditions.length > 0 || wasFilteredRef.current) {
      void applyFilters();
    }
    wasFilteredRef.current = filterConditions.length > 0;

    return () => {
      isStale = true;
    };
  }, [filterConditions, makeRootTransactionsQuery, dateFormat]);

  const {
    transactions,
    isPending: isTransactionsLoading,
    isFetchingNextPage: isLoadingMoreTransactions,
    fetchNextPage: fetchMoreTransactions,
  } = useTransactions({
    query: isFilterPending ? undefined : transactionsQuery,
  });
  const { previewTransactions, isLoading: isPreviewTransactionsLoading } =
    usePreviewTransactions();

  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onOpenTransaction = useCallback(
    (transaction: TransactionEntity) => {
      if (!isPreviewId(transaction.id)) {
        void navigate(`/transactions/${transaction.id}`);
      } else {
        dispatch(
          pushModal({
            modal: {
              name: 'scheduled-transaction-menu',
              options: {
                transactionId: transaction.id,
                onPost: async (transactionId, today = false) => {
                  const parts = transactionId.split('/');
                  await send('schedule/post-transaction', {
                    id: parts[1],
                    today,
                  });
                  dispatch(
                    collapseModals({
                      rootModalName: 'scheduled-transaction-menu',
                    }),
                  );
                },
                onSkip: async transactionId => {
                  const parts = transactionId.split('/');
                  await send('schedule/skip-next-date', { id: parts[1] });
                  dispatch(
                    collapseModals({
                      rootModalName: 'scheduled-transaction-menu',
                    }),
                  );
                },
                onComplete: async transactionId => {
                  const parts = transactionId.split('/');
                  await send('schedule/update', {
                    schedule: { id: parts[1], completed: true },
                  });
                  dispatch(
                    collapseModals({
                      rootModalName: 'scheduled-transaction-menu',
                    }),
                  );
                },
              },
            },
          }),
        );
      }
    },
    [dispatch, navigate],
  );

  const balanceBindings = useMemo(
    () => ({
      balance: bindings.allAccountBalance(),
    }),
    [],
  );

  const transactionsToDisplay =
    !isSearching && !isFiltered
      ? // Do not render child transactions in the list, unless searching or filtering
        previewTransactions.concat(transactions.filter(t => !t.is_child))
      : transactions;

  return (
    <TransactionListWithBalances
      isLoading={
        isSearching || isFiltered
          ? isTransactionsLoading
          : isPreviewTransactionsLoading
      }
      transactions={transactionsToDisplay}
      balance={balanceBindings.balance}
      isLoadingMore={isLoadingMoreTransactions}
      onLoadMore={fetchMoreTransactions}
      searchPlaceholder={t('Search All Accounts')}
      onSearch={onSearch}
      onOpenTransaction={onOpenTransaction}
      showMakeTransfer
      filtered={hasOtherConditions}
      onNotesTagClick={onNotesTagClick}
      tagFilter={tagFilter}
      onClearTagFilter={onClearTagFilter}
    />
  );
}
