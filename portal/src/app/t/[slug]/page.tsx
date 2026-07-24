import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/tenant";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);

  if (!project) {
    notFound();
  }

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1rem" }}>
      <p style={{ textTransform: "uppercase", letterSpacing: 1, color: "#888" }}>
        In partnership with {project.sponsor.name}
      </p>
      <h1>{project.name}</h1>
      <p>
        This project portal is under construction. Registration and progress
        tracking for beneficiaries, and a sponsor dashboard, are coming in a
        later phase.
      </p>
    </main>
  );
}
