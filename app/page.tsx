'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const checkSession = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace('/login');
        return;
      }

      router.replace('/dashboard');
    };

    checkSession();
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <p className="text-sm text-gray-600">Checking your session...</p>
    </div>
  );
}
