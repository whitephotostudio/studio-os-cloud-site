import { redirect } from "next/navigation";

export default function SchoolRedirectPage({ params }: { params: { id: string } }) {
  redirect(`/dashboard/projects/schools/${params.id}`);
}
