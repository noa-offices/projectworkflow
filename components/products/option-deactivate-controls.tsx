"use client";

import {
  deactivateProductComponent,
  deactivateProductComponentGroup,
} from "@/app/products/templates/actions";

export function DeactivateOptionForm({ id }: { id: string }) {
  return (
    <form
      action={deactivateProductComponent}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "This will deactivate this option. Existing quotation rows will not be changed.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-500"
      >
        Deactivate option
      </button>
    </form>
  );
}

export function DeactivateGroupForm({
  componentGroup,
  optionType,
  templateId,
}: {
  componentGroup: string;
  optionType: string;
  templateId: string;
}) {
  return (
    <form
      action={deactivateProductComponentGroup}
      onSubmit={(event) => {
        if (
          !window.confirm(
            "This will deactivate all options inside this group. Existing quotation rows will not be changed.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="option_type" value={optionType} />
      <input type="hidden" name="component_group" value={componentGroup} />
      <button
        type="submit"
        className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-500"
      >
        Deactivate group
      </button>
    </form>
  );
}
