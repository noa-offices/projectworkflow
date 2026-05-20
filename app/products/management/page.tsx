import { redirect } from "next/navigation";

export default function ProductManagementPage() {
  redirect("/products/templates?manage=1");
}
