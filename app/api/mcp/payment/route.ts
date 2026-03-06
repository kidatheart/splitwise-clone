import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PAYMENT_DELAY_MS = 1500;
const FAILURE_RATE = 0.1; // 10%

function generatePaymentId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 12; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `mock_pay_${suffix}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PaymentBody = {
  amount: number;
  currency: string;
  payer_id: string;
  receiver_id: string;
  group_id: string;
  expense_description?: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PaymentBody;
    const {
      amount,
      currency,
      payer_id,
      receiver_id,
      group_id,
      expense_description,
    } = body;

    if (
      amount == null ||
      !currency ||
      !payer_id ||
      !receiver_id ||
      !group_id
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: amount, currency, payer_id, receiver_id, group_id',
        },
        { status: 400 }
      );
    }

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount must be a positive number' },
        { status: 400 }
      );
    }

    // Simulate payment processing delay
    await sleep(PAYMENT_DELAY_MS);

    // 10% random failure rate
    if (Math.random() < FAILURE_RATE) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payment failed (simulated)',
        },
        { status: 502 }
      );
    }

    const payment_id = generatePaymentId();

    const { data: row, error } = await supabase
      .from('payments')
      .insert({
        payment_id,
        amount,
        currency,
        payer_id,
        receiver_id,
        group_id,
        expense_description: expense_description ?? null,
        status: 'completed',
      })
      .select('id, payment_id, created_at')
      .single();

    if (error) {
      console.error('Payments insert error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      payment_id: row.payment_id,
      id: row.id,
      created_at: row.created_at,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
