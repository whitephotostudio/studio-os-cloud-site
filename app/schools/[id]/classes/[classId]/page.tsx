import { redirect } from "next/navigation";

export default function SchoolClassRedirectPage({
  params,
}: {
  params: { id: string; classId: string };
}) {
  const classId = encodeURIComponent(decodeURIComponent(params.classId));
  redirect(`/dashboard/projects/schools/${params.id}/classes/${classId}`);
}
