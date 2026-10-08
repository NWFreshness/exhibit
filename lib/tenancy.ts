// Tenancy: every district-owned query is scoped by districtId. There is no
// code path that reads a district-owned row without its districtId filter.
export type SessionUser = {
  id: string;
  email: string;
  districtId: string;
  role: "owner" | "curriculum" | "sped" | "viewer";
  districtName?: string;
  schoolId?: string | null;
};

export class TenantDenied extends Error {
  status = 404;
  constructor() {
    super("Not found");
  }
}

export function districtOf(user: SessionUser | null | undefined): string {
  if (!user?.districtId) throw new TenantDenied();
  return user.districtId;
}

export function canWrite(user: SessionUser): boolean {
  return user.role === "owner" || user.role === "curriculum" || user.role === "sped";
}

export function isOwner(user: SessionUser): boolean {
  return user.role === "owner";
}

/** Where-clause fragment every district-owned query must spread in. */
export function scope(user: SessionUser) {
  return { districtId: districtOf(user) };
}
