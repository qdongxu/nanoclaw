---
name: add-feishu
description: Add Feishu (飞书) as a channel. Can run alongside other channels like WhatsApp, Telegram, or Slack. Uses WebSocket long connection for receiving messages.
---

# Add Feishu Channel

This skill adds Feishu (飞书, Lark for international) support to NanoClaw, then walks through interactive setup.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/feishu.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

### Ask the user

Use `AskUserQuestion` to collect configuration:

AskUserQuestion: Do you have a Feishu app configured (App ID and App Secret), or do you need to create one?

If they have credentials, collect the App ID and App Secret now. If not, we'll create one in Phase 3.

## Phase 2: Validate Code Changes

Since the Feishu channel is bundled with NanoClaw core, verify the implementation is in place:

```bash
# Check that the channel file exists
ls -la src/channels/feishu.ts

# Check that the dependency is installed
npm install

# Build and run tests
npm run build
npx vitest run src/channels/feishu.test.ts
```

All tests must pass and build must be clean before proceeding.

## Phase 3: Setup

### Create Feishu App (if needed)

If the user doesn't have a Feishu app, tell them:

> I need you to create a Feishu self-built app:
>
> 1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (for China) or [Lark Developer](https://open.larksuite.com/app) (for international)
> 2. Click **Create custom app** (创建企业自建应用)
> 3. Fill in:
>    - App name (应用名称): Something friendly (e.g., "NanoClaw Assistant")
>    - App description (应用描述): Brief description
> 4. After creation, go to **Credentials & Basic Info** (凭证与基础信息)
> 5. Copy the **App ID** (App ID) and **App Secret** (App Secret)
>
> **Important permissions needed:**
> 1. Go to **Permission Management** (权限管理)
> 2. Search and enable these permissions:
>    - `im:message` (获取与发送消息) - required
>    - `im:message:send_as_bot` (以应用身份发消息) - required
>    - `im:chat` (获取群组信息) - recommended
>    - `im:chat:readonly` (获取群组信息) - recommended
> 3. Go to **Event Subscriptions** (事件订阅)
> 4. Enable **Receive messages** (接收消息) events:
>    - `im.message.receive_v1` (接收消息)
> 5. For the subscription method, choose **Long Connection** (长连接) - this uses WebSocket and doesn't require a public URL
> 6. Publish the app version and wait for admin approval (if required in your organization)

Wait for the user to provide the App ID and App Secret.

### Configure environment

Add to `.env`:

```bash
FEISHU_APP_ID=cli_xxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Channels auto-enable when their credentials are present — no extra configuration needed.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

The container reads environment from `data/env/env`, not `.env` directly.

### Build and restart

```bash
npm run build
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux:
systemctl --user restart nanoclaw
```

## Phase 4: Registration

### Get Chat ID

Tell the user:

> To get your Feishu chat ID:
>
> 1. **For group chats:**
>    - Open Feishu and go to the group chat
>    - Click the group name at the top to open group info
>    - Click **Settings** (设置) → **Group Info** (群信息)
>    - The **Chat ID** (群号) is shown there (format: `oc_xxxxxxxxxxxxxxxx`)
>
> 2. **For direct messages:**
>    - In a DM, the chat ID format is `ou_xxxxxxxxxxxxxxxx` (user's open ID)
>    - You can get it from the user's profile or from API calls
>
> 3. **Via bot command:**
>    - Add the bot to a chat and send any message
>    - Check the logs: `tail -f logs/nanoclaw.log`
>    - Look for the chat_id in the received message data
>
> The JID format for NanoClaw is: `feishu:<chat-id>`

Wait for the user to provide the chat ID.

### Register the chat

The chat ID, name, and folder name are needed. Use `npx tsx setup/index.ts --step register` with the appropriate flags.

For a main chat (responds to all messages):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_main" --trigger "@${ASSISTANT_NAME}" --channel feishu --no-trigger-required --is-main
```

For additional chats (trigger-only):

```bash
npx tsx setup/index.ts --step register -- --jid "feishu:<chat-id>" --name "<chat-name>" --folder "feishu_<group-name>" --trigger "@${ASSISTANT_NAME}" --channel feishu
```

## Phase 5: Verify

### Test the connection

Tell the user:

> Send a message in your registered Feishu chat:
> - For main chat: Any message works
> - For non-main: Include the trigger word (e.g., `@NanoClaw hello`)
>
> The bot should respond within a few seconds.

### Check logs if needed

```bash
tail -f logs/nanoclaw.log
```

## Troubleshooting

### Bot not responding

1. Check `FEISHU_APP_ID` and `FEISHU_APP_SECRET` are set in `.env` AND synced to `data/env/env`
2. Check chat is registered: `sqlite3 store/messages.db "SELECT * FROM registered_groups WHERE jid LIKE 'feishu:%'"`
3. For non-main chats: message must include trigger pattern
4. Service is running: `launchctl list | grep nanoclaw` (macOS) or `systemctl --user status nanoclaw` (Linux)

### WebSocket connection issues

1. Check that **Long Connection** (长连接) is enabled in the Feishu app settings
2. Verify the app has been published and approved
3. Check that the app has the required permissions (`im:message`, `im:message:send_as_bot`)
4. Look for connection errors in the logs: `grep -i "feishu\|websocket\|connection" logs/nanoclaw.log`

### Bot not receiving messages

1. Verify the `im.message.receive_v1` event is subscribed
2. Check that the bot has been added to the group chat
3. For private groups, the bot may need to be invited by an admin
4. Verify the app version has been published (not just saved as draft)

### Permission errors

If you see permission errors in the logs:
1. Go to **Permission Management** (权限管理) in your Feishu app settings
2. Add the missing permission
3. **Publish a new version** of the app — permission changes require version publishing
4. Wait for admin approval if required

### Getting chat ID

If the chat ID is hard to find:
- Check the logs when sending a message to a chat with the bot
- The `chat_id` field in the received event data is what you need
- Group chat IDs start with `oc_`, user IDs start with `ou_`

## After Setup

The Feishu channel supports:
- **Group chats** — Bot must be added to the group
- **Direct messages** — Users can DM the bot directly
- **Multi-channel** — Can run alongside WhatsApp, Telegram, Slack, or other channels (auto-enabled by credentials)

## Known Limitations

- **Text only** — The bot currently only processes text messages. Images, files, and rich cards are not forwarded to the agent.
- **No typing indicator** — Feishu's API doesn't expose a typing indicator for bots. The `setTyping()` method is a no-op.
- **Message splitting is naive** — Long messages are split at a fixed 4000-character boundary. A smarter split would improve readability.
- **China vs International** — The channel uses Feishu (China) endpoints by default. For Lark (international), you would need to change `lark.Domain.Feishu` to `lark.Domain.Lark` in `src/channels/feishu.ts`.

## Removal

To remove Feishu integration:

1. Delete `src/channels/feishu.ts` and `src/channels/feishu.test.ts`
2. Remove `import './feishu.js'` from `src/channels/index.ts`
3. Remove `FEISHU_APP_ID` and `FEISHU_APP_SECRET` from `.env`
4. Remove Feishu registrations from SQLite: `sqlite3 store/messages.db "DELETE FROM registered_groups WHERE jid LIKE 'feishu:%'"`
5. Uninstall: `npm uninstall @larksuiteoapi/node-sdk`
6. Rebuild: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `npm run build && systemctl --user restart nanoclaw` (Linux)
