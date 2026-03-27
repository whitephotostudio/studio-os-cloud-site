import { redirect } from "next/navigation";

export default function SchoolSettingsRedirectPage({ params }: { params: { id: string } }) {
  redirect(`/dashboard/projects/schools/${params.id}/settings`);
}
