export function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalTextValue(formData: FormData, name: string) {
  const value = textValue(formData, name);
  return value || null;
}

export function boolValue(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

export function optionalNumberValue(formData: FormData, name: string) {
  const value = textValue(formData, name);

  if (!value) {
    return null;
  }

  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

export function normalizeClientName(value: string) {
  return value.trim().toLowerCase();
}

export function clientPayload(formData: FormData, userId?: string) {
  const payload = {
    company_name: textValue(formData, "company_name"),
    contact_person: optionalTextValue(formData, "contact_person"),
    email: optionalTextValue(formData, "email"),
    phone: optionalTextValue(formData, "phone"),
    website: optionalTextValue(formData, "website"),
    address: optionalTextValue(formData, "address"),
    city: optionalTextValue(formData, "city"),
    country: textValue(formData, "country") || "UAE",
    trn: optionalTextValue(formData, "trn"),
    notes: optionalTextValue(formData, "notes"),
    is_active: boolValue(formData, "is_active"),
  };

  return userId ? { ...payload, created_by: userId } : payload;
}
