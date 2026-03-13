import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store mock functions for assertions
const mockCreate = vi.fn().mockResolvedValue({});
const mockStart = vi.fn();

// Mock the lark SDK before importing the channel
vi.mock('@larksuiteoapi/node-sdk', () => {
  return {
    Client: class MockClient {
      im = {
        v1: {
          message: {
            create: mockCreate,
          },
        },
      };
    },
    WSClient: class MockWSClient {
      start = mockStart;
    },
    EventDispatcher: class MockEventDispatcher {
      register = vi.fn().mockReturnThis();
    },
    LoggerLevel: {
      debug: 'debug',
      info: 'info',
      warn: 'warn',
      error: 'error',
    },
  };
});

import { FeishuChannel } from './feishu.js';
import type { ChannelOpts } from './registry.js';

describe('FeishuChannel', () => {
  let channel: FeishuChannel;
  let mockOpts: ChannelOpts;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up environment variables
    process.env.FEISHU_APP_ID = 'test_app_id';
    process.env.FEISHU_APP_SECRET = 'test_app_secret';

    mockOpts = {
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: vi.fn().mockReturnValue({}),
    };

    channel = new FeishuChannel(mockOpts);
  });

  afterEach(() => {
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
  });

  describe('ownsJid', () => {
    it('returns true for feishu JIDs', () => {
      expect(channel.ownsJid('feishu:oc_abc123')).toBe(true);
      expect(channel.ownsJid('feishu:oc_xyz789')).toBe(true);
    });

    it('returns false for non-feishu JIDs', () => {
      expect(channel.ownsJid('whatsapp:123456789')).toBe(false);
      expect(channel.ownsJid('telegram:123456789')).toBe(false);
      expect(channel.ownsJid('slack:C12345678')).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('returns false before connect', () => {
      expect(channel.isConnected()).toBe(false);
    });

    it('returns true after connect', async () => {
      await channel.connect();
      expect(channel.isConnected()).toBe(true);
    });

    it('returns false after disconnect', async () => {
      await channel.connect();
      await channel.disconnect();
      expect(channel.isConnected()).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('throws for invalid JID', async () => {
      await expect(channel.sendMessage('whatsapp:123', 'test')).rejects.toThrow(
        'Invalid JID for Feishu channel',
      );
    });

    it('sends message via API client', async () => {
      await channel.connect();
      await channel.sendMessage('feishu:oc_test123', 'Hello World');

      expect(mockCreate).toHaveBeenCalledWith({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: 'oc_test123',
          msg_type: 'text',
          content: JSON.stringify({ text: 'Hello World' }),
        },
      });
    });

    it('splits long messages', async () => {
      await channel.connect();

      const longText = 'a'.repeat(5000);
      await channel.sendMessage('feishu:oc_test123', longText);

      // Should be called multiple times due to splitting
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});
