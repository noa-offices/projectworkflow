import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clientSequenceFromNumber,
  formatClientNumber,
} from "@/lib/projectworkflow-numbering";

export async function nextClientNumber(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("clients")
    .select("client_number")
    .returns<Array<{ client_number: string | null }>>();

  if (error) {
    throw error;
  }

  const maxSequence = (data ?? []).reduce((max, client) => {
    const sequence = clientSequenceFromNumber(client.client_number);
    return sequence ? Math.max(max, sequence) : max;
  }, 0);

  return formatClientNumber(maxSequence + 1);
}
