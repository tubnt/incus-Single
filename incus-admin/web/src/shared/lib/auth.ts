import { http } from "./http";

export interface User {
  id: number;
  email: string;
  name: string;
  role: "admin" | "customer";
  balance: number;
}

export async function fetchCurrentUser(): Promise<User> {
  return http.get<User>("/auth/me");
}

export function isAdmin(user: User): boolean {
  return user.role === "admin";
}
