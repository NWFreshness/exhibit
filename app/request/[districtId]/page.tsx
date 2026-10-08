import { notFound } from "next/navigation";
import { Shell } from "@/app/shell";
import { prisma } from "@/lib/prisma";
import { PublicRequestForm } from "../form";

export default async function PublicRequestPage({ params }: { params: Promise<{ districtId: string }> }) {
  const { districtId } = await params;
  const district = await prisma.district.findUnique({ where: { id: districtId } });
  if (!district) notFound();
  return (
    <Shell user={null} title="Request a classroom tool">
      <p>This form goes straight into {district.name}&apos;s council file — not into someone&apos;s inbox. Requests land on hold until reviewed, and your words stay a note, never exhibit fact.</p>
      <div className="card"><PublicRequestForm districtId={district.id} districtName={district.name} /></div>
      <p className="hint sans">Never paste student names, grades, IEPs, or student work here. Contracts and district records only.</p>
    </Shell>
  );
}
