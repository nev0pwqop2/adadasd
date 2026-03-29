import React from 'react';
import { useLocation } from 'wouter';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

const DiscordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.033.05a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
  </svg>
);

export type NavPage = 'home' | 'plans' | 'leaderboard' | 'dashboard' | 'admin';

interface NavbarProps {
  current?: NavPage;
}

export default function Navbar({ current }: NavbarProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user } = useGetMe({ query: { retry: false } as any });
  const { mutate: logoutMutate } = useLogout();

  const base = import.meta.env.BASE_URL;

  const handleLogin = () => { window.location.href = `${base}api/auth/discord`; };

  const handleLogout = () => {
    logoutMutate(undefined, {
      onSuccess: () => { queryClient.clear(); setLocation('/'); },
      onError:   () => { queryClient.clear(); setLocation('/'); },
    });
  };

  const links: { id: NavPage; label: string; href: string }[] = [
    { id: 'home',        label: 'Home',        href: `${base}` },
    { id: 'plans',       label: 'Plans',       href: `${base}plans` },
    { id: 'leaderboard', label: 'Leaderboard', href: `${base}leaderboard` },
    { id: 'dashboard',   label: 'Dashboard',   href: `${base}dashboard` },
    ...(user?.isAdmin ? [{ id: 'admin' as NavPage, label: 'Admin', href: `${base}admin` }] : []),
  ];

  return (
    <div className="flex-shrink-0 w-full px-4 pt-3 pb-1 sticky top-0 z-50 flex justify-center">
      <header className="w-full max-w-3xl bg-[#18120a]/90 backdrop-blur-md border border-[#f5a623]/10 rounded-2xl px-5 h-12 flex items-center justify-between shadow-[0_4px_32px_rgba(0,0,0,0.5)]">

        {/* Brand */}
        <a href={`${base}`} className="flex items-center gap-2.5 flex-shrink-0">
          <img src={`${base}exe-logo.png`} alt="EXE" className="w-7 h-7 rounded-lg" />
          <span className="font-bold text-[15px] text-white/90 tracking-tight">Exe Joiner</span>
        </a>

        {/* Nav links — centered absolutely */}
        <nav className="hidden sm:flex items-center gap-6 absolute left-1/2 -translate-x-1/2">
          {links.map(({ id, label, href }) => (
            <a
              key={id}
              href={href}
              className={`text-sm transition-colors ${
                current === id
                  ? 'text-[#f5a623] font-semibold'
                  : id === 'admin'
                    ? 'text-red-400/60 hover:text-red-400'
                    : 'text-white/40 hover:text-white/75'
              }`}
            >
              {label}
            </a>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {user ? (
            <>
              {/* Avatar with glowing ring */}
              <div className="relative">
                <div className="w-9 h-9 rounded-full ring-2 ring-[#f5a623]/60 ring-offset-2 ring-offset-[#18120a] p-[2px] bg-[#f5a623]/10">
                  {user.avatar ? (
                    <img
                      src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`}
                      alt="Avatar"
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full bg-[#f5a623]/20 flex items-center justify-center">
                      <span className="text-[#f5a623] text-xs font-bold">{user.username?.[0]?.toUpperCase()}</span>
                    </div>
                  )}
                </div>
              </div>

              <span className="hidden md:block text-xs font-medium text-white/50 max-w-[100px] truncate">{user.username}</span>

              <button
                onClick={handleLogout}
                className="text-sm text-white/40 hover:text-white/80 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={handleLogin}
              className="flex items-center gap-2 px-4 h-8 rounded-xl border border-[#f5a623]/20 bg-[#f5a623]/5 text-sm text-white/60 hover:text-white/90 hover:border-[#f5a623]/40 hover:bg-[#f5a623]/10 transition-all"
            >
              <DiscordIcon />
              Login
            </button>
          )}
        </div>

      </header>
    </div>
  );
}
