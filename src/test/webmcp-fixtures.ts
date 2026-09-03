import { SIGNED_IN_WEBMCP_TOOL_NAMES } from "../webmcp/tool-catalog";

export const ANONYMOUS_WEBMCP_TOOL_NAMES = [
  "inspect_room",
  "find_furniture",
  "apply_room_edit",
  "apply_room_structure_edit",
  "inspect_lighting_preview",
  "set_lighting_preview",
  "inspect_retailer_offers",
  "inspect_room_shopping_plan",
  "find_substitutes",
] as const;

export const CART_READ_WEBMCP_TOOL_NAMES = [
  "inspect_cart",
  "find_retailer_offers",
] as const;

export const CART_WRITE_WEBMCP_TOOL_NAMES = [
  "add_to_cart",
  "remove_from_cart",
  "set_cart_quantity",
] as const;

export const CART_WEBMCP_TOOL_NAMES = [
  ...SIGNED_IN_WEBMCP_TOOL_NAMES,
] as const;

export const AUTHENTICATED_WEBMCP_TOOL_NAMES = [
  ...ANONYMOUS_WEBMCP_TOOL_NAMES,
  ...CART_WEBMCP_TOOL_NAMES,
] as const;

export const withoutWebMcpTool = (
  names: readonly string[],
  omittedName: string,
) => names.filter((name) => name !== omittedName);

export const repeatWebMcpToolNames = (
  names: readonly string[],
  repetitions: number,
) => Array.from({ length: repetitions }, () => names).flat();
