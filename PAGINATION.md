# Session Message Pagination API

## Overview

The session API now supports pagination with infinite scrollback, allowing users to load the most recent messages initially and scroll up to load older messages progressively.

## API Endpoints

### GET `/api/claude/sessions/:sessionId`

Load messages from a specific session with pagination support.

**Query Parameters:**
- `limit` (number, default: 50) - Number of messages to return
  - Set to `0` to get all messages (no pagination)
  - Recommended: 50 for initial load, 20-50 for scrollback
- `offset` (number, default: 0) - Number of messages to skip from the end
  - `0` = most recent messages
  - `50` = skip 50 most recent, get the next batch
  - `100` = skip 100 most recent, get even older messages

**Response:**
```json
{
  "sessionId": "abc-123",
  "projectPath": "/path/to/project",
  "messageCount": 50,        // Number of messages in this response
  "totalMessages": 1361,     // Total messages available (for progress indication)
  "offset": 0,               // Current offset position
  "messages": [...],         // Array of ChatMessage objects
  "isActive": false,         // Whether session is currently active
  "isPartial": true          // true if pagination is applied
}
```

### GET `/api/claude/current`

Load messages from the most recent session (same pagination support as above).

## Usage Examples

### Initial Page Load
```bash
GET /api/claude/sessions/abc-123?limit=50&offset=0
```
Returns the 50 most recent messages.

### User Scrolls Up (Load More)
```bash
GET /api/claude/sessions/abc-123?limit=50&offset=50
```
Returns the next 50 older messages (messages 51-100 from the end).

### Continue Scrolling
```bash
GET /api/claude/sessions/abc-123?limit=50&offset=100
GET /api/claude/sessions/abc-123?limit=50&offset=150
GET /api/claude/sessions/abc-123?limit=50&offset=200
...
```

### Load All Messages (No Pagination)
```bash
GET /api/claude/sessions/abc-123?limit=0
```
Returns all messages (use sparingly for very large sessions).

## Frontend Implementation

### React Example with Infinite Scroll

```typescript
interface SessionData {
  messages: ChatMessage[]
  totalMessages: number
  hasMore: boolean
  isLoading: boolean
}

function useSessionMessages(sessionId: string) {
  const [data, setData] = useState<SessionData>({
    messages: [],
    totalMessages: 0,
    hasMore: true,
    isLoading: false
  })
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  // Initial load - most recent messages
  const loadInitial = async () => {
    setData(prev => ({ ...prev, isLoading: true }))

    const response = await fetch(
      `/api/claude/sessions/${sessionId}?limit=${LIMIT}&offset=0`
    )
    const result = await response.json()

    setData({
      messages: result.messages,
      totalMessages: result.totalMessages,
      hasMore: result.messages.length === LIMIT,
      isLoading: false
    })
    setOffset(LIMIT)
  }

  // Load older messages when user scrolls up
  const loadMore = async () => {
    if (data.isLoading || !data.hasMore) return

    setData(prev => ({ ...prev, isLoading: true }))

    const response = await fetch(
      `/api/claude/sessions/${sessionId}?limit=${LIMIT}&offset=${offset}`
    )
    const result = await response.json()

    setData(prev => ({
      messages: [...result.messages, ...prev.messages], // Prepend older messages
      totalMessages: result.totalMessages,
      hasMore: result.messages.length === LIMIT,
      isLoading: false
    }))
    setOffset(prev => prev + result.messages.length)
  }

  // Check if we can load more
  const canLoadMore = () => {
    return data.hasMore && offset < data.totalMessages
  }

  return { data, loadInitial, loadMore, canLoadMore }
}
```

### Scroll Detection

```typescript
function ChatWindow({ sessionId }: { sessionId: string }) {
  const { data, loadInitial, loadMore, canLoadMore } = useSessionMessages(sessionId)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadInitial()
  }, [sessionId])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return

    // Check if user scrolled to top (within 100px)
    if (element.scrollTop < 100 && canLoadMore()) {
      const oldScrollHeight = element.scrollHeight

      loadMore().then(() => {
        // Maintain scroll position after prepending messages
        const newScrollHeight = element.scrollHeight
        element.scrollTop = newScrollHeight - oldScrollHeight
      })
    }
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{ height: '100%', overflowY: 'auto' }}
    >
      {data.isLoading && <div>Loading...</div>}

      {canLoadMore() && (
        <button onClick={loadMore}>
          Load More ({data.messages.length} of {data.totalMessages})
        </button>
      )}

      {data.messages.map(msg => (
        <MessageComponent key={msg.id} message={msg} />
      ))}
    </div>
  )
}
```

### Using IntersectionObserver (Recommended)

```typescript
function ChatWindow({ sessionId }: { sessionId: string }) {
  const { data, loadInitial, loadMore, canLoadMore } = useSessionMessages(sessionId)
  const topSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadInitial()
  }, [sessionId])

  // Auto-load when sentinel becomes visible
  useEffect(() => {
    if (!topSentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && canLoadMore()) {
          loadMore()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(topSentinelRef.current)
    return () => observer.disconnect()
  }, [canLoadMore])

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      {/* Sentinel at top - triggers loadMore when visible */}
      <div ref={topSentinelRef} style={{ height: '10px' }}>
        {data.isLoading && <LoadingSpinner />}
      </div>

      {data.messages.map(msg => (
        <MessageComponent key={msg.id} message={msg} />
      ))}
    </div>
  )
}
```

## Performance Considerations

### Default Behavior
- **Initial load:** 50 messages (can be adjusted)
- **Scrollback:** 50 messages per batch
- **Total processing:** Still reads full file for deduplication and tool result attachment

### Benefits
- ✅ **Faster initial page loads** - Only 50 messages sent over network instead of thousands
- ✅ **Reduced JSON parsing** - Frontend only parses 50 messages initially
- ✅ **Better UX** - Chat appears instantly, older messages load on demand
- ✅ **Bandwidth savings** - Large sessions send 99% less data initially

### Trade-offs
- ⚠️ **Server still processes full file** - Required for message deduplication and tool result linking
- ⚠️ **Multiple requests** - Users scrolling through full history make multiple API calls
- ✅ **Caching friendly** - Same session/offset always returns same data

## Testing

### Manual Testing

```bash
# Initial load (most recent 50)
curl "http://localhost:3456/api/claude/sessions/SESSION_ID?limit=50&offset=0"

# Scroll up once (next 50 older)
curl "http://localhost:3456/api/claude/sessions/SESSION_ID?limit=50&offset=50"

# Scroll up again (next 50 older)
curl "http://localhost:3456/api/claude/sessions/SESSION_ID?limit=50&offset=100"

# Jump to middle of history
curl "http://localhost:3456/api/claude/sessions/SESSION_ID?limit=50&offset=500"

# Get all messages (no pagination)
curl "http://localhost:3456/api/claude/sessions/SESSION_ID?limit=0"
```

### Verification

1. **No overlap:** Messages from `offset=0` should not overlap with `offset=50`
2. **Continuity:** Last message at `offset=0` should be chronologically after first message at `offset=50`
3. **Consistency:** Same parameters should always return same messages
4. **Edge cases:**
   - `offset >= totalMessages` returns empty array
   - `offset < 0` is treated as 0
   - `limit=0` returns all messages

## Migration Guide

### Existing Code (Before)
```typescript
// Loaded ALL messages every time
const response = await fetch(`/api/claude/sessions/${sessionId}`)
const { messages } = await response.json()
```

### Updated Code (After)
```typescript
// Load only recent messages, add scrollback support
const response = await fetch(`/api/claude/sessions/${sessionId}?limit=50&offset=0`)
const { messages, totalMessages, hasMore } = await response.json()

// To maintain backward compatibility (load all)
const response = await fetch(`/api/claude/sessions/${sessionId}?limit=0`)
```

## See Also

- [Plan File](/Users/nikhilchavan/.claude/plans/humming-imagining-willow.md) - Original implementation plan
- Session Reader: `packages/server/src/claude/sessions.ts`
- API Routes: `packages/server/src/routes/claude.routes.ts`
