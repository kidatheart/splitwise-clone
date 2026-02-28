'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type AuthUser = {
  id: string;
  email: string | null;
};

export default function CreateGroupPage() {
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      const { data, error: userError } = await supabase.auth.getUser();

      if (userError || !data.user) {
        router.replace('/login');
        return;
      }

      setUser({ id: data.user.id, email: data.user.email ?? null });
      setIsLoading(false);
    };

    loadUser();
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNameError(null);

    const name = groupName.trim();
    if (!name) {
      setNameError('Please enter a group name.');
      return;
    }

    const isValidName = /^[A-Za-z0-9 ]+$/.test(name);
    if (!isValidName) {
      setNameError(
        'Group name can only contain letters, numbers, and spaces.'
      );
      return;
    }

    if (!user) {
      router.replace('/login');
      return;
    }

    try {
      setIsSubmitting(true);

      const { data: createdGroup, error: createGroupError } = await supabase
        .from('groups')
        .insert({
          name,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (createGroupError || !createdGroup) {
        setError(createGroupError?.message ?? 'Could not create the group.');
        return;
      }

      const { error: addMemberError } = await supabase
        .from('group_members')
        .insert({
          group_id: createdGroup.id,
          user_id: user.id,
          role: 'admin',
        });

      if (addMemberError) {
        setError(addMemberError.message);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      console.error(err);
      setError('Something went wrong. Please try again.');
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Create group</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Back
          </Link>
        </div>

        {user?.email && (
          <p className="text-sm text-gray-600">
            Creating as <span className="font-medium">{user.email}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="groupName"
              className="block text-sm font-medium text-gray-700"
            >
              Group name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="e.g. Goa Trip"
            />
            {nameError && (
              <p className="text-xs text-red-600">{nameError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {isSubmitting ? 'Creating...' : 'Create group'}
          </button>
        </form>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
