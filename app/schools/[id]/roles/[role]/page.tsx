import { redirect } from "next/navigation";

export default function SchoolRoleRedirectPage({
  params,
}: {
  params: { id: string; role: string };
}) {
  const role = encodeURIComponent(decodeURIComponent(params.role));
  redirect(`/dashboard/projects/schools/${params.id}/roles/${role}`);
}
