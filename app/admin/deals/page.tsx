import { redirect } from "next/navigation";

// The deals list lives on /admin itself.
export default function AdminDealsIndex() {
  redirect("/admin");
}
