/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 *
 * MCP Proxy:
 *   Containers can also use MCP servers through this proxy.
 *   Requests to /mcp/:serverName/* are forwarded to the real MCP server
 *   with auth headers injected. MCP server config is read from ~/.claude.json.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

interface McpServerConfig {
  type: 'http' | 'sse' | 'stdio';
  url: string;
  headers?: Record<string, string>;
}

// Cache for MCP server configurations
let mcpServersConfig: Record<string, McpServerConfig> = {};

export function loadMcpServersConfig(): void {
  const globalClaudeJsonPath = path.join(
    process.env.HOME || '/root',
    '.claude.json',
  );
  if (fs.existsSync(globalClaudeJsonPath)) {
    try {
      const globalClaudeJson = JSON.parse(
        fs.readFileSync(globalClaudeJsonPath, 'utf-8'),
      );
      if (globalClaudeJson.mcpServers) {
        mcpServersConfig = globalClaudeJson.mcpServers;
        logger.info(
          { servers: Object.keys(mcpServersConfig) },
          'Loaded MCP servers config for proxy',
        );
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load MCP servers config');
    }
  }
}

export function getMcpServersConfig(): Record<string, McpServerConfig> {
  return mcpServersConfig;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
  const oauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      // Check if this is an MCP request
      const mcpMatch = req.url?.match(/^\/mcp\/([^\/]+)(\/.*)?$/);
      if (mcpMatch) {
        handleMcpRequest(req, res, mcpMatch[1], mcpMatch[2] || '/');
        return;
      }

      // Regular API proxy
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);

        // Only forward necessary headers, not all incoming headers
        // Some providers (like BigModel) reject requests with extra headers
        const headers: Record<string, string | number | string[] | undefined> =
          {
            host: upstreamUrl.host,
            'content-type': req.headers['content-type'] || 'application/json',
            'content-length': body.length,
            accept: req.headers['accept'] || 'application/json',
          };

        // Forward anthropic-specific headers if present
        if (req.headers['anthropic-version']) {
          headers['anthropic-version'] = req.headers['anthropic-version'];
        }
        if (req.headers['anthropic-beta']) {
          headers['anthropic-beta'] = req.headers['anthropic-beta'];
        }

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        // Build path: prepend base path from ANTHROPIC_BASE_URL if present
        const basePath = upstreamUrl.pathname.replace(/\/$/, '');
        const fullPath = basePath + req.url;

        // Debug: log what we're sending
        logger.info(
          {
            url: `${upstreamUrl.hostname}${fullPath}`,
            method: req.method,
            headers: Object.keys(headers),
            bodyLength: body.length,
          },
          'Credential proxy forwarding request',
        );

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: fullPath,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

/**
 * Handle MCP requests by forwarding to the real MCP server with auth headers.
 */
function handleMcpRequest(
  req: InstanceType<typeof import('http').IncomingMessage>,
  res: InstanceType<typeof import('http').ServerResponse>,
  serverName: string,
  path: string,
): void {
  const mcpConfig = mcpServersConfig[serverName];
  if (!mcpConfig) {
    logger.warn({ serverName }, 'MCP server not found in config');
    res.writeHead(404);
    res.end(`MCP server "${serverName}" not found`);
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    try {
      const targetUrl = new URL(mcpConfig.url);
      const isTargetHttps = targetUrl.protocol === 'https:';
      const makeTargetRequest = isTargetHttps ? httpsRequest : httpRequest;

      // Build headers - start with content headers
      const headers: Record<string, string | number | string[] | undefined> = {
        host: targetUrl.host,
        'content-type': req.headers['content-type'] || 'application/json',
        'content-length': body.length,
        accept: req.headers['accept'] || 'application/json, text/event-stream',
      };

      // Inject auth headers from MCP config
      if (mcpConfig.headers) {
        for (const [key, value] of Object.entries(mcpConfig.headers)) {
          headers[key.toLowerCase()] = value;
        }
      }

      // Build full path (avoid double slashes)
      const basePath = targetUrl.pathname.replace(/\/$/, '');
      const fullPath = path === '/' ? basePath : basePath + path;

      logger.info(
        {
          serverName,
          url: `${targetUrl.hostname}${fullPath}`,
          method: req.method,
          headers: Object.keys(headers),
          bodyLength: body.length,
        },
        'MCP proxy forwarding request',
      );

      const upstream = makeTargetRequest(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || (isTargetHttps ? 443 : 80),
          path: fullPath,
          method: req.method,
          headers,
        } as RequestOptions,
        (upRes) => {
          // Forward status and headers
          res.writeHead(upRes.statusCode!, upRes.headers);
          upRes.pipe(res);
        },
      );

      upstream.on('error', (err) => {
        logger.error(
          { err, serverName, url: mcpConfig.url },
          'MCP proxy upstream error',
        );
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Bad Gateway');
        }
      });

      upstream.write(body);
      upstream.end();
    } catch (err) {
      logger.error({ err, serverName, url: mcpConfig.url }, 'MCP proxy error');
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    }
  });
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
