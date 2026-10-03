import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ClientTools } from './client-tools.js';

export function createMcpServer(clientTools: ClientTools): McpServer {
  const server = new McpServer({ name: 'serviceready', version: '1.0.0' });
  server.registerTool('list_services', {
    description: 'List published services offered by a seller.',
    inputSchema: { seller_slug: z.string() }
  }, async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await clientTools.execute('list_services', args, 'mcp')) }]
  }));
  server.registerTool('get_service', {
    description: 'Get details for a published service.',
    inputSchema: { seller_slug: z.string(), service_id: z.string() }
  }, async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await clientTools.execute('get_service', args, 'mcp')) }]
  }));
  server.registerTool('request_quote', {
    description: 'Request a price-fixed quote. A human must approve and pay the deposit.',
    inputSchema: {
      seller_slug: z.string(),
      service_id: z.string(),
      client_name: z.string(),
      client_email: z.string().email(),
      brief: z.string()
    }
  }, async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await clientTools.execute('request_quote', args, 'mcp')) }]
  }));
  server.registerTool('get_quote_status', {
    description: 'Get the current status and amounts for a quote.',
    inputSchema: { quote_id: z.string() }
  }, async (args) => ({
    content: [{ type: 'text', text: JSON.stringify(await clientTools.execute('get_quote_status', args, 'mcp')) }]
  }));
  return server;
}
