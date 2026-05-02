"use client";
import { useEffect, useState } from "react";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminLogin } from "@/components/admin/AdminLogin";
import type { AdminUser } from "@/lib/types";

const SESSION_KEY = "makhbartak.admin.session";

export default function AdminPage() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration on mount
      if (raw) setUser(JSON.parse(raw));
    } catch {
      // localStorage may be blocked — fall through to login
    }
    setHydrated(true);
  }, []);

  const handleLogin = (u: AdminUser) => {
    setUser(u);
    try { window.localStorage.setItem(SESSION_KEY, JSON.stringify(u)); } catch {}
  };

  const handleLogout = () => {
    setUser(null);
    try { window.localStorage.removeItem(SESSION_KEY); } catch {}
  };

  if (!hydrated) return null;
  if (!user) return <AdminLogin onLogin={handleLogin} />;
  return <AdminDashboard user={user} onLogout={handleLogout} />;
}
