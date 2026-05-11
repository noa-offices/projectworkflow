import Dexie, { type Table } from "dexie";
import type {
  LocalQuotationWorkspace,
  LocalQuotationWorkspaceIndex,
} from "@/lib/local/quotation-workspace";

class QuotationWorkspaceDb extends Dexie {
  quotationWorkspaces!: Table<LocalQuotationWorkspace, string>;
  quotationWorkspaceIndex!: Table<LocalQuotationWorkspaceIndex, string>;

  constructor() {
    super("projectworkflow-quotation-workspaces");

    this.version(1).stores({
      quotationWorkspaces: "local_id,server_quotation_id,project_id,client_id,quotation_no,updated_at,last_saved_to_software_at",
      quotationWorkspaceIndex: "server_quotation_id,project_id,client_id,quotation_no,updated_at,has_unsaved_changes,last_saved_to_software_at",
    });
  }
}

let dbInstance: QuotationWorkspaceDb | null = null;

export function quotationWorkspaceDb() {
  if (!dbInstance) {
    dbInstance = new QuotationWorkspaceDb();
  }

  return dbInstance;
}

export function workspaceIndexFromDocument(workspace: LocalQuotationWorkspace): LocalQuotationWorkspaceIndex {
  return {
    local_id: workspace.local_id,
    server_quotation_id: workspace.server_quotation_id,
    quotation_no: workspace.quotation_no,
    title: workspace.title,
    project_id: workspace.project_id,
    client_id: workspace.client_id,
    status: workspace.status,
    currency: workspace.currency,
    updated_at: workspace.updated_at,
    has_unsaved_changes: workspace.has_unsaved_changes,
    last_saved_to_software_at: workspace.last_saved_to_software_at,
  };
}

export async function saveWorkspaceDocument(workspace: LocalQuotationWorkspace) {
  const db = quotationWorkspaceDb();
  await db.transaction("rw", db.quotationWorkspaces, db.quotationWorkspaceIndex, async () => {
    await db.quotationWorkspaces.put(workspace);
    await db.quotationWorkspaceIndex.put(workspaceIndexFromDocument(workspace));
  });
}

export async function getWorkspaceDocument(serverQuotationId: string) {
  const db = quotationWorkspaceDb();
  return db.quotationWorkspaces.where("server_quotation_id").equals(serverQuotationId).first();
}

export async function getWorkspaceIndex(serverQuotationId: string) {
  const db = quotationWorkspaceDb();
  return db.quotationWorkspaceIndex.where("server_quotation_id").equals(serverQuotationId).first();
}

export async function listWorkspaceIndexByProject(projectId: string) {
  const db = quotationWorkspaceDb();
  return db.quotationWorkspaceIndex.where("project_id").equals(projectId).toArray();
}
