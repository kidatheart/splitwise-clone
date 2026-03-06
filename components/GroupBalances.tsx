'use client';

import { useEffect, useState } from 'react';
import {
  calculateGroupBalances,
  simplifyDebts,
  NetBalanceResult,
  SimplifiedDebt,
} from '@/lib/calculations';
import { supabase } from '@/lib/supabase';

type Props = {
  groupId: string;
};

export function GroupBalances({ groupId }: Props) {
  const [balances, setBalances] = useState<NetBalanceResult[]>([]);
  const [debts, setDebts] = useState<SimplifiedDebt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

  const loadBalances = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Track current user so we can show Settle Up button only to payer
      const { data: userData } = await supabase.auth.getUser();
      setCurrentUserId(userData.user?.id ?? null);

      const b = await calculateGroupBalances(groupId);
      setBalances(b);
      setDebts(simplifyDebts(b));
    } catch (err: any) {
      console.error(err);
      setError('Could not load balances.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (groupId) {
      loadBalances();
    }
  }, [groupId]);

  const handleSettle = async (debt: SimplifiedDebt, index: number) => {
    const confirm = window.confirm(
      'Are you sure you want to mark this debt as settled?'
    );
    if (!confirm) return;

    setError(null);
    setSuccess(null);
    const key = `${debt.from_user_id}-${debt.to_user_id}-${index}`;
    setSettlingKey(key);

    // Extra guard: do not try to settle a zero/near-zero debt
    if (debt.amount < 1) {
      setError('This debt is already settled.');
      setSettlingKey(null);
      return;
    }

    try {
      const { data: userData, error: authError } =
        await supabase.auth.getUser();

      if (authError || !userData.user) {
        setError('You must be logged in to settle a debt.');
        return;
      }

      const { data: expenseRow, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: groupId,
          description: 'Settlement',
          amount: debt.amount,
          paid_by: debt.from_user_id,
          split_type: 'custom',
          created_by: userData.user.id,
          type: 'credit',
        })
        .select('id')
        .single();

      if (expenseError || !expenseRow) {
        setError(
          expenseError?.message ?? 'Could not create settlement credit.'
        );
        return;
      }

      const expenseId = expenseRow.id as string;

      const { error: splitsError } = await supabase
        .from('expense_splits')
        .insert([
          {
            expense_id: expenseId,
            user_id: debt.to_user_id,
            amount: -debt.amount,
          },
          {
            expense_id: expenseId,
            user_id: debt.from_user_id,
            amount: debt.amount,
          },
        ]);

      if (splitsError) {
        setError(splitsError.message);
        return;
      }

      await loadBalances();
      setSuccess('Debt marked as settled.');
    } catch (err: any) {
      console.error(err);
      setError('Something went wrong while settling this debt.');
    } finally {
      setSettlingKey(null);
    }
  };

  return (
    <section className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Balances
        </h2>
      </div>

      {success && (
        <p className="text-xs text-emerald-700">{success}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-600">Calculating balances...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : balances.length === 0 ? (
        <p className="text-sm text-gray-600">
          No balances yet. Add an expense or credit to get started.
        </p>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Member balances
            </h3>
            <ul className="space-y-1 text-sm">
              {balances.map((b) => {
                const value = b.net_balance;
                const colorClass =
                  value > 0
                    ? 'text-emerald-700'
                    : value < 0
                    ? 'text-red-600'
                    : 'text-gray-600';
                const label =
                  b.email ?? b.user_id.slice(0, 6) + '...';

                return (
                  <li
                    key={b.user_id}
                    className="flex items-center justify-between"
                  >
                    <span className="text-gray-800">{label}</span>
                    <span className={colorClass}>
                      {value > 0 ? '+' : value < 0 ? '-' : ''}
                      {formatCurrency(Math.abs(value))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Suggested settlements
            </h3>
            {debts.length === 0 ? (
              <p className="text-sm text-gray-600">
                All settled up! 🎉
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {debts.map((d, index) => {
                  const fromLabel =
                    d.from_email ?? d.from_user_id.slice(0, 6) + '...';
                  const toLabel =
                    d.to_email ?? d.to_user_id.slice(0, 6) + '...';

                  return (
                    <li
                      key={`${d.from_user_id}-${d.to_user_id}-${index}`}
                      className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2"
                    >
                      <div className="text-gray-800">
                        <span className="font-medium">{fromLabel}</span>{' '}
                        needs to pay{' '}
                        <span className="font-medium">
                          {toLabel}
                        </span>{' '}
                        <span className="font-semibold">
                          {formatCurrency(d.amount)}
                        </span>
                      </div>
                      {currentUserId === d.from_user_id && (
                        <button
                          type="button"
                          onClick={() => handleSettle(d, index)}
                          disabled={
                            settlingKey ===
                            `${d.from_user_id}-${d.to_user_id}-${index}`
                          }
                          className="ml-3 inline-flex items-center rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                        >
                          {settlingKey ===
                          `${d.from_user_id}-${d.to_user_id}-${index}`
                            ? 'Settling...'
                            : 'Settle Up'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

