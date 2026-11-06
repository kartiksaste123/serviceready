import { defineHandler } from "nitro";
import { dispatchApi } from "../../../src/server/api-dispatch";

/** Nitro production/preview catch-all for /api/** */
export default defineHandler(async (event) => {
  return dispatchApi(event.req);
});
