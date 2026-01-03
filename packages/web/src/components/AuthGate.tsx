import { useState, useEffect, type ReactNode } from 'react'
import { hasAuthToken, setAuthToken, getAuthHeaders } from '../utils/auth'

interface AuthGateProps {
  children: ReactNode
  apiUrl: string
}

export function AuthGate({ children, apiUrl }: AuthGateProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  // Check if we have a valid token on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (!hasAuthToken()) {
        setIsChecking(false)
        return
      }

      // Verify token is still valid by making a test request
      try {
        const res = await fetch(`${apiUrl}/api/claude/projects`, {
          headers: getAuthHeaders()
        })
        if (res.ok) {
          setIsAuthenticated(true)
        }
      } catch (e) {
        // Token invalid or server not reachable
        console.error('Auth check failed:', e)
      }
      setIsChecking(false)
    }

    checkAuth()
  }, [apiUrl])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token.trim()) {
      setError('Please enter a token')
      return
    }

    // Test the token
    try {
      const res = await fetch(`${apiUrl}/api/claude/projects`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.trim()}`
        }
      })

      if (res.ok) {
        setAuthToken(token.trim())
        setIsAuthenticated(true)
      } else if (res.status === 401) {
        setError('Invalid token')
      } else {
        setError(`Server error: ${res.status}`)
      }
    } catch (e) {
      setError('Could not connect to server. Is it running?')
    }
  }

  if (isChecking) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loading}>Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.title}>Sidecar</h1>
          <p style={styles.subtitle}>Enter your authentication token</p>
          <p style={styles.hint}>
            Find your token in the server console output, or in ~/.sidecar/auth.json
          </p>

          <form onSubmit={handleSubmit} style={styles.form}>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter token..."
              style={styles.input}
              autoFocus
            />
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" style={styles.button}>
              Connect
            </button>
          </form>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0a0a0a',
    padding: '20px'
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center'
  },
  title: {
    fontSize: '24px',
    fontWeight: 600,
    color: '#fff',
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '16px',
    color: '#888',
    marginBottom: '8px'
  },
  hint: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '24px'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  input: {
    padding: '12px 16px',
    fontSize: '16px',
    borderRadius: '8px',
    border: '1px solid #333',
    backgroundColor: '#0a0a0a',
    color: '#fff',
    outline: 'none'
  },
  button: {
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#3b82f6',
    color: '#fff',
    cursor: 'pointer'
  },
  error: {
    color: '#ef4444',
    fontSize: '14px',
    margin: 0
  },
  loading: {
    color: '#888',
    fontSize: '16px'
  }
}
