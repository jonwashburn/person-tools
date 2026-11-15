// One entry for every path: the router's HTTP API, the MCP server at /mcp, the discovery file.
import { handle } from '../src/app.js';
export const onRequest = (ctx) => handle(ctx.request, ctx.env, ctx);
