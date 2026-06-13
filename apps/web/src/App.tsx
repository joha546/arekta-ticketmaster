import { useEffect, useState } from 'react';

type HealthResponse = { status: string };
type Event = { id: number; name: string; venue: string };

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [ready, setReady] = useState<string>('checking...');
  const [events, setEvents] = useState<Event[]>([]);
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function loadData() {
    setError(null);
    try {
      const [healthData, readyData, eventsData] = await Promise.all([
        fetchJson<HealthResponse>('/health'),
        fetchJson<{ status: string }>('/ready'),
        fetchJson<{ events: Event[] }>('/events'),
      ]);
      setHealth(healthData);
      setReady(readyData.status);
      setEvents(eventsData.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function createEvent(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await fetchJson('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, venue }),
      });
      setName('');
      setVenue('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <main>
      <h1>Arekta Ticketmaster</h1>
      <p>Full-stack demo: React + Express + PostgreSQL PSS + Observability</p>

      <div className="card">
        <h2>API Status</h2>
        <p>
          Health:{' '}
          <span className={health?.status === 'ok' ? 'status-ok' : 'status-error'}>
            {health?.status ?? 'unknown'}
          </span>
        </p>
        <p>
          Ready:{' '}
          <span className={ready === 'ready' ? 'status-ok' : 'status-error'}>{ready}</span>
        </p>
        {error && <p className="status-error">{error}</p>}
      </div>

      <div className="card">
        <h2>Create Event</h2>
        <form onSubmit={createEvent}>
          <input
            placeholder="Event name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            placeholder="Venue"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            required
          />
          <button type="submit">Create</button>
        </form>
      </div>

      <div className="card">
        <h2>Events (read from replica)</h2>
        {events.length === 0 ? (
          <p>No events yet.</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                {event.name} @ {event.venue}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
