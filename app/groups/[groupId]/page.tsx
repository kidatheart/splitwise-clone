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

export default function GroupDetailPage() {
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = params.groupId;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
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

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
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
          <div className="flex items-center gap-3">
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

        <section className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">
            Expenses
          </h2>
          <p className="text-sm text-gray-600">
            Expenses will appear here.
          </p>
        </section>
      </div>
    </div>
  );
}
