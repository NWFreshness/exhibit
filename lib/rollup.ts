// Building rollup for acknowledgments. A viewer scoped to a building sees
// names only for that building; every other name stays a count. The owner
// and council roles see every name. Used by the training page and its test.
export type RollupSchool = { id: string; name: string };
export type RollupAck = { schoolId: string | null; name: string };
export type RollupViewer = { role: string; schoolId?: string | null };

export function buildingRollup(
  schools: RollupSchool[],
  acks: RollupAck[],
  viewer: RollupViewer
): Array<{ schoolId: string; name: string; count: number; names: string[] | null }> {
  const scoped = viewer.role === "viewer" && viewer.schoolId ? viewer.schoolId : null;
  return schools.map((s) => ({
    schoolId: s.id,
    name: s.name,
    count: acks.filter((a) => a.schoolId === s.id).length,
    names: scoped && s.id !== scoped ? null : acks.filter((a) => a.schoolId === s.id).map((a) => a.name),
  }));
}
