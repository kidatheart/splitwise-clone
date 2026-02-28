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

export default function AddCreditPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string>('');
  const [paidTo, setPaidTo] = useState<string>('');

  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [participantError, setParticipantError] = useState<string | null>(null);
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

      // Default paid_by and paid_to
      if (mappedMembers.length > 0) {
        setPaidBy(authUser.id);
        const firstOther =
          mappedMembers.find((m) => m.userId !== authUser.id) ??
          mappedMembers[0];
        setPaidTo(firstOther.userId);
      }

      setIsLoading(false);
    };

    if (groupId) {
      loadData();
    }
  }, [groupId, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDescriptionError(null);
    setAmountError(null);
    setParticipantError(null);
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
      setAmountError('Amount must be greater than zero.');
      return;
    }

    const amountParts = amount.split('.');
    if (amountParts[1] && amountParts[1].length > 2) {
      setAmountError('Amount cannot have more than 2 decimal places.');
      return;
    }

    if (!paidBy || !paidTo) {
      setParticipantError('Please select both who paid and who received.');
      return;
    }

    if (paidBy === paidTo) {
      setParticipantError('Paid by and Paid to cannot be the same person.');
      return;
    }

    if (!currentUser) {
      router.replace('/login');
      return;
    }

    // Extra safety: ensure participants are still valid
    if (paidBy === paidTo) {
      setParticipantError('Paid by and Paid to cannot be the same person.');
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
          split_type: 'custom',
          created_by: currentUser.id,
          type: 'credit',
        })
        .select('id')
        .single();

      if (expenseError || !expenseRow) {
        setGeneralError(
          expenseError?.message ?? 'Could not save the credit.'
        );
        return;
      }

      const expenseId = expenseRow.id as string;

      const splits = [
        {
          expense_id: expenseId,
          user_id: paidBy,
          amount: -numericAmount,
        },
        {
          expense_id: expenseId,
          user_id: paidTo,
          amount: numericAmount,
        },
      ];

      const { error: splitsError } = await supabase
        .from('expense_splits')
        .insert(splits);

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">
            Add credit
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
              placeholder="e.g. Cash repayment"
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

          {/* Paid by / Paid to */}
          <div className="space-y-3">
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

            <div className="space-y-1">
              <label
                htmlFor="paidTo"
                className="block text-sm font-medium text-gray-700"
              >
                Paid to
              </label>
              <select
                id="paidTo"
                value={paidTo}
                onChange={(e) => setPaidTo(e.target.value)}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.email ?? member.userId}
                  </option>
                ))}
              </select>
            </div>

            {participantError && (
              <p className="text-xs text-red-600">{participantError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex justify-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
          >
            {isSubmitting ? 'Saving...' : 'Save credit'}
          </button>
        </form>
      </div>
    </div>
  );
}
