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
  id: string;
  userId: string;
  email: string | null;
  role: string;
};

export default function InviteMembersPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadPageData = async () => {
      // 1. Check logged-in user
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

      // 2. Load existing group members
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
      setIsLoading(false);
    };

    if (groupId) {
      loadPageData();
    }
  }, [groupId, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setEmailError(null);

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setEmailError('Please enter an email address.');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      setEmailError('Please enter a valid email address.');
      return;
    }

    if (!currentUser) {
      router.replace('/login');
      return;
    }

    if (currentUser.email && currentUser.email.toLowerCase() === email) {
      setError('You cannot invite yourself to the group.');
      return;
    }

    try {
      setIsSubmitting(true);

      // Look up user by email in a profiles table linked to auth users
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('email', email)
        .single();

      if (profileError || !profile) {
        setError('No account found with this email');
        return;
      }

      const userId = profile.id as string;

      // Prevent adding duplicate members
      const { data: existingMember, error: existingError } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingError && existingError.code !== 'PGRST116') {
        setError('Could not check existing members. Please try again.');
        return;
      }

      if (existingMember) {
        setError('This person is already in the group.');
        return;
      }

      const { data: newMemberRows, error: addError } = await supabase
        .from('group_members')
        .insert({
          group_id: groupId,
          user_id: userId,
          role: 'member',
        })
        .select('id, role')
        .single();

      if (addError || !newMemberRows) {
        setError(addError?.message ?? 'Could not add member.');
        return;
      }

      const newMember: Member = {
        id: newMemberRows.id as string,
        userId,
        email: (profile as any).email ?? null,
        role: newMemberRows.role as string,
      };

      setMembers((prev) => [...prev, newMember]);
      setInviteEmail('');
      setSuccess('Member added to the group.');
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
      <div className="w-full max-w-lg bg-white rounded-xl shadow-md p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">
            Invite members
          </h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Back
          </Link>
        </div>

        {currentUser?.email && (
          <p className="text-sm text-gray-600">
            You are signed in as{' '}
            <span className="font-medium">{currentUser.email}</span>
          </p>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor="inviteEmail"
              className="block text-sm font-medium text-gray-700"
            >
              Member email
            </label>
            <input
              id="inviteEmail"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="friend@example.com"
            />
            {emailError && (
              <p className="text-xs text-red-600">{emailError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full inline-flex justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            {isSubmitting ? 'Adding...' : 'Add Member'}
          </button>
        </form>

        <div className="pt-4 border-t border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            Current members
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
                      Role: {member.role}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
