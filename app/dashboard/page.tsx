'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type User = {
  id: string;
  email: string | null;
};

type Group = {
  id: string;
  name: string;
  createdAt: string;
  membersCount: number;
};

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        router.replace('/login');
        return;
      }

      const authUser: User = {
        id: data.user.id,
        email: data.user.email ?? null,
      };
      setUser(authUser);

      const { data: groupRows, error: groupsError } = await supabase
        .from('groups')
        .select('id, name, created_at, group_members(count)')
        .eq('group_members.user_id', authUser.id);

      if (groupsError) {
        console.error(groupsError);
        setGroups([]);
      } else {
        const mappedGroups: Group[] =
          groupRows?.map((g: any) => ({
            id: g.id as string,
            name: g.name as string,
            createdAt: g.created_at as string,
            membersCount:
              (Array.isArray(g.group_members) &&
                g.group_members[0] &&
                (g.group_members[0].count as number)) ||
              0,
          })) ?? [];

        setGroups(mappedGroups);
      }

      setIsLoading(false);
    };

    loadData();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          setUser(null);
          setGroups([]);
          router.replace('/login');
        }
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-600 text-sm">Loading your dashboard...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div className="text-lg font-semibold text-gray-900">SplitWise</div>
          <div className="flex items-center gap-4">
            {user?.email && (
              <span className="text-sm text-gray-600 hidden sm:inline">
                {user.email}
              </span>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 space-y-6">
        <section className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Welcome{user?.email ? `, ${user.email}` : ''}!
            </h2>
            <p className="text-sm text-gray-600">
              Here are your groups.
            </p>
          </div>
          <Link
            href="/groups/create"
            className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Create New Group
          </Link>
        </section>

        {groups.length === 0 ? (
          <section className="bg-white rounded-xl shadow-sm p-6 text-center space-y-3">
            <p className="text-gray-700 font-medium">
              You don&apos;t have any groups yet.
            </p>
            <p className="text-sm text-gray-600">
              Create your first group to start splitting expenses with friends.
            </p>
            <Link
              href="/groups/create"
              className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            >
              Create your first group
            </Link>
          </section>
        ) : (
          <section className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">
              Your groups
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={`/groups/${group.id}`}
                  className="block rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm hover:border-indigo-500 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-base font-semibold text-gray-900">
                      {group.name}
                    </h4>
                    <span className="text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-700">
                      {group.membersCount} member
                      {group.membersCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Created on{' '}
                    {new Date(group.createdAt).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
