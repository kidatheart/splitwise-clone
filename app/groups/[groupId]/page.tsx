'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type AuthUser = {
  id: string;
  email: string | null;
};

type Group = {
  id: string;
  name: string;
};

type Member = {
  id: string;
  userId: string;
  email: string | null;
  role: string;
};

type ExpenseSplit = {
  userId: string;
  email: string | null;
  amount: number;
};

type Expense = {
  id: string;
  description: string;
  amount: number;
  createdAt: string;
  type: 'expense' | 'credit';
  paidById: string;
  paidByEmail: string | null;
  splits: ExpenseSplit[];
};

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expandedExpenseId, setExpandedExpenseId] = useState<string | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      // 1. Ensure user is logged in
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

      // 2. Fetch group
      const { data: groupRow, error: groupError } = await supabase
        .from('groups')
        .select('id, name')
        .eq('id', groupId)
        .single();

      if (groupError || !groupRow) {
        setError('This group could not be found.');
        setIsLoading(false);
        return;
      }

      const groupData: Group = {
        id: groupRow.id as string,
        name: groupRow.name as string,
      };
      setGroup(groupData);

      // 3. Check that the user is a member of this group
      const { data: membership, error: membershipError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', authUser.id)
        .maybeSingle();

      if (membershipError && membershipError.code !== 'PGRST116') {
        setError('Could not verify your access to this group.');
        setIsLoading(false);
        return;
      }

      if (!membership) {
        // User is not a member of this group
        router.replace('/dashboard');
        return;
      }

      // 4. Load all members of this group
      const { data: memberRows, error: membersError } = await supabase
        .from('group_members')
        .select('id, user_id, role')
        .eq('group_id', groupId);

      if (membersError) {
        setError('Could not load group members.');
        setIsLoading(false);
        return;
      }

      if (!memberRows || memberRows.length === 0) {
        setMembers([]);
        setIsLoading(false);
        return;
      }

      const userIds = memberRows.map((m) => m.user_id);

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', userIds);

      if (profilesError) {
        setError('Could not load member details.');
        setIsLoading(false);
        return;
      }

      const emailById = new Map<string, string | null>();
      (profiles ?? []).forEach((p) => {
        emailById.set(p.id as string, (p as any).email ?? null);
      });

      const mappedMembers: Member[] =
        memberRows?.map((m) => ({
          id: m.id as string,
          userId: m.user_id as string,
          email: emailById.get(m.user_id as string) ?? null,
          role: m.role as string,
        })) ?? [];

      setMembers(mappedMembers);

      // 5. Load expenses for this group
      const { data: expenseRows, error: expensesError } = await supabase
        .from('expenses')
        .select('id, description, amount, created_at, type, paid_by')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false });

      if (expensesError) {
        setError('Could not load expenses.');
        setIsLoading(false);
        return;
      }

      if (!expenseRows || expenseRows.length === 0) {
        setExpenses([]);
        setIsLoading(false);
        return;
      }

      const expenseIds = expenseRows.map((e) => e.id as string);

      const { data: splitRows, error: splitsError } = await supabase
        .from('expense_splits')
        .select('expense_id, user_id, amount')
        .in('expense_id', expenseIds);

      if (splitsError) {
        setError('Could not load expense details.');
        setIsLoading(false);
        return;
      }

      const userIdsForProfiles = new Set<string>();
      expenseRows.forEach((e) => {
        userIdsForProfiles.add(e.paid_by as string);
      });
      (splitRows ?? []).forEach((s) => {
        userIdsForProfiles.add(s.user_id as string);
      });

      const { data: splitProfiles, error: splitProfilesError } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', Array.from(userIdsForProfiles));

      if (splitProfilesError) {
        setError('Could not load expense participant details.');
        setIsLoading(false);
        return;
      }

      const emailByUserId = new Map<string, string | null>();
      (splitProfiles ?? []).forEach((p) => {
        emailByUserId.set(p.id as string, (p as any).email ?? null);
      });

      const expenseSplitsByExpenseId = new Map<string, ExpenseSplit[]>();
      (splitRows ?? []).forEach((s) => {
        const expId = s.expense_id as string;
        const userId = s.user_id as string;
        const list = expenseSplitsByExpenseId.get(expId) ?? [];
        list.push({
          userId,
          email: emailByUserId.get(userId) ?? null,
          amount: Number(s.amount),
        });
        expenseSplitsByExpenseId.set(expId, list);
      });

      const mappedExpenses: Expense[] =
        expenseRows?.map((e: any) => ({
          id: e.id as string,
          description: e.description as string,
          amount: Number(e.amount),
          createdAt: e.created_at as string,
          type: e.type as 'expense' | 'credit',
          paidById: e.paid_by as string,
          paidByEmail: emailByUserId.get(e.paid_by as string) ?? null,
          splits: expenseSplitsByExpenseId.get(e.id as string) ?? [],
        })) ?? [];

      setExpenses(mappedExpenses);
      setIsLoading(false);
    };

    if (groupId) {
      loadData();
    }
  }, [groupId, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600 text-sm">Loading group...</p>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="bg-white rounded-xl shadow-md px-6 py-4">
          <p className="text-sm text-gray-700">
            This group could not be found.
          </p>
          <div className="mt-3 text-right">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => `₹${value.toFixed(2)}`;

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {group.name}
            </h1>
            {currentUser?.email && (
              <p className="text-sm text-gray-600">
                Signed in as{' '}
                <span className="font-medium">{currentUser.email}</span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/groups/${group.id}/expenses/add`}
              className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Add Expense
            </Link>
            <Link
              href={`/groups/${group.id}/credits/add`}
              className="inline-flex items-center rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2"
            >
              Add Credit
            </Link>
            <Link
              href={`/groups/${group.id}/invite`}
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Invite Members
            </Link>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
            >
              Back
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">
            Members
          </h2>
          {members.length === 0 ? (
            <p className="text-sm text-gray-600">No members in this group yet.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="text-gray-900">
                      {member.email ?? member.userId}
                    </p>
                    <p className="text-xs text-gray-500">
                      {member.role === 'admin' ? 'Admin' : 'Member'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              Expenses & credits
            </h2>
            <div className="flex gap-3 text-xs text-gray-600">
              <span>
                Expenses:{' '}
                <span className="font-semibold">
                  {expenses.filter((e) => e.type === 'expense').length}
                </span>
              </span>
              <span>
                Credits:{' '}
                <span className="font-semibold">
                  {expenses.filter((e) => e.type === 'credit').length}
                </span>
              </span>
            </div>
          </div>

          {expenses.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
              No expenses or credits yet. Use &quot;Add Expense&quot; or
              &quot;Add Credit&quot; to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => {
                const isCredit = expense.type === 'credit';
                const isExpanded = expandedExpenseId === expense.id;

                return (
                  <button
                    key={expense.id}
                    type="button"
                    onClick={() =>
                      setExpandedExpenseId(
                        isExpanded ? null : expense.id
                      )
                    }
                    className={`w-full text-left rounded-lg border px-4 py-3 text-sm shadow-sm transition hover:border-indigo-500 hover:shadow-md ${
                      isCredit
                        ? 'border-green-200 bg-green-50'
                        : 'border-blue-200 bg-blue-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-900">
                            {expense.description}
                          </p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              isCredit
                                ? 'bg-green-100 text-green-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {isCredit ? 'Credit' : 'Expense'}
                          </span>
                          {expense.splits.length === 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              No splits
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-700">
                          Total:{' '}
                          <span className="font-medium">
                            {formatCurrency(expense.amount)}
                          </span>{' '}
                          • Paid by{' '}
                          <span className="font-medium">
                            {expense.paidByEmail ?? expense.paidById}
                          </span>
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {new Date(
                            expense.createdAt
                          ).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-[11px] text-gray-500">
                        {isExpanded ? 'Hide details' : 'View details'}
                      </span>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 rounded-md bg-white/70 px-3 py-2">
                        <p className="mb-2 text-xs font-semibold text-gray-800">
                          Member shares
                        </p>
                        {expense.splits.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            No split details available.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {expense.splits.map((split) => (
                              <li
                                key={`${expense.id}-${split.userId}`}
                                className="flex items-center justify-between text-xs text-gray-700"
                              >
                                <span>
                                  {split.email ?? split.userId}
                                </span>
                                <span
                                  className={
                                    split.amount < 0
                                      ? 'text-red-600'
                                      : 'text-green-700'
                                  }
                                >
                                  {split.amount < 0 ? '-' : '+'}
                                  {formatCurrency(Math.abs(split.amount))}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
