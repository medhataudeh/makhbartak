"use client";
import { createContext, useContext } from "react";
import type { AdminUser } from "@/lib/types";

export const AdminUserContext = createContext<AdminUser | null>(null);

export function useCurrentAdmin(): AdminUser {
  const u = useContext(AdminUserContext);
  if (!u) {
    // Fallback for sections rendered outside the admin tree (shouldn't happen).
    return { id: "_", username: "_", password: "", name: "—", role: "super_admin", isActive: true };
  }
  return u;
}
