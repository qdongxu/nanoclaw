---
name: human-timer
description: Create human-like timers with random delays. Use when asked to do something "around a time" or "from time to time" rather than precisely. Simulates natural human behavior by adding randomized jitter to scheduled tasks.
---

# Human-Like Timer Pattern

When asked to do something at an approximate time (not precise like a timer), use this pattern to simulate natural human behavior.

## When to Use

- User asks you to do something "around" a time
- User wants a reminder "from time to time"
- User wants periodic behavior that feels natural, not robotic
- Phrases like "every so often", "occasionally", "sometime after"

## The Pattern: Two-Stage Timer

Instead of scheduling the task directly, create a two-stage timer:

1. **Primary timer** - Set for the base interval/time
2. **Secondary timer** - When primary fires, add random delay (1/3 of primary interval), then execute

## Implementation via IPC

Use the IPC task scheduling system. Create tasks via:

```bash
echo '{"type":"schedule_task","schedule_type":"once","schedule_value":"<ISO timestamp>","prompt":"<task>","targetJid":"<chat_jid>"}' > /ipc/<group_folder>/tasks/<filename>.json
```

### Example: "Remind me about X every hour-ish"

Step 1 - Create primary timer for 1 hour:
```bash
# Calculate next_run = now + 1 hour
PRIMARY_INTERVAL_MS=3600000  # 1 hour
NEXT_RUN=$(date -u -d "+1 hour" +%Y-%m-%dT%H:%M:%S.000Z)
echo "{\"type\":\"schedule_task\",\"taskId\":\"reminder-x-primary\",\"schedule_type\":\"once\",\"schedule_value\":\"$NEXT_RUN\",\"prompt\":\"Create secondary timer for reminder X with random delay. Maximum delay: 1200000ms (20 minutes = 1/3 of 1 hour). Actual task: Remind about X.\",\"targetJid\":\"$CHAT_JID\"}" > /ipc/$GROUP_FOLDER/tasks/reminder-x-primary.json
```

Step 2 - When primary fires, agent creates secondary with random delay:
```bash
# Random delay between 0 and 1/3 of primary interval
RANDOM_DELAY=$((RANDOM % 1200000))  # 0 to 20 minutes
SECONDARY_RUN=$(date -u -d "+${RANDOM_DELAY} milliseconds" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d "+$((RANDOM_DELAY/1000)) seconds" +%Y-%m-%dT%H:%M:%S.000Z)
echo "{\"type\":\"schedule_task\",\"taskId\":\"reminder-x-execute\",\"schedule_type\":\"once\",\"schedule_value\":\"$SECONDARY_RUN\",\"prompt\":\"Remind about X\",\"targetJid\":\"$CHAT_JID\"}" > /ipc/$GROUP_FOLDER/tasks/reminder-x-execute.json
```

## Helper Function for Common Intervals

| Primary Interval | Max Random Delay (1/3) | Example Use |
|------------------|------------------------|-------------|
| 5 minutes | ~1.7 minutes | Quick check-ins |
| 15 minutes | 5 minutes | Short reminders |
| 30 minutes | 10 minutes | Moderate frequency |
| 1 hour | 20 minutes | Hourly-ish tasks |
| 2 hours | 40 minutes | Periodic updates |
| 6 hours | 2 hours | Semi-daily |
| 12 hours | 4 hours | Twice daily |
| 24 hours | 8 hours | Daily-ish |

## Full Example: Simulating Person Speaking in Chat

User request: "Say something in the group chat every now and then, like a person would"

This creates a recurring pattern with natural variation:

1. Schedule primary timer for base interval (e.g., 2 hours)
2. When primary fires:
   - Calculate random delay (0 to 40 minutes for 2-hour interval)
   - Schedule secondary timer
3. When secondary fires:
   - Send a casual message
   - Schedule next primary timer

### Recurring Human Timer

For ongoing behavior, make it recursive. After the secondary timer executes, schedule the next cycle:

```bash
# After sending message, schedule next primary timer
NEXT_PRIMARY=$(date -u -d "+2 hours" +%Y-%m-%dT%H:%M:%S.000Z)
echo "{\"type\":\"schedule_task\",\"taskId\":\"chat-presence-primary\",\"schedule_type\":\"once\",\"schedule_value\":\"$NEXT_PRIMARY\",\"prompt\":\"HUMAN_TIMER_SECONDARY: chat-presence. Max delay: 2400000ms (40 min). Task: Say something casual in the chat.\",\"targetJid\":\"$CHAT_JID\"}" > /ipc/$GROUP_FOLDER/tasks/chat-presence-primary.json
```

## Prompt Format for Self-Reference

When creating tasks that should continue the cycle, include clear instructions:

```
HUMAN_TIMER_SECONDARY: <timer-name>
Max delay: <milliseconds>ms
Task: <actual task to perform>
Then reschedule primary for: <interval>
```

This allows the agent to recognize it's part of a human-timer pattern and handle appropriately.

## Chat JID and Group Folder

These are available from environment or can be found in:
- `/data/groups.json` - contains chat JIDs and their group folders
- The current group's folder is passed to the agent at startup
