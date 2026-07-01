import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JLinkDeviceCatalog } from '../../../jlink/device-catalog.js';
import {
  registerTool,
  ToolError,
  type ToolHandlerResult,
} from '../../registry.js';
import {
  jlinkDeviceCatalogGetInputSchema,
  jlinkDeviceCatalogSearchInputSchema,
  type JLinkDeviceCatalogGetInput,
  type JLinkDeviceCatalogSearchInput,
} from './schemas.js';

export function registerJLinkDeviceCatalogTools(server: McpServer, catalog: JLinkDeviceCatalog): void {
  registerTool(server, {
    name: 'jlink_device_catalog_search',
    description: 'Search installed SEGGER J-Link device database entries. Use this before writing jlink.target.',
    sensitivity: 'read-only',
    inputSchema: jlinkDeviceCatalogSearchInputSchema,
    handler: async (input: JLinkDeviceCatalogSearchInput): Promise<ToolHandlerResult> => {
      const result = await catalog.search({
        query: input.query,
        vendor: input.vendor,
        limit: input.limit,
      });
      return { success: true, evidence: { kind: 'debug_output', data: result, cursor: 0 } };
    },
  });

  registerTool(server, {
    name: 'jlink_device_catalog_get',
    description: 'Get one installed SEGGER J-Link device database entry by exact registered name.',
    sensitivity: 'read-only',
    inputSchema: jlinkDeviceCatalogGetInputSchema,
    handler: async (input: JLinkDeviceCatalogGetInput): Promise<ToolHandlerResult> => {
      const device = await catalog.get(input.name);
      if (device === undefined) {
        throw new ToolError('NOT_FOUND', `J-Link device not found in installed SEGGER catalog: ${input.name}`);
      }
      return { success: true, evidence: { kind: 'debug_output', data: { device }, cursor: 0 } };
    },
  });
}
