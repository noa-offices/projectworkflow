import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageProductLibrary } from "@/lib/auth";
import { entities, minimizedRows, type ReadEntity, type ReadRow } from "@/lib/local-read-cache/types";
import { projectSummaries, quotationGroupCondition, quotationGroupKey, quotationSummaries, type SummaryQuotation } from "@/lib/local-read-cache/projections";
import { managementRows, brandRows, materialRows } from "./product-projections";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function failure(status: number, code: string) { return Response.json({ ok: false, code }, { status, headers }); }

export async function readProjection(request: Request, entity: string, createDb: () => Promise<SupabaseClient>) {
  try {
    if (![...entities, "session", "builder"].includes(entity as ReadEntity)) return failure(404, "NOT_FOUND");
    const db = await createDb();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError && authError.status !== 401 && authError.status !== 403) return failure(503, "UNAVAILABLE");
    if (!user) return failure(401, "UNAUTHORIZED");
    const { data: profile, error: profileError } = await db.from("profiles").select("role,account_status").eq("id", user.id).single();
    if (profileError) return failure(503, "UNAVAILABLE");
    if (profile?.account_status !== "active") return failure(403, "FORBIDDEN");
    if (["products", "products:management", "brands:list", "materials:library"].includes(entity) && !canManageProductLibrary(profile.role)) return failure(403, "FORBIDDEN");
    if (entity === "session") return Response.json({ ok: true, userId: user.id }, { headers });
    if (entity === "builder") {
      const id = new URL(request.url).searchParams.get("id") ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) return failure(400, "VALIDATION");
      const { data, error } = await db.from("quotations").select("id").eq("id", id).single();
      if (error || !data) return failure(403, "FORBIDDEN");
      return Response.json({ ok: true, userId: user.id, quotationId: data.id }, { headers });
    }
    let rows: ReadRow[] = [];
    if (entity === "products:management") {
      const { data, error } = await db.from("product_templates")
        .select("id,template_name,template_code,item_code,brand_id,main_category_id,sub_category_id,default_image_url,is_active,lifecycle_status")
        .order("brand_id").order("template_name").limit(500);
      if (error) return failure(503, "REFRESH_FAILED");
      const brandIds = [...new Set((data ?? []).map(t => t.brand_id).filter(Boolean))];
      const categoryIds = [...new Set((data ?? []).flatMap(t => [t.main_category_id, t.sub_category_id]).filter(Boolean))];
      const [brands, categories] = await Promise.all([
        brandIds.length ? db.from("brands").select("id,name,is_active").in("id", brandIds) : Promise.resolve({ data: [], error: null }),
        categoryIds.length ? db.from("product_categories").select("id,name").in("id", categoryIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (brands.error || categories.error) return failure(503, "REFRESH_FAILED");
      rows = managementRows(data ?? [], brands.data ?? [], categories.data ?? []);
    } else if (entity === "brands:list" || entity === "materials:library") {
      const { data: brands, error } = await db.from("brands")
        .select("id,name,code,origin,is_active").order("name").limit(250);
      if (error) return failure(503, "REFRESH_FAILED");
      const ids = (brands ?? []).map(b => b.id);
      if (entity === "brands:list") {
        const categories = ids.length ? await db.from("product_categories")
          .select("id,brand_id,parent_id,is_active").in("brand_id", ids).limit(10001) : { data: [], error: null };
        if (categories.error || (categories.data?.length ?? 0) > 10000) return failure(503, "REFRESH_FAILED");
        rows = brandRows(brands ?? [], categories.data ?? []);
      } else {
        const [groups, materials] = await Promise.all([
          ids.length ? db.from("brand_material_groups").select("id,brand_id,group_name,sort_order,is_active")
            .in("brand_id", ids).order("sort_order").order("group_name").limit(1001) : Promise.resolve({ data: [], error: null }),
          ids.length ? db.from("brand_materials")
            .select("id,brand_id,material_group_id,material_name,material_code,material_category,material_collection,image_url,sort_order,is_active")
            .in("brand_id", ids).order("material_group_id").order("sort_order").order("material_name").limit(1000) : Promise.resolve({ data: [], error: null }),
        ]);
        if (groups.error || materials.error || (groups.data?.length ?? 0) > 1000) return failure(503, "REFRESH_FAILED");
        rows = materialRows(brands ?? [], groups.data ?? [], materials.data ?? []);
      }
    } else if (entity === "clients") {
      const { data, error } = await db.from("clients").select("id,company_name,client_number,client_code,is_active").order("company_name").limit(500);
      if (error) return failure(503, "REFRESH_FAILED");
      rows = (data ?? []).map(r => ({
        id: r.id, title: r.company_name, code: r.client_number ?? r.client_code ?? "",
        subtitle: "", status: r.is_active ? "Active" : "Inactive", href: "/sales/clients?client=" + r.id,
      }));
    } else if (entity === "products") {
      const { data, error } = await db.from("product_templates")
        .select("id,template_name,template_code,item_code,description,brand_id,main_category_id,sub_category_id,default_image_url,is_active")
        .eq("is_active", true).eq("lifecycle_status", "active").order("template_name").limit(500);
      if (error) return failure(503, "REFRESH_FAILED");
      const brandIds = [...new Set((data ?? []).map(r => r.brand_id).filter(Boolean))];
      const categoryIds = [...new Set((data ?? []).flatMap(r => [r.main_category_id, r.sub_category_id]).filter(Boolean))];
      const [brands, categories] = await Promise.all([
        brandIds.length ? db.from("brands").select("id,name").in("id", brandIds) : Promise.resolve({ data: [], error: null }),
        categoryIds.length ? db.from("product_categories").select("id,name").in("id", categoryIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (brands.error || categories.error) return failure(503, "REFRESH_FAILED");
      const brandNames = new Map((brands.data ?? []).map(r => [r.id, r.name]));
      const categoryNames = new Map((categories.data ?? []).map(r => [r.id, r.name]));
      rows = (data ?? []).map(r => ({
        id: r.id, title: r.template_name, code: r.item_code ?? r.template_code ?? "",
        subtitle: String(r.description ?? "").slice(0, 300), status: "Active",
        href: "/products/templates?template=" + r.id, thumbnail: r.default_image_url ?? "",
        brand: brandNames.get(r.brand_id) ?? "", category: [categoryNames.get(r.main_category_id), categoryNames.get(r.sub_category_id)].filter(Boolean).join(" / "),
      }));
    } else {
      // JSON leaf selection keeps heavy layout/pricing snapshots off this read path.
      // These bounded batch reads are constant-count, never per-row queries.
      const fields = "id,client_id,project_id,quotation_no,title,legacy_reference,quotation_date,status,currency,grand_total,is_active,approved_salesperson_id,file:layout_settings->projectFile,approval:layout_settings->clientApprovalDraft,archivedAt:layout_settings->>folderArchivedAt,completedAt:layout_settings->>projectCompletedAt,cancelledAt:layout_settings->>projectCancelledAt";
      const [quotations, clients, projects] = await Promise.all([
        db.from("quotations").select(fields)
          .order("created_at", { ascending: false }).limit(1000),
        db.from("clients").select("id,company_name").order("company_name").limit(1000),
        entity === "quotations" ? db.from("projects").select("id,project_name,project_year").limit(1000) : Promise.resolve({ data: [], error: null }),
      ]);
      if (quotations.error || clients.error || projects.error) return failure(503, "REFRESH_FAILED");
      let source = quotations.data ?? [];
      if (entity === "quotations" && source.length) {
        // Fetch complete siblings for the recent folders in at most two batch reads.
        // A truncated sibling result is a failure, never a misleading folder count.
        const groups = new Map<string, typeof source[number]>();
        for (const row of source) {
          const key = quotationGroupKey(row);
          if (!groups.has(key) && groups.size < 200) groups.set(key, row);
        }
        const conditions = [...groups.values()].map(quotationGroupCondition);
        const batches = await Promise.all([conditions.slice(0, 100), conditions.slice(100)].filter(batch => batch.length)
          .map(batch => db.from("quotations").select(fields).or(batch.join(",")).order("created_at", { ascending: false }).limit(5001)));
        if (batches.some(batch => batch.error || (batch.data?.length ?? 0) > 5000)) return failure(503, "REFRESH_FAILED");
        source = batches.flatMap(batch => batch.data ?? []).filter(row => groups.has(quotationGroupKey(row)));
      }
      const normalized = source.map(r => ({
        ...r, layout_settings: {
          projectFile: r.file, clientApprovalDraft: r.approval, folderArchivedAt: r.archivedAt,
          projectCompletedAt: r.completedAt, projectCancelledAt: r.cancelledAt,
        },
      })) as unknown as SummaryQuotation[];
      const names = new Map((clients.data ?? []).map(r => [r.id, r.company_name]));
      rows = entity === "quotations"
        ? quotationSummaries(normalized, names, new Map((projects.data ?? []).map(r => [r.id, r])))
        : projectSummaries(normalized, names, entity === "completed");
    }
    return Response.json({
      ok: true, userId: user.id, entity, data: minimizedRows(entity as ReadEntity, rows), fetchedAt: Date.now(),
    }, { headers });
  } catch {
    return failure(503, "UNAVAILABLE");
  }
}
