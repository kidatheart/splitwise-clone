import { supabase } from '@/lib/supabase';

export type NetBalanceResult = {
  user_id: string;
  email: string | null;
  net_balance: number;
};

/**
 * calculateGroupBalances
 *
 * For a given group:
 * - Fetch all members and their emails
 * - Fetch all expenses and their splits
 * - For each user, compute:
 *   net_balance = total_paid - total_owed
 *
 * Rules:
 * - For normal expenses (type = 'expense'):
 *   - The payer gets +full amount
 *   - Each split row is treated as an amount the user owes, so we subtract it
 * - For credits (type = 'credit'):
 *   - We only use the split rows:
 *     - Positive split amounts increase a user's balance (they receive money)
 *     - Negative split amounts decrease a user's balance (they pay money)
 *
 * All balances are rounded to 2 decimal places.
 *
 * Example with 3 people (A, B, C):
 *
 * - Dinner: ₹900, paid by A, split equally (₹300 each)
 *   - A: +900 (paid) -300 (owes own share) = +600
 *   - B: -300
 *   - C: -300
 *
 * - Credit: A pays B back ₹200 (cash)
 *   - Splits:
 *     - A: -200
 *     - B: +200
 *
 * Net balances:
 *   - A:  +600  - 200 = +400  (A should receive ₹400 overall)
 *   - B:  -300  + 200 = -100  (B should pay ₹100 overall)
 *   - C:  -300        = -300  (C should pay ₹300 overall)
 */
export async function calculateGroupBalances(
  groupId: string
): Promise<NetBalanceResult[]> {
  // 1. Load group members
  const { data: memberRows, error: membersError } = await supabase
    .from('group_members')
    .select('user_id')
    .eq('group_id', groupId);

  if (membersError) {
    throw new Error(`Could not load group members: ${membersError.message}`);
  }

  const memberUserIds = (memberRows ?? []).map((m) => m.user_id as string);

  if (memberUserIds.length === 0) {
    return [];
  }

  // 2. Load member emails from profiles
  const { data: profileRows, error: profilesError } = await supabase
    .from('profiles')
    .select('id, email')
    .in('id', memberUserIds);

  if (profilesError) {
    throw new Error(`Could not load member profiles: ${profilesError.message}`);
  }

  const emailByUserId = new Map<string, string | null>();
  (profileRows ?? []).forEach((p) => {
    emailByUserId.set(p.id as string, (p as any).email ?? null);
  });

  // 3. Load all expenses for this group
  const { data: expenseRows, error: expensesError } = await supabase
    .from('expenses')
    .select('id, amount, paid_by, type')
    .eq('group_id', groupId);

  if (expensesError) {
    throw new Error(`Could not load expenses: ${expensesError.message}`);
  }

  if (!expenseRows || expenseRows.length === 0) {
    // No expenses yet -> everyone has zero balance
    return memberUserIds.map((userId) => ({
      user_id: userId,
      email: emailByUserId.get(userId) ?? null,
      net_balance: 0,
    }));
  }

  const expenseIds = expenseRows.map((e) => e.id as string);

  // Map expense ID to its type and paid_by so we can use this when processing splits
  const expenseMeta = new Map<
    string,
    { type: 'expense' | 'credit'; paid_by: string; amount: number }
  >();

  expenseRows.forEach((e: any) => {
    expenseMeta.set(e.id as string, {
      type: e.type as 'expense' | 'credit',
      paid_by: e.paid_by as string,
      amount: Number(e.amount),
    });
  });

  // 4. Load all splits
  const { data: splitRows, error: splitsError } = await supabase
    .from('expense_splits')
    .select('expense_id, user_id, amount')
    .in('expense_id', expenseIds);

  if (splitsError) {
    throw new Error(`Could not load expense splits: ${splitsError.message}`);
  }

  // 5. Initialize balances in cents (to avoid floating point issues)
  const balancesCents = new Map<string, number>();
  memberUserIds.forEach((userId) => {
    balancesCents.set(userId, 0);
  });

  // 6. Apply effects of each expense
  //    - For expenses: payer +full amount, each split -share
  //    - For credits: use only splits (positive = receive, negative = pay)
  // First, handle the "paid_by" effect for normal expenses
  expenseRows.forEach((e: any) => {
    const meta = expenseMeta.get(e.id as string);
    if (!meta) return;

    if (meta.type === 'expense') {
      const payer = meta.paid_by;
      const amountCents = Math.round(meta.amount * 100);
      const current = balancesCents.get(payer) ?? 0;
      balancesCents.set(payer, current + amountCents);
    }
  });

  // Then apply splits
  (splitRows ?? []).forEach((s) => {
    const expId = s.expense_id as string;
    const meta = expenseMeta.get(expId);
    if (!meta) return;

    const userId = s.user_id as string;
    const splitAmount = Number(s.amount);
    const splitCents = Math.round(splitAmount * 100);
    const current = balancesCents.get(userId) ?? 0;

    if (meta.type === 'expense') {
      // For normal expenses, split amount is what the user owes
      balancesCents.set(userId, current - splitCents);
    } else if (meta.type === 'credit') {
      // For credits, splits already encode payment direction:
      // - Positive = receives money
      // - Negative = pays money
      balancesCents.set(userId, current + splitCents);
    }
  });

  // 7. Convert balances back to rupees and round to 2 decimals
  const results: NetBalanceResult[] = memberUserIds.map((userId) => {
    const cents = balancesCents.get(userId) ?? 0;
    const rounded = Math.round(cents); // already in cents
    const net = rounded / 100;
    // Treat very small values as settled to avoid rounding noise
    const normalized =
      Math.abs(net) < 1 ? 0 : Number(net.toFixed(2));

    return {
      user_id: userId,
      email: emailByUserId.get(userId) ?? null,
      net_balance: normalized,
    };
  });

  return results;
}

export type SimplifiedDebt = {
  from_user_id: string;
  from_email: string | null;
  to_user_id: string;
  to_email: string | null;
  amount: number;
};

/**
 * simplifyDebts
 *
 * Takes the net balances for a group and returns a simplified list
 * of who should pay whom and how much, so that all balances go to zero.
 *
 * Approach:
 * - Split users into:
 *   - debtors: net_balance < 0  (they need to pay)
 *   - creditors: net_balance > 0 (they need to receive)
 * - Greedily match the biggest debtor with the biggest creditor:
 *   - payment = min(|debtor_balance|, creditor_balance)
 *   - reduce both balances by this payment
 *   - record one transaction debtor -> creditor for "payment"
 * - Repeat until no one owes or is owed.
 *
 * The result is a small set of direct payments without extra hops.
 */
export function simplifyDebts(
  balances: NetBalanceResult[]
): SimplifiedDebt[] {
  const debtors = balances
    .filter((b) => b.net_balance < 0)
    .map((b) => ({
      user_id: b.user_id,
      email: b.email,
      amount: Math.abs(b.net_balance),
    }))
    .sort((a, b) => b.amount - a.amount); // largest debtor first

  const creditors = balances
    .filter((b) => b.net_balance > 0)
    .map((b) => ({
      user_id: b.user_id,
      email: b.email,
      amount: b.net_balance,
    }))
    .sort((a, b) => b.amount - a.amount); // largest creditor first

  const result: SimplifiedDebt[] = [];

  let i = 0; // debtor index
  let j = 0; // creditor index

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    if (debtor.amount <= 0) {
      i += 1;
      continue;
    }
    if (creditor.amount <= 0) {
      j += 1;
      continue;
    }

    const payment = Math.min(debtor.amount, creditor.amount);

    if (payment > 0) {
      result.push({
        from_user_id: debtor.user_id,
        from_email: debtor.email,
        to_user_id: creditor.user_id,
        to_email: creditor.email,
        amount: Number(payment.toFixed(2)),
      });
    }

    debtor.amount = Number((debtor.amount - payment).toFixed(2));
    creditor.amount = Number((creditor.amount - payment).toFixed(2));

    if (debtor.amount <= 0.000001) {
      i += 1;
    }
    if (creditor.amount <= 0.000001) {
      j += 1;
    }
  }

  return result;
}


