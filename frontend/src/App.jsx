import { useRef, useState } from 'react';

export default function App() {
  const [question, setQuestion] = useState('What are the eligibility criteria for a government scholarship?');
  const [result, setResult] = useState({
    answer: 'Submit a question to start research.',
    confidence: 'n/a',
    status: 'ready',
  });
  const [progress, setProgress] = useState('');
  const [sources, setSources] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const eventSource = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSources([]);
    setWarnings([]);
    setProgress('Starting research');
    eventSource.current?.close();
    try {
      const response = await fetch('http://localhost:3001/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not start the research run.');

      const stream = new EventSource(`http://localhost:3001/api/research/${data.runId}/stream`);
      eventSource.current = stream;
      const stages = {
        connected: 'Connected',
        received: 'Question received',
        rewriting: 'Preparing search query',
        searching: 'Searching the web',
        search_complete: 'Search results ready',
        fetching: 'Reading source pages',
        fetch_complete: 'Source pages ready',
        synthesizing: 'Checking evidence',
        completed: 'Research complete',
        failed: 'Research could not be completed',
      };
      Object.entries(stages).forEach(([name, label]) => {
        stream.addEventListener(name, () => setProgress(label));
      });
      stream.addEventListener('final', (message) => {
        const entry = JSON.parse(message.data);
        setResult({
          answer: entry.answer,
          confidence: entry.confidence,
          status: entry.status,
        });
        setSources(entry.citations || []);
        setWarnings(entry.warnings || []);
        setProgress('');
        setBusy(false);
        stream.close();
      });
      stream.addEventListener('run_error', (message) => {
        setError(JSON.parse(message.data).error);
        setProgress('');
        setBusy(false);
        stream.close();
      });
      stream.onerror = () => {
        setError('The research progress stream disconnected. Check the run status and try again.');
        setProgress('');
        setBusy(false);
        stream.close();
      };
    } catch (requestError) {
      setError(requestError.message || 'Research could not be started.');
      setProgress('');
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <header>
        <h1>Text2AI</h1>
        <p>AI-powered SMS research assistant</p>
      </header>

      <main className="panel">
        <form onSubmit={handleSubmit}>
          <label htmlFor="question">Question</label>
          <textarea id="question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={5} />
          <button type="submit" disabled={busy || !question.trim()}>{busy ? 'Researching...' : 'Research'}</button>
        </form>

        <section className="result-panel">
          <h2>Result</h2>
          {progress && <div className="meta" role="status">{progress}</div>}
          {error && <div className="meta" role="alert">{error}</div>}
          {warnings.map((warning) => <div className="meta" role="status" key={warning}>{warning}</div>)}
          <div className="meta">Status: {result.status}</div>
          <div className="meta">Confidence: {result.confidence}</div>
          <p>{result.answer}</p>
          {sources.length > 0 && (
            <ul>
              {sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer>
        Privacy note: phone numbers are masked, stored with hashes, and never logged in full.
      </footer>
    </div>
  );
}
