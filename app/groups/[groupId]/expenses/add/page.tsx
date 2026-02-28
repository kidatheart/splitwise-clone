'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type AuthUser = {
  id: string;
  email: string | null;
};

type Member = {
  userId: string;
  email: string | null;
};

type SplitType = 'equal_all' | 'equal_selected' | 'custom';
type ExpenseType = 'expense' | 'credit';

export default function AddExpensePage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string>('');
  const [expenseType, setExpenseType] = useState<ExpenseType>('expense');
  const [splitType, setSplitType] = useState<SplitType>('equal_all');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError || !data.user) {
        router.replace('/login');
        return;
      }

      const authUser: AuthUser = {
        id: data.user.id,
        email: data.user.email ?? null,
      };
      setCurrentUser(authUser);

      // Ensure the user is a member of this group
      const { data: membership, error: membershipError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (membershipError && membershipError.code !== 'PGRST116') {
        setGeneralError('Could not verify your access to this group.');
        setIsLoading(false);
        return;
      }

      if (!membership) {
        router.replace('/dashboard');
        return;
      }

      // Load all members of this group
      const { data: memberRows, error: membersError } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', groupId);

      if (membersError) {
        setGeneralError('Could not load group members.');
        setIsLoading(false);
        return;
      }

      const userIds = (memberRows ?? []).map((m) => m.user_id as string);

      if (userIds.length === 0) {
        setMembers([]);
        setIsLoading(false);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', userIds);

      if (profilesError) {
        setGeneralError('Could not load member details.');
        setIsLoading(false);
        return;
      }

      const emailById = new Map<string, string | null>();
      (profiles ?? []).forEach((p) => {
        emailById.set(p.id as string, (p as any).email ?? null);
      });

      const mappedMembers: Member[] = userIds.map((id) => ({
        userId: id,
        email: emailById.get(id) ?? null,
      }));

      setMembers(mappedMembers);

      // Default "Paid By" to current user if they are in members
      if (mappedMembers.some((m) => m.userId === authUser.id)) {
        setPaidBy(authUser.id);
      } else if (mappedMembers[0]) {
        setPaidBy(mappedMembers[0].userId);
      }

      setIsLoading(false);
    };

    if (groupId) {
      loadData();
    }
  }, [groupId, router]);

  const toggleSelectedMember = (userId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleCustomShareChange = (userId: string, value: string) => {
    setCustomShares((prev) => ({
      ...prev,
      [userId]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDescriptionError(null);
    setAmountError(null);
    setSplitError(null);
    setGeneralError(null);

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setDescriptionError('Please enter a description.');
      return;
    }

    const descriptionPattern = /^[A-Za-z0-9 ,.!?'"-]+$/;
    if (!descriptionPattern.test(trimmedDescription)) {
      setDescriptionError(
        'Description can only contain letters, numbers, spaces, and basic punctuation.'
      );
      return;
    }

    const numericAmount = parseFloat(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount <= 0) {
      setAmountError('Please enter a valid positive amount.');
      return;
    }

    const amountParts = amount.split('.');
    if (amountParts[1] && amountParts[1].length > 2) {
      setAmountError('Amount cannot have more than 2 decimal places.');
      return;
    }

    if (!currentUser) {
      router.replace('/login');
      return;
    }

    const participantIds: string[] =
      splitType === 'equal_all'
        ? members.map((m) => m.userId)
        : splitType === 'equal_selected'
        ? selectedMemberIds
        : members.map((m) => m.userId);

    if (splitType === 'equal_selected' && participantIds.length === 0) {
      setSplitError('Please select at least one member to split between.');
      return;
    }

    // Build per-user splits
    type SplitRow = { user_id: string; amount: number };
    const splits: SplitRow[] = [];
    const totalCents = Math.round(numericAmount * 100);

    if (splitType === 'equal_all' || splitType === 'equal_selected') {
      const count = participantIds.length;
      if (count === 0) {
        setSplitError('No members available to split this expense.');
        return;
      }

      const baseCents = Math.floor(totalCents / count);
      const remainder = totalCents - baseCents * count;

      participantIds.forEach((userId, index) => {
        const shareCents = baseCents + (index < remainder ? 1 : 0);
        splits.push({
          user_id: userId,
          amount: shareCents / 100,
        });
      });
    } else if (splitType === 'custom') {
      let sumCents = 0;
      const customSplits: SplitRow[] = [];

      members.forEach((member) => {
        const raw = (customShares[member.userId] ?? '').trim();
        if (!raw) {
          return;
        }
        const value = parseFloat(raw);
        if (Number.isNaN(value) || value < 0) {
          setSplitError('Custom amounts must be non-negative numbers.');
          return;
        }
        const cents = Math.round(value * 100);
        if (cents > 0) {
          sumCents += cents;
          customSplits.push({
            user_id: member.userId,
            amount: cents / 100,
          });
        }
      });

      if (sumCents !== totalCents) {
        setSplitError('Custom amounts must add up exactly to the total amount.');
        return;
      }

      if (customSplits.length === 0) {
        setSplitError('Please enter at least one custom amount.');
        return;
      }

      splits.push(...customSplits);
    }

    if (splits.length === 0) {
      setSplitError('Could not compute splits for this expense.');
      return;
    }

    try {
      setIsSubmitting(true);

      const { data: expenseRow, error: expenseError } = await supabase
        .from('expenses')
        .insert({
          group_id: groupId,
          description: trimmedDescription,
          amount: numericAmount,
          paid_by: paidBy,
          split_type: splitType,
          created_by: currentUser.id,
          type: expenseType,
        })
        .select('id')
        .single();

      if (expenseError || !expenseRow) {
        setGeneralError(
          expenseError?.message ?? 'Could not save the expense.'
        );
        return;
      }

      const expenseId = expenseRow.id as string;

      const { error: splitsError } = await supabase
        .from('expense_splits')
        .insert(
          splits.map((s) => ({
            expense_id: expenseId,
            user_id: s.user_id,
            amount: s.amount,
          }))
        );

      if (splitsError) {
        setGeneralError(splitsError.message);
        return;
      }

      router.push(`/groups/${groupId}`);
    } catch (err) {
      console.error(err);
      setGeneralError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600 text-sm">Loading...</p>
      </div>
    );
  }

  // Helper for display: ₹ with 2 decimal places
  const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

  // For custom split running total
  let customTotal = 0;
  const amountNumber = parseFloat(amount);
  const hasValidAmountNumber =
    !Number.isNaN(amountNumber) && amountNumber > 0;

  if (splitType === 'custom') {
    customTotal = members.reduce((sum, member) => {
      const raw = (customShares[member.userId] ?? '').trim();
      if (!raw) return sum;
      const value = parseFloat(raw);
      if (Number.isNaN(value) || value < 0) return sum;
      return sum + value;
    }, 0);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-md p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">
            Add expense
          </h1>
          <Link
            href={`/groups/${groupId}`}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Back to group
          </Link>
        </div>

        {currentUser?.email && (
          <p className="text-sm text-gray-600">
            Signed in as{' '}
            <span className="font-medium">{currentUser.email}</span>
          </p>
        )}

        {generalError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Description */}
          <div className="space-y-1">
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700"
            >
              Description
            </label>
            <input
              id="description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="e.g. Dinner at ABC"
            />
            {descriptionError && (
              <p className="text-xs text-red-600">{descriptionError}</p>
            )}
          </div>

          {/* Amount */}
          <div className="space-y-1">
            <label
              htmlFor="amount"
              className="block text-sm font-medium text-gray-700"
            >
              Amount (₹)
            </label>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="₹0.00"
            />
            {amountError && (
              <p className="text-xs text-red-600">{amountError}</p>
            )}
          </div>

          {/* Paid by */}
          <div className="space-y-1">
            <label
              htmlFor="paidBy"
              className="block text-sm font-medium text-gray-700"
            >
              Paid by
            </label>
            <select
              id="paidBy"
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.email ?? member.userId}
                </option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Type
            </label>
            <div className="flex gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="type"
                  value="expense"
                  checked={expenseType === 'expense'}
                  onChange={() => setExpenseType('expense')}
                  className="h-4 w-4 text-indigo-600"
                />
                <span>Expense</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="type"
                  value="credit"
                  checked={expenseType === 'credit'}
                  onChange={() => setExpenseType('credit')}
                  className="h-4 w-4 text-indigo-600"
                />
                <span>Credit</span>
              </label>
            </div>
          </div>

          {/* Split type */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              Split type
            </label>
            <div className="flex flex-wrap gap-3 text-sm">
              <button
                type="button"
                onClick={() => setSplitType('equal_all')}
                className={`rounded-full border px-3 py-1 ${
                  splitType === 'equal_all'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Equal All
              </button>
              <button
                type="button"
                onClick={() => setSplitType('equal_selected')}
                className={`rounded-full border px-3 py-1 ${
                  splitType === 'equal_selected'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Equal Selected
              </button>
              <button
                type="button"
                onClick={() => setSplitType('custom')}
                className={`rounded-full border px-3 py-1 ${
                  splitType === 'custom'
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Custom
              </button>
            </div>
            {splitError && (
              <p className="text-xs text-red-600">{splitError}</p>
            )}
          </div>

          {/* Split details */}
          {splitType === 'equal_all' && (
            <div className="rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-700">
              This expense will be split equally between all group members.
            </div>
          )}

          {splitType === 'equal_selected' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-700">
                Select which members to split this expense between.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {members.map((member) => (
                  <label
                    key={member.userId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMemberIds.includes(member.userId)}
                      onChange={() => toggleSelectedMember(member.userId)}
                      className="h-4 w-4 text-indigo-600"
                    />
                    <span>{member.email ?? member.userId}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {splitType === 'custom' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-700">
                Enter the exact amount for each member. The total must equal the
                expense amount.
              </p>
              {hasValidAmountNumber && (
                <p
                  className={`text-[11px] ${
                    Math.round(customTotal * 100) ===
                    Math.round(amountNumber * 100)
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  Current total:{' '}
                  <span className="font-medium">
                    {formatCurrency(customTotal || 0)}
                  </span>{' '}
                  /{' '}
                  <span className="font-medium">
                    {formatCurrency(amountNumber)}
                  </span>
                </p>
              )}
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex-1 text-gray-800">
                      {member.email ?? member.userId}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customShares[member.userId] ?? ''}
                      onChange={(e) =>
                        handleCustomShareChange(member.userId, e.target.value)
                      }
                      className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {isSubmitting ? 'Saving...' : 'Save expense'}
          </button>
        </form>
      </div>
    </div>
  );
}
