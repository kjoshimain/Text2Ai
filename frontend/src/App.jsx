import { useState } from 'react';

export default function App() {
  const [question, setQuestion] = useState('What are the eligibility criteria for a government scholarship?');
  const [result, setResult] = useState({
    answer: 'The backend will research the live web and return a source-backed answer when the service is running.',
    confidence: 'medium',
    status: 'ready',
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const response = await fetch('http://localhost:3001/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();
    if (data.result) {
      setResult({
        answer: data.result.answer,
        confidence: data.result.confidence,
        status: data.result.status,
      });
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
          <button type="submit">Research</button>
        </form>

        <section className="result-panel">
          <h2>Result</h2>
          <div className="meta">Status: {result.status}</div>
          <div className="meta">Confidence: {result.confidence}</div>
          <p>{result.answer}</p>
        </section>
      </main>

      <footer>
        Privacy note: phone numbers are masked, stored with hashes, and never logged in full.
      </footer>
    </div>
  );
}
