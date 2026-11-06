import { defineHandler } from "nitro";
import { handleMcp } from "../../../src/server/mcp";

/** MCP Streamable HTTP endpoint: /mcp/:slug */
export default defineHandler(async (event) => {
  const slug = decodeURIComponent(
    new URL(event.req.url).pathname.split("/").filter(Boolean)[1] ?? "",
  );
  return handleMcp(event.req, slug);
});
