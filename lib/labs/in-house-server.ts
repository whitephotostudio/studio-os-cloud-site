import { randomUUID } from "node:crypto";
import { inHouseSheetFromRow, loadInHousePriceSheets, type LabAccess } from "./server";
import type { InHousePriceSheetAction } from "./in-house-types";
import { LabError } from "./validation";

function databaseError(error: { code?: string; message?: string }): never {
  const message = error.message || "";
  if (/IN_HOUSE_VERSION_CONFLICT/.test(message)) throw new LabError("This private price copy changed in another window. Refresh before saving.", 409, "IN_HOUSE_VERSION_CONFLICT");
  if (/IN_HOUSE_SOURCE_CHANGED/.test(message)) throw new LabError("The source price sheet changed. Create a fresh import copy.", 409, "IN_HOUSE_SOURCE_CHANGED");
  if (/IN_HOUSE_(OWNER|NOT_FOUND)/.test(message)) throw new LabError("This private price copy does not belong to your studio.", 404, "IN_HOUSE_NOT_FOUND");
  if (/IN_HOUSE_LIMIT/.test(message)) throw new LabError("This studio has reached the 200 in-house test-copy limit.", 400, "IN_HOUSE_LIMIT");
  if (/IN_HOUSE_INVALID/.test(message)) throw new LabError("Check the private copy's retail prices and selected items.", 400, "IN_HOUSE_INVALID");
  throw new LabError("Your private in-house price copy could not be saved. Current school prices have not changed.", 503, "IN_HOUSE_UNAVAILABLE");
}

export async function performInHousePriceSheetAction(access: LabAccess, action: InHousePriceSheetAction) {
  const id = action.action === "import" ? randomUUID() : action.id;
  const document = action.action === "import" ? action.sheet : { name: action.name, entries: action.entries };
  const result = await access.service.rpc("save_in_house_price_sheet", { p_user_id: access.userId, p_action: action.action, p_id: id,
    p_expected_version: action.action === "save" ? action.expectedVersion : 0, p_document: document });
  if (result.error) databaseError(result.error);
  if (!result.data || typeof result.data !== "object" || typeof result.data.id !== "string") throw new LabError("The private copy receipt was unavailable. Refresh before retrying the same source import.", 503, "IN_HOUSE_UNAVAILABLE");
  return { sheet: inHouseSheetFromRow(result.data), sheets: await loadInHousePriceSheets(access), replayed: result.data.replayed === true };
}
