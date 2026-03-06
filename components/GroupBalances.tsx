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
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentDebt, setPaymentDebt] = useState<SimplifiedDebt | null>(null);
  const [paymentIndex, setPaymentIndex] = useState<number | null>(null);
  const [cardNumber, setCardNumber] = useState('4242 4242 4242 4242');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);

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

  // Ensure we have current user as soon as possible so Pay Now / Settle Up show for payer
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted && data.user?.id) setCurrentUserId(data.user.id);
    });
    return () => { mounted = false; };
  }, []);

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

  const openPaymentModal = (debt: SimplifiedDebt, index: number) => {
    setPaymentDebt(debt);
    setPaymentIndex(index);
    setCardNumber('4242 4242 4242 4242');
    setExpiry('');
    setCvv('');
    setPaymentError(null);
    setPaymentSuccess(null);
    setIsPaymentModalOpen(true);
  };

  const closePaymentModal = () => {
    setIsPaymentModalOpen(false);
    setPaymentDebt(null);
    setPaymentIndex(null);
    setIsPaying(false);
  };

  const handlePayNow = async () => {
    if (!paymentDebt || paymentIndex === null) return;

    setPaymentError(null);
    setPaymentSuccess(null);
    setIsPaying(true);

    try {
      const response = await fetch('/api/mcp/payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: paymentDebt.amount,
          currency: 'INR',
          payer_id: paymentDebt.from_user_id,
          receiver_id: paymentDebt.to_user_id,
          group_id: groupId,
          expense_description: 'Settlement payment',
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setPaymentError(
          data.error ?? 'Payment failed. Please try again.'
        );
        setIsPaying(false);
        return;
      }

      // Record this successful payment as a credit in our own tables
      // so that balance calculations can pick it up.
      const { data: expenseRow, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: groupId,
          description: 'Payment via MCP',
          amount: paymentDebt.amount,
          paid_by: paymentDebt.from_user_id,
          split_type: 'custom',
          created_by: paymentDebt.from_user_id,
          type: 'credit',
        })
        .select('id')
        .single();

      if (expenseError || !expenseRow) {
        console.error(expenseError);
        setPaymentError(
          'Payment was processed, but we could not update balances.'
        );
        setIsPaying(false);
        return;
      }

      const expenseId = expenseRow.id as string;

      const { error: splitsError } = await supabase
        .from('expense_splits')
        .insert([
          {
            // Payer: they are the debtor, paying down what they owe -> positive credit split
            expense_id: expenseId,
            user_id: paymentDebt.from_user_id,
            amount: paymentDebt.amount,
          },
          {
            // Receiver: they are the creditor, reducing what they're owed -> negative credit split
            expense_id: expenseId,
            user_id: paymentDebt.to_user_id,
            amount: -paymentDebt.amount,
          },
        ]);

      if (splitsError) {
        console.error(splitsError);
        setPaymentError(
          'Payment was processed, but we could not update balances.'
        );
        setIsPaying(false);
        return;
      }

      setPaymentSuccess(
        `Payment successful! Payment ID: ${data.payment_id}`
      );
      setIsPaying(false);

      // After a successful payment, briefly show success, then close the modal
      // and refresh balances so the UI reflects the latest state.
      setTimeout(() => {
        closePaymentModal();
        // Recalculate balances so suggested settlements update immediately
        loadBalances();
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setPaymentError('Something went wrong while processing payment.');
      setIsPaying(false);
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
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {/* Pay Now and Settle Up: only for the person who OWES (from_user_id), not the receiver */}
                        {currentUserId === d.from_user_id && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSettle(d, index)}
                              disabled={
                                settlingKey ===
                                `${d.from_user_id}-${d.to_user_id}-${index}`
                              }
                              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                            >
                              {settlingKey ===
                              `${d.from_user_id}-${d.to_user_id}-${index}`
                                ? 'Settling...'
                                : 'Settle Up'}
                            </button>
                            <button
                              type="button"
                              onClick={() => openPaymentModal(d, index)}
                              className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                            >
                              Pay Now
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
      {isPaymentModalOpen && paymentDebt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Pay now
              </h3>
              <button
                type="button"
                onClick={closePaymentModal}
                className="text-sm text-gray-500 hover:text-gray-700"
                disabled={isPaying}
              >
                Cancel
              </button>
            </div>

            <div className="space-y-1 text-sm">
              <p className="text-gray-700">
                Amount:{' '}
                <span className="font-semibold">
                  {formatCurrency(paymentDebt.amount)}
                </span>
              </p>
              <p className="text-xs text-gray-600">
                Paying{' '}
                <span className="font-medium">
                  {paymentDebt.to_email ??
                    paymentDebt.to_user_id.slice(0, 6) + '...'}
                </span>
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="cardNumber"
                  className="block text-xs font-medium text-gray-700"
                >
                  Card number
                </label>
                <input
                  id="cardNumber"
                  type="text"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="4242 4242 4242 4242"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1 space-y-1">
                  <label
                    htmlFor="expiry"
                    className="block text-xs font-medium text-gray-700"
                  >
                    Expiry date
                  </label>
                  <input
                    id="expiry"
                    type="text"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="MM/YY"
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label
                    htmlFor="cvv"
                    className="block text-xs font-medium text-gray-700"
                  >
                    CVV
                  </label>
                  <input
                    id="cvv"
                    type="password"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="123"
                  />
                </div>
              </div>
            </div>

            {isPaying && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                <span>Processing payment...</span>
              </div>
            )}

            {paymentError && (
              <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                <p>{paymentError}</p>
                <button
                  type="button"
                  onClick={handlePayNow}
                  disabled={isPaying}
                  className="mt-2 inline-flex items-center rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                >
                  Retry payment
                </button>
              </div>
            )}

            {paymentSuccess && (
              <div className="rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                {paymentSuccess}
              </div>
            )}

            <button
              type="button"
              onClick={handlePayNow}
              disabled={isPaying}
              className="mt-2 w-full inline-flex justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              {isPaying
                ? 'Processing...'
                : `Pay ${formatCurrency(paymentDebt.amount)}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

